defmodule Nexus.Repo.Migrations.CreateNotifications do
  use Ecto.Migration

  def change do
    create table(:notifications) do
      add :user_id,     references(:users, on_delete: :delete_all), null: false
      add :type,        :string, null: false
      # type: "reply" | "mention" | "reaction" | "dm" | "announcement"
      add :read,        :boolean, null: false, default: false
      add :read_at,     :utc_datetime

      # Polymorphic source — what triggered the notification
      add :actor_id,    references(:users, on_delete: :nilify_all)
      add :post_id,     references(:posts, on_delete: :delete_all)
      add :reply_id,    references(:replies, on_delete: :delete_all)
      add :message_id,  references(:messages, on_delete: :delete_all)

      # Extra context stored as JSONB (e.g. emoji for reactions)
      add :data,        :map, default: %{}

      timestamps(type: :utc_datetime)
    end

    create index(:notifications, [:user_id])
    create index(:notifications, [:user_id, :read])
    create index(:notifications, [:inserted_at])
  end
end
