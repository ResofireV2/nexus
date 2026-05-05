defmodule Nexus.Release do
  @app :nexus

  def migrate do
    load_app()
    for repo <- repos() do
      {:ok, _, _} = Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :up, all: true))
    end
  end

  def seed do
    load_app()

    # Ensure repo is started
    {:ok, _} = Application.ensure_all_started(:nexus)

    seed_file = Application.app_dir(@app, "priv/repo/seeds.exs")
    if File.exists?(seed_file) do
      Code.eval_file(seed_file)
    end
  end

  def rollback(repo, version) do
    load_app()
    {:ok, _, _} = Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :down, to: version))
  end

  defp repos do
    Application.fetch_env!(@app, :ecto_repos)
  end

  defp load_app do
    Application.load(@app)
  end
end
