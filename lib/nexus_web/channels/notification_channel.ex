defmodule NexusWeb.NotificationChannel do
  use NexusWeb, :channel

  alias Nexus.Notifications

  @impl true
  def join("notifications:" <> user_id_str, _payload, socket) do
    current_user_id = socket.assigns[:current_user_id]
    requested_id    = String.to_integer(user_id_str)

    if current_user_id == requested_id do
      Phoenix.PubSub.subscribe(Nexus.PubSub, "notifications:#{current_user_id}")
      send(self(), :after_join)
      {:ok, socket}
    else
      {:error, %{reason: "Unauthorized"}}
    end
  end

  @impl true
  def handle_info(:after_join, socket) do
    count = Notifications.unread_count(socket.assigns.current_user_id)
    push(socket, "unread_count", %{count: count})
    {:noreply, socket}
  end

  def handle_info({:new_notification, payload}, socket) do
    push(socket, "new_notification", payload)
    {:noreply, socket}
  end

  def handle_info({:unread_count, count}, socket) do
    push(socket, "unread_count", %{count: count})
    {:noreply, socket}
  end

  # Real-time DM message delivery via the stable per-user notification channel
  def handle_info({:new_dm_message, payload}, socket) do
    push(socket, "new_message", payload)
    {:noreply, socket}
  end

  # Real-time post reply delivery via the stable per-user notification channel
  def handle_info({:new_reply, payload}, socket) do
    push(socket, "new_reply", payload)
    {:noreply, socket}
  end

  # Client sends "mark_read" with %{"id" => 123}
  @impl true
  def handle_in("mark_read", %{"id" => id}, socket) do
    user_id = socket.assigns.current_user_id
    Notifications.mark_read(id, user_id)
    count = Notifications.unread_count(user_id)
    push(socket, "unread_count", %{count: count})
    {:reply, :ok, socket}
  end

  def handle_in("mark_all_read", _payload, socket) do
    user_id = socket.assigns.current_user_id
    Notifications.mark_all_read(user_id)
    push(socket, "unread_count", %{count: 0})
    {:reply, :ok, socket}
  end
end
