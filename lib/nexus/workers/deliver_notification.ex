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
            fragment("? IS NOT DISTINCT FROM ?", n.post_id,  ^post_id) and
            fragment("? IS NOT DISTINCT FROM ?", n.reply_id, ^reply_id),
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
    require Logger

    if not push_enabled_for?(Nexus.Accounts.get_user(user_id), "dm") do
      :ok
    else
      subscriptions = Nexus.Accounts.get_push_subscriptions(user_id)

      if Enum.empty?(subscriptions) do
        :ok
      else
        pwa           = Nexus.Admin.get_setting("pwa")
        vapid_public  = pwa["vapid_public"]
        vapid_private = pwa["vapid_private"]

        if vapid_public && vapid_private do
          site_name  = (Nexus.Admin.get_setting("general"))["site_name"] || "Nexus"
          host       = NexusWeb.Endpoint.url()
          raw_icon   = pwa["icon_192_path"] || "/images/icon-192.png"
          raw_badge  = pwa["badge_url"] || raw_icon
          icon       = if String.starts_with?(raw_icon,  "http"), do: raw_icon,  else: "#{host}#{raw_icon}"
          badge      = if String.starts_with?(raw_badge, "http"), do: raw_badge, else: "#{host}#{raw_badge}"
          actor_name = actor_display(actor)

          payload = Jason.encode!(%{
            title: site_name,
            body:  "#{actor_name} sent you a message",
            icon:  icon,
            badge: badge,
            url:   "#{host}/messages/#{thread_id}"
          })

          Enum.each(subscriptions, fn sub ->
            case Nexus.WebPush.send(sub.endpoint, sub.p256dh, sub.auth, vapid_public, vapid_private, payload) do
              :ok ->
                Logger.info("Push DM: delivered to user #{user_id}")
              {:error, :subscription_expired} ->
                Nexus.Accounts.clear_push_subscription_by_endpoint(sub.endpoint)
              {:error, :subscription_not_found} ->
                Nexus.Accounts.clear_push_subscription_by_endpoint(sub.endpoint)
              {:error, reason} ->
                Logger.warning("Push DM failed for user #{user_id}: #{inspect(reason)}")
            end
          end)
        end
      end
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
        :ok

      not push_enabled_for?(user, notification.type) ->
        Logger.info("Push: user #{user.id} has push disabled for type #{notification.type}")
        :ok

      true ->
        subscriptions = Nexus.Accounts.get_push_subscriptions(notification.user_id)

        if Enum.empty?(subscriptions) do
          Logger.info("Push: user #{notification.user_id} has no push subscriptions")
          :ok
        else
          pwa = Nexus.Admin.get_setting("pwa")
          vapid_public  = pwa["vapid_public"]
          vapid_private = pwa["vapid_private"]

          if is_nil(vapid_public) or is_nil(vapid_private) do
            Logger.warning("Push: VAPID keys not configured")
            :ok
          else
            payload = build_push_payload(notification, pwa)

            Enum.each(subscriptions, fn sub ->
              Logger.info("Push: sending to user #{notification.user_id} endpoint #{String.slice(sub.endpoint, 0, 50)}…")

              case Nexus.WebPush.send(sub.endpoint, sub.p256dh, sub.auth, vapid_public, vapid_private, payload) do
                :ok ->
                  Logger.info("Push: delivered to user #{notification.user_id}")

                {:error, :subscription_expired} ->
                  Logger.info("Push: subscription expired for user #{notification.user_id}, clearing")
                  Nexus.Accounts.clear_push_subscription_by_endpoint(sub.endpoint)

                {:error, :subscription_not_found} ->
                  Logger.info("Push: subscription not found for user #{notification.user_id}, clearing")
                  Nexus.Accounts.clear_push_subscription_by_endpoint(sub.endpoint)

                {:error, reason} ->
                  Logger.warning("Push: failed for user #{notification.user_id}: #{inspect(reason)}")
              end
            end)
          end
        end
    end
  end

  defp build_push_payload(notification, pwa) do
    site_name = (Nexus.Admin.get_setting("general"))["site_name"] || "Nexus"

    # Icons must be absolute URLs for the push service to fetch them on the device.
    host      = NexusWeb.Endpoint.url()
    raw_icon  = pwa["icon_192_path"] || "/images/icon-192.png"
    raw_badge = pwa["badge_url"]     || raw_icon
    icon      = if String.starts_with?(raw_icon,  "http"), do: raw_icon,  else: "#{host}#{raw_icon}"
    badge     = if String.starts_with?(raw_badge, "http"), do: raw_badge, else: "#{host}#{raw_badge}"

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

  defp post_url(nil),     do: NexusWeb.Endpoint.url()
  defp post_url(post_id), do: "#{NexusWeb.Endpoint.url()}/posts/#{post_id}"

  defp thread_url(nil),       do: "/messages"
  defp thread_url(thread_id), do: "/messages/#{thread_id}"

  # Clear a stale push subscription from the user record.
  # Called when the push endpoint returns 410 (expired) or 404 (not found).
  # Silently succeeds — if the update fails the subscription will be retried
  # on the next notification and cleaned up then.
  # Check whether the user has push enabled for this notification type.
  # Preferences are stored as: preferences["notifications"][type]["push"] = true/false
  # Default is true — only skip if explicitly set to false.
  defp push_enabled_for?(nil, _type), do: false
  defp push_enabled_for?(user, type) do
    prefs = get_in(user.preferences || %{}, ["notifications", type]) || %{}
    Map.get(prefs, "push", true) != false
  end
end
