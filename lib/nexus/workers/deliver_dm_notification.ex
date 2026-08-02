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

  alias Nexus.{Accounts, Notifications}

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
        case Notifications.create_notification(%{
               type: "dm",
               user_id: user_id,
               actor_id: actor_id,
               data: %{thread_id: thread_id}
             }) do
          {:ok, notification} ->
            Phoenix.PubSub.broadcast(
              Nexus.PubSub,
              "notifications:#{user_id}",
              {:new_notification,
               %{
                 id: notification.id,
                 type: "dm",
                 read: false,
                 actor: %{id: actor_id, username: actor.username},
                 inserted_at: notification.inserted_at
               }}
            )

            Nexus.Workers.DeliverNotification.maybe_send_push_for_dm(user_id, actor, thread_id)
            :ok

          {:error, changeset} ->
            # Returned rather than swallowed so Oban records and retries it.
            {:error, changeset}
        end
    end
  end
end
