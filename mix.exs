defmodule Nexus.MixProject do
  use Mix.Project

  def project do
    [
      app: :nexus,
      version: "0.1.0-beta",
      elixir: "~> 1.17",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      aliases: aliases(),
      deps: deps(),
      releases: [
        nexus: [
          include_executables_for: [:unix],
          applications: [runtime_tools: :permanent],
          steps: [:assemble],
          strip_beams: false
        ]
      ]
    ]
  end

  def application do
    [
      mod: {Nexus.Application, []},
      extra_applications: [:logger, :runtime_tools]
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  defp deps do
    [
      # Phoenix core
      {:phoenix, "~> 1.8"},
      {:phoenix_ecto, "~> 4.6"},
      {:ecto_sql, "~> 3.12"},
      {:postgrex, "~> 0.19"},
      {:phoenix_html, "~> 4.1"},
      {:phoenix_live_reload, "~> 1.2", only: :dev},
      {:phoenix_live_view, "~> 1.0"},
      {:floki, ">= 0.30.0"},

      # Real-time
      {:phoenix_pubsub, "~> 2.1"},

      # Background jobs
      {:oban, "~> 2.18"},

      # Auth
      {:bcrypt_elixir, "~> 3.0"},
      {:joken, "~> 2.6"},

      # HTTP client (for OAuth, webhooks, oEmbed)
      {:req, "~> 0.5"},

      # Image processing
      {:image, "~> 0.54"},

      # File uploads
      {:ex_aws, "~> 2.5"},
      {:ex_aws_s3, "~> 2.5"},
      {:hackney, "~> 1.9"},
      {:sweet_xml, "~> 0.7"},

      # Utilities
      {:remote_ip, "~> 1.2"},
      {:jason, "~> 1.4"},
      {:plug_cowboy, "~> 2.7"},
      {:gettext, "~> 0.26"},
      {:dns_cluster, "~> 0.1"},
      {:bandit, "~> 1.5"},
      {:swoosh, "~> 1.16"},
      {:gen_smtp, "~> 1.2"},
      {:tzdata, "~> 1.1"},

      # Dev/test
      {:faker, "~> 0.18", only: [:dev, :test]},
      {:ex_machina, "~> 2.8", only: :test},
      {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
      {:sobelow, "~> 0.13", only: [:dev, :test], runtime: false},
      {:dialyxir, "~> 1.4", only: [:dev, :test], runtime: false}
    ]
  end

  defp aliases do
    [
      setup: ["deps.get", "ecto.setup", "assets.setup", "assets.build"],
      "ecto.setup": ["ecto.create", "ecto.migrate", "run priv/repo/seeds.exs"],
      "ecto.reset": ["ecto.drop", "ecto.setup"],
      "assets.setup": ["cmd npm install --prefix assets"],
      "assets.build": ["cmd npm run build --prefix assets"],
      "assets.deploy": ["cmd npm run deploy --prefix assets", "phx.digest"],
      test: ["ecto.create --quiet", "ecto.migrate --quiet", "test"]
    ]
  end
end
