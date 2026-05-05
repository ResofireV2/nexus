defmodule NexusWeb.DMChannel do
  use NexusWeb, :channel

  alias Nexus.Messaging

  @impl true
  def join("dm:" <> thread_id, _payload, socket) do
    user_id = socket.assigns[:current_user_id]

    if is_nil(user_id) do
      {:error, %{reason: "Authentication required"}}
    else
      case Messaging.get_thread_for_user(thread_id, user_id) do
        {:ok, thread} ->
          send(self(), :after_join)
          {:ok, %{thread_id: thread.id}, assign(socket, :thread_id, thread.id)}

        {:error, :not_found} ->
          {:error, %{reason: "Thread not found or access denied"}}
      end
    end
  end

  @impl true
  def handle_info(:after_join, socket) do
    # Subscribe to PubSub for this thread
    Phoenix.PubSub.subscribe(Nexus.PubSub, "dm:#{socket.assigns.thread_id}")
    {:noreply, socket}
  end

  def handle_info({:new_message, payload}, socket) do
    push(socket, "new_message", payload)
    {:noreply, socket}
  end

  # Client sends "send_message" with %{"body" => "..."}
  @impl true
  def handle_in("send_message", %{"body" => body}, socket) do
    user_id   = socket.assigns[:current_user_id]
    thread_id = socket.assigns.thread_id
    thread    = Messaging.get_thread(thread_id)

    case Messaging.send_message(thread, user_id, %{"body" => body}) do
      {:ok, message} ->
        payload = message_json(message)
        broadcast!(socket, "new_message", payload)
        {:reply, {:ok, payload}, socket}

      {:error, changeset} ->
        {:reply, {:error, %{errors: format_errors(changeset)}}, socket}
    end
  end

  # Client sends "typing"
  def handle_in("typing", _payload, socket) do
    broadcast_from!(socket, "typing", %{user_id: socket.assigns[:current_user_id]})
    {:noreply, socket}
  end

  defp message_json(message) do
    %{
      id: message.id,
      body: message.body,
      body_format: message.body_format,
      thread_id: message.thread_id,
      inserted_at: message.inserted_at,
      user: %{
        id: message.user.id,
        username: message.user.username,
        avatar_url: message.user.avatar_url
      }
    }
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", to_string(v)) end)
    end)
  end
end
