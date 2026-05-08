defmodule Nexus.Repo.Migrations.AddWebhookToExtensions do
  use Ecto.Migration

  def change do
    alter table(:extensions) do
      add :webhook_url,    :string
      add :js_bundle_url,  :string
      add :manifest_url,   :string
      add :install_count,  :integer, default: 0
    end
  end
end
