defmodule Nexus.Repo.Migrations.AddParentIdToSpaces do
  use Ecto.Migration

  def change do
    alter table(:spaces) do
      add :parent_id, references(:spaces, on_delete: :nilify_all), null: true
    end

    create index(:spaces, [:parent_id])
  end
end
