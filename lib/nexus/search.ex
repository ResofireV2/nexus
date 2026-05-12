defmodule Nexus.Search do
  @moduledoc """
  Full-text search over posts and replies using PostgreSQL tsvector.
  Falls back to trigram similarity for typo tolerance.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Forum.{Post, Reply, Space, Tag}
  alias Nexus.Accounts.User

  @page_size 20

  def search(query_string, opts \\ []) do
    kind       = Keyword.get(opts, :kind, "all")
    space_slug = Keyword.get(opts, :space)
    tag_slug   = Keyword.get(opts, :tag)
    sort       = Keyword.get(opts, :sort, "relevance")
    cursor     = Keyword.get(opts, :cursor)
    user       = Keyword.get(opts, :user)
    author     = Keyword.get(opts, :author)
    date_from  = Keyword.get(opts, :date_from)
    date_to    = Keyword.get(opts, :date_to)

    query_string = String.trim(query_string)

    if String.length(query_string) < 2 do
      %{posts: [], replies: [], total: 0, next_cursor: nil}
    else
      posts =
        if kind in ["all", "posts"] do
          search_posts(query_string, space_slug, tag_slug, sort, cursor, user, author, date_from, date_to)
        else
          %{results: [], next_cursor: nil}
        end

      replies =
        if kind in ["all", "replies"] do
          search_replies(query_string, sort, cursor, author, date_from, date_to)
        else
          %{results: [], next_cursor: nil}
        end

      %{
        posts:       posts.results,
        replies:     replies.results,
        next_cursor: posts.next_cursor || replies.next_cursor
      }
    end
  end

  defp search_posts(query_string, space_slug, tag_slug, sort, cursor, user, author, date_from, date_to) do
    tsquery = build_tsquery(query_string)

    query =
      from p in Post,
        where: p.hidden == false,
        select: %{p | search_vector: nil},
        preload: [:user, :space, :tags]

    query = filter_posts_by_space(query, space_slug)
    query = filter_posts_by_tag(query, tag_slug)
    query = filter_posts_by_visibility(query, user)
    query = filter_by_author(query, author, :post)
    query = filter_by_date(query, date_from, date_to, :post)

    query =
      if tsquery do
        q = from p in query,
              where: fragment("? @@ to_tsquery('english', ?)", p.search_vector, ^tsquery)
        if sort == "relevance" do
          from p in q, order_by: [
            desc: fragment("ts_rank(?, to_tsquery('english', ?), 32)", p.search_vector, ^tsquery),
            desc: p.inserted_at
          ]
        else
          q
        end
      else
        from p in query,
          where: fragment("similarity(title, ?) > 0.1 OR similarity(body, ?) > 0.1", ^query_string, ^query_string),
          order_by: [
            desc: fragment("GREATEST(similarity(title, ?), similarity(body, ?))", ^query_string, ^query_string),
            desc: p.inserted_at
          ]
      end

    query = apply_sort_override(query, sort)
    query = apply_post_cursor(query, cursor, sort)
    query = limit(query, @page_size + 1)

    results = Repo.all(query)
    results = attach_post_highlights(results, tsquery)

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

  defp filter_by_author(query, nil,    _kind), do: query
  defp filter_by_author(query, "",     _kind), do: query
  defp filter_by_author(query, username, :post) do
    join(query, :inner, [p], u in User, on: p.user_id == u.id and ilike(u.username, ^username))
  end
  defp filter_by_author(query, username, :reply) do
    join(query, :inner, [r], u in User, on: r.user_id == u.id and ilike(u.username, ^username))
  end

  defp filter_by_date(query, nil, nil, _kind), do: query
  defp filter_by_date(query, date_from, date_to, kind) do
    query
    |> maybe_filter_from(date_from, kind)
    |> maybe_filter_to(date_to, kind)
  end

  defp maybe_filter_from(q, nil, _), do: q
  defp maybe_filter_from(q, d, :post) do
    case Date.from_iso8601(d) do
      {:ok, date} -> where(q, [p], p.inserted_at >= ^DateTime.new!(date, ~T[00:00:00], "Etc/UTC"))
      _ -> q
    end
  end
  defp maybe_filter_from(q, d, :reply) do
    case Date.from_iso8601(d) do
      {:ok, date} -> where(q, [r], r.inserted_at >= ^DateTime.new!(date, ~T[00:00:00], "Etc/UTC"))
      _ -> q
    end
  end

  defp maybe_filter_to(q, nil, _), do: q
  defp maybe_filter_to(q, d, :post) do
    case Date.from_iso8601(d) do
      {:ok, date} -> where(q, [p], p.inserted_at <= ^DateTime.new!(date, ~T[23:59:59], "Etc/UTC"))
      _ -> q
    end
  end
  defp maybe_filter_to(q, d, :reply) do
    case Date.from_iso8601(d) do
      {:ok, date} -> where(q, [r], r.inserted_at <= ^DateTime.new!(date, ~T[23:59:59], "Etc/UTC"))
      _ -> q
    end
  end

  defp apply_sort_override(query, "latest") do
    from p in query, order_by: [desc: p.inserted_at]
  end
  defp apply_sort_override(query, "top") do
    from p in query, order_by: [desc: p.reaction_count, desc: p.inserted_at]
  end
  defp apply_sort_override(query, _), do: query

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

  defp attach_post_highlights(posts, nil) do
    Enum.map(posts, fn p -> Map.put(p, :highlight, trim_body(p.body)) end)
  end
  defp attach_post_highlights(posts, tsquery) do
    ids = Enum.map(posts, & &1.id)

    body_headlines =
      Repo.all(
        from p in Post,
          where: p.id in ^ids,
          select: {p.id, fragment(
            "ts_headline('english', ?, to_tsquery('english', ?), 'MaxWords=20,MinWords=10,ShortWord=3,HighlightAll=false,MaxFragments=1,FragmentDelimiter=\" … \"')",
            p.body, ^tsquery
          )}
      ) |> Map.new()

    title_headlines =
      Repo.all(
        from p in Post,
          where: p.id in ^ids,
          select: {p.id, fragment(
            "ts_headline('english', ?, to_tsquery('english', ?), 'HighlightAll=true')",
            p.title, ^tsquery
          )}
      ) |> Map.new()

    Enum.map(posts, fn p ->
      p
      |> Map.put(:highlight, Map.get(body_headlines, p.id, trim_body(p.body)))
      |> Map.put(:title_highlight, Map.get(title_headlines, p.id))
    end)
  end

  defp attach_reply_highlights(replies, nil) do
    Enum.map(replies, fn r -> Map.put(r, :highlight, trim_body(r.body)) end)
  end
  defp attach_reply_highlights(replies, tsquery) do
    ids = Enum.map(replies, & &1.id)
    headlines =
      Repo.all(
        from r in Reply,
          where: r.id in ^ids,
          select: {r.id, fragment(
            "ts_headline('english', ?, to_tsquery('english', ?), 'MaxWords=20,MinWords=10,ShortWord=3,HighlightAll=false,MaxFragments=1,FragmentDelimiter=\" … \"')",
            r.body, ^tsquery
          )}
      ) |> Map.new()
    Enum.map(replies, fn r -> Map.put(r, :highlight, Map.get(headlines, r.id, trim_body(r.body))) end)
  end

  defp search_replies(query_string, _sort, _cursor, author, date_from, date_to) do
    tsquery = build_tsquery(query_string)

    query =
      from r in Reply,
        where: r.hidden == false,
        select: %{r | search_vector: nil},
        preload: [:user, post: [:space]]

    query = filter_by_author(query, author, :reply)
    query = filter_by_date(query, date_from, date_to, :reply)

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

    results = query |> limit(@page_size) |> Repo.all()
    results = attach_reply_highlights(results, tsquery)
    %{results: results, next_cursor: nil}
  end

  defp trim_body(nil), do: nil
  defp trim_body(body) when byte_size(body) <= 300, do: body
  defp trim_body(body), do: String.slice(body, 0, 297) <> "..."

  defp build_tsquery(query_string) do
    words =
      query_string
      |> String.split(~r/\s+/, trim: true)
      |> Enum.map(&String.replace(&1, ~r/[^a-zA-Z0-9]/, ""))
      |> Enum.reject(&(String.length(&1) < 2))

    if Enum.empty?(words), do: nil,
    else: words |> Enum.map(&"#{&1}:*") |> Enum.join(" & ")
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
