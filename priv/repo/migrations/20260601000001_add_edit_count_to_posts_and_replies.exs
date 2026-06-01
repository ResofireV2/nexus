defmodule Nexus.Repo.Migrations.AddEditCountToPostsAndReplies do
  use Ecto.Migration

  def change do
    alter table(:posts) do
      add :edit_count, :integer, null: false, default: 0
    end

    alter table(:replies) do
      add :edit_count, :integer, null: false, default: 0
    end

    # Backfill existing rows from post_edits.
    # post_edits uses on_delete: :delete_all so counts are always accurate.
    execute """
      UPDATE posts
      SET edit_count = (
        SELECT COUNT(*) FROM post_edits WHERE post_edits.post_id = posts.id
      )
      WHERE EXISTS (
        SELECT 1 FROM post_edits WHERE post_edits.post_id = posts.id
      )
    """,
    # Down: no-op — columns are dropped by the alter table below
    ""

    execute """
      UPDATE replies
      SET edit_count = (
        SELECT COUNT(*) FROM post_edits WHERE post_edits.reply_id = replies.id
      )
      WHERE EXISTS (
        SELECT 1 FROM post_edits WHERE post_edits.reply_id = replies.id
      )
    """,
    ""
  end
end
