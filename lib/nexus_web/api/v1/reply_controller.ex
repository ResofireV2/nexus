defmodule NexusWeb.API.V1.ReplyController do
  use NexusWeb, :controller

  alias Nexus.Forum
  alias Nexus.Accounts.User

  # GET /api/v1/posts/:post_id/replies
  def index(conn, %{"post_id" => post_id} = params) do
    case Forum.get_post(post_id) do
      nil -> conn |> put_status(:not_found) |> json(%{error: "Post not found"})
      post ->
        %{replies: replies, next_cursor: next_cursor} =
          Forum.list_replies(post.id, cursor: params["cursor"])

        json(conn, %{
          replies: Enum.map(replies, &reply_json/1),
          next_cursor: next_cursor
        })
    end
  end

  # POST /api/v1/posts/:post_id/replies
  def create(conn, %{"post_id" => post_id} = params) do
    user = conn.assigns.current_user

    # Check email verification requirement
    if Nexus.Permissions.require_email_verification?() && !user.email_verified && user.role == "member" do
      conn |> put_status(:forbidden) |> json(%{error: "Please verify your email address before posting"})
    else
      case Forum.get_post(post_id) do
        nil  -> conn |> put_status(:not_found) |> json(%{error: "Post not found"})
        %{locked: true} -> conn |> put_status(:forbidden) |> json(%{error: "Post is locked"})
        post ->
          pending = !Nexus.Permissions.can_post_immediately?(user) && user.role == "member"

          case Forum.create_reply(post, Map.put(params, "pending_approval", pending), user) do
            {:ok, reply} ->
              if pending do
                conn |> put_status(:created) |> json(%{reply: reply_json(reply), pending: true, message: "Your reply is pending approval"})
              else
                Nexus.Activity.increment_stat(user.id, :replies_count)
                # Auto-follow the post if user preference is set (default: true)
                if Map.get(user.preferences || %{}, "auto_follow_replied_posts", true) != false do
                  Forum.follow_post(user.id, post.id)
                end
                Task.start(fn -> Nexus.Notifications.notify_reply(post, reply, user) end)
                # Notify post followers (excluding the reply author)
                Task.start(fn ->
                  follower_ids = Forum.post_follower_ids(post.id)
                  Enum.each(follower_ids, fn follower_id ->
                    if follower_id != user.id do
                      Nexus.Notifications.notify_followed_post_reply(post, reply, user, follower_id)
                    end
                  end)
                end)
                Task.start(fn -> Nexus.Extensions.fire("reply_created", %{reply_id: reply.id, post_id: post.id}) end)
                %{"user_id" => user.id} |> Nexus.Workers.CheckBadges.new(schedule_in: 60) |> Oban.insert()
                %{"user_id" => user.id} |> Nexus.Workers.UpdateScore.new() |> Oban.insert()

                # Broadcast to every subscriber of this post's notification channel.
                # Using "post_viewers:{post_id}" as a lightweight PubSub topic that
                # PostChannel processes subscribe to on join — more reliable than
                # depending on the post: channel PubSub subscription being active.
                Phoenix.PubSub.broadcast(
                  Nexus.PubSub,
                  "post_viewers:#{post.id}",
                  {:new_reply, reply_json(reply)}
                )

                conn |> put_status(:created) |> json(%{reply: reply_json(reply)})
              end

            {:error, changeset} ->
              conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
          end
      end
    end
  end

  # PATCH /api/v1/posts/:post_id/replies/:id
  def update(conn, %{"id" => id} = params) do
    user = conn.assigns.current_user

    case Forum.get_reply(id) do
      nil   -> conn |> put_status(:not_found) |> json(%{error: "Reply not found"})
      reply ->
        if can_edit?(user, reply) do
          Forum.record_reply_edit(reply, user.id)
          case Forum.update_reply(reply, params) do
            {:ok, updated} -> json(conn, %{reply: reply_json(updated)})
            {:error, cs}   -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
          end
        else
          conn |> put_status(:forbidden) |> json(%{error: "Not authorized"})
        end
    end
  end

  # DELETE /api/v1/posts/:post_id/replies/:id
  def delete(conn, %{"id" => id}) do
    user = conn.assigns.current_user

    case Forum.get_reply(id) do
      nil   -> conn |> put_status(:not_found) |> json(%{error: "Reply not found"})
      reply ->
        if can_edit?(user, reply) do
          {:ok, _} = Forum.delete_reply(reply)
          json(conn, %{ok: true})
        else
          conn |> put_status(:forbidden) |> json(%{error: "Not authorized"})
        end
    end
  end

  # POST /api/v1/posts/:post_id/replies/:id/hide  (moderator+)
  def hide(conn, %{"id" => id}) do
    case Forum.get_reply(id) do
      nil   -> conn |> put_status(:not_found) |> json(%{error: "Reply not found"})
      reply ->
        {:ok, _} = Forum.hide_reply(reply, conn.assigns.current_user.id)
        json(conn, %{ok: true})
    end
  end

  defp can_edit?(user, reply) do
    user.id == reply.user_id || User.moderator?(user)
  end

  defp reply_json(reply) do
    %{
      id: reply.id,
      body: reply.body,
      body_format: reply.body_format,
      post_id: reply.post_id,
      reaction_count: reply.reaction_count,
      reactions: Nexus.Forum.list_reactions(reply_id: reply.id),
      inserted_at: reply.inserted_at,
      updated_at: reply.updated_at,
      user: user_json(reply.user),
      edit_count: Forum.reply_edit_count(reply.id)
    }
  end

  defp user_json(nil), do: nil
  defp user_json(u), do: %{id: u.id, username: u.username, avatar_url: u.avatar_url}

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", to_string(v)) end)
    end)
  end

  # GET /api/v1/posts/:post_id/replies/:id/edits
  def edits(conn, %{"id" => id}) do
    edits = Forum.list_reply_edits(String.to_integer(id))
    json(conn, %{edits: Enum.map(edits, fn e ->
      %{id: e.id, old_body: e.old_body, edited_at: e.edited_at, editor: e.editor}
    end)})
  end
end
