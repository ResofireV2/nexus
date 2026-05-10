defmodule Nexus.Repo.Migrations.AddGithubFieldsToExtensions do
  use Ecto.Migration

  def change do
    alter table(:extensions) do
      add :github_repo,        :string   # e.g. "owner/nexus-my-extension"
      add :installed_version,  :string   # tag that was installed e.g. "v0.2.0"
      add :latest_version,     :string   # latest release tag fetched from GitHub
      add :release_notes,      :text     # markdown body of the latest release
    end
  end
end
