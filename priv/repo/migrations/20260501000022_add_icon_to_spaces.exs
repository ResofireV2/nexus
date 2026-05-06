defmodule Nexus.Repo.Migrations.AddIconToSpaces do
  use Ecto.Migration

  def change do
    alter table(:spaces) do
      add :icon, :string, default: "fa-layer-group"
    end
  end
end
