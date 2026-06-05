defmodule Nexus.Repo.Migrations.BackfillSubSpaceColors do
  use Ecto.Migration

  def up do
    # For every sub-space that has no colour set, copy the parent's colour.
    # This is a one-time backfill for sub-spaces created before the
    # space_controller was updated to inherit parent colour on creation.
    execute """
    UPDATE spaces AS child
    SET    color = parent.color
    FROM   spaces AS parent
    WHERE  child.parent_id = parent.id
      AND  (child.color IS NULL OR child.color = '')
      AND  parent.color IS NOT NULL
      AND  parent.color != ''
    """
  end

  def down do
    # Not reversible — we don't know which sub-spaces had no colour originally.
    :ok
  end
end
