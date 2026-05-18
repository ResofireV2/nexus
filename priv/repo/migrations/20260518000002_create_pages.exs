defmodule Nexus.Repo.Migrations.CreatePages do
  use Ecto.Migration

  def change do
    create table(:pages) do
      add :slug,      :string, null: false
      add :title,     :string, null: false
      add :body,      :text,   null: false, default: ""
      add :published, :boolean, null: false, default: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:pages, [:slug])
    create index(:pages, [:published])
  end
end
