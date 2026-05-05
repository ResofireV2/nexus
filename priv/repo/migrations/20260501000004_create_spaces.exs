defmodule Nexus.Repo.Migrations.CreateSpaces do
  use Ecto.Migration

  def change do
    create table(:spaces) do
      add :name,        :string, null: false
      add :slug,        :citext, null: false
      add :description, :text
      add :color,       :string, null: false, default: "#5B4EF5"
      # color family hex — used for tag chips and space pills
      add :visibility,  :string, null: false, default: "public"
      # visibility: "public" | "private"
      add :position,    :integer, null: false, default: 0
      add :post_count,  :integer, null: false, default: 0

      add :created_by_id, references(:users, on_delete: :nilify_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:spaces, [:slug])
    create index(:spaces, [:visibility])
    create index(:spaces, [:position])
  end
end
