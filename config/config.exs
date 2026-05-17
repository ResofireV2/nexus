import Config

config :nexus,
  ecto_repos: [Nexus.Repo],
  generators: [timestamp_type: :utc_datetime]

config :nexus, NexusWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [html: NexusWeb.ErrorHTML, json: NexusWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: Nexus.PubSub,
  live_view: [signing_salt: "nexus_lv_salt"]

config :elixir, :time_zone_database, Tzdata.TimeZoneDatabase



config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

config :phoenix, :json_library, Jason

# Oban background jobs
config :nexus, Oban,
  repo: Nexus.Repo,
  plugins: [
    Oban.Plugins.Pruner,
    {Oban.Plugins.Cron, crontab: [
      {"0 * * * *",  Nexus.Workers.SendDigest, args: %{"frequency" => "daily"},   max_attempts: 1},
      {"0 * * * *",  Nexus.Workers.SendDigest, args: %{"frequency" => "weekly"},  max_attempts: 1},
      {"0 * * * *",  Nexus.Workers.SendDigest, args: %{"frequency" => "monthly"}, max_attempts: 1}
    ]}
  ],
  queues: [
    default:    10,
    mailers:    20,
    media:       5,
    webhooks:   10,
    extensions: 10  # Reserved for extension background jobs — do not use in Nexus core
  ]

import_config "#{config_env()}.exs"
