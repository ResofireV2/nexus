import Config

config :nexus, Nexus.Repo,
  username: "nexus",
  password: "nexus",
  hostname: "db",
  database: "nexus_dev",
  stacktrace: true,
  show_sensitive_data_on_connection_error: true,
  pool_size: 10

config :nexus, NexusWeb.Endpoint,
  http: [ip: {0, 0, 0, 0}, port: 4000],
  check_origin: false,
  code_reloader: true,
  debug_errors: true,
  secret_key_base: "dev_secret_key_base_replace_in_production_min_64_chars_long_xxxx",
  watchers: [
    node: ["build.js", "--watch", cd: Path.expand("../assets", __DIR__)]
  ],
  live_reload: [
    patterns: [
      ~r"priv/static/(?!uploads/).*(js|css|png|jpeg|jpg|gif|svg)$",
      ~r"priv/gettext/.*(po)$",
      ~r"lib/nexus_web/(controllers|live|components)/.*(ex|heex)$"
    ]
  ]

config :nexus, Nexus.Mailer, adapter: Swoosh.Adapters.Local

config :nexus, :jwt_secret, "dev_jwt_secret_replace_in_production_min_32_chars_xxxx"
config :nexus, :mailer_from, {"Nexus Dev", "dev@nexus.localhost"}
config :nexus, :env, :dev

config :logger, level: :debug
config :phoenix, :plug_init_mode, :runtime
config :phoenix_live_view, :debug_heex_annotations, true
