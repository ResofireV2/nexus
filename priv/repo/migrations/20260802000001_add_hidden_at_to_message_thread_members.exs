defmodule Nexus.Repo.Migrations.AddHiddenAtToMessageThreadMembers do
  use Ecto.Migration

  # Deleting a direct thread previously ran Repo.delete on the thread itself,
  # destroying the row and every message in it for *both* participants. Either
  # party could unilaterally erase the other's copy of the conversation.
  #
  # hidden_at makes the delete per-member instead: the thread and its messages
  # survive for anyone who has not hidden it. A thread reappears on its own when
  # a message arrives after the hide timestamp — no write needed to unhide,
  # since list_threads compares against last_message_at.
  def change do
    alter table(:message_thread_members) do
      add :hidden_at, :utc_datetime
    end

    # list_threads filters on this for every member row it touches.
    create index(:message_thread_members, [:user_id, :hidden_at])
  end
end
