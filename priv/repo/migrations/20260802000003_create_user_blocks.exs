defmodule Nexus.Repo.Migrations.CreateUserBlocks do
  use Ecto.Migration

  # DM-level blocking. Deliberately not forum-wide: hiding a blocked user's
  # posts, replies and mentions from feeds is a much larger piece of work and a
  # separate decision. This covers the actual gap, which is that a member had no
  # way to stop another member messaging them short of an admin ban.
  #
  # The row records intent in one direction (blocker blocks blocked) while
  # enforcement is mutual — see Messaging.blocked_between?/2. Storing it
  # one-directionally keeps "who blocked whom" answerable, which matters for the
  # unblock list.
  def change do
    create table(:user_blocks) do
      add :blocker_id, references(:users, on_delete: :delete_all), null: false
      add :blocked_id, references(:users, on_delete: :delete_all), null: false

      timestamps(type: :utc_datetime, updated_at: false)
    end

    # One row per pair per direction; re-blocking is a no-op rather than an error.
    create unique_index(:user_blocks, [:blocker_id, :blocked_id])
    # Enforcement looks up both directions on every send.
    create index(:user_blocks, [:blocked_id])
  end
end
