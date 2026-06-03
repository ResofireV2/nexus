defmodule Nexus.Repo.Migrations.CreateGroupMemberships do
  use Ecto.Migration

  def change do
    create table(:group_memberships) do
      add :group_id, references(:groups, on_delete: :delete_all), null: false
      add :user_id,  references(:users,  on_delete: :delete_all), null: false

      # Track when the membership was created for display in the admin panel
      add :inserted_at, :utc_datetime, null: false
    end

    create unique_index(:group_memberships, [:group_id, :user_id])
    create index(:group_memberships, [:group_id])
    create index(:group_memberships, [:user_id])
  end
end
