defmodule NexusWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :nexus

  # The signing_salt default here is only used as a fallback. The real value
  # is injected at runtime via config :nexus, NexusWeb.Endpoint in runtime.exs,
  # so SESSION_SIGNING_SALT from .env is always picked up without a recompile.
  @session_options [
    store: :cookie,
    key: "_nexus_key",
    signing_salt: "nexus_salt",
    same_site: "Lax"
  ]

  socket "/live", Phoenix.LiveView.Socket,
    websocket: [connect_info: [session: @session_options]],
    longpoll: [connect_info: [session: @session_options]]

  socket "/socket", NexusWeb.UserSocket,
    websocket: true,
    longpoll: false

  plug Plug.Static,
    at: "/",
    from: :nexus,
    gzip: false,
    only: NexusWeb.static_paths()

  # Serve user-uploaded files from the bind-mounted uploads directory
  plug Plug.Static,
    at: "/uploads",
    from: "/app/uploads",
    gzip: false

  if code_reloading? do
    socket "/phoenix/live_reload/socket", Phoenix.LiveReloader.Socket
    plug Phoenix.LiveReloader
    plug Phoenix.CodeReloader
    plug Phoenix.Ecto.CheckRepoStatus, otp_app: :nexus
  end

  plug Plug.RequestId
  plug Plug.Telemetry, event_prefix: [:phoenix, :endpoint]

  plug Plug.Parsers,
    parsers: [:urlencoded, :multipart, :json],
    pass: ["*/*"],
    json_decoder: Phoenix.json_library(),
    # Allow up to 50 MB — the per-upload limit is enforced in the Uploads context
    length: 52_428_800

  plug Plug.MethodOverride
  plug Plug.Head
  plug :put_secure_session
  # Rewrites conn.remote_ip from X-Forwarded-For set by Caddy, so that the
  # rate limiter and activity tracker see the real client IP rather than
  # Caddy's loopback address. RemoteIp ignores the header from any IP that
  # isn't a known proxy, preventing clients from spoofing their address.
  plug RemoteIp, headers: ["x-forwarded-for"]
  plug NexusWeb.Router

  # SESSION_SIGNING_SALT is injected by runtime.exs from the .env file, which
  # runs after the release binary is built but before the app starts. Module
  # attributes are baked at build time and cannot see it, so we read
  # Application.get_env inside a function instead. Plug.Session.init/1 for the
  # cookie store is pure key derivation (no I/O), so the per-request cost is
  # negligible in practice.
  defp put_secure_session(conn, _opts) do
    opts = Plug.Session.init(
      store: :cookie,
      key: "_nexus_key",
      signing_salt: Application.get_env(:nexus, :session_signing_salt, "nexus_salt"),
      same_site: "Lax"
    )
    Plug.Session.call(conn, opts)
  end
end
