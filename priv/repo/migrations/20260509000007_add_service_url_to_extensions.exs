defmodule Nexus.Repo.Migrations.AddServiceUrlToExtensions do
  use Ecto.Migration

  def change do
    alter table(:extensions) do
      add :service_url,  :string
      add :proxy_secret, :string
    end
  end
end
