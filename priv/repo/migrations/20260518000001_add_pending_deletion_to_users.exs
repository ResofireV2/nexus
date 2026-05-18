defmodule Nexus.Repo.Migrations.AddPendingDeletionToUsers do
  use Ecto.Migration

  def change do
    alter table(:users) do
      add :deletion_scheduled_at, :utc_datetime, null: true
    end
  end
end
