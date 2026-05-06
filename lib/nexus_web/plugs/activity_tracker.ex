defmodule NexusWeb.Plugs.ActivityTracker do
  @moduledoc """
  Plug that tracks user activity on every authenticated request.
  Must be placed after LoadUser/RequireAuth in the pipeline.
  Updates last_seen_at and fires async login event tracking.
  """

  import Plug.Conn

  def init(opts), do: opts

  def call(conn, _opts) do
    case conn.assigns[:current_user] do
      nil  -> conn
      user ->
        Nexus.Activity.track_request(user, [
          ip_address: to_string(:inet.ntoa(conn.remote_ip)),
          user_agent: get_req_header(conn, "user-agent") |> List.first()
        ])
        conn
    end
  end
end
