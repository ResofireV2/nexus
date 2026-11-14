defmodule Nexus.Repo.Migrations.SyncSpacePositionsFromLayout do
  use Ecto.Migration

  # The sidebar's space order (site_settings "layout" -> spaces_order) and the
  # spaces.position column could drift apart, so the composer and the admin
  # list showed a different order from the sidebar. Saving the layout now keeps
  # them in step; this brings existing installs into line once, using the
  # sidebar order as the one the admin chose.
  def up do
    execute """
    UPDATE spaces AS s
    SET position = o.ord
    FROM (
      SELECT t.elem::bigint AS id, t.ord
      FROM site_settings,
           jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(value -> 'spaces_order') = 'array'
                  THEN value -> 'spaces_order' ELSE '[]'::jsonb END
           ) WITH ORDINALITY AS t(elem, ord)
      WHERE key = 'layout'
        AND t.elem ~ '^[0-9]+$'
    ) AS o
    WHERE s.id = o.id
    """
  end

  def down, do: :ok
end
