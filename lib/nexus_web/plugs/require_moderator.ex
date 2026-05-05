defmodule NexusWeb.Plugs.RequireModerator do
  import Plug.Conn
  import Phoenix.Controller

  def init(opts), do: opts

  def call(%{assigns: %{current_user: user}} = conn, _opts) when not is_nil(user) do
    if Nexus.Accounts.User.moderator?(user) do
      conn
    else
      conn
      |> put_status(:forbidden)
      |> json(%{error: "Insufficient permissions"})
      |> halt()
    end
  end

  def call(conn, _opts) do
    conn
    |> put_status(:unauthorized)
    |> json(%{error: "Authentication required"})
    |> halt()
  end
end
