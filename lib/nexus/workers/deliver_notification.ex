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

  # Types that should be grouped (same type + same post = one notification row)
  @groupable_types ~w(reaction reply followed_post)

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"attrs" => attrs}}) do
    # Atomize keys for Ecto
    attrs = for {k, v} <- attrs, into: %{}, do: {String.to_existing_atom(k), v}

    user_id  = attrs.user_id
    actor_id = attrs.actor_id
    type     = attrs.type
    post_id  = Map.get(attrs, :post_id)
    reply_id = Map.get(attrs, :reply_id)

    if type in @groupable_types do
      handle_groupable(attrs, user_id, actor_id, type, post_id, reply_id)
    else
      handle_unique(attrs, user_id, actor_id, type, post_id, reply_id)
    end
  end

  # Group reactions/replies on the same post into a single notification row.
  # Updates the existing unread row if found; otherwise creates a new one.
  defp handle_groupable(attrs, user_id, actor_id, type, post_id, reply_id) do
    user = Nexus.Accounts.get_user(user_id)
    unless web_enabled_for?(user, type) do
      :ok
    else
    existing =
      Nexus.Repo.one(
        from n in Notification,
          where:
            n.user_id == ^user_id and
            n.type    == ^type    and
            n.read    == false    and
            fragment("? IS NOT DISTINCT FROM ?", n.post_id, ^post_id),
          order_by: [desc: n.inserted_at],
          limit: 1
      )

    case existing do
      nil ->
        # No existing unread group — create a fresh row
        do_create(Map.put(attrs, :group_actors, [actor_id]))

      notif ->
        # Already have an unread group — add actor and increment count
        # only if this actor isn't already in the group
        new_actors =
          if actor_id && actor_id not in (notif.group_actors || []) do
            Enum.take([actor_id | (notif.group_actors || [])], 5)
          else
            notif.group_actors || []
          end

        # Exact duplicate — same actor already in this group, skip silently
        if actor_id in (notif.group_actors || []) do
          :ok
        else
          Nexus.Repo.update_all(
            from(n in Notification, where: n.id == ^notif.id),
            set: [
              group_count:  notif.group_count + 1,
              group_actors: new_actors,
              inserted_at:  DateTime.utc_now() |> DateTime.truncate(:second)
            ]
          )
          updated = Nexus.Repo.preload(
            %{notif | group_count: notif.group_count + 1, group_actors: new_actors},
            [:actor, :post, :reply]
          )
          broadcast_notification(updated)
          :ok
        end
    end
    end # unless web_enabled_for?
  end

  # Non-groupable types — strict idempotency: skip if exact duplicate exists
  defp handle_unique(attrs, user_id, actor_id, type, post_id, reply_id) do
    existing =
      if type == "badge" do
        # Badge notifications must be deduplicated by badge_id, not just by
        # user_id + actor_id + type. Without this, every auto-awarded badge
        # (actor_id = nil, post_id = nil, reply_id = nil) matches the same
        # fingerprint and all but the first are silently dropped.
        badge_id = get_in(attrs, [:data, :badge_id]) || get_in(attrs, [:data, "badge_id"])
        Nexus.Repo.one(
          from n in Notification,
            where:
              n.user_id == ^user_id and
              n.type    == ^type    and
              fragment("(?->>'badge_id') = ?", n.data, ^to_string(badge_id)),
            limit: 1
        )
      else
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
      end

    if existing do
      :ok
    else
      do_create(attrs)
    end
  end

  defp do_create(attrs) do
    user = Nexus.Accounts.get_user(attrs.user_id)

    # Respect the "web" (in-app) notification preference.
    # If the user has disabled web notifications for this type, skip entirely —
    # don't create the DB row, don't push, don't email.
    # ctx-aware variant resolves ext_type → preference key for
    # extension notifications.
    if web_enabled_for_ctx?(user, attrs) do
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
    else
      :ok
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
    # ctx-aware variant for extension ext_type resolution.
    with true <- email_enabled_for_ctx?(user, notification),
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

  # Variant that takes the full notification context. For
  # extension notifications, the preference key is the ext_type (the
  # extension's own notification key), not the generic "extension" string.
  # The default value also comes from the extension's declared
  # default_preferences when present.
  defp email_enabled_for_ctx?(nil, _ctx), do: false
  defp email_enabled_for_ctx?(user, %{type: "extension", data: data}) when is_map(data) do
    key = data["ext_type"]
    slug = data["ext_slug"]
    check_extension_channel(user, slug, key, "email")
  end
  defp email_enabled_for_ctx?(user, %{type: type}), do: email_enabled_for?(user, type)

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

    # Push the real unread count so the badge always reflects actual DB state
    # rather than relying on blind client-side increments.
    count = Nexus.Notifications.unread_count(notification.user_id)
    Phoenix.PubSub.broadcast(
      Nexus.PubSub,
      "notifications:#{notification.user_id}",
      {:unread_count, count}
    )
  end

  defp notification_json(n) do
    %{
      id:           n.id,
      type:         n.type,
      read:         n.read,
      data:         n.data,
      group_count:  Map.get(n, :group_count) || 1,
      group_actors: Map.get(n, :group_actors) || [],
      inserted_at:  n.inserted_at,
      actor:        user_json(n.actor),
      post_id:      n.post_id,
      reply_id:     n.reply_id,
      message_id:   n.message_id
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

      not push_enabled_for_ctx?(user, notification) ->
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

  defp push_content(%Notification{type: "reaction", actor: actor, post_id: post_id, reply_id: reply_id, data: data}, site_name) do
    actor_name = actor_display(actor)
    emoji      = get_in(data, ["type"]) || "❤️"
    {target, url} = if post_id do
      {"your post",  post_url(post_id)}
    else
      {"your reply", post_url_for_reply(reply_id)}
    end
    {"#{site_name}", "#{actor_name} reacted #{emoji} to #{target}", url}
  end

  defp push_content(%Notification{type: "followed_post", actor: actor, post_id: post_id}, site_name) do
    actor_name = actor_display(actor)
    {"#{site_name}", "#{actor_name} replied to a post you follow", post_url(post_id)}
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

  defp push_content(%Notification{type: "extension", data: data}, site_name) do
    label = get_in(data, ["push_body"]) || "You have a new notification"
    url   = get_in(data, ["url"]) || "/"
    {"#{site_name}", label, url}
  end

  defp push_content(_, site_name) do
    {"#{site_name}", "You have a new notification", "/"}
  end

  defp actor_display(nil),    do: "Someone"
  defp actor_display(actor),  do: actor.username || "Someone"

  defp post_url(nil),     do: NexusWeb.Endpoint.url()
  defp post_url(post_id), do: "#{NexusWeb.Endpoint.url()}/posts/#{post_id}"

  defp post_url_for_reply(nil), do: NexusWeb.Endpoint.url()
  defp post_url_for_reply(reply_id) do
    case Nexus.Repo.one(
      from r in Nexus.Forum.Reply,
        where: r.id == ^reply_id,
        select: r.post_id
    ) do
      nil     -> NexusWeb.Endpoint.url()
      post_id -> "#{NexusWeb.Endpoint.url()}/posts/#{post_id}"
    end
  end

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

  # ctx-aware variant — see email_enabled_for_ctx? for rationale.
  defp push_enabled_for_ctx?(nil, _ctx), do: false
  defp push_enabled_for_ctx?(user, %{type: "extension", data: data}) when is_map(data) do
    key = data["ext_type"]
    slug = data["ext_slug"]
    check_extension_channel(user, slug, key, "push")
  end
  defp push_enabled_for_ctx?(user, %{type: type}), do: push_enabled_for?(user, type)

  # Check whether the user has in-app (web) notifications enabled for this type.
  # Default is true — only suppress if explicitly set to false.
  defp web_enabled_for?(nil, _type), do: true
  defp web_enabled_for?(user, type) do
    prefs = get_in(user.preferences || %{}, ["notifications", type]) || %{}
    Map.get(prefs, "web", true) != false
  end

  # ctx-aware variant — see email_enabled_for_ctx? for rationale.
  defp web_enabled_for_ctx?(nil, _ctx), do: true
  defp web_enabled_for_ctx?(user, %{type: "extension", data: data}) when is_map(data) do
    key = data["ext_type"]
    slug = data["ext_slug"]
    check_extension_channel(user, slug, key, "web")
  end
  defp web_enabled_for_ctx?(user, %{type: type}), do: web_enabled_for?(user, type)

  # Shared channel resolver for extension notifications.
  #
  # The user's preference JSON looks like:
  #
  #     %{
  #       "notifications" => %{
  #         "reply"        => %{"web" => true, "email" => false},   # built-in
  #         "smoke_notif"  => %{"web" => true, "email" => false}    # ext key
  #       }
  #     }
  #
  # For an extension notification with key "smoke_notif", we look up
  # prefs["smoke_notif"][channel]. If the user has explicitly toggled
  # it, that wins. If not, we fall back to the extension's declared
  # default_preferences for this type. If the type isn't declared
  # (back-compat — extension hasn't migrated yet), we default to true
  # for web, false for email/push.
  defp check_extension_channel(_user, nil, _key, channel) do
    # No slug means we can't look up declarations. Use the conservative
    # defaults.
    default_for_undeclared(channel)
  end
  defp check_extension_channel(user, slug, key, channel) when is_binary(key) do
    prefs = get_in(user.preferences || %{}, ["notifications", key]) || %{}

    cond do
      Map.has_key?(prefs, channel) ->
        # User has explicitly set this — honor it.
        Map.get(prefs, channel) == true

      true ->
        # Fall back to the extension's declared default, or the universal
        # default if the type isn't declared.
        case Nexus.Extensions.Registry.notification_type_for(slug, key) do
          nil ->
            default_for_undeclared(channel)

          %{"default_preferences" => defaults, "channels" => channels} ->
            cond do
              channel not in channels ->
                # Type explicitly excludes this channel — never deliver.
                false
              true ->
                Map.get(defaults || %{}, channel, default_for_undeclared(channel))
            end
        end
    end
  end
  defp check_extension_channel(_user, _slug, _key, channel),
    do: default_for_undeclared(channel)

  defp default_for_undeclared("web"),   do: true
  defp default_for_undeclared("email"), do: false
  defp default_for_undeclared("push"),  do: false
  defp default_for_undeclared(_),       do: false
end
