defmodule Nexus.Repo.Migrations.CreateTags do
  use Ecto.Migration

  def change do
    create table(:tags) do
      add :name,       :citext, null: false
      add :slug,       :citext, null: false
      add :color,      :string, null: false, default: "#5B4EF5"
      add :post_count, :integer, null: false, default: 0

      timestamps(type: :utc_datetime)
    end

    create unique_index(:tags, [:slug])
    create unique_index(:tags, [:name])
  end
end
