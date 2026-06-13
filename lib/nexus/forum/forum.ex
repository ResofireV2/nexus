defmodule Nexus.Forum do
  @moduledoc """
  The Forum context. Handles spaces, tags, posts, replies, reactions, feed, and subscriptions.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Forum.{Space, Tag, Post, Reply, Reaction, SpaceSubscription, TagSubscription, PostSave}

  # ---------------------------------------------------------------------------
  # Spaces
  # ---------------------------------------------------------------------------

  def list_spaces do
    Space
    |> where([s], s.visibility == "public")
    |> order_by([s], [asc: s.position, asc: s.name])
    |> Repo.all()
  end

  def list_all_spaces do
    Space
    |> order_by([s], [asc: s.position, asc: s.name])
    |> Repo.all()
  end

  def get_space(id), do: Repo.get(Space, id)
  def get_space!(id), do: Repo.get!(Space, id)
  def get_space_by_slug(slug), do: Repo.get_by(Space, slug: slug)

  def create_space(attrs, user) do
    %Space{}
    |> Space.changeset(attrs)
    |> Ecto.Changeset.put_change(:created_by_id, user.id)
    |> Repo.insert()
  end

  def update_space(%Space{} = space, attrs) do
    space |> Space.changeset(attrs) |> Repo.update()
  end

  @doc """
  Updates the position column on each space to match the given ordered list of
  space IDs. Called when the admin drags to reorder spaces in the admin panel
  so that list_spaces/0 (used by the composer, feed, and API) returns spaces
  in the correct order everywhere — not just the sidebar.
  """
  def reorder_spaces(ordered_ids) when is_list(ordered_ids) do
    # N parameterized UPDATE statements — one per space, zero SELECT queries.
    # Previously did N Repo.get + N Repo.update (2N round trips); this is N.
    # A single-query CASE approach would require raw SQL to stay injection-safe
    # with dynamic IDs, which is not worth the complexity at typical space counts.
    ordered_ids
    |> Enum.with_index(1)
    |> Enum.each(fn {id, position} ->
      from(s in Space, where: s.id == ^id)
      |> Repo.update_all(set: [position: position])
    end)
    :ok
  end

  def delete_space(%Space{} = space), do: Repo.delete(space)

  # ---------------------------------------------------------------------------
  # Tags
  # ---------------------------------------------------------------------------

  def list_tags do
    Tag |> order_by([t], [desc: t.post_count, asc: t.name]) |> Repo.all()
  end

  def get_tag(id), do: Repo.get(Tag, id)
  def get_tag_by_slug(slug), do: Repo.get_by(Tag, slug: slug)

  def create_tag(attrs) do
    %Tag{} |> Tag.changeset(attrs) |> Repo.insert()
  end

  def update_tag(%Tag{} = tag, attrs) do
    tag |> Tag.changeset(attrs) |> Repo.update()
  end

  def delete_tag(%Tag{} = tag), do: Repo.delete(tag)

  # ---------------------------------------------------------------------------
  # Posts
  # ---------------------------------------------------------------------------

  def get_post(id) do
    Post
    |> where([p], p.id == ^id and p.hidden == false)
    |> preload([:user, :space, :tags])
    |> Repo.one()
  end

  def get_post!(id) do
    Post
    |> preload([:user, :space, :tags])
    |> Repo.get!(id)
  end

  # Converts bare image URLs in post/reply bodies to markdown image syntax.
  # e.g. https://example.com/photo.jpg → ![](https://example.com/photo.jpg)
  @image_url_regex ~r/(?<![(\[])(https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp|svg))(?![)\]])/i
  defp embed_image_urls(nil), do: nil
  defp embed_image_urls(body) do
    Regex.replace(@image_url_regex, body, fn url, _ -> "![](#{url})" end)
  end

  defp normalize_attrs(attrs) do
    case Map.get(attrs, "body") || Map.get(attrs, :body) do
      nil  -> attrs
      body ->
        normalized = embed_image_urls(body)
        attrs |> Map.delete("body") |> Map.delete(:body) |> Map.put("body", normalized)
    end
  end

  def create_post(attrs, user, tag_ids \\ []) do
    tags = Repo.all(from t in Tag, where: t.id in ^tag_ids)

    result =
      %Post{}
      |> Post.changeset(normalize_attrs(attrs))
      |> Ecto.Changeset.put_change(:user_id, user.id)
      |> Ecto.Changeset.put_assoc(:tags, tags)
      |> Repo.insert()

    case result do
      {:ok, post} ->
        increment_space_post_count(post.space_id)
        increment_tag_post_counts(tag_ids)
        {:ok, Repo.preload(post, [:user, :space, :tags])}

      error ->
        error
    end
  end

  def update_post(%Post{} = post, attrs, tag_ids \\ nil) do
    changeset = Post.changeset(post, normalize_attrs(attrs))

    changeset =
      if tag_ids do
        tags = Repo.all(from t in Tag, where: t.id in ^tag_ids)
        Ecto.Changeset.put_assoc(changeset, :tags, tags)
      else
        changeset
      end

    case Repo.update(changeset) do
      {:ok, post} -> {:ok, Repo.preload(post, [:user, :space, :tags], force: true)}
      error -> error
    end
  end

  def delete_post(%Post{} = post) do
    case Repo.delete(post) do
      {:ok, _} ->
        decrement_space_post_count(post.space_id)
        {:ok, :deleted}
      error -> error
    end
  end

  def hide_post(%Post{} = post, moderator_id) do
    post
    |> Post.hide_changeset(moderator_id)
    |> Repo.update()
  end

  def pin_post(%Post{} = post, pinned, scope \\ nil) do
    post |> Post.pin_changeset(pinned, scope) |> Repo.update()
  end

  def lock_post(%Post{} = post, locked) do
    post |> Post.lock_changeset(locked) |> Repo.update()
  end

  defp increment_space_post_count(space_id) do
    from(s in Space, where: s.id == ^space_id)
    |> Repo.update_all(inc: [post_count: 1])
  end

  defp decrement_space_post_count(space_id) do
    from(s in Space, where: s.id == ^space_id)
    |> Repo.update_all(inc: [post_count: -1])
  end

  defp increment_tag_post_counts([]), do: :ok
  defp increment_tag_post_counts(tag_ids) do
    from(t in Tag, where: t.id in ^tag_ids)
    |> Repo.update_all(inc: [post_count: 1])
  end

  # ---------------------------------------------------------------------------
  # Replies
  # ---------------------------------------------------------------------------

  def list_replies(post_id, opts \\ []) do
    cursor = Keyword.get(opts, :cursor)
    limit  = 25

    query =
      Reply
      |> where([r], r.post_id == ^post_id and r.hidden == false)
      |> preload([:user])
      |> order_by([r], [asc: r.inserted_at, asc: r.id])
      |> limit(^(limit + 1))

    query =
      if cursor do
        case decode_reply_cursor(cursor) do
          {:ok, %{"id" => id, "inserted_at" => ts}} ->
            dt = DateTime.from_unix!(ts)
            where(query, [r], r.inserted_at > ^dt or (r.inserted_at == ^dt and r.id > ^id))
          _ -> query
        end
      else
        query
      end

    replies = Repo.all(query)

    {replies, next_cursor} =
      if length(replies) > limit do
        items = Enum.take(replies, limit)
        last = List.last(items)
        cursor = %{"id" => last.id, "inserted_at" => DateTime.to_unix(last.inserted_at)}
                 |> Jason.encode!()
                 |> Base.url_encode64(padding: false)
        {items, cursor}
      else
        {replies, nil}
      end

    %{replies: replies, next_cursor: next_cursor}
  end

  def get_reply(id) do
    Reply |> preload(:user) |> Repo.get(id)
  end

  def create_reply(post, attrs, user) do
    result =
      %Reply{}
      |> Reply.changeset(normalize_attrs(attrs))
      |> Ecto.Changeset.put_change(:user_id, user.id)
      |> Ecto.Changeset.put_change(:post_id, post.id)
      |> Repo.insert()

    case result do
      {:ok, reply} ->
        now = DateTime.utc_now() |> DateTime.truncate(:second)
        from(p in Post, where: p.id == ^post.id)
        |> Repo.update_all(inc: [reply_count: 1], set: [last_reply_at: now])

        reply = Repo.preload(reply, :user)

        # Notify post author asynchronously
        Nexus.Notifications.notify_reply(post, reply, reply.user)

        {:ok, reply}

      error ->
        error
    end
  end

  def update_reply(%Reply{} = reply, attrs) do
    reply |> Reply.changeset(normalize_attrs(attrs)) |> Repo.update()
  end

  def delete_reply(%Reply{} = reply) do
    case Repo.delete(reply) do
      {:ok, _} ->
        from(p in Post, where: p.id == ^reply.post_id)
        |> Repo.update_all(inc: [reply_count: -1])
        {:ok, :deleted}
      error -> error
    end
  end

  def hide_reply(%Reply{} = reply, moderator_id) do
    reply |> Reply.hide_changeset(moderator_id) |> Repo.update()
  end

  defp decode_reply_cursor(cursor) do
    with {:ok, json} <- Base.url_decode64(cursor, padding: false),
         {:ok, data} <- Jason.decode(json) do
      {:ok, data}
    else
      _ -> {:error, :invalid}
    end
  end

  # ---------------------------------------------------------------------------
  # Reactions
  # ---------------------------------------------------------------------------

  def add_reaction(user_id, attrs) do
    post_id  = attrs["post_id"]
    reply_id = attrs["reply_id"]
    new_emoji = attrs["emoji"]

    # Remove any existing reaction from this user on this post/reply first
    existing_query =
      from r in Reaction, where: r.user_id == ^user_id

    existing_query =
      cond do
        post_id  -> where(existing_query, [r], r.post_id == ^post_id)
        reply_id -> where(existing_query, [r], r.reply_id == ^reply_id)
        true     -> existing_query
      end

    case Repo.one(existing_query) do
      nil -> :ok
      old_reaction ->
        Repo.delete(old_reaction)
        update_reaction_count(old_reaction, -1)
    end

    result =
      %Reaction{}
      |> Reaction.changeset(Map.put(attrs, "user_id", user_id))
      |> Repo.insert(on_conflict: :nothing)

    case result do
      {:ok, reaction} ->
        update_reaction_count(reaction, 1)
        {:ok, reaction}
      error -> error
    end
  end

  def remove_reaction(user_id, attrs) do
    post_id  = attrs["post_id"]
    reply_id = attrs["reply_id"]
    emoji    = attrs["emoji"]

    query =
      from r in Reaction,
        where: r.user_id == ^user_id and r.emoji == ^emoji

    query =
      cond do
        post_id  -> where(query, [r], r.post_id == ^post_id)
        reply_id -> where(query, [r], r.reply_id == ^reply_id)
        true     -> query
      end

    case Repo.one(query) do
      nil -> {:error, :not_found}
      reaction ->
        Repo.delete(reaction)
        update_reaction_count(reaction, -1)
        {:ok, :removed}
    end
  end

  @doc "Get the emoji a specific user reacted with on a post or reply. Returns nil if no reaction."
  def get_user_reaction(user_id, post_id: post_id) do
    Repo.one(from r in Reaction, where: r.user_id == ^user_id and r.post_id == ^post_id, select: r.emoji)
  end

  def get_user_reaction(user_id, reply_id: reply_id) do
    Repo.one(from r in Reaction, where: r.user_id == ^user_id and r.reply_id == ^reply_id, select: r.emoji)
  end

  def list_reactions(post_id: post_id) do
    from(r in Reaction,
      where: r.post_id == ^post_id,
      group_by: r.emoji,
      select: %{emoji: r.emoji, count: count(r.id)}
    )
    |> Repo.all()
  end

  def list_reactions(reply_id: reply_id) do
    from(r in Reaction,
      where: r.reply_id == ^reply_id,
      group_by: r.emoji,
      select: %{emoji: r.emoji, count: count(r.id)}
    )
    |> Repo.all()
  end

  @doc "Batch version of list_reactions for replies. Returns %{reply_id => [%{emoji, count}]}"
  def list_reactions_for_replies([]), do: %{}
  def list_reactions_for_replies(reply_ids) do
    Repo.all(
      from r in Reaction,
        where: r.reply_id in ^reply_ids,
        group_by: [r.reply_id, r.emoji],
        select: {r.reply_id, %{emoji: r.emoji, count: count(r.id)}}
    )
    |> Enum.reduce(%{}, fn {reply_id, reaction}, acc ->
      Map.update(acc, reply_id, [reaction], &(&1 ++ [reaction]))
    end)
  end

  def list_reactions_with_users(post_id: post_id) do
    from(r in Reaction,
      where: r.post_id == ^post_id,
      join: u in Nexus.Accounts.User, on: u.id == r.user_id,
      order_by: [asc: r.inserted_at],
      select: %{emoji: r.emoji, user_id: u.id, username: u.username, avatar_url: u.avatar_url}
    )
    |> Repo.all()
    |> group_by_emoji()
  end

  def list_reactions_with_users(reply_id: reply_id) do
    from(r in Reaction,
      where: r.reply_id == ^reply_id,
      join: u in Nexus.Accounts.User, on: u.id == r.user_id,
      order_by: [asc: r.inserted_at],
      select: %{emoji: r.emoji, user_id: u.id, username: u.username, avatar_url: u.avatar_url}
    )
    |> Repo.all()
    |> group_by_emoji()
  end

  defp group_by_emoji(rows) do
    rows
    |> Enum.group_by(& &1.emoji)
    |> Enum.map(fn {emoji, users} ->
      %{
        emoji: emoji,
        count: length(users),
        users: Enum.map(users, fn u -> %{id: u.user_id, username: u.username, avatar_url: u.avatar_url} end)
      }
    end)
    |> Enum.sort_by(& &1.count, :desc)
  end

  defp update_reaction_count(%Reaction{post_id: post_id}, delta) when not is_nil(post_id) do
    from(p in Post, where: p.id == ^post_id)
    |> Repo.update_all(inc: [reaction_count: delta])
  end

  defp update_reaction_count(%Reaction{reply_id: reply_id}, delta) when not is_nil(reply_id) do
    from(r in Reply, where: r.id == ^reply_id)
    |> Repo.update_all(inc: [reaction_count: delta])
  end

  defp update_reaction_count(_, _), do: :ok

  # ---------------------------------------------------------------------------
  # Feed
  # ---------------------------------------------------------------------------

  @page_size 25

  def list_feed(opts \\ []) do
    user       = Keyword.get(opts, :user)
    space_slug = Keyword.get(opts, :space)
    tag_slug   = Keyword.get(opts, :tag)
    sort       = Keyword.get(opts, :sort, "latest")
    cursor     = Keyword.get(opts, :cursor)
    following  = Keyword.get(opts, :following, false)
    username   = Keyword.get(opts, :username)

    query =
      Post
      |> where([p], p.hidden == false)
      |> preload([:user, :space, :tags])

    query = filter_by_space(query, space_slug)
    query = filter_pinned_for_context(query, space_slug)
    query = filter_by_tag(query, tag_slug)
    query = filter_by_visibility(query, user)
    query = if following && user, do: filter_by_following(query, user.id), else: query
    query = if username, do: filter_by_username(query, username), else: query
    query = apply_cursor(query, cursor, sort)
    query = apply_sort(query, sort)
    query = limit(query, @page_size + 1)

    raw = Repo.all(query)

    # Post-filter by space read permission. The query already handles the
    # guest/visibility case via filter_by_visibility/2. For authenticated
    # users, we additionally enforce space-level read gates here.
    # NOTE: filtering happens before pagination so the has-more-pages
    # detection is based on the filtered count, not the raw DB count.
    # This means a page may contain fewer than @page_size items when some
    # posts are filtered out, but the next_cursor will always be correct.
    posts = Enum.filter(raw, fn post ->
      Nexus.Forum.SpacePermissions.can_read?(post.space, user)
    end)

    {posts, next_cursor} =
      if length(posts) > @page_size do
        items = Enum.take(posts, @page_size)
        {items, encode_cursor(List.last(items), sort)}
      else
        {posts, nil}
      end

    %{posts: posts, next_cursor: next_cursor}
  end

  defp filter_by_space(query, nil), do: query
  defp filter_by_space(query, slug) do
    # When viewing a parent space, include posts from all its sub-spaces too.
    # When viewing a sub-space, show only that sub-space's posts.
    join(query, :inner, [p], s in Space,
      on: p.space_id == s.id and (s.slug == ^slug or s.parent_id == fragment(
        "(SELECT id FROM spaces WHERE slug = ?)", ^slug
      ))
    )
  end

  # Global feed: exclude posts pinned only to a space (they'd appear without context)
  # Space feed: include all posts — space-pinned and globally-pinned both float
  defp filter_pinned_for_context(query, nil) do
    where(query, [p], is_nil(p.pin_scope) or p.pin_scope == "global")
  end
  defp filter_pinned_for_context(query, _space_slug), do: query

  defp filter_by_tag(query, nil), do: query
  defp filter_by_tag(query, slug) do
    query
    |> join(:inner, [p], pt in "post_tags", on: pt.post_id == p.id)
    |> join(:inner, [p, _s, pt], t in Tag, on: pt.tag_id == t.id and t.slug == ^slug)
  end

  defp filter_by_visibility(query, nil) do
    join(query, :inner, [p], s in Space, on: p.space_id == s.id and s.visibility == "public")
  end
  defp filter_by_visibility(query, _user), do: query

  defp filter_by_following(query, user_id) do
    # Posts in spaces the user follows
    space_sub_query =
      from p in Post,
      join: ss in SpaceSubscription, on: ss.space_id == p.space_id and ss.user_id == ^user_id,
      select: p.id

    # Posts tagged with tags the user follows
    tag_sub_query =
      from p in Post,
      join: pt in "post_tags",   on: pt.post_id == p.id,
      join: ts in TagSubscription, on: ts.tag_id == pt.tag_id and ts.user_id == ^user_id,
      select: p.id

    where(query, [p], p.id in subquery(space_sub_query) or p.id in subquery(tag_sub_query))
  end

  defp filter_by_username(query, username) do
    query
    |> join(:inner, [p], u in Nexus.Accounts.User, on: p.user_id == u.id and u.username == ^username)
  end

  defp apply_cursor(query, nil, _sort), do: query
  defp apply_cursor(query, cursor, sort) do
    case decode_cursor(cursor) do
      {:ok, %{"inserted_at" => ts, "id" => id}} when sort == "rising" ->
        dt = DateTime.from_unix!(ts)
        where(query, [p], p.inserted_at < ^dt or (p.inserted_at == ^dt and p.id < ^id))

      {:ok, %{"last_reply_at" => ts, "id" => id}} when sort in ["latest", "activity"] ->
        dt = DateTime.from_unix!(ts)
        where(query, [p],
          fragment("COALESCE(?, ?)", p.last_reply_at, p.inserted_at) < ^dt or
          (fragment("COALESCE(?, ?)", p.last_reply_at, p.inserted_at) == ^dt and p.id < ^id)
        )

      {:ok, %{"reaction_count" => rc, "id" => id}} when sort == "top" ->
        where(query, [p], p.reaction_count < ^rc or (p.reaction_count == ^rc and p.id < ^id))

      _ -> query
    end
  end

  # Pinned posts always float to the top, then normal sort applies.
  # For space-filtered feeds, only space-pinned and globally-pinned posts float.
  # For the global feed, only globally-pinned posts float.
  defp apply_sort(query, "top") do
    order_by(query, [p], [
      fragment("CASE WHEN ? = true THEN 0 ELSE 1 END", p.pinned),
      desc: p.reaction_count, desc: p.id
    ])
  end
  defp apply_sort(query, sort) when sort in ["latest", "activity"] do
    order_by(query, [p], [
      fragment("CASE WHEN ? = true THEN 0 ELSE 1 END", p.pinned),
      desc: fragment("COALESCE(?, ?)", p.last_reply_at, p.inserted_at), desc: p.id
    ])
  end
  defp apply_sort(query, "rising") do
    order_by(query, [p], [
      fragment("CASE WHEN ? = true THEN 0 ELSE 1 END", p.pinned),
      fragment(
        "((? + ?) / power(extract(epoch from (now() - ?)) / 3600.0 + 2, 1.5)) DESC, ? DESC",
        p.reply_count, p.reaction_count, p.inserted_at, p.id
      )
    ])
  end
  defp apply_sort(query, _) do
    order_by(query, [p], [
      fragment("CASE WHEN ? = true THEN 0 ELSE 1 END", p.pinned),
      desc: p.inserted_at, desc: p.id
    ])
  end

  defp encode_cursor(post, "top") do
    %{"reaction_count" => post.reaction_count, "id" => post.id}
    |> Jason.encode!() |> Base.url_encode64(padding: false)
  end
  defp encode_cursor(post, sort) when sort in ["latest", "activity"] do
    ts = post.last_reply_at || post.inserted_at
    %{"last_reply_at" => DateTime.to_unix(ts), "id" => post.id}
    |> Jason.encode!() |> Base.url_encode64(padding: false)
  end
  defp encode_cursor(post, _) do
    %{"inserted_at" => DateTime.to_unix(post.inserted_at), "id" => post.id}
    |> Jason.encode!() |> Base.url_encode64(padding: false)
  end

  defp decode_cursor(cursor) do
    with {:ok, json} <- Base.url_decode64(cursor, padding: false),
         {:ok, data} <- Jason.decode(json) do
      {:ok, data}
    else
      _ -> {:error, :invalid_cursor}
    end
  end

  # ---------------------------------------------------------------------------
  # Subscriptions
  # ---------------------------------------------------------------------------

  def subscribed_to_space?(user_id, space_id) do
    Repo.exists?(from s in SpaceSubscription, where: s.user_id == ^user_id and s.space_id == ^space_id)
  end

  def subscribe_to_space(user_id, space_id) do
    %SpaceSubscription{}
    |> SpaceSubscription.changeset(%{user_id: user_id, space_id: space_id})
    |> Ecto.Changeset.put_change(:inserted_at, DateTime.utc_now() |> DateTime.truncate(:second))
    |> Repo.insert(on_conflict: :nothing)
  end

  def unsubscribe_from_space(user_id, space_id) do
    Repo.delete_all(from s in SpaceSubscription, where: s.user_id == ^user_id and s.space_id == ^space_id)
    {:ok, :unsubscribed}
  end

  def subscribe_to_tag(user_id, tag_id) do
    %TagSubscription{}
    |> TagSubscription.changeset(%{user_id: user_id, tag_id: tag_id})
    |> Ecto.Changeset.put_change(:inserted_at, DateTime.utc_now() |> DateTime.truncate(:second))
    |> Repo.insert(on_conflict: :nothing)
  end

  def unsubscribe_from_tag(user_id, tag_id) do
    Repo.delete_all(from s in TagSubscription, where: s.user_id == ^user_id and s.tag_id == ^tag_id)
    {:ok, :unsubscribed}
  end

  def user_space_ids(user_id) do
    from(s in SpaceSubscription, where: s.user_id == ^user_id, select: s.space_id) |> Repo.all()
  end

  def user_tag_ids(user_id) do
    from(s in TagSubscription, where: s.user_id == ^user_id, select: s.tag_id) |> Repo.all()
  end

  # ---------------------------------------------------------------------------
  # Post / reply saves (bookmarks)
  # ---------------------------------------------------------------------------

  def save_post(user_id, post_id) do
    %PostSave{}
    |> PostSave.changeset(%{user_id: user_id, post_id: post_id, inserted_at: DateTime.utc_now() |> DateTime.truncate(:second)})
    |> Repo.insert(on_conflict: :nothing)
  end

  def unsave_post(user_id, post_id) do
    Repo.delete_all(from s in PostSave, where: s.user_id == ^user_id and s.post_id == ^post_id)
    {:ok, :unsaved}
  end

  def save_reply(user_id, reply_id) do
    %PostSave{}
    |> PostSave.changeset(%{user_id: user_id, reply_id: reply_id, inserted_at: DateTime.utc_now() |> DateTime.truncate(:second)})
    |> Repo.insert(on_conflict: :nothing)
  end

  def unsave_reply(user_id, reply_id) do
    Repo.delete_all(from s in PostSave, where: s.user_id == ^user_id and s.reply_id == ^reply_id)
    {:ok, :unsaved}
  end

  def post_saved?(user_id, post_id) do
    Repo.exists?(from s in PostSave, where: s.user_id == ^user_id and s.post_id == ^post_id)
  end

  def reply_saved?(user_id, reply_id) do
    Repo.exists?(from s in PostSave, where: s.user_id == ^user_id and s.reply_id == ^reply_id)
  end

  @doc "Returns the IDs of replies belonging to `post_id` that `user_id` has saved."
  def saved_reply_ids_for_post(user_id, post_id) do
    from(s in PostSave,
      join: r in Nexus.Forum.Reply, on: r.id == s.reply_id and r.post_id == ^post_id,
      where: s.user_id == ^user_id and not is_nil(s.reply_id),
      select: s.reply_id
    )
    |> Repo.all()
  end

  @saved_page_size 25

  def list_saved(user_id, opts \\ []) do
    cursor = Keyword.get(opts, :cursor)
    limit  = @saved_page_size

    query =
      from s in PostSave,
      where: s.user_id == ^user_id,
      left_join: p in Post,  on: s.post_id  == p.id  and not p.hidden and not p.pending_approval,
      left_join: r in Reply, on: s.reply_id == r.id  and not r.hidden and not r.pending_approval,
      left_join: sp in Space, on: p.space_id == sp.id,
      left_join: rp in Post,  on: r.post_id  == rp.id,
      left_join: rsp in Space, on: rp.space_id == rsp.id,
      left_join: pu in Nexus.Accounts.User, on: p.user_id  == pu.id,
      left_join: ru in Nexus.Accounts.User, on: r.user_id  == ru.id,
      order_by: [desc: s.inserted_at, desc: s.id],
      limit: ^(limit + 1),
      select: %{
        id:         s.id,
        saved_at:   s.inserted_at,
        type:       fragment("CASE WHEN ? IS NOT NULL THEN 'post' ELSE 'reply' END", s.post_id),
        post_id:    p.id,
        post_title: p.title,
        post_body:  p.body,
        post_reply_count:    p.reply_count,
        post_reaction_count: p.reaction_count,
        post_inserted_at:    p.inserted_at,
        post_space_name:  sp.name,
        post_space_slug:  sp.slug,
        post_space_color: sp.color,
        post_username:      pu.username,
        post_avatar_url:    pu.avatar_url,
        post_avatar_color:  pu.avatar_color,
        post_user_id:       pu.id,
        reply_id:   r.id,
        reply_body: r.body,
        reply_inserted_at: r.inserted_at,
        reply_post_id:     rp.id,
        reply_post_title:  rp.title,
        reply_space_name:  rsp.name,
        reply_space_color: rsp.color,
        reply_username:     ru.username,
        reply_avatar_url:   ru.avatar_url,
        reply_avatar_color: ru.avatar_color,
        reply_user_id:      ru.id
      }

    query =
      if cursor do
        case Base.url_decode64(cursor, padding: false) do
          {:ok, json} ->
            case Jason.decode(json) do
              {:ok, %{"id" => id}} -> where(query, [s], s.id < ^id)
              _ -> query
            end
          _ -> query
        end
      else
        query
      end

    items = Repo.all(query)

    {items, next_cursor} =
      if length(items) > limit do
        page = Enum.take(items, limit)
        last = List.last(page)
        cur  = %{"id" => last.id} |> Jason.encode!() |> Base.url_encode64(padding: false)
        {page, cur}
      else
        {items, nil}
      end

    %{saved: items, next_cursor: next_cursor}
  end

  @doc """
  Returns a map of %{post_id => user} for the most recent non-hidden reply
  on each of the given post IDs. Fetched in a single query.
  """
  @doc """
  Returns a map of %{post_id => [user, ...]} with up to 4 unique recent
  participants (repliers) per post, ordered most-recent first.
  The post author is NOT included — they are already shown separately.
  Fetched in a single query.
  """
  def recent_participant_users(post_ids) when post_ids == [], do: %{}
  def recent_participant_users(post_ids) do
    # Rank unique (post_id, user_id) pairs by most recent reply
    ranked =
      from r in Reply,
        where: r.post_id in ^post_ids and r.hidden == false and r.pending_approval == false,
        select: %{
          post_id: r.post_id,
          user_id: r.user_id,
          row_num: fragment(
            "ROW_NUMBER() OVER (PARTITION BY ?, ? ORDER BY ? DESC)",
            r.post_id, r.user_id, r.inserted_at
          )
        }

    # Keep only the latest reply per (post, user) pair, then rank across the post
    deduped =
      from(sub in subquery(ranked),
        where: sub.row_num == 1,
        select: %{
          post_id: sub.post_id,
          user_id: sub.user_id,
          rank: fragment(
            "ROW_NUMBER() OVER (PARTITION BY ? ORDER BY ? DESC)",
            sub.post_id, sub.row_num
          )
        }
      )

    results =
      from(d in subquery(deduped),
        where: d.rank <= 4,
        join: u in Nexus.Accounts.User, on: u.id == d.user_id,
        order_by: [asc: d.post_id, asc: d.rank],
        select: {d.post_id, %{id: u.id, username: u.username, avatar_url: u.avatar_url, avatar_color: u.avatar_color}}
      )
      |> Repo.all()

    # Group into %{post_id => [user, ...]}
    Enum.reduce(results, %{}, fn {post_id, user}, acc ->
      Map.update(acc, post_id, [user], &(&1 ++ [user]))
    end)
  end

  def last_reply_users(post_ids) when post_ids == [], do: %{}
  def last_reply_users(post_ids) do
    # Rank replies per post by inserted_at DESC, then keep rank = 1
    ranked =
      from r in Reply,
        where: r.post_id in ^post_ids and r.hidden == false and r.pending_approval == false,
        select: %{
          post_id: r.post_id,
          user_id: r.user_id,
          row_num: fragment(
            "ROW_NUMBER() OVER (PARTITION BY ? ORDER BY ? DESC)",
            r.post_id, r.inserted_at
          )
        }

    results =
      from(sub in subquery(ranked),
        where: sub.row_num == 1,
        join: u in Nexus.Accounts.User, on: u.id == sub.user_id,
        select: {sub.post_id, %{id: u.id, username: u.username, avatar_url: u.avatar_url, avatar_color: u.avatar_color}}
      )
      |> Repo.all()

    Map.new(results)
  end


  # ── Post follows ──────────────────────────────────────────────────────────

  alias Nexus.Forum.PostFollow

  def follow_post(user_id, post_id) do
    %PostFollow{}
    |> PostFollow.changeset(%{user_id: user_id, post_id: post_id})
    |> Repo.insert(on_conflict: :nothing)
  end

  def unfollow_post(user_id, post_id) do
    case Repo.get_by(PostFollow, user_id: user_id, post_id: post_id) do
      nil    -> {:ok, :not_found}
      follow -> Repo.delete(follow)
    end
  end

  def following_post?(user_id, post_id) do
    Repo.exists?(from f in PostFollow, where: f.user_id == ^user_id and f.post_id == ^post_id)
  end

  def post_follower_ids(post_id) do
    Repo.all(from f in PostFollow, where: f.post_id == ^post_id, select: f.user_id)
  end


  # ── Edit history ──────────────────────────────────────────────────────────

  alias Nexus.Forum.PostEdit

  def record_post_edit(post, editor_id) do
    result =
      %PostEdit{}
      |> PostEdit.changeset(%{
        post_id:   post.id,
        user_id:   editor_id,
        old_title: post.title,
        old_body:  post.body,
        edited_at: DateTime.utc_now() |> DateTime.truncate(:second)
      })
      |> Repo.insert()

    if match?({:ok, _}, result) do
      from(p in Post, where: p.id == ^post.id)
      |> Repo.update_all(inc: [edit_count: 1])
    end

    result
  end

  def record_reply_edit(reply, editor_id) do
    result =
      %PostEdit{}
      |> PostEdit.changeset(%{
        reply_id:  reply.id,
        user_id:   editor_id,
        old_body:  reply.body,
        edited_at: DateTime.utc_now() |> DateTime.truncate(:second)
      })
      |> Repo.insert()

    if match?({:ok, _}, result) do
      from(r in Reply, where: r.id == ^reply.id)
      |> Repo.update_all(inc: [edit_count: 1])
    end

    result
  end

  def post_edit_count(post_id) do
    Repo.aggregate(from(e in PostEdit, where: e.post_id == ^post_id), :count)
  end

  def reply_edit_count(reply_id) do
    Repo.aggregate(from(e in PostEdit, where: e.reply_id == ^reply_id), :count)
  end

  # Batch: returns %{post_id => count} for a list of post_ids
  def post_edit_counts(post_ids) when post_ids == [], do: %{}
  def post_edit_counts(post_ids) do
    Repo.all(
      from e in PostEdit,
        where: e.post_id in ^post_ids,
        group_by: e.post_id,
        select: {e.post_id, count(e.id)}
    ) |> Map.new()
  end

  # Batch: returns %{reply_id => count} for a list of reply_ids
  def reply_edit_counts(reply_ids) when reply_ids == [], do: %{}
  def reply_edit_counts(reply_ids) do
    Repo.all(
      from e in PostEdit,
        where: e.reply_id in ^reply_ids,
        group_by: e.reply_id,
        select: {e.reply_id, count(e.id)}
    ) |> Map.new()
  end

  def list_post_edits(post_id) do
    Repo.all(
      from e in PostEdit,
        where: e.post_id == ^post_id,
        join: u in Nexus.Accounts.User, on: u.id == e.user_id,
        order_by: [desc: e.edited_at],
        select: %{id: e.id, old_title: e.old_title, old_body: e.old_body,
                  edited_at: e.edited_at, editor: %{id: u.id, username: u.username}}
    )
  end

  def list_reply_edits(reply_id) do
    Repo.all(
      from e in PostEdit,
        where: e.reply_id == ^reply_id,
        join: u in Nexus.Accounts.User, on: u.id == e.user_id,
        order_by: [desc: e.edited_at],
        select: %{id: e.id, old_body: e.old_body,
                  edited_at: e.edited_at, editor: %{id: u.id, username: u.username}}
    )
  end

  # ── Question / accepted answer ────────────────────────────────────────────

  def accept_answer(post_id, reply_id) do
    Repo.update_all(
      from(p in Post, where: p.id == ^post_id),
      set: [accepted_reply_id: reply_id]
    )
    {:ok, :accepted}
  end

  def unaccept_answer(post_id) do
    Repo.update_all(
      from(p in Post, where: p.id == ^post_id),
      set: [accepted_reply_id: nil]
    )
    {:ok, :unaccepted}
  end

  # ── Read status ───────────────────────────────────────────────────────────

  @doc """
  Returns a map of read status for the given post IDs and user.

  Each entry is %{post_id => %{seen: boolean, new_reply_count: integer}}.
  `seen` is true when a post_reads row exists for this user+post, or when the
  post was created before the user's marked_all_as_read_at timestamp.
  `new_reply_count` is the number of replies added since the user last read
  the post, computed as post.reply_count - post_reads.reply_count. Posts
  covered by marked_all_as_read_at with no post_reads row get new_reply_count 0.

  Returns %{} for an empty post list or nil user.
  """
  def read_status_for_posts(_post_ids, nil), do: %{}
  def read_status_for_posts([], _user), do: %{}
  def read_status_for_posts(post_ids, user) do
    user_id = user.id
    marked_at = user.marked_all_as_read_at

    rows =
      from(r in Nexus.Forum.PostRead,
        join: p in Post, on: p.id == r.post_id,
        where: r.user_id == ^user_id and r.post_id in ^post_ids,
        select: {r.post_id, p.reply_count - r.reply_count}
      )
      |> Repo.all()

    seen_ids = MapSet.new(rows, fn {post_id, _} -> post_id end)

    # Fetch inserted_at for posts not yet in post_reads but potentially
    # covered by marked_all_as_read_at, so we can apply the timestamp check.
    unmarked_ids = Enum.reject(post_ids, &MapSet.member?(seen_ids, &1))

    inserted_at_map =
      if marked_at && unmarked_ids != [] do
        from(p in Post,
          where: p.id in ^unmarked_ids,
          select: {p.id, p.inserted_at}
        )
        |> Repo.all()
        |> Map.new()
      else
        %{}
      end

    Enum.reduce(post_ids, %{}, fn post_id, acc ->
      cond do
        MapSet.member?(seen_ids, post_id) ->
          {^post_id, delta} = Enum.find(rows, fn {id, _} -> id == post_id end)
          Map.put(acc, post_id, %{seen: true, new_reply_count: max(delta, 0)})

        marked_at && Map.get(inserted_at_map, post_id) &&
            DateTime.compare(Map.get(inserted_at_map, post_id), marked_at) != :gt ->
          Map.put(acc, post_id, %{seen: true, new_reply_count: 0})

        true ->
          Map.put(acc, post_id, %{seen: false, new_reply_count: 0})
      end
    end)
  end
end
