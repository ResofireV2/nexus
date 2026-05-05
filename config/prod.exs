import Config

config :nexus, env: :prod

config :nexus, NexusWeb.Endpoint,
  cache_static_manifest: "priv/static/cache_manifest.json",
  server: true

config :logger, level: :info

config :nexus, Nexus.Mailer, adapter: Swoosh.Adapters.Local
