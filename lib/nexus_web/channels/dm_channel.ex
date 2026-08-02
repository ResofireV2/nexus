defmodule NexusWeb.DMChannel do
  @moduledoc """
  Typing indicators for a DM thread.

  Message delivery deliberately does not run through this channel. Messages are
  sent over HTTP (`MessageController.create/2`) and delivered to each member's
  always-on `notifications:{user_id}` topic, which is reliable whether or not
  the recipient currently has the thread open. See the comment in that
  controller.

  This channel previously also carried a `send_message` handler and a
  `{:new_message, _}` PubSub clause from that earlier design. Both were removed:
  the handler duplicated the controller's insert without its ban and anti-spam
  checks, and nothing ever published `{:new_message, _}` to a `dm:` topic.
  """
  use NexusWeb, :channel

  alias Nexus.Messaging

  @impl true
  def join("dm:" <> thread_id_str, _payload, socket) do
    user_id = socket.assigns[:current_user_id]

    # Integer.parse rather than String.to_integer: a join to "dm:abc" would
    # raise and take the channel process down before authorization ran.
    case {user_id, Integer.parse(thread_id_str)} do
      {nil, _} ->
        {:error, %{reason: "Authentication required"}}

      {_, {thread_id, ""}} ->
        case Messaging.get_thread_for_user(thread_id, user_id) do
          {:ok, thread} ->
            {:ok, %{thread_id: thread.id}, assign(socket, :thread_id, thread.id)}

          {:error, :not_found} ->
            {:error, %{reason: "Thread not found or access denied"}}
        end

      _ ->
        {:error, %{reason: "Invalid thread"}}
    end
  end

  # Phoenix subscribes the channel process to the topic on join, so there is no
  # after_join subscribe here. The previous version subscribed a second time to
  # the same topic, which would have delivered every broadcast to this process
  # twice.

  @impl true
  def handle_in("typing_start", _payload, socket) do
    broadcast_from!(socket, "typing_start", %{user_id: socket.assigns[:current_user_id]})
    {:noreply, socket}
  end

  def handle_in("typing_stop", _payload, socket) do
    broadcast_from!(socket, "typing_stop", %{user_id: socket.assigns[:current_user_id]})
    {:noreply, socket}
  end
end
