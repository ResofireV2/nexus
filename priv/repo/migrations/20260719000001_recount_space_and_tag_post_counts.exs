defmodule Nexus.Repo.Migrations.RecountSpaceAndTagPostCounts do
  use Ecto.Migration

  # Repairs drift in the denormalised post_count columns.
  #
  # Until now `update_post/3` never adjusted the counters when a post moved
  # between spaces, so the source space stayed over-counted and the destination
  # under-counted forever. Tag counts were only ever incremented — never on
  # edit, never on delete — and `hide_post/2` left both untouched even though a
  # hidden post disappears from every feed.
  #
  # The maintenance paths are fixed in Nexus.Forum; this repairs the values that
  # already drifted. Counts visible posts only, so the number matches what the
  # feed shows.
  #
  # SQL is inlined rather than calling Nexus.Forum.recount_*_post_counts/0 so
  # this migration keeps working unchanged if those functions later evolve.

  def up do
    execute("""
    UPDATE spaces s
    SET post_count = COALESCE(
      (SELECT COUNT(*) FROM posts p WHERE p.space_id = s.id AND p.hidden = false), 0)
    """)

    execute("""
    UPDATE tags t
    SET post_count = COALESCE((
      SELECT COUNT(*)
      FROM post_tags pt
      JOIN posts p ON p.id = pt.post_id
      WHERE pt.tag_id = t.id AND p.hidden = false
    ), 0)
    """)
  end

  # Recomputing from source data has no meaningful inverse — the previous
  # values were wrong by definition.
  def down, do: :ok
end
