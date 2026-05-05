defmodule NexusWeb.UserSocket do
  use Phoenix.Socket

  channel "post:*",          NexusWeb.PostChannel
  channel "feed:*",          NexusWeb.FeedChannel
  channel "presence:*",      NexusWeb.PresenceChannel
  channel "dm:*",            NexusWeb.DMChannel
  channel "notifications:*", NexusWeb.NotificationChannel

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) do
    case Nexus.Auth.JWT.verify_access_token(token) do
      {:ok, claims} ->
        user_id = Nexus.Auth.JWT.user_id_from_claims(claims)
        {:ok, assign(socket, :current_user_id, user_id)}

      {:error, _} ->
        :error
    end
  end

  def connect(_params, socket, _connect_info) do
    {:ok, assign(socket, :current_user_id, nil)}
  end

  @impl true
  def id(socket) do
    case socket.assigns[:current_user_id] do
      nil -> nil
      id  -> "user_socket:#{id}"
    end
  end
end
