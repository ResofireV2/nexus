defmodule Nexus.Application do
  use Application

  @impl true
  def start(_type, _args) do
    # Ensure upload directories exist
    static = Application.app_dir(:nexus, "priv/static")
    for dir <- ~w(uploads/posts uploads/avatars uploads/covers uploads/logos uploads/webp/posts uploads/webp/avatars uploads/webp/covers uploads/webp/logos) do
      File.mkdir_p!(Path.join(static, dir))
    end

    children = [
      NexusWeb.Telemetry,
      Nexus.Repo,
      {DNSCluster, query: Application.get_env(:nexus, :dns_cluster_query, :ignore)},
      {Phoenix.PubSub, name: Nexus.PubSub},
      Nexus.Presence,
      {Finch, name: Nexus.Finch},
      {Oban, Application.fetch_env!(:nexus, Oban)},
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
    end

    result
  end

  @impl true
  def config_change(changed, _new, removed) do
    NexusWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
