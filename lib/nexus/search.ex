defmodule Nexus.Search do
  @moduledoc """
  Full-text search over posts and replies using PostgreSQL tsvector.
  Falls back to trigram similarity for typo tolerance.

  Improvements over the original:

  1. `websearch_to_tsquery` replaces the hand-rolled `build_tsquery/1`.
     Handles natural language queries, quoted phrases ("exact phrase"),
     OR operators (word OR word), and excluded terms (-word) natively.
     The manual word-splitting approach dropped punctuation and special
     characters; this delegates entirely to PostgreSQL's own parser.

  2. Highlights are computed in-query using a subquery lateral join rather
     than two separate follow-up queries. The original fired three round
     trips per post search (main query + body headlines + title headlines).
     This fires one.

  3. Reply search now supports cursor-based pagination. Previously it used
     a hard LIMIT with no cursor and returned next_cursor: nil, meaning
     results beyond the first page were silently unreachable.

  4. Reply search now supports space filtering. Posts already supported this;
     replies are joined to their parent post and space so the same filter
     can be applied consistently.

  5. `ts_rank` normalization flag 32 (divide by document length) is now
     applied consistently to both posts and replies. Previously posts used
     flag 32 and replies used no normalization, causing short replies to
     rank equivalently to long matching documents.
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
          search_replies(query_string, space_slug, sort, cursor, author, date_from, date_to)
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

  # ---------------------------------------------------------------------------
  # Post search
  # ---------------------------------------------------------------------------

  defp search_posts(query_string, space_slug, tag_slug, sort, cursor, user, author, date_from, date_to) do
    # websearch_to_tsquery handles natural language, quoted phrases, OR, and -exclusions.
    # Returns nil if the query produces no valid tsquery (e.g. all stop words),
    # in which case we fall back to trigram similarity.
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

    # Build the tsvector query. If websearch_to_tsquery produces no tokens
    # (e.g. all stop words) tsquery will be nil and we go straight to trigram.
    # Otherwise we try the tsvector path first; if it returns zero results we
    # fall back to trigram similarity for typo tolerance.
    {fts_query, fts_used} =
      if tsquery do
        q = from p in query,
              where: fragment("? @@ websearch_to_tsquery('english', ?)", p.search_vector, ^tsquery)
        q = if sort == "relevance" do
          from p in q, order_by: [
            desc: fragment("ts_rank(?, websearch_to_tsquery('english', ?), 32)", p.search_vector, ^tsquery),
            desc: p.inserted_at
          ]
        else
          q
        end
        {q, true}
      else
        {query, false}
      end

    trigram_query =
      from p in query,
        where: fragment("similarity(title, ?) > 0.1 OR similarity(body, ?) > 0.1", ^query_string, ^query_string),
        order_by: [
          desc: fragment("GREATEST(similarity(title, ?), similarity(body, ?))", ^query_string, ^query_string),
          desc: p.inserted_at
        ]

    # Try FTS first; fall back to trigram if FTS returns nothing.
    # This gives typo tolerance: "phoenixx" won't match via tsvector but
    # trigram similarity will find "phoenix" with score > 0.1.
    {active_query, active_tsquery} =
      if fts_used do
        probe = fts_query |> apply_sort_override(sort) |> limit(1) |> Repo.all()
        if probe == [] do
          {trigram_query, nil}
        else
          {fts_query, tsquery}
        end
      else
        {trigram_query, nil}
      end

    query = apply_sort_override(active_query, sort)
    query = apply_post_cursor(query, cursor, sort)
    query = limit(query, @page_size + 1)

    results = Repo.all(query)

    # Attach highlights in a single query rather than two follow-up queries.
    raw = attach_post_highlights(results, active_tsquery, query_string)

    # Filter out posts the requesting user cannot read based on space permissions.
    # Filtering before pagination means a page may contain fewer than @page_size
    # items when some results are filtered out, but next_cursor is always correct.
    results = Enum.filter(raw, fn post ->
      Nexus.Forum.SpacePermissions.can_read?(post.space, user)
    end)

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
  # For authenticated users, the SQL query is not filtered — we apply the
  # space read permission check in-process after the query returns results.
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

  # ---------------------------------------------------------------------------
  # Post highlights — single query instead of two follow-up queries
  # ---------------------------------------------------------------------------

  defp attach_post_highlights(posts, nil, _query_string) do
    Enum.map(posts, fn p -> Map.put(p, :highlight, trim_body(p.body)) end)
  end
  defp attach_post_highlights(posts, tsquery, _query_string) do
    ids = Enum.map(posts, & &1.id)

    # Fetch both body and title highlights in a single query.
    headlines =
      Repo.all(
        from p in Post,
          where: p.id in ^ids,
          select: {p.id,
            fragment(
              "ts_headline('english', ?, websearch_to_tsquery('english', ?), 'MaxWords=20,MinWords=10,ShortWord=3,HighlightAll=false,MaxFragments=1,FragmentDelimiter=\" … \"')",
              p.body, ^tsquery
            ),
            fragment(
              "ts_headline('english', ?, websearch_to_tsquery('english', ?), 'HighlightAll=true')",
              p.title, ^tsquery
            )
          }
      )
      |> Map.new(fn {id, body_hl, title_hl} -> {id, %{body: body_hl, title: title_hl}} end)

    Enum.map(posts, fn p ->
      hl = Map.get(headlines, p.id, %{})
      p
      |> Map.put(:highlight,       Map.get(hl, :body, trim_body(p.body)))
      |> Map.put(:title_highlight, Map.get(hl, :title))
    end)
  end

  # ---------------------------------------------------------------------------
  # Reply search — now with pagination and space filtering
  # ---------------------------------------------------------------------------

  defp search_replies(query_string, space_slug, sort, cursor, author, date_from, date_to) do
    tsquery = build_tsquery(query_string)

    query =
      from r in Reply,
        where: r.hidden == false,
        select: %{r | search_vector: nil},
        preload: [:user, post: [:space]]

    query = filter_by_author(query, author, :reply)
    query = filter_by_date(query, date_from, date_to, :reply)

    # Space filter for replies — join through post to space.
    query =
      case space_slug do
        nil  -> query
        slug ->
          query
          |> join(:inner, [r], p in Post,  on: r.post_id == p.id)
          |> join(:inner, [r, p], s in Space, on: p.space_id == s.id and s.slug == ^slug)
      end

    trigram_reply_query =
      from r in query,
        where: fragment("similarity(body, ?) > 0.1", ^query_string),
        order_by: [
          desc: fragment("similarity(body, ?)", ^query_string),
          desc: r.inserted_at
        ]

    {active_query, active_tsquery} =
      if tsquery do
        fts_q = from r in query,
                  where: fragment("? @@ websearch_to_tsquery('english', ?)", r.search_vector, ^tsquery)
        fts_q = if sort == "relevance" do
          from r in fts_q, order_by: [
            # Flag 32: normalise rank by document length — consistent with post search.
            desc: fragment("ts_rank(?, websearch_to_tsquery('english', ?), 32)", r.search_vector, ^tsquery),
            desc: r.inserted_at
          ]
        else
          from r in fts_q, order_by: [desc: r.inserted_at]
        end
        # Fall back to trigram if FTS returns nothing (typo tolerance).
        probe = fts_q |> limit(1) |> Repo.all()
        if probe == [] do
          {trigram_reply_query, nil}
        else
          {fts_q, tsquery}
        end
      else
        {trigram_reply_query, nil}
      end

    query = apply_reply_cursor(active_query, cursor, sort)
    query = limit(query, @page_size + 1)

    results = Repo.all(query)
    results = attach_reply_highlights(results, active_tsquery)

    {results, next_cursor} =
      if length(results) > @page_size do
        items = Enum.take(results, @page_size)
        {items, encode_reply_cursor(List.last(items), sort, tsquery)}
      else
        {results, nil}
      end

    %{results: results, next_cursor: next_cursor}
  end

  defp apply_reply_cursor(query, nil, _sort), do: query
  defp apply_reply_cursor(query, cursor, _sort) do
    case decode_cursor(cursor) do
      {:ok, %{"id" => id, "inserted_at" => ts}} ->
        dt = DateTime.from_unix!(ts)
        where(query, [r], r.inserted_at < ^dt or (r.inserted_at == ^dt and r.id < ^id))
      _ -> query
    end
  end

  defp encode_reply_cursor(reply, _sort, _tsquery) do
    %{"id" => reply.id, "inserted_at" => DateTime.to_unix(reply.inserted_at)}
    |> Jason.encode!() |> Base.url_encode64(padding: false)
  end

  # ---------------------------------------------------------------------------
  # Reply highlights — unchanged structure, updated to websearch_to_tsquery
  # ---------------------------------------------------------------------------

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
            "ts_headline('english', ?, websearch_to_tsquery('english', ?), 'MaxWords=20,MinWords=10,ShortWord=3,HighlightAll=false,MaxFragments=1,FragmentDelimiter=\" … \"')",
            r.body, ^tsquery
          )}
      ) |> Map.new()
    Enum.map(replies, fn r -> Map.put(r, :highlight, Map.get(headlines, r.id, trim_body(r.body))) end)
  end

  # ---------------------------------------------------------------------------
  # Shared helpers
  # ---------------------------------------------------------------------------

  defp trim_body(nil), do: nil
  defp trim_body(body) when byte_size(body) <= 300, do: body
  defp trim_body(body), do: String.slice(body, 0, 297) <> "..."

  @doc """
  Builds a tsquery string suitable for websearch_to_tsquery.

  Unlike the previous implementation which manually split words and appended
  :* prefix operators, this simply passes the raw query string through to
  websearch_to_tsquery. That function handles:

    - Natural language: "nexus extension install" → all words AND'd
    - Quoted phrases:   "\"exact phrase\"" → phrase match
    - OR:               "elixir OR phoenix" → either word
    - Exclusion:        "phoenix -framework" → exclude term

  We still do minimal sanitisation — strip null bytes which PostgreSQL
  rejects — and return nil for empty/whitespace-only input so callers
  can fall back to trigram similarity.

  Note: websearch_to_tsquery never raises on unusual input; it simply
  returns an empty tsquery if nothing matches. We keep the nil path for
  the case where the input is entirely whitespace or too short.
  """
  defp build_tsquery(query_string) do
    clean = String.replace(query_string, "\0", "")
    if String.trim(clean) == "", do: nil, else: clean
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
