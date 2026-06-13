defmodule Nexus.Repo.Migrations.AddMarkedAllAsReadAtToUsers do
  use Ecto.Migration

  def change do
    alter table(:users) do
      add :marked_all_as_read_at, :utc_datetime, null: true
    end
  end
end
