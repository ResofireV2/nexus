defmodule NexusWeb.Plugs.RequireEmailVerified do
  @moduledoc """
  Halts with 403 if email verification is required (per admin settings) and the
  current user has not yet verified their email address.

  Must be placed after RequireAuth in the pipeline so current_user is guaranteed
  to be present. Admins and moderators are never blocked — only members.
  """

  import Plug.Conn
  import Phoenix.Controller

  def init(opts), do: opts

  def call(%{assigns: %{current_user: user}} = conn, _opts) do
    if Nexus.Permissions.require_email_verification?() &&
         !user.email_verified &&
         user.role == "member" do
      conn
      |> put_status(:forbidden)
      |> json(%{error: "Please verify your email address before continuing"})
      |> halt()
    else
      conn
    end
  end

  def call(conn, _opts), do: conn
end
