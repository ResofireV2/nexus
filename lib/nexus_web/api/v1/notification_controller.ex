defmodule NexusWeb.API.V1.NotificationController do
  use NexusWeb, :controller

  import Ecto.Query
  alias Nexus.Notifications
  alias Nexus.Repo

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

  # GET /api/v1/notifications/declared-types
  # Returns declared notification types from all currently-enabled
  # extensions, grouped per-extension. The preferences page renders one
  # section per extension below the built-in notification types.
  def declared_types(conn, _params) do
    groups = Nexus.Extensions.Registry.declared_notification_types_grouped()
    json(conn, %{groups: groups})
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

  # POST /api/v1/notifications/mark-read-by-thread
  # Marks all unread DM notifications for a given thread as read.
  # Called when the user opens a DM thread.
  def mark_read_by_thread(conn, %{"thread_id" => thread_id}) do
    user_id    = conn.assigns.current_user.id
    now        = DateTime.utc_now() |> DateTime.truncate(:second)
    thread_str = to_string(thread_id)

    from(n in Nexus.Notifications.Notification,
      where: n.user_id == ^user_id and n.read == false and n.type == "dm" and
             fragment("(?->>'thread_id') = ?", n.data, ^thread_str)
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

  # POST /api/v1/notifications/mark-read-by-post
  # Silently marks all unread notifications for a given post as read.
  # Called when the user navigates to a post regardless of how they got there.
  def mark_read_by_post(conn, %{"post_id" => post_id}) do
    user_id = conn.assigns.current_user.id
    now     = DateTime.utc_now() |> DateTime.truncate(:second)

    # Single UPDATE using a subquery — avoids the separate SELECT for reply_ids.
    reply_id_subquery = from(r in Nexus.Forum.Reply, where: r.post_id == ^post_id, select: r.id)

    from(n in Nexus.Notifications.Notification,
      where: n.user_id == ^user_id and n.read == false and (
        n.post_id == ^post_id or
        (is_nil(n.post_id) and n.reply_id in subquery(reply_id_subquery))
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
  # The caller must supply slug (their extension's slug), target_user_id,
  # and a type string. Validates against the declared notification type
  # when one exists; returns 422 on validation failure.
  def create_extension(conn, params) do
    actor    = conn.assigns.current_user
    slug     = params["slug"]
    user_id  = params["target_user_id"]
    type     = params["type"]
    data     = params["data"] || %{}
    post_id  = params["post_id"]
    reply_id = params["reply_id"]

    cond do
      is_nil(slug) or not is_binary(slug) ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "slug is required"})

      not Nexus.Extensions.Registry.enabled?(slug) ->
        # Either the extension doesn't exist or is currently disabled.
        # In either case, the notification shouldn't fire.
        conn |> put_status(:forbidden) |> json(%{error: "Extension \"#{slug}\" is not enabled"})

      is_nil(user_id) or is_nil(type) ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "target_user_id and type are required"})

      String.length(type) > 64 ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "type must be 64 characters or fewer"})

      true ->
        result = Notifications.notify_extension(slug, type,
          user_id:  user_id,
          actor_id: actor.id,
          post_id:  post_id,
          reply_id: reply_id,
          data:     data
        )

        case result do
          {:ok, _} ->
            json(conn, %{ok: true})

          {:error, reason} ->
            conn |> put_status(:unprocessable_entity) |> json(%{error: reason})
        end
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
