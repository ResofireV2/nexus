defmodule Nexus.Repo.Migrations.AddScriptPathToThemes do
  use Ecto.Migration

  def change do
    alter table(:themes) do
      add_if_not_exists :script_path, :string
    end
  end
end
