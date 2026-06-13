defmodule NexusWeb.API.V1.PostController do
  use NexusWeb, :controller

  alias Nexus.Forum
  alias Nexus.Accounts.User
  import Ecto.Query
  alias Nexus.Repo

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

    if user.status in ["banned", "suspended"] do
      conn |> put_status(:forbidden) |> json(%{error: "Your account is not permitted to post"})
    else

    # Check space-level post permission before doing anything else.
    space_id = params["space_id"]
    space = if space_id, do: Forum.get_space(space_id), else: nil

    if is_nil(space) do
      conn |> put_status(:unprocessable_entity) |> json(%{error: "Invalid space"})
    else
    if !Nexus.Forum.SpacePermissions.can_post?(space, user) do
      conn |> put_status(:forbidden) |> json(%{error: "You do not have permission to post in this space"})
    else

    # Determine if post needs approval
    pending = !Nexus.Permissions.can_post_immediately?(user) && user.role == "member"

    # Composition spam check — may upgrade pending to true even if user can normally post
    composition_signals = params["compositionSignals"]
    content = params["body"] || ""
    {pending, composition_result} =
      case Nexus.AntiSpam.CompositionAnalyser.check(user, content, composition_signals) do
        {:hold, verdict, details} -> {true,  {:held, verdict, details}}
        {:log,  verdict, details} -> {pending, {:logged, verdict, details}}
        :pass                     -> {pending, :pass}
      end

    case Forum.create_post(Map.put(params, "pending_approval", pending), user, tag_ids) do
      {:ok, post} ->
        # Record verdict and audit log entry for composition holds
        case composition_result do
          {:held, verdict, details} ->
            Task.start(fn ->
              Nexus.AntiSpam.CompositionAnalyser.record_verdict(%{
                post_id: post.id, user_id: user.id,
                verdict: verdict, details: details, report_only: false
              })
              Nexus.Moderation.log_spam_hold(user.id, post.id, verdict, false)
            end)
          {:logged, verdict, details} ->
            Task.start(fn ->
              Nexus.AntiSpam.CompositionAnalyser.record_verdict(%{
                post_id: post.id, user_id: user.id,
                verdict: verdict, details: details, report_only: true
              })
              Nexus.Moderation.log_spam_hold(user.id, post.id, verdict, true)
            end)
          :pass -> :ok
        end

        # Dispatch any compose attachments to their declaring
        # extensions. Fires regardless of pending state — attachments
        # persist into the extension's tables; whether the parent post
        # is visible to others is a separate concern.
        Nexus.Extensions.SideData.persist_attachments(
          "post", post.id, params["attachments"] || []
        )

        if pending do
          conn |> put_status(:created) |> json(%{post: post_json(post), pending: true, message: "Your post is pending approval"})
        else
          Nexus.Activity.increment_stat(user.id, :posts_count)
          NexusWeb.FeedChannel.broadcast_new_post(post)
          {:ok, payload} = Nexus.Extensions.HookContracts.build_payload(
            "post_created", %{user_id: user.id, post_id: post.id}
          )
          Nexus.Extensions.fire("post_created", payload)
          # Auto-follow if user preference is set (default: true)
          if Map.get(user.preferences || %{}, "auto_follow_own_posts", true) != false do
            Forum.follow_post(user.id, post.id)
          end
          %{"user_id" => user.id} |> Nexus.Workers.CheckBadges.new(schedule_in: 60) |> Oban.insert()
          %{"user_id" => user.id} |> Nexus.Workers.UpdateScore.new() |> Oban.insert()
          Nexus.LinkPreviews.extract_urls(post.body)
          |> Enum.each(fn url ->
            %{"url" => url} |> Nexus.Workers.FetchLinkPreview.new() |> Oban.insert()
          end)
          conn |> put_status(:created) |> json(%{post: post_json(post)})
        end

      {:error, changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
    end
    end # space can_post? check
    end # space nil check
    end # status check
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
              {:ok, payload} = Nexus.Extensions.HookContracts.build_payload(
                "post_updated", %{user_id: user.id, post_id: updated.id}
              )
              Nexus.Extensions.fire("post_updated", payload)
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
    post_id_i = String.to_integer(post_id)
    read = Nexus.Repo.one(from r in Nexus.Forum.PostRead, where: r.user_id == ^user_id and r.post_id == ^post_id_i)
    json(conn, %{last_reply_id: read && read.last_reply_id, reply_count: read && read.reply_count || 0})
  end

  # POST /api/v1/posts/:id/read-position
  def save_read_position(conn, %{"id" => post_id, "last_reply_id" => last_reply_id, "reply_count" => reply_count}) do
    user_id = conn.assigns.current_user.id
    post_id_int = String.to_integer(post_id)
    existing = Nexus.Repo.one(from r in Nexus.Forum.PostRead, where: r.user_id == ^user_id and r.post_id == ^post_id_int)
    attrs = %{user_id: user_id, post_id: post_id_int, last_reply_id: last_reply_id, reply_count: reply_count}
    result = case existing do
      nil -> %Nexus.Forum.PostRead{} |> Nexus.Forum.PostRead.changeset(attrs) |> Nexus.Repo.insert()
      rec -> rec |> Nexus.Forum.PostRead.changeset(attrs) |> Nexus.Repo.update()
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
          {:ok, payload} = Nexus.Extensions.HookContracts.build_payload(
            "post_deleted", %{user_id: user.id, post_id: post.id}
          )
          Nexus.Extensions.fire("post_deleted", payload)
          json(conn, %{ok: true})
        else
          conn |> put_status(:forbidden) |> json(%{error: "Not authorized"})
        end
    end
  end

  # POST /api/v1/posts/:id/pin  (moderator+)
  # params: scope — "global" | "space" | omitted (toggles off)
  def pin(conn, %{"id" => id} = params) do
    post  = Forum.get_post!(id)
    actor = conn.assigns.current_user
    scope = params["scope"]

    # Only admins may pin globally; moderators may only pin to a space
    if scope == "global" && !Nexus.Accounts.User.admin?(actor) do
      conn |> put_status(:forbidden) |> json(%{error: "Only admins can pin globally"})
    else
      # If scope is omitted we're unpinning; otherwise pin with the given scope
      pinned = !is_nil(scope)
      {:ok, updated} = Forum.pin_post(post, pinned, scope)

      if updated.pinned && post.user_id do
        %{"user_id" => post.user_id} |> Nexus.Workers.UpdateScore.new(schedule_in: 60) |> Oban.insert()
        # Only fan-out announcements for global pins — space pins are too narrow
        # to warrant notifying every user on the forum.
        if updated.pin_scope == "global" do
          %{"post_id" => updated.id, "actor_id" => actor.id}
          |> Nexus.Workers.FanOutAnnouncement.new()
          |> Oban.insert()
        end
      end

      json(conn, %{post: post_json(updated)})
    end
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
      pin_scope: post.pin_scope,
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
      edit_count: post.edit_count
    }
  end

  defp space_json(nil), do: nil
  defp space_json(s), do: %{id: s.id, name: s.name, slug: s.slug, color: s.color}

  defp tag_json(t), do: %{id: t.id, name: t.name, slug: t.slug, color: t.color}

  defp user_json(nil), do: nil
  defp user_json(u), do: %{id: u.id, username: u.username, avatar_url: u.avatar_url}

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", if(is_binary(v), do: v, else: inspect(v))) end)
    end)
  end

  # GET /api/v1/posts/:id/edits
  def edits(conn, %{"id" => id}) do
    case Integer.parse(id) do
      {post_id_int, ""} ->
        edits = Forum.list_post_edits(post_id_int)
        json(conn, %{edits: Enum.map(edits, fn e ->
          %{id: e.id, old_title: e.old_title, old_body: e.old_body,
            edited_at: e.edited_at, editor: e.editor}
        end)})
      _ -> conn |> put_status(:bad_request) |> json(%{error: "Invalid id"})
    end
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
