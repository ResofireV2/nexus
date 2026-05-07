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

  def pin_post(%Post{} = post, pinned) do
    post |> Post.pin_changeset(pinned) |> Repo.update()
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
    limit  = 50

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
        Task.start(fn -> Nexus.Notifications.notify_reply(post, reply, reply.user) end)

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

  @page_size 30

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
    query = filter_by_tag(query, tag_slug)
    query = filter_by_visibility(query, user)
    query = if following && user, do: filter_by_following(query, user.id), else: query
    query = if username, do: filter_by_username(query, username), else: query
    query = apply_cursor(query, cursor, sort)
    query = apply_sort(query, sort)
    query = limit(query, @page_size + 1)

    posts = Repo.all(query)

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
    join(query, :inner, [p], s in Space, on: p.space_id == s.id and s.slug == ^slug)
  end

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
    query
    |> join(:inner, [p], sub in Nexus.Forum.Subscription,
        on: (sub.space_id == p.space_id or sub.tag_id in fragment("SELECT tag_id FROM post_tags WHERE post_id = ?", p.id))
            and sub.user_id == ^user_id)
    |> distinct([p], p.id)
  end

  defp filter_by_username(query, username) do
    query
    |> join(:inner, [p], u in Nexus.Accounts.User, on: p.user_id == u.id and u.username == ^username)
  end

  defp apply_cursor(query, nil, _sort), do: query
  defp apply_cursor(query, cursor, sort) do
    case decode_cursor(cursor) do
      {:ok, %{"inserted_at" => ts, "id" => id}} when sort == "latest" ->
        dt = DateTime.from_unix!(ts)
        where(query, [p], p.inserted_at < ^dt or (p.inserted_at == ^dt and p.id < ^id))

      {:ok, %{"last_reply_at" => ts, "id" => id}} when sort == "activity" ->
        dt = DateTime.from_unix!(ts)
        where(query, [p], p.last_reply_at < ^dt or (p.last_reply_at == ^dt and p.id < ^id))

      {:ok, %{"reaction_count" => rc, "id" => id}} when sort == "top" ->
        where(query, [p], p.reaction_count < ^rc or (p.reaction_count == ^rc and p.id < ^id))

      _ -> query
    end
  end

  defp apply_sort(query, "top"),      do: order_by(query, [p], [desc: p.reaction_count, desc: p.id])
  defp apply_sort(query, "activity"), do: order_by(query, [p], [desc: p.last_reply_at, desc: p.id])
  defp apply_sort(query, _),          do: order_by(query, [p], [desc: p.inserted_at, desc: p.id])

  defp encode_cursor(post, "top") do
    %{"reaction_count" => post.reaction_count, "id" => post.id}
    |> Jason.encode!() |> Base.url_encode64(padding: false)
  end
  defp encode_cursor(post, "activity") do
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

  def list_saved(user_id) do
    Repo.all(
      from s in PostSave,
      where: s.user_id == ^user_id,
      left_join: p in Post,  on: s.post_id  == p.id  and not p.hidden and not p.pending_approval,
      left_join: r in Reply, on: s.reply_id == r.id  and not r.hidden and not r.pending_approval,
      left_join: sp in Space, on: p.space_id == sp.id,
      left_join: rp in Post,  on: r.post_id  == rp.id,
      left_join: rsp in Space, on: rp.space_id == rsp.id,
      left_join: pu in Nexus.Accounts.User, on: p.user_id  == pu.id,
      left_join: ru in Nexus.Accounts.User, on: r.user_id  == ru.id,
      order_by: [desc: s.inserted_at],
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
        post_username:    pu.username,
        post_avatar_url:  pu.avatar_url,
        reply_id:   r.id,
        reply_body: r.body,
        reply_inserted_at: r.inserted_at,
        reply_post_id:     rp.id,
        reply_post_title:  rp.title,
        reply_space_name:  rsp.name,
        reply_space_color: rsp.color,
        reply_username:    ru.username,
        reply_avatar_url:  ru.avatar_url
      }
    )
  end
end
