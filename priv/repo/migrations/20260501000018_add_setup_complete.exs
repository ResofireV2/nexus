defmodule Nexus.Repo.Migrations.AddSetupComplete do
  use Ecto.Migration

  def change do
    # We store setup state in site_settings with key "setup"
    # This migration just ensures the table exists (already created in stage 11)
    # and inserts the default setup state
    execute """
      INSERT INTO site_settings (key, value, inserted_at, updated_at)
      VALUES ('setup', '{"complete": false, "step": 0}', NOW(), NOW())
      ON CONFLICT (key) DO NOTHING
    """,
    "DELETE FROM site_settings WHERE key = 'setup'"
  end
end
