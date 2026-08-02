defmodule Nexus.Workers.DeliverDmNotification do
  @moduledoc """
  Creates the notification row for one DM recipient, broadcasts it to their
  notification channel, and sends a web push if they have a subscription.

  Replaces two nested `Task.start` calls — one per recipient in
  `Messaging.send_message/3`, and one for the push inside
  `Notifications.enqueue_dm_notification/1`. `Task.start` links nothing and
  logs nothing, so a failure anywhere in that path meant the message was
  delivered while the recipient's notification and push vanished with no trace.
  Under Oban a failure is recorded, retried, and visible in the jobs table.

  Note this is only the *notification*. The message itself reaches open clients
  via the broadcast in `MessageController.create/2` and does not depend on this
  job, so a slow queue delays the badge and the push, never the message.

  Uniqueness is deliberately narrow: a 5 second window on the exact args, which
  collapses an accidental double-send of the same message without suppressing
  genuine consecutive messages in a busy conversation.
  """

  use Oban.Worker,
    queue: :default,
    max_attempts: 3,
    unique: [period: 5, fields: [:args], states: [:available, :scheduled, :executing]]

  import Ecto.Query, only: [from: 2]

  alias Nexus.{Accounts, Notifications, Repo}
  alias Nexus.Notifications.Notification

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"user_id" => user_id, "actor_id" => actor_id, "thread_id" => thread_id}}) do
    # The actor is loaded here rather than passed through job args: args are
    # JSON, and the push body needs the current username rather than whatever
    # it was when the job was queued.
    case Accounts.get_user(actor_id) do
      nil ->
        # Actor deleted between send and delivery. Nothing to notify about.
        :ok

      actor ->
        result =
          case existing_unread(user_id, thread_id) do
            nil  -> create_notification(user_id, actor_id, thread_id)
            notif -> bump_notification(notif)
          end

        case result do
          {:ok, notification} ->
            Phoenix.PubSub.broadcast(
              Nexus.PubSub,
              "notifications:#{user_id}",
              {:new_notification,
               %{
                 id: notification.id,
                 type: "dm",
                 read: false,
                 group_count: notification.group_count,
                 actor: %{id: actor_id, username: actor.username},
                 inserted_at: notification.inserted_at
               }}
            )

            # The badge is driven by this, not by the event above. The client
            # deliberately does not increment on new_notification — it waits for
            # a real count from the DB. DeliverNotification broadcasts one after
            # every notification it creates; the DM path never did, so the
            # notifications badge only moved on a page refresh.
            Phoenix.PubSub.broadcast(
              Nexus.PubSub,
              "notifications:#{user_id}",
              {:unread_count, Notifications.unread_count(user_id)}
            )

            # Pushed on every message, including grouped ones. This is a
            # deliberate difference from DeliverNotification's grouping, which
            # goes silent on repeat activity from the same actor: a second
            # reaction is noise, but a second message is new content the
            # recipient is waiting on. Grouping here is about the notification
            # list, not about suppressing delivery.
            Nexus.Workers.DeliverNotification.maybe_send_push_for_dm(user_id, actor, thread_id)
            :ok

          {:error, changeset} ->
            # Returned rather than swallowed so Oban records and retries it.
            {:error, changeset}
        end
    end
  end

  # An unread DM notification already showing for this thread, if any.
  #
  # DeliverNotification's @groupable_types handles reactions and replies, but it
  # groups by post_id and skips when the actor is already in the group — correct
  # when one person can only react once, wrong here, where the same person
  # sending three messages is exactly the case that needs collapsing. So DMs
  # group on thread_id and count repeats from the same actor.
  defp existing_unread(user_id, thread_id) do
    thread_str = to_string(thread_id)

    Repo.one(
      from n in Notification,
        where:
          n.user_id == ^user_id and
            n.type == "dm" and
            n.read == false and
            fragment("(?->>'thread_id') = ?", n.data, ^thread_str),
        order_by: [desc: n.inserted_at],
        limit: 1
    )
  end

  defp create_notification(user_id, actor_id, thread_id) do
    Notifications.create_notification(%{
      type: "dm",
      user_id: user_id,
      actor_id: actor_id,
      data: %{thread_id: thread_id}
    })
  end

  # inserted_at is touched as well as the count so the thread floats back to the
  # top of the list on each new message rather than staying where the first one
  # landed.
  defp bump_notification(%Notification{} = notif) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    notif
    |> Ecto.Changeset.change(%{
      group_count: (notif.group_count || 1) + 1,
      inserted_at: now
    })
    |> Repo.update()
  end
end
