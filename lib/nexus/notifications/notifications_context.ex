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
    # No blanket "someone replied to your post" notification —
    # post authors get notified via the follow system instead.
    # Only notify @mentioned users.
    notify_mentions(reply.body, actor, post_id: post.id, reply_id: reply.id)
  end

  @doc """
  Notify a specific post follower that a new reply was posted on a post they follow.
  """
  def notify_followed_post_reply(post, reply, actor, follower_id) do
    enqueue_notification(%{
      type:     "followed_post",
      user_id:  follower_id,
      actor_id: actor.id,
      post_id:  post.id,
      reply_id: reply.id
    })
  end

  @doc """
  Notify all users who have announcements enabled when an admin posts one.
  Dispatches one DeliverNotification job per user (batched, non-blocking).
  """
  def notify_announcement(post, actor) do
    user_ids =
      Nexus.Repo.all(
        from u in Nexus.Accounts.User,
          where: u.id != ^actor.id and u.status == "active",
          select: u.id
      )

    Enum.each(user_ids, fn user_id ->
      enqueue_notification(%{
        type:     "announcement",
        user_id:  user_id,
        actor_id: actor.id,
        post_id:  post.id
      })
    end)
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
