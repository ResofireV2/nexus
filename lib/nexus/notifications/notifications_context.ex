defmodule Nexus.Notifications do
  @moduledoc """
  The Notifications context. Handles in-app notifications.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Notifications.Notification

  @page_size 30

  # ---------------------------------------------------------------------------
  # Listing
  # ---------------------------------------------------------------------------

  def list_notifications(user_id, opts \\ []) do
    unread_only = Keyword.get(opts, :unread_only, false)
    cursor      = Keyword.get(opts, :cursor)

    query =
      from n in Notification,
        where: n.user_id == ^user_id,
        order_by: [desc: n.inserted_at, desc: n.id],
        preload: [:actor, :post, :reply]

    query = if unread_only, do: where(query, [n], n.read == false), else: query

    query =
      if cursor do
        case decode_cursor(cursor) do
          {:ok, %{"id" => id, "inserted_at" => ts}} ->
            dt = DateTime.from_unix!(ts)
            where(query, [n], n.inserted_at < ^dt or (n.inserted_at == ^dt and n.id < ^id))
          _ -> query
        end
      else
        query
      end

    query = limit(query, @page_size + 1)
    notifications = Repo.all(query)

    {notifications, next_cursor} =
      if length(notifications) > @page_size do
        items = Enum.take(notifications, @page_size)
        last  = List.last(items)
        c = %{"id" => last.id, "inserted_at" => DateTime.to_unix(last.inserted_at)}
            |> Jason.encode!()
            |> Base.url_encode64(padding: false)
        {items, c}
      else
        {notifications, nil}
      end

    %{notifications: notifications, next_cursor: next_cursor}
  end

  def unread_count(user_id) do
    from(n in Notification,
      where: n.user_id == ^user_id and n.read == false,
      select: count(n.id)
    )
    |> Repo.one() || 0
  end

  # ---------------------------------------------------------------------------
  # Creating
  # ---------------------------------------------------------------------------

  def create_notification(attrs) do
    %Notification{}
    |> Notification.changeset(attrs)
    |> Repo.insert()
  end

  def enqueue_dm_notification(%{user_id: user_id, actor_id: actor_id, actor: actor, thread_id: thread_id}) do
    # Create the notification record
    case create_notification(%{
      type: "dm",
      user_id: user_id,
      actor_id: actor_id,
      data: %{thread_id: thread_id}
    }) do
      {:ok, notification} ->
        # Broadcast instantly to the user's notification channel
        Phoenix.PubSub.broadcast(Nexus.PubSub, "notifications:#{user_id}", {:new_notification, %{
          id: notification.id,
          type: "dm",
          read: false,
          actor: %{id: actor_id, username: actor.username},
          inserted_at: notification.inserted_at
        }})

        # Also send a web push — DMs bypass the Oban worker so we handle push here
        Task.start(fn ->
          Nexus.Workers.DeliverNotification.maybe_send_push_for_dm(user_id, actor, thread_id)
        end)

      _ -> :ok
    end
  end

  def notify_reply(post, reply, actor) do
    # Notify the post author directly if they're not the one replying.
    # This is separate from the follow system so authors always get notified
    # regardless of their follow preferences.
    if post.user_id && post.user_id != actor.id do
      enqueue_notification(%{
        type:     "reply",
        user_id:  post.user_id,
        actor_id: actor.id,
        post_id:  post.id,
        reply_id: reply.id
      })
    end

    # Also notify @mentioned users
    notify_mentions(reply.body, actor, post_id: post.id, reply_id: reply.id)
  end

  @doc """
  Notify a specific post follower that a new reply was posted on a post they follow.
  """
  def notify_followed_post_reply(post, reply, actor, follower_id) do
    # Skip the post author — they already receive a direct "reply" notification.
    # Skip the actor — they don't need to be notified of their own reply.
    if follower_id != actor.id && follower_id != post.user_id do
      enqueue_notification(%{
        type:     "followed_post",
        user_id:  follower_id,
        actor_id: actor.id,
        post_id:  post.id,
        reply_id: reply.id
      })
    end
  end

  def notify_reaction(post_or_reply, actor, type) do
    owner_id =
      case post_or_reply do
        %Nexus.Forum.Post{user_id: uid}  -> uid
        %Nexus.Forum.Reply{user_id: uid} -> uid
      end

    if owner_id && owner_id != actor.id do
      attrs = %{
        type: "reaction",
        user_id: owner_id,
        actor_id: actor.id,
        data: %{type: type}
      }

      attrs =
        case post_or_reply do
          %Nexus.Forum.Post{id: id}  -> Map.put(attrs, :post_id, id)
          %Nexus.Forum.Reply{id: id} -> Map.put(attrs, :reply_id, id)
        end

      enqueue_notification(attrs)
    end
  end

  defp notify_mentions(body, actor, source_ids) do
    # Extract @username mentions
    mentions = Regex.scan(~r/@([a-zA-Z0-9_]+)/, body, capture: :all_but_first)
               |> List.flatten()
               |> Enum.uniq()

    for username <- mentions do
      case Nexus.Accounts.get_user_by_username(username) do
        nil  -> :skip
        user ->
          if user.id != actor.id do
            attrs =
              %{type: "mention", user_id: user.id, actor_id: actor.id}
              |> Map.merge(Map.new(source_ids))

            enqueue_notification(attrs)
          end
      end
    end
  end

  defp enqueue_notification(attrs) do
    %{attrs: attrs}
    |> Nexus.Workers.DeliverNotification.new()
    |> Oban.insert()
  end

  @doc """
  Send a notification from an extension. The `slug` identifies the
  extension and is used to look up the declared notification type for
  validation. The `key` (formerly `type`) identifies the notification
  within the extension (e.g. "new_review") and must match a declared
  notification_types entry in the extension's manifest. It's stored in
  data["ext_type"] and the DB record uses the generic "extension" type,
  keeping the schema valid while allowing unlimited extension-defined types.

  When the extension declares a payload_schema for this type, the data
  payload is validated against it — missing required fields produce
  `{:error, reason}` instead of an enqueued notification.

  Returns `{:ok, job}` on success, `{:error, reason}` on validation
  failure.
  """
  def notify_extension(slug, key, opts \\ []) when is_binary(slug) and is_binary(key) do
    data = Keyword.get(opts, :data, %{})

    case validate_extension_notification(slug, key, data) do
      :ok ->
        attrs = %{
          type:     "extension",
          user_id:  Keyword.fetch!(opts, :user_id),
          actor_id: Keyword.get(opts, :actor_id),
          post_id:  Keyword.get(opts, :post_id),
          reply_id: Keyword.get(opts, :reply_id),
          data:     Map.merge(%{"ext_type" => key, "ext_slug" => slug}, data)
        }

        enqueue_notification(attrs)
        {:ok, :enqueued}

      {:error, reason} ->
        require Logger
        Logger.warning("Notifications: rejected extension notification " <>
                       "#{slug}/#{key}: #{reason}")
        {:error, reason}
    end
  end

  # Back-compat shim for the old 2-arg form (user_id, type, opts). Extensions
  # using this haven't declared their notification types in the manifest yet;
  # we log a deprecation warning and send anyway with slug="legacy".
  @deprecated "Pass slug as the first argument: notify_extension(slug, key, user_id: user_id, ...)"
  def notify_extension(user_id, key, opts) when is_integer(user_id) or is_binary(user_id) do
    require Logger
    Logger.warning("Notifications.notify_extension/3 called with legacy " <>
                   "2-positional form (user_id, key, opts). Pass slug as " <>
                   "the first argument so notification type validation works.")

    notify_extension("legacy", key, Keyword.put(opts, :user_id, user_id))
  end

  # Validates a notification payload against the extension's declared
  # notification type, if one exists. Returns :ok if either:
  #   - The extension declares a type with this key and the payload matches
  #     its payload_schema (all declared fields present in data)
  #   - The extension does NOT declare a type with this key (back-compat:
  #     log but allow). This is the soft-mode behavior — extensions can
  #     adopt declared types incrementally without breaking existing flows.
  # Returns {:error, reason} when the declared payload_schema is violated.
  defp validate_extension_notification(slug, key, data) do
    case Nexus.Extensions.Registry.notification_type_for(slug, key) do
      nil ->
        # No declaration. Allow but log (soft mode). Extensions declaring
        # the type would get strict validation; ones not declaring opt
        # out by omission.
        require Logger
        Logger.debug("Notifications: extension #{slug} sending undeclared " <>
                     "notification type #{inspect(key)} — declare it in " <>
                     "manifest.notification_types for validation and " <>
                     "user-facing preferences UI.")
        :ok

      %{"payload_schema" => nil} ->
        :ok

      %{"payload_schema" => schema} when is_map(schema) ->
        missing =
          schema
          |> Map.keys()
          |> Enum.reject(fn k ->
            # Field present if either string or atom key is in the data map
            Map.has_key?(data, k) or Map.has_key?(data, String.to_atom(k))
          end)

        if missing == [] do
          :ok
        else
          {:error,
           "missing required fields per payload_schema: #{Enum.join(missing, ", ")}"}
        end
    end
  end

  # ---------------------------------------------------------------------------
  # Marking read
  # ---------------------------------------------------------------------------

  def mark_read(notification_id, user_id) do
    case Repo.get_by(Notification, id: notification_id, user_id: user_id) do
      nil -> {:error, :not_found}
      n   ->
        n |> Notification.mark_read_changeset() |> Repo.update()
    end
  end

  def mark_all_read(user_id) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    from(n in Notification,
      where: n.user_id == ^user_id and n.read == false
    )
    |> Repo.update_all(set: [read: true, read_at: now])

    {:ok, :marked}
  end

  def delete_notification(id, user_id) do
    case Repo.get_by(Notification, id: id, user_id: user_id) do
      nil -> {:error, :not_found}
      n   -> Repo.delete(n)
    end
  end

  def delete_all_notifications(user_id) do
    from(n in Notification, where: n.user_id == ^user_id)
    |> Repo.delete_all()
    {:ok, :deleted}
  end

  defp decode_cursor(cursor) do
    with {:ok, json} <- Base.url_decode64(cursor, padding: false),
         {:ok, data} <- Jason.decode(json) do
      {:ok, data}
    else
      _ -> {:error, :invalid}
    end
  end
end
