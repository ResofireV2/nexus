defmodule Nexus.Repo.Migrations.CreateUsers do
  use Ecto.Migration

  def change do
    # citext needed for case-insensitive email/username columns
    execute "CREATE EXTENSION IF NOT EXISTS citext", "DROP EXTENSION IF EXISTS citext"

    create table(:users) do
      add :email,               :citext, null: false
      add :username,            :citext, null: false
      add :password_hash,       :string
      add :role,                :string, null: false, default: "member"
      # role: "member" | "moderator" | "admin"

      # Email verification
      add :email_verified,      :boolean, null: false, default: false
      add :email_verify_token,  :string
      add :email_verify_sent_at, :utc_datetime

      # OAuth
      add :oauth_provider,      :string
      add :oauth_uid,           :string

      # Profile
      add :avatar_url,          :string
      add :cover_url,           :string
      add :bio,                 :text

      # Moderation status
      add :status,              :string, null: false, default: "active"
      # status: "active" | "muted" | "suspended" | "banned"
      add :status_until,        :utc_datetime
      add :status_reason,       :text

      # Preferences (stored as JSONB for flexibility)
      add :preferences,         :map, null: false, default: %{}
      # preferences keys: theme, notification_settings, dm_privacy, locale, digest_frequency

      # Push notifications
      add :push_subscription,   :map

      # Magic link
      add :magic_token,         :string
      add :magic_token_sent_at, :utc_datetime

      # Password reset
      add :reset_token,         :string
      add :reset_token_sent_at, :utc_datetime

      timestamps(type: :utc_datetime)
    end

    create unique_index(:users, [:email])
    create unique_index(:users, [:username])
    create unique_index(:users, [:magic_token])
    create unique_index(:users, [:reset_token])
    create unique_index(:users, [:email_verify_token])
    create index(:users, [:oauth_provider, :oauth_uid])
    create index(:users, [:status])
    create index(:users, [:role])
  end
end
