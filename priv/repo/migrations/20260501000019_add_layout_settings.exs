defmodule Nexus.Repo.Migrations.AddLayoutSettings do
  use Ecto.Migration

  def change do
    execute """
      INSERT INTO site_settings (key, value, inserted_at, updated_at)
      VALUES ('layout', '{
        "sidebar_order": ["feed", "search", "messages", "notifications"],
        "feed_blocks": ["pinned", "posts"],
        "post_blocks": ["content", "reactions", "replies"],
        "sidebar_widgets": []
      }', NOW(), NOW())
      ON CONFLICT (key) DO NOTHING
    """,
    "DELETE FROM site_settings WHERE key = 'layout'"
  end
end
