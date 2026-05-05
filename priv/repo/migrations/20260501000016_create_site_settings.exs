defmodule Nexus.Repo.Migrations.CreateSiteSettings do
  use Ecto.Migration

  def change do
    create table(:site_settings, primary_key: false) do
      add :key,   :string, primary_key: true, null: false
      add :value, :map, null: false, default: %{}

      timestamps(type: :utc_datetime)
    end
  end
end
