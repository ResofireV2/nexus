defmodule Nexus.Repo.Migrations.CreateMessaging do
  use Ecto.Migration

  def change do
    # Threads (1-on-1 or group)
    create table(:message_threads) do
      add :kind,        :string, null: false, default: "direct"
      # kind: "direct" | "group"
      add :name,        :string
      # name only used for group threads
      add :emoji,       :string
      # emoji avatar for group threads
      add :last_message_at, :utc_datetime

      timestamps(type: :utc_datetime)
    end

    create index(:message_threads, [:last_message_at])

    # Thread membership
    create table(:message_thread_members, primary_key: false) do
      add :thread_id,   references(:message_threads, on_delete: :delete_all), null: false
      add :user_id,     references(:users, on_delete: :delete_all), null: false
      add :muted,       :boolean, null: false, default: false
      add :last_read_at, :utc_datetime
      add :inserted_at, :utc_datetime, null: false
    end

    create unique_index(:message_thread_members, [:thread_id, :user_id])
    create index(:message_thread_members, [:user_id])

    # Messages
    create table(:messages) do
      add :body,        :text, null: false
      add :body_format, :string, null: false, default: "markdown"
      add :thread_id,   references(:message_threads, on_delete: :delete_all), null: false
      add :user_id,     references(:users, on_delete: :nilify_all)
      add :read_at,     :utc_datetime

      timestamps(type: :utc_datetime)
    end

    create index(:messages, [:thread_id])
    create index(:messages, [:user_id])
    create index(:messages, [:inserted_at])
  end
end
