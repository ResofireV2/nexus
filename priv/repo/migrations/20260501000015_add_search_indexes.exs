defmodule Nexus.Repo.Migrations.AddSearchIndexes do
  use Ecto.Migration

  def up do
    # Trigram extension for fuzzy/typo-tolerant search
    execute "CREATE EXTENSION IF NOT EXISTS pg_trgm"

    # Trigram indexes on title and body for ILIKE fallback
    execute """
      CREATE INDEX IF NOT EXISTS posts_title_trgm_idx
      ON posts USING gin (title gin_trgm_ops)
    """

    execute """
      CREATE INDEX IF NOT EXISTS posts_body_trgm_idx
      ON posts USING gin (body gin_trgm_ops)
    """

    execute """
      CREATE INDEX IF NOT EXISTS replies_body_trgm_idx
      ON replies USING gin (body gin_trgm_ops)
    """
  end

  def down do
    execute "DROP INDEX IF EXISTS posts_title_trgm_idx"
    execute "DROP INDEX IF EXISTS posts_body_trgm_idx"
    execute "DROP INDEX IF EXISTS replies_body_trgm_idx"
    execute "DROP EXTENSION IF EXISTS pg_trgm"
  end
end
