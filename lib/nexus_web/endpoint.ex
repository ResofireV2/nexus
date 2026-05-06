defmodule NexusWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :nexus

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
  plug Plug.Session, @session_options
  plug NexusWeb.Router
end
