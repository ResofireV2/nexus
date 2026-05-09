defmodule Nexus.Workers.DeliverNotification do
  @moduledoc """
  Oban worker that creates a notification record, broadcasts it to the
  recipient's Phoenix channel, and sends a web push notification if the
  user has a push subscription stored.
  """

  use Oban.Worker,
    queue: :default,
    max_attempts: 3,
    unique: [period: 30, fields: [:args], keys: [:attrs]]

  alias Nexus.Notifications
  alias Nexus.Notifications.Notification
  import Ecto.Query, only: [from: 2]

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"attrs" => attrs}}) do
    # Atomize keys for Ecto
    attrs = for {k, v} <- attrs, into: %{}, do: {String.to_existing_atom(k), v}

    # Idempotency guard — bind optional fields to variables first
    # since ^Map.get() cannot be used directly inside a query macro.
    user_id  = attrs.user_id
    actor_id = attrs.actor_id
    type     = attrs.type
    post_id  = Map.get(attrs, :post_id)
    reply_id = Map.get(attrs, :reply_id)

    existing =
      Nexus.Repo.one(
        from n in Notification,
          where:
            n.user_id  == ^user_id and
            n.actor_id == ^actor_id and
            n.type     == ^type and
            n.post_id  == ^post_id and
            n.reply_id == ^reply_id,
          limit: 1
      )

    if existing do
      :ok
    else
      case Notifications.create_notification(attrs) do
        {:ok, notification} ->
          notification = Nexus.Repo.preload(notification, [:actor, :post, :reply])
          broadcast_notification(notification)
          maybe_send_push(notification)
          maybe_send_email(notification)
          :ok

        {:error, changeset} ->
          {:error, changeset}
      end
    end
  end

  # ---------------------------------------------------------------------------
  # Email notifications
  # ---------------------------------------------------------------------------

  defp maybe_send_email(notification) do
    if notification.type == "dm", do: :ok, else: do_maybe_send_email(notification)
  end

  defp do_maybe_send_email(notification) do
    user = Nexus.Accounts.get_user(notification.user_id)
    with true <- email_enabled_for?(user, notification.type),
         actor_name <- actor_display(notification.actor) do
      Task.start(fn ->
        Nexus.Mailer.send_notification_email(user, %{
          type:  notification.type,
          actor: actor_name
        })
      end)
    end
    :ok
  end

  defp email_enabled_for?(nil, _type), do: false
  defp email_enabled_for?(user, type) do
    prefs = get_in(user.preferences || %{}, ["notifications", type]) || %{}
    Map.get(prefs, "email", false) == true
  end

  # ---------------------------------------------------------------------------
  # Public helper called by Nexus.Notifications for DM push
  # DMs bypass the Oban worker, so notifications_context calls this directly.
  # ---------------------------------------------------------------------------

  def maybe_send_push_for_dm(user_id, actor, thread_id) do
    user = Nexus.Accounts.get_user(user_id)

    with %{"endpoint" => endpoint, "keys" => %{"p256dh" => p256dh, "auth" => auth}} <-
           user && user.push_subscription,
         true <- push_enabled_for?(user, "dm"),
         pwa = Nexus.Admin.get_setting("pwa"),
         vapid_public  when not is_nil(vapid_public)  <- pwa["vapid_public"],
         vapid_private when not is_nil(vapid_private) <- pwa["vapid_private"] do

      site_name = (Nexus.Admin.get_setting("general"))["site_name"] || "Nexus"
      icon      = pwa["icon_192_path"] || "/images/icon-192.png"
      badge     = pwa["badge_url"]     || icon
      actor_name = actor_display(actor)

      payload = Jason.encode!(%{
        title: site_name,
        body:  "#{actor_name} sent you a message",
        icon:  icon,
        badge: badge,
        url:   thread_url(thread_id)
      })

      case Nexus.WebPush.send(endpoint, p256dh, auth, vapid_public, vapid_private, payload) do
        :ok ->
          :ok

        {:error, :subscription_expired} ->
          clear_subscription(user)

        {:error, :subscription_not_found} ->
          clear_subscription(user)

        {:error, reason} ->
          require Logger
          Logger.warning("DM web push failed for user #{user_id}: #{inspect(reason)}")
          :ok
      end
    else
      _ -> :ok
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
    require Logger
    user = Nexus.Accounts.get_user(notification.user_id)

    cond do
      is_nil(user) ->
        Logger.warning("Push: user #{notification.user_id} not found")
        :ok

      is_nil(user.push_subscription) ->
        Logger.info("Push: user #{user.id} has no push subscription")
        :ok

      not push_enabled_for?(user, notification.type) ->
        Logger.info("Push: user #{user.id} has push disabled for type #{notification.type}")
        :ok

      true ->
        sub = user.push_subscription
        endpoint = sub["endpoint"]
        p256dh   = get_in(sub, ["keys", "p256dh"])
        auth     = get_in(sub, ["keys", "auth"])

        if is_nil(endpoint) or is_nil(p256dh) or is_nil(auth) do
          Logger.warning("Push: malformed subscription for user #{user.id}: #{inspect(sub)}")
          :ok
        else
          pwa = Nexus.Admin.get_setting("pwa")
          vapid_public  = pwa["vapid_public"]
          vapid_private = pwa["vapid_private"]

          cond do
            is_nil(vapid_public) ->
              Logger.warning("Push: VAPID public key not configured")
              :ok

            is_nil(vapid_private) ->
              Logger.warning("Push: VAPID private key not configured")
              :ok

            true ->
              payload = build_push_payload(notification, pwa)
              Logger.info("Push: sending to user #{user.id} endpoint #{String.slice(endpoint, 0, 50)}…")

              case Nexus.WebPush.send(endpoint, p256dh, auth, vapid_public, vapid_private, payload) do
                :ok ->
                  Logger.info("Push: delivered to user #{user.id}")
                  :ok

                {:error, :subscription_expired} ->
                  Logger.info("Push: subscription expired for user #{user.id}, clearing")
                  clear_subscription(user)

                {:error, :subscription_not_found} ->
                  Logger.info("Push: subscription not found for user #{user.id}, clearing")
                  clear_subscription(user)

                {:error, reason} ->
                  Logger.warning("Push: failed for user #{user.id}: #{inspect(reason)}")
                  :ok
              end
          end
        end
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

  # Clear a stale push subscription from the user record.
  # Called when the push endpoint returns 410 (expired) or 404 (not found).
  # Silently succeeds — if the update fails the subscription will be retried
  # on the next notification and cleaned up then.
  defp clear_subscription(user) do
    require Logger
    Logger.info("Clearing stale push subscription for user #{user.id}")
    Nexus.Accounts.update_preferences(user, %{push_subscription: nil})
    :ok
  end

  # Check whether the user has push enabled for this notification type.
  # Preferences are stored as: preferences["notifications"][type]["push"] = true/false
  # Default is true — only skip if explicitly set to false.
  defp push_enabled_for?(user, type) do
    prefs = get_in(user.preferences || %{}, ["notifications", type]) || %{}
    Map.get(prefs, "push", true) != false
  end
end
