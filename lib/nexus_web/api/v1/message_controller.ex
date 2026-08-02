defmodule NexusWeb.API.V1.MessageController do
  use NexusWeb, :controller

  alias Nexus.Messaging

  # GET /api/v1/threads/:thread_id/messages
  def index(conn, %{"thread_id" => thread_id} = params) do
    user_id = conn.assigns.current_user.id

    case Messaging.get_thread_for_user(thread_id, user_id) do
      {:error, :not_found} ->
        conn |> put_status(:not_found) |> json(%{error: "Thread not found"})

      {:ok, thread} ->
        # Messages predating a hide are not returned — a thread that reappears
        # after the caller deleted it starts from the new activity, not the
        # history they cleared.
        member = Enum.find(thread.members, &(&1.user_id == user_id))

        %{messages: messages, next_cursor: next_cursor} =
          Messaging.list_messages(thread.id,
            cursor: params["cursor"],
            since: member && member.hidden_at
          )

        json(conn, %{
          messages: Enum.map(messages, &message_json/1),
          next_cursor: next_cursor
        })
    end
  end

  # POST /api/v1/threads/:thread_id/messages
  def create(conn, %{"thread_id" => thread_id} = params) do
    user = conn.assigns.current_user

    if user.status in ["banned", "suspended"] do
      conn |> put_status(:forbidden) |> json(%{error: "Your account is not permitted to send messages"})
    else
    unless Nexus.AntiSpam.can_send_dm?(user) do
      remaining = Nexus.AntiSpam.dm_lockout_remaining(user)
      conn
      |> put_status(:forbidden)
      |> json(%{
          error: "New accounts must wait before sending direct messages.",
          dm_lockout: true,
          hours_remaining: remaining
        })
    else
      case Messaging.get_thread_for_user(thread_id, user.id) do
        {:error, :not_found} ->
          conn |> put_status(:not_found) |> json(%{error: "Thread not found"})

        {:ok, thread} ->
          case Messaging.send_message(thread, user.id, params) do
            {:ok, message} ->
              payload = message_json(message)

              # Deliver to every thread member's always-on notification channel.
              # This is more reliable than the dm: channel which may not be subscribed.
              thread_with_members = Nexus.Repo.preload(thread, :members)

              Enum.each(thread_with_members.members, fn member ->
                Phoenix.PubSub.broadcast(
                  Nexus.PubSub,
                  "notifications:#{member.user_id}",
                  {:new_dm_message, payload}
                )

                # Push the recipient's real unread total alongside the message.
                #
                # The client used to derive this itself: on new_message it fired
                # a GET /threads/unread and set the badge from the response.
                # That left the Messages badge stale until a page refresh while
                # the Notifications badge — which receives a count directly —
                # updated immediately. Sending the number the same way removes
                # the round-trip and the discrepancy.
                Phoenix.PubSub.broadcast(
                  Nexus.PubSub,
                  "notifications:#{member.user_id}",
                  {:dm_unread_count, Messaging.unread_count(member.user_id)}
                )
              end)

              conn |> put_status(:created) |> json(%{message: payload})

            {:error, changeset} ->
              conn
              |> put_status(:unprocessable_entity)
              |> json(%{errors: format_errors(changeset)})
          end
      end
    end
    end # status check
  end

  defp message_json(message) do
    %{
      id: message.id,
      body: message.body,
      body_format: message.body_format,
      thread_id: message.thread_id,
      inserted_at: message.inserted_at,
      user: user_json(message.user)
    }
  end

  defp user_json(nil), do: nil
  defp user_json(u), do: %{id: u.id, username: u.username, avatar_url: u.avatar_url}

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", if(is_binary(v), do: v, else: inspect(v))) end)
    end)
  end
end
