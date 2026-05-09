defmodule Nexus.Repo.Migrations.AddAcceptedReplyToPosts do
  use Ecto.Migration

  def change do
    alter table(:posts) do
      add :accepted_reply_id, references(:replies, on_delete: :nilify_all)
    end
  end
end
