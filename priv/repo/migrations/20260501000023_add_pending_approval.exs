defmodule Nexus.Repo.Migrations.AddPendingApproval do
  use Ecto.Migration

  def change do
    alter table(:posts) do
      add :pending_approval, :boolean, default: false
    end

    alter table(:replies) do
      add :pending_approval, :boolean, default: false
    end

    create index(:posts, [:pending_approval])
    create index(:replies, [:pending_approval])
  end
end
