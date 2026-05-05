defmodule Nexus.Search do
  @moduledoc """
  Full-text search over posts and replies using PostgreSQL tsvector.
  Falls back to trigram similarity for typo tolerance.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Forum.{Post, Reply, Space, Tag}

  @page_size 20

  # ---------------------------------------------------------------------------
  # Main search entry point
  # ---------------------------------------------------------------------------

  def search(query_string, opts \\ []) do
    kind      = Keyword.get(opts, :kind, "all")
    # kind: "all" | "posts" | "replies"
    space_slug = Keyword.get(opts, :space)
    tag_slug   = Keyword.get(opts, :tag)
    sort       = Keyword.get(opts, :sort, "relevance")
    # sort: "relevance" | "latest" | "top"
    cursor     = Keyword.get(opts, :cursor)
    user       = Keyword.get(opts, :user)

    query_string = String.trim(query_string)

    if String.length(query_string) < 2 do
      %{posts: [], replies: [], total: 0, next_cursor: nil}
    else
      posts   = if kind in ["all", "posts"],   do: search_posts(query_string, space_slug, tag_slug, sort, cursor, user), else: %{results: [], next_cursor: nil}
      replies = if kind in ["all", "replies"], do: search_replies(query_string, sort, cursor), else: %{results: [], next_cursor: nil}

      %{
        posts: posts.results,
        replies: replies.results,
        next_cursor: posts.next_cursor || replies.next_cursor
      }
    end
  end

  # ---------------------------------------------------------------------------
  # Post search
  # ---------------------------------------------------------------------------

  defp search_posts(query_string, space_slug, tag_slug, sort, cursor, user) do
    tsquery = build_tsquery(query_string)

    query =
      from p in Post,
        where: p.hidden == false,
        select: %{p | search_vector: nil},
        preload: [:user, :space, :tags]

    query = filter_posts_by_space(query, space_slug)
    query = filter_posts_by_tag(query, tag_slug)
    query = filter_posts_by_visibility(query, user)

    # Try full-text search first, fall back to trigram
    query =
      if tsquery do
        from p in query,
          where: fragment("? @@ to_tsquery('english', ?)", p.search_vector, ^tsquery),
          order_by: [
            desc: fragment("ts_rank(?, to_tsquery('english', ?), 32)", p.search_vector, ^tsquery),
            desc: p.inserted_at
          ]
      else
        from p in query,
          where:
            fragment("similarity(title, ?) > 0.1 OR similarity(body, ?) > 0.1",
              ^query_string, ^query_string),
          order_by: [
            desc: fragment("GREATEST(similarity(title, ?), similarity(body, ?))", ^query_string, ^query_string),
            desc: p.inserted_at
          ]
      end
    query = apply_post_cursor(query, cursor, sort)
    query = limit(query, @page_size + 1)

    results = Repo.all(query)

    {results, next_cursor} =
      if length(results) > @page_size do
        items = Enum.take(results, @page_size)
        {items, encode_post_cursor(List.last(items), sort)}
      else
        {results, nil}
      end

    %{results: results, next_cursor: next_cursor}
  end

  defp filter_posts_by_space(query, nil), do: query
  defp filter_posts_by_space(query, slug) do
    join(query, :inner, [p], s in Space, on: p.space_id == s.id and s.slug == ^slug)
  end

  defp filter_posts_by_tag(query, nil), do: query
  defp filter_posts_by_tag(query, slug) do
    query
    |> join(:inner, [p], pt in "post_tags", on: pt.post_id == p.id)
    |> join(:inner, [p, _s, pt], t in Tag, on: pt.tag_id == t.id and t.slug == ^slug)
  end

  defp filter_posts_by_visibility(query, nil) do
    join(query, :inner, [p], s in Space, on: p.space_id == s.id and s.visibility == "public")
  end
  defp filter_posts_by_visibility(query, _user), do: query

  defp apply_post_cursor(query, nil, _sort), do: query
  defp apply_post_cursor(query, cursor, sort) do
    case decode_cursor(cursor) do
      {:ok, %{"id" => id, "inserted_at" => ts}} when sort == "latest" ->
        dt = DateTime.from_unix!(ts)
        where(query, [p], p.inserted_at < ^dt or (p.inserted_at == ^dt and p.id < ^id))

      {:ok, %{"id" => id, "reaction_count" => rc}} when sort == "top" ->
        where(query, [p], p.reaction_count < ^rc or (p.reaction_count == ^rc and p.id < ^id))

      _ -> query
    end
  end

  defp encode_post_cursor(post, "latest") do
    %{"id" => post.id, "inserted_at" => DateTime.to_unix(post.inserted_at)}
    |> Jason.encode!() |> Base.url_encode64(padding: false)
  end
  defp encode_post_cursor(post, "top") do
    %{"id" => post.id, "reaction_count" => post.reaction_count}
    |> Jason.encode!() |> Base.url_encode64(padding: false)
  end
  defp encode_post_cursor(post, _) do
    %{"id" => post.id, "inserted_at" => DateTime.to_unix(post.inserted_at)}
    |> Jason.encode!() |> Base.url_encode64(padding: false)
  end

  # ---------------------------------------------------------------------------
  # Reply search
  # ---------------------------------------------------------------------------

  defp search_replies(query_string, _sort, _cursor) do
    tsquery = build_tsquery(query_string)

    query =
      from r in Reply,
        where: r.hidden == false,
        select: %{r | search_vector: nil},
        preload: [:user, post: [:space]]

    query =
      if tsquery do
        from r in query,
          where: fragment("? @@ to_tsquery('english', ?)", r.search_vector, ^tsquery),
          order_by: [desc: fragment("ts_rank(?, to_tsquery('english', ?))", r.search_vector, ^tsquery)]
      else
        from r in query,
          where: fragment("similarity(body, ?) > 0.1", ^query_string),
          order_by: [desc: fragment("similarity(body, ?)", ^query_string)]
      end

    query = limit(query, @page_size)
    results = Repo.all(query)

    %{results: results, next_cursor: nil}
  end

  # ---------------------------------------------------------------------------
  # tsquery builder
  # ---------------------------------------------------------------------------

  defp build_tsquery(query_string) do
    words =
      query_string
      |> String.split(~r/\s+/, trim: true)
      |> Enum.map(&String.replace(&1, ~r/[^a-zA-Z0-9]/, ""))
      |> Enum.reject(&(String.length(&1) < 2))

    if Enum.empty?(words) do
      nil
    else
      # Each word gets a prefix match with :* operator
      words
      |> Enum.map(&"#{&1}:*")
      |> Enum.join(" & ")
    end
  end

  defp decode_cursor(cursor) do
    with {:ok, json} <- Base.url_decode64(cursor, padding: false),
         {:ok, data} <- Jason.decode(json) do
      {:ok, data}
    else
      _ -> {:error, :invalid}
    end
  end
end
