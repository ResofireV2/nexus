defmodule Nexus.Workers.DeliverNotification do
  @moduledoc """
  Oban worker that creates a notification record and broadcasts it
  to the recipient's notification channel.
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
        :ok

      {:error, changeset} ->
        {:error, changeset}
    end
  end

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
end
