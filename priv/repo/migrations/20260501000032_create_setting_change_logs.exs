defmodule Nexus.Repo.Migrations.CreateSettingChangeLogs do
  use Ecto.Migration

  def change do
    create table(:setting_change_logs) do
      add :section,   :string,  null: false
      add :old_value, :map,     null: false, default: %{}
      add :new_value, :map,     null: false, default: %{}
      add :admin_id,  references(:users, on_delete: :nilify_all)
      add :inserted_at, :utc_datetime, null: false
    end

    create index(:setting_change_logs, [:inserted_at])
    create index(:setting_change_logs, [:admin_id])
  end
end
