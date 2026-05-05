defmodule Nexus.Repo.Migrations.CreateExtensions do
  use Ecto.Migration

  def change do
    create table(:extensions) do
      add :name,        :string, null: false
      add :slug,        :string, null: false
      add :version,     :string, null: false
      add :description, :text
      add :author,      :string
      add :homepage,    :string
      add :enabled,     :boolean, null: false, default: true
      add :settings,    :map, null: false, default: %{}
      add :manifest,    :map, null: false, default: %{}

      timestamps(type: :utc_datetime)
    end

    create unique_index(:extensions, [:slug])

    create table(:extension_hooks) do
      add :extension_id, references(:extensions, on_delete: :delete_all), null: false
      add :event,        :string, null: false
      add :handler,      :string, null: false
      add :priority,     :integer, null: false, default: 50
      add :enabled,      :boolean, null: false, default: true

      timestamps(type: :utc_datetime)
    end

    create index(:extension_hooks, [:event])
    create index(:extension_hooks, [:extension_id])

    create table(:extension_slots) do
      add :extension_id, references(:extensions, on_delete: :delete_all), null: false
      add :slot,         :string, null: false
      add :component,    :string, null: false
      add :priority,     :integer, null: false, default: 50
      add :enabled,      :boolean, null: false, default: true

      timestamps(type: :utc_datetime)
    end

    create index(:extension_slots, [:slot])
    create index(:extension_slots, [:extension_id])
  end
end
