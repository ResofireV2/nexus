defmodule NexusWeb.PresenceChannel do
  use NexusWeb, :channel

  alias Nexus.{Accounts, Presence}

  @impl true
  def join("presence:global", _payload, socket) do
    send(self(), :after_join)
    {:ok, socket}
  end

  def join(_topic, _payload, _socket) do
    {:error, %{reason: "Unknown presence topic"}}
  end

  @impl true
  def handle_info(:after_join, socket) do
    user_id = socket.assigns[:current_user_id]

    if user_id do
      user = Accounts.get_user(user_id)

      {:ok, _} = Presence.track(socket, "user:#{user_id}", %{
        user_id: user_id,
        username: user && user.username,
        online_at: System.system_time(:millisecond)
      })
    end

    push(socket, "presence_state", Presence.list(socket))
    {:noreply, socket}
  end
end
