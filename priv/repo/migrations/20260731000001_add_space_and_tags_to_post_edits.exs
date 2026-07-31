defmodule Nexus.Repo.Migrations.AddSpaceAndTagsToPostEdits do
  use Ecto.Migration

  # Edit history recorded only old_title and old_body, so a post whose Space or
  # tags changed produced a history entry with an identical before and after —
  # an accountability record reporting that something changed while unable to
  # say what.
  #
  # old_space_id is a plain integer rather than a reference: this is a historical
  # snapshot, and a deleted Space should leave the record intact rather than
  # cascading the edit row away or blocking the delete.
  #
  # old_tag_ids is an integer array for the same reason. The join table is the
  # live association; this is what the tags were at a point in time.
  #
  # Both are nullable. Rows written before this migration have no snapshot, and
  # reply edits never carry a Space.
  def change do
    alter table(:post_edits) do
      add :old_space_id, :integer
      add :old_tag_ids,  {:array, :integer}
    end
  end
end
