import Config

config :nexus, Nexus.Repo,
  username: "nexus",
  password: "nexus",
  hostname: "db",
  database: "nexus_test#{System.get_env("MIX_TEST_PARTITION")}",
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: System.schedulers_online() * 2

config :nexus, NexusWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "test_secret_key_base_replace_in_production_min_64_chars_long_xxxx",
  server: false

config :nexus, Nexus.Mailer, adapter: Swoosh.Adapters.Test

config :nexus, Oban, testing: :inline

config :logger, level: :warning

config :phoenix, :plug_init_mode, :runtime
