defmodule Nexus.Repo.Migrations.AddCreatorToThreads do
  use Ecto.Migration

  def change do
    alter table(:message_threads) do
      add :creator_id, references(:users, on_delete: :nilify_all)
    end
  end
end
