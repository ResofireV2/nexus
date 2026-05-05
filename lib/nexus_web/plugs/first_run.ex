defmodule NexusWeb.Plugs.FirstRun do
  @moduledoc """
  Checks if setup is complete. If not, returns a JSON response
  directing the client to the setup wizard.
  Only applies to browser routes, not API routes.
  """

  import Plug.Conn
  import Phoenix.Controller

  def init(opts), do: opts

  def call(conn, _opts) do
    # Skip for setup routes and API routes
    skip? =
      String.starts_with?(conn.request_path, "/api/") ||
      String.starts_with?(conn.request_path, "/assets/") ||
      String.starts_with?(conn.request_path, "/dev/") ||
      conn.request_path == "/manifest.json" ||
      conn.request_path == "/sw.js"

    if skip? || Nexus.Setup.complete?() do
      conn
    else
      conn
      |> put_status(:ok)
      |> json(%{
        setup_required: true,
        message: "Nexus requires initial setup",
        setup_url: "/api/v1/setup/status"
      })
      |> halt()
    end
  end
end
