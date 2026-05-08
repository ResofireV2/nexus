defmodule Nexus.Workers.DeliverNotification do
  @moduledoc """
  Oban worker that creates a notification record, broadcasts it to the
  recipient's Phoenix channel, and sends a web push notification if the
  user has a push subscription stored.
  """

  use Oban.Worker, queue: :default, max_attempts: 3

  alias Nexus.Notifications
  alias Nexus.Notifications.Notification

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"attrs" => attrs}}) do
    # Atomize keys for Ecto
    attrs = for {k, v} <- attrs, into: %{}, do: {String.to_existing_atom(k), v}

    case Notifications.create_notification(attrs) do
      {:ok, notification} ->
        notification = Nexus.Repo.preload(notification, [:actor, :post, :reply])
        broadcast_notification(notification)
        maybe_send_push(notification)
        :ok

      {:error, changeset} ->
        {:error, changeset}
    end
  end

  # ---------------------------------------------------------------------------
  # Phoenix PubSub broadcast (existing behaviour — unchanged)
  # ---------------------------------------------------------------------------

  defp broadcast_notification(notification) do
    payload = notification_json(notification)

    Phoenix.PubSub.broadcast(
      Nexus.PubSub,
      "notifications:#{notification.user_id}",
      {:new_notification, payload}
    )
  end

  defp notification_json(n) do
    %{
      id: n.id,
      type: n.type,
      read: n.read,
      data: n.data,
      inserted_at: n.inserted_at,
      actor: user_json(n.actor),
      post_id: n.post_id,
      reply_id: n.reply_id,
      message_id: n.message_id
    }
  end

  defp user_json(nil), do: nil
  defp user_json(u), do: %{id: u.id, username: u.username, avatar_url: u.avatar_url}

  # ---------------------------------------------------------------------------
  # Web push
  # ---------------------------------------------------------------------------

  defp maybe_send_push(notification) do
    user = Nexus.Accounts.get_user(notification.user_id)

    with %{"endpoint" => endpoint, "keys" => %{"p256dh" => p256dh, "auth" => auth}} <-
           user && user.push_subscription,
         pwa = Nexus.Admin.get_setting("pwa"),
         vapid_public  when not is_nil(vapid_public)  <- pwa["vapid_public"],
         vapid_private when not is_nil(vapid_private) <- pwa["vapid_private"] do

      payload = build_push_payload(notification, pwa)

      case Nexus.WebPush.send(endpoint, p256dh, auth, vapid_public, vapid_private, payload) do
        :ok -> :ok
        # Push delivery failures are non-fatal — log and continue
        {:error, reason} ->
          require Logger
          Logger.warning("Web push failed for user #{notification.user_id}: #{inspect(reason)}")
          :ok
      end
    else
      _ -> :ok
    end
  end

  defp build_push_payload(notification, pwa) do
    site_name = (Nexus.Admin.get_setting("general"))["site_name"] || "Nexus"
    icon      = pwa["icon_192_path"] || "/images/icon-192.png"
    badge     = pwa["badge_url"]     || icon

    {title, body, url} = push_content(notification, site_name)

    Jason.encode!(%{title: title, body: body, icon: icon, badge: badge, url: url})
  end

  # Map notification type to human-readable push content
  defp push_content(%Notification{type: "reply", actor: actor, post_id: post_id}, site_name) do
    actor_name = actor_display(actor)
    {"#{site_name}", "#{actor_name} replied to your post", post_url(post_id)}
  end

  defp push_content(%Notification{type: "mention", actor: actor, post_id: post_id}, site_name) do
    actor_name = actor_display(actor)
    {"#{site_name}", "#{actor_name} mentioned you", post_url(post_id)}
  end

  defp push_content(%Notification{type: "reaction", actor: actor, post_id: post_id, data: data}, site_name) do
    actor_name = actor_display(actor)
    emoji      = get_in(data, ["type"]) || "❤️"
    {"#{site_name}", "#{actor_name} reacted #{emoji} to your post", post_url(post_id)}
  end

  defp push_content(%Notification{type: "dm", data: data}, site_name) do
    thread_id = get_in(data, ["thread_id"])
    {"#{site_name}", "You have a new direct message", thread_url(thread_id)}
  end

  defp push_content(%Notification{type: "badge"}, site_name) do
    {"#{site_name}", "You earned a new badge!", "/"}
  end

  defp push_content(%Notification{type: "announcement"}, site_name) do
    {"#{site_name}", "New announcement from the team", "/"}
  end

  defp push_content(_, site_name) do
    {"#{site_name}", "You have a new notification", "/"}
  end

  defp actor_display(nil),    do: "Someone"
  defp actor_display(actor),  do: actor.username || "Someone"

  defp post_url(nil),     do: "/"
  defp post_url(post_id), do: "/posts/#{post_id}"

  defp thread_url(nil),       do: "/messages"
  defp thread_url(thread_id), do: "/messages/#{thread_id}"
end
