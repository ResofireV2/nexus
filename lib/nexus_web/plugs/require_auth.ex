defmodule NexusWeb.Plugs.RequireAuth do
  @moduledoc """
  Halts the request with 401 if no authenticated user is present.
  Must be used after LoadUser in the pipeline.
  """

  import Plug.Conn
  import Phoenix.Controller

  def init(opts), do: opts

  def call(%{assigns: %{current_user: %Nexus.Accounts.User{}}} = conn, _opts) do
    conn
  end

  def call(conn, _opts) do
    conn
    |> put_status(:unauthorized)
    |> json(%{error: "Authentication required"})
    |> halt()
  end
end
