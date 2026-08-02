defmodule Nexus.Repo.Migrations.AddDeletedAtToMessages do
  use Ecto.Migration

  # Soft delete rather than removing the row.
  #
  # A message that simply vanishes leaves the surrounding conversation
  # incoherent for the other person — replies suddenly answer nothing. Keeping
  # the row and rendering a "message deleted" placeholder is honest about the
  # fact that something was there and removed, which is also what makes an
  # open-ended delete window defensible: nothing is being rewritten, only the
  # content is withdrawn.
  #
  # The body is cleared on delete, so the row retains no content — only the
  # fact of it, its author, and its position in the conversation.
  def change do
    alter table(:messages) do
      add :deleted_at, :utc_datetime
    end
  end
end
