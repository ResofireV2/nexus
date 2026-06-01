defmodule Nexus.Application do
  use Application

  @impl true
  def start(_type, _args) do
    # Ensure upload directories exist on the bind-mounted path
    uploads_dir =
      if Application.get_env(:nexus, :env) == :prod do
        "/app/uploads"
      else
        Path.join([:code.priv_dir(:nexus), "static", "uploads"])
      end

    for dir <- ~w(posts avatars covers logos webp/posts webp/avatars webp/covers webp/logos linkpreviews linkpreviews/favicons webp/linkpreviews) do
      File.mkdir_p!(Path.join(uploads_dir, dir))
    end

    # Run outstanding migrations automatically on every release startup.
    # Safe to run multiple times — Ecto.Migrator is idempotent.
    if Application.get_env(:nexus, :env) == :prod do
      {:ok, _} = Application.ensure_all_started(:postgrex)
      {:ok, _} = Application.ensure_all_started(:ecto_sql)
      Ecto.Migrator.with_repo(Nexus.Repo, &Ecto.Migrator.run(&1, :up, all: true))
    end

    children = [
      NexusWeb.Telemetry,
      Nexus.Repo,
      {DNSCluster, query: Application.get_env(:nexus, :dns_cluster_query, :ignore)},
      {Phoenix.PubSub, name: Nexus.PubSub},
      Nexus.Presence,
      {Finch, name: Nexus.Finch},
      {Oban, Application.fetch_env!(:nexus, Oban)},
      # Rate limiter — ETS table for auth endpoint throttling
      Nexus.RateLimiter,
      # Settings and stats caches — ETS-backed, invalidated on write
      Nexus.SettingsCache,
      Nexus.StatsCache,
      # Extension infrastructure — must start before the endpoint so that
      # extension routes are available when the first request arrives.
      Nexus.Extensions.Registry,
      Nexus.Extensions.ExtensionSupervisor,
      NexusWeb.Endpoint
    ]

    opts = [strategy: :one_for_one, name: Nexus.Supervisor]
    result = Supervisor.start_link(children, opts)

    # Run seeds once on startup (only in prod, only if DB is empty)
    if Application.get_env(:nexus, :env) == :prod do
      Task.start(fn ->
        :timer.sleep(2000)
        try do
          seed_file = Application.app_dir(:nexus, "priv/repo/seeds.exs")
          if File.exists?(seed_file), do: Code.eval_file(seed_file)
        rescue
          _ -> :ok
        end
      end)

      # Load all enabled extensions from the DB after startup
      Task.start(fn ->
        :timer.sleep(3000)
        try do
          Nexus.Extensions.load_all_enabled()
        rescue
          e -> require Logger; Logger.error("Failed to load extensions on startup: #{inspect(e)}")
        end
      end)
    end

    result
  end

  @impl true
  def config_change(changed, _new, removed) do
    NexusWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
