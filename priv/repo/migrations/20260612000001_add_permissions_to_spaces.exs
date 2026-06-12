defmodule Nexus.Repo.Migrations.AddPermissionsToSpaces do
  use Ecto.Migration

  def change do
    alter table(:spaces) do
      # Default is an empty map at the DB level. The Space schema field default
      # provides the full four-gate structure for new records created via Ecto.
      # Existing rows will have {} which gate_for/2 in SpacePermissions treats
      # as "use the module's @default_gates" — fully open, no behaviour change.
      add :permissions, :map, default: %{}
    end
  end
end
