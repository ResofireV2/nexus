defmodule NexusWeb.API.V1.PostController do
  use NexusWeb, :controller

  alias Nexus.Forum
  alias Nexus.Accounts.User

  # GET /api/v1/posts/:id
  def show(conn, %{"id" => id}) do
    if !conn.assigns[:current_user] && !Nexus.Permissions.guest_browsing?() do
      conn |> put_status(:unauthorized) |> json(%{error: "Please log in to view this forum"})
    else
    case Forum.get_post(id) do
      nil  -> conn |> put_status(:not_found) |> json(%{error: "Post not found"})
      post ->
        reactions = Forum.list_reactions(post_id: post.id)
        user_reaction = if conn.assigns[:current_user] do
          Forum.get_user_reaction(conn.assigns.current_user.id, post_id: post.id)
        end
        json(conn, %{post: Map.merge(post_json(post), %{reactions: reactions, user_reaction: user_reaction})})
    end
    end
  end

  # POST /api/v1/posts
  def create(conn, params) do
    user    = conn.assigns.current_user
    tag_ids = Map.get(params, "tag_ids", [])

    # Check email verification requirement
    if Nexus.Permissions.require_email_verification?() && !user.email_verified && user.role == "member" do
      conn |> put_status(:forbidden) |> json(%{error: "Please verify your email address before posting"})
    else
      # Determine if post needs approval
      pending = !Nexus.Permissions.can_post_immediately?(user) && user.role == "member"

      case Forum.create_post(Map.put(params, "pending_approval", pending), user, tag_ids) do
        {:ok, post} ->
          if pending do
            conn |> put_status(:created) |> json(%{post: post_json(post), pending: true, message: "Your post is pending approval"})
          else
            Nexus.Activity.increment_stat(user.id, :posts_count)
            NexusWeb.FeedChannel.broadcast_new_post(post)
            Task.start(fn -> Nexus.Extensions.fire("post_created", %{post_id: post.id}) end)
            # Auto-follow if user preference is set (default: true)
            if Map.get(user.preferences || %{}, "auto_follow_own_posts", true) != false do
              Forum.follow_post(user.id, post.id)
            end
            %{"user_id" => user.id} |> Nexus.Workers.CheckBadges.new(schedule_in: 60) |> Oban.insert()
            %{"user_id" => user.id} |> Nexus.Workers.UpdateScore.new() |> Oban.insert()
            Task.start(fn ->
              Nexus.LinkPreviews.extract_urls(post.body)
              |> Enum.each(&Nexus.LinkPreviews.get_or_fetch/1)
            end)
            conn |> put_status(:created) |> json(%{post: post_json(post)})
          end

        {:error, changeset} ->
          conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
      end
    end
  end

  # PATCH /api/v1/posts/:id
  def update(conn, %{"id" => id} = params) do
    user = conn.assigns.current_user

    case Forum.get_post!(id) do
      nil  -> conn |> put_status(:not_found) |> json(%{error: "Post not found"})
      post ->
        if can_edit?(user, post) do
          tag_ids = Map.get(params, "tag_ids")
          Forum.record_post_edit(post, user.id)
          case Forum.update_post(post, params, tag_ids) do
            {:ok, updated} ->
              Task.start(fn -> Nexus.Extensions.fire("post_updated", %{post_id: updated.id}) end)
              Nexus.LinkPreviews.extract_urls(updated.body)
              |> Enum.each(fn url ->
                %{"url" => url} |> Nexus.Workers.FetchLinkPreview.new() |> Oban.insert()
              end)
              json(conn, %{post: post_json(updated)})
            {:error, cs}   -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
          end
        else
          conn |> put_status(:forbidden) |> json(%{error: "Not authorized"})
        end
    end
  end

  # GET /api/v1/posts/:id/read-position
  def read_position(conn, %{"id" => post_id}) do
    user_id = conn.assigns.current_user.id
    alias Nexus.Forum.PostRead
    import Ecto.Query
    read = Nexus.Repo.one(from r in PostRead, where: r.user_id == ^user_id and r.post_id == ^String.to_integer("#{post_id}"))
    json(conn, %{last_reply_id: read && read.last_reply_id, reply_count: read && read.reply_count || 0})
  end

  # POST /api/v1/posts/:id/read-position
  def save_read_position(conn, %{"id" => post_id, "last_reply_id" => last_reply_id, "reply_count" => reply_count}) do
    user_id = conn.assigns.current_user.id
    alias Nexus.Forum.PostRead
    import Ecto.Query
    post_id_int = String.to_integer("#{post_id}")
    existing = Nexus.Repo.one(from r in PostRead, where: r.user_id == ^user_id and r.post_id == ^post_id_int)
    attrs = %{user_id: user_id, post_id: post_id_int, last_reply_id: last_reply_id, reply_count: reply_count}
    result = case existing do
      nil -> %PostRead{} |> PostRead.changeset(attrs) |> Nexus.Repo.insert()
      rec -> rec |> PostRead.changeset(attrs) |> Nexus.Repo.update()
    end
    case result do
      {:ok, _} -> json(conn, %{ok: true})
      {:error, _} -> conn |> put_status(:unprocessable_entity) |> json(%{error: "Failed"})
    end
  end

  # DELETE /api/v1/posts/:id
  def delete(conn, %{"id" => id}) do
    user = conn.assigns.current_user

    case Forum.get_post!(id) do
      nil  -> conn |> put_status(:not_found) |> json(%{error: "Post not found"})
      post ->
        if can_edit?(user, post) do
          {:ok, _} = Forum.delete_post(post)
          Task.start(fn -> Nexus.Extensions.fire("post_deleted", %{post_id: post.id}) end)
          json(conn, %{ok: true})
        else
          conn |> put_status(:forbidden) |> json(%{error: "Not authorized"})
        end
    end
  end

  # POST /api/v1/posts/:id/pin  (moderator+)
  def pin(conn, %{"id" => id}) do
    post = Forum.get_post!(id)
    actor = conn.assigns.current_user
    {:ok, updated} = Forum.pin_post(post, !post.pinned)
    # Enqueue score update for post author when pinned (not unpinned)
    if updated.pinned && post.user_id do
      %{"user_id" => post.user_id} |> Nexus.Workers.UpdateScore.new(schedule_in: 60) |> Oban.insert()
      # Notify all users of this announcement via a background fan-out worker
      # so we never block the pin request on large user bases.
      %{"post_id" => updated.id, "actor_id" => actor.id}
      |> Nexus.Workers.FanOutAnnouncement.new()
      |> Oban.insert()
    end
    json(conn, %{post: post_json(updated)})
  end

  # POST /api/v1/posts/:id/lock  (moderator+)
  def lock(conn, %{"id" => id}) do
    post = Forum.get_post!(id)
    {:ok, updated} = Forum.lock_post(post, !post.locked)
    json(conn, %{post: post_json(updated)})
  end

  # POST /api/v1/posts/:id/hide  (moderator+)
  def hide(conn, %{"id" => id}) do
    post = Forum.get_post!(id)
    {:ok, _} = Forum.hide_post(post, conn.assigns.current_user.id)
    json(conn, %{ok: true})
  end

  defp can_edit?(user, post) do
    user.id == post.user_id || User.moderator?(user)
  end

  defp post_json(post) do
    %{
      id: post.id,
      title: post.title,
      body: post.body,
      body_format: post.body_format,
      type: post.type,
      pinned: post.pinned,
      locked: post.locked,
      accepted_reply_id: post.accepted_reply_id,
      reply_count: post.reply_count,
      reaction_count: post.reaction_count,
      last_reply_at: post.last_reply_at,
      inserted_at: post.inserted_at,
      updated_at: post.updated_at,
      space: space_json(post.space),
      tags: Enum.map(post.tags, &tag_json/1),
      user: user_json(post.user),
      edit_count: Forum.post_edit_count(post.id)
    }
  end

  defp space_json(nil), do: nil
  defp space_json(s), do: %{id: s.id, name: s.name, slug: s.slug, color: s.color}

  defp tag_json(t), do: %{id: t.id, name: t.name, slug: t.slug, color: t.color}

  defp user_json(nil), do: nil
  defp user_json(u), do: %{id: u.id, username: u.username, avatar_url: u.avatar_url}

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", to_string(v)) end)
    end)
  end

  # GET /api/v1/posts/:id/edits
  def edits(conn, %{"id" => id}) do
    edits = Forum.list_post_edits(String.to_integer(id))
    json(conn, %{edits: Enum.map(edits, fn e ->
      %{id: e.id, old_title: e.old_title, old_body: e.old_body,
        edited_at: e.edited_at, editor: e.editor}
    end)})
  end

  # POST /api/v1/posts/:id/accept/:reply_id
  def accept_answer(conn, %{"id" => post_id, "reply_id" => reply_id}) do
    user = conn.assigns.current_user
    post = Forum.get_post!(post_id)
    if post && (post.user_id == user.id || user.role in ["admin", "moderator"]) do
      Forum.accept_answer(String.to_integer(post_id), String.to_integer(reply_id))
      json(conn, %{ok: true, accepted_reply_id: String.to_integer(reply_id)})
    else
      conn |> put_status(:forbidden) |> json(%{error: "Not authorized"})
    end
  end

  # DELETE /api/v1/posts/:id/accept
  def unaccept_answer(conn, %{"id" => post_id}) do
    user = conn.assigns.current_user
    post = Forum.get_post!(post_id)
    if post && (post.user_id == user.id || user.role in ["admin", "moderator"]) do
      Forum.unaccept_answer(String.to_integer(post_id))
      json(conn, %{ok: true, accepted_reply_id: nil})
    else
      conn |> put_status(:forbidden) |> json(%{error: "Not authorized"})
    end
  end
end
