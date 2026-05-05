defmodule Nexus.Repo.Migrations.CreateModerationLog do
  use Ecto.Migration

  def change do
    create table(:moderation_logs) do
      add :action,       :string, null: false
      # action: "ban" | "unban" | "mute" | "unmute" | "suspend" | "unsuspend"
      #       | "space_restrict" | "space_unrestrict"
      #       | "post_hide" | "post_delete" | "reply_hide" | "reply_delete"

      add :moderator_id, references(:users, on_delete: :nilify_all)
      add :target_user_id, references(:users, on_delete: :nilify_all)
      add :post_id,      references(:posts, on_delete: :nilify_all)
      add :reply_id,     references(:replies, on_delete: :nilify_all)
      add :space_id,     references(:spaces, on_delete: :nilify_all)

      add :reason,       :text
      add :duration,     :integer
      # duration in minutes, nil = permanent

      add :data,         :map, default: %{}

      timestamps(type: :utc_datetime)
    end

    create index(:moderation_logs, [:moderator_id])
    create index(:moderation_logs, [:target_user_id])
    create index(:moderation_logs, [:inserted_at])
    create index(:moderation_logs, [:action])
  end
end
