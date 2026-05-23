defmodule Nexus.Repo.Migrations.CreatePageWidgets do
  use Ecto.Migration

  def change do
    create table(:page_widgets) do
      add :name,     :string, null: false
      add :position, :integer, null: false, default: 0

      timestamps(type: :utc_datetime)
    end

    create unique_index(:page_widgets, [:name])

    alter table(:pages) do
      add :widget_id, references(:page_widgets, on_delete: :nilify_all)
    end

    create index(:pages, [:widget_id])
  end
end
