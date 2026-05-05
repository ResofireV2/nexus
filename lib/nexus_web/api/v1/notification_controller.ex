defmodule NexusWeb.API.V1.NotificationController do
  use NexusWeb, :controller

  alias Nexus.Notifications

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

  defp notification_json(n) do
    %{
      id: n.id,
      type: n.type,
      read: n.read,
      read_at: n.read_at,
      data: n.data,
      inserted_at: n.inserted_at,
      actor: user_json(n.actor),
      post_id: n.post_id,
      reply_id: n.reply_id
    }
  end

  defp user_json(nil), do: nil
  defp user_json(u), do: %{id: u.id, username: u.username, avatar_url: u.avatar_url}
end
