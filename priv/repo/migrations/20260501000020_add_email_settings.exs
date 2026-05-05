defmodule Nexus.Repo.Migrations.AddEmailSettings do
  use Ecto.Migration

  def change do
    execute """
      INSERT INTO site_settings (key, value, inserted_at, updated_at)
      VALUES ('email', '{
        "smtp_host": "",
        "smtp_port": "587",
        "smtp_encryption": "tls",
        "smtp_username": "",
        "smtp_password": "",
        "from_address": "",
        "from_name": "Nexus",
        "digest_emails": true,
        "reply_notifications": true,
        "dm_notifications": true,
        "mention_notifications": true
      }', NOW(), NOW())
      ON CONFLICT (key) DO NOTHING
    """,
    "DELETE FROM site_settings WHERE key = 'email'"
  end
end
