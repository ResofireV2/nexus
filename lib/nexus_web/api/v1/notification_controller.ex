defmodule NexusWeb.API.V1.NotificationController do
  use NexusWeb, :controller

  import Ecto.Query
  alias Nexus.Notifications
  alias Nexus.Repo
  alias Nexus.Forum.Reply

  # GET /api/v1/notifications
  def index(conn, params) do
    user_id     = conn.assigns.current_user.id
    unread_only = params["unread"] == "true"
    cursor      = params["cursor"]

    %{notifications: notifications, next_cursor: next_cursor} =
      Notifications.list_notifications(user_id, unread_only: unread_only, cursor: cursor)

    json(conn, %{
      notifications: Enum.map(notifications, &notification_json/1),
      next_cursor: next_cursor
    })
  end

  # GET /api/v1/notifications/unread
  def unread(conn, _params) do
    count = Notifications.unread_count(conn.assigns.current_user.id)
    json(conn, %{count: count})
  end

  # PATCH /api/v1/notifications/:id/read
  def mark_read(conn, %{"id" => id}) do
    case Notifications.mark_read(id, conn.assigns.current_user.id) do
      {:ok, _}             -> json(conn, %{ok: true})
      {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "Not found"})
    end
  end

  # POST /api/v1/notifications/read-all
  def mark_all_read(conn, _params) do
    Notifications.mark_all_read(conn.assigns.current_user.id)
    json(conn, %{ok: true})
  end

  # DELETE /api/v1/notifications/:id
  def delete(conn, %{"id" => id}) do
    case Notifications.delete_notification(id, conn.assigns.current_user.id) do
      {:ok, _}             -> json(conn, %{ok: true})
      {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "Not found"})
    end
  end

  # DELETE /api/v1/notifications
  def delete_all(conn, _params) do
    Notifications.delete_all_notifications(conn.assigns.current_user.id)
    json(conn, %{ok: true})
  end

  # POST /api/v1/notifications/mark-read-by-post
  # Silently marks all unread notifications for a given post as read.
  # Called when the user navigates to a post regardless of how they got there.
  def mark_read_by_post(conn, %{"post_id" => post_id}) do
    user_id = conn.assigns.current_user.id
    now     = DateTime.utc_now() |> DateTime.truncate(:second)

    # Collect reply IDs that belong to this post so we can also mark
    # notifications that have reply_id set but post_id nil (e.g. reply reactions)
    reply_ids =
      from(r in Nexus.Forum.Reply,
        where: r.post_id == ^post_id,
        select: r.id
      )
      |> Repo.all()

    from(n in Nexus.Notifications.Notification,
      where: n.user_id == ^user_id and n.read == false and (
        n.post_id == ^post_id or
        (is_nil(n.post_id) and n.reply_id in ^reply_ids)
      )
    )
    |> Repo.update_all(set: [read: true, read_at: now])

    count = Nexus.Notifications.unread_count(user_id)

    Phoenix.PubSub.broadcast(
      Nexus.PubSub,
      "notifications:#{user_id}",
      {:unread_count, count}
    )

    json(conn, %{ok: true})
  end
  # Called by extension JS bundles to notify a specific user.
  # The caller must supply target_user_id and a type string.
  def create_extension(conn, params) do
    actor    = conn.assigns.current_user
    user_id  = params["target_user_id"]
    type     = params["type"]
    data     = params["data"] || %{}
    post_id  = params["post_id"]
    reply_id = params["reply_id"]

    cond do
      is_nil(user_id) or is_nil(type) ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "target_user_id and type are required"})

      String.length(type) > 64 ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "type must be 64 characters or fewer"})

      true ->
        Notifications.notify_extension(user_id, type,
          actor_id: actor.id,
          post_id:  post_id,
          reply_id: reply_id,
          data:     data
        )
        json(conn, %{ok: true})
    end
  end

  defp notification_json(n) do
    %{
      id:           n.id,
      type:         n.type,
      read:         n.read,
      read_at:      n.read_at,
      data:         n.data,
      group_count:  n.group_count || 1,
      group_actors: n.group_actors || [],
      inserted_at:  n.inserted_at,
      actor:        user_json(n.actor),
      post_id:      n.post_id,
      reply_id:     n.reply_id
    }
  end

  defp user_json(nil), do: nil
  defp user_json(u), do: %{id: u.id, username: u.username, avatar_url: u.avatar_url}
end
