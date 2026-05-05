defmodule Nexus.Repo.Migrations.CreateReports do
  use Ecto.Migration

  def change do
    create table(:reports) do
      add :reason,      :string, null: false
      # reason: "spam" | "harassment" | "misinformation" | "off_topic" | "other"
      add :notes,       :text
      add :status,      :string, null: false, default: "pending"
      # status: "pending" | "reviewed" | "dismissed" | "actioned"

      add :reporter_id, references(:users, on_delete: :nilify_all)
      add :reviewer_id, references(:users, on_delete: :nilify_all)
      add :reviewed_at, :utc_datetime

      # Polymorphic target
      add :post_id,     references(:posts, on_delete: :delete_all)
      add :reply_id,    references(:replies, on_delete: :delete_all)
      add :user_id,     references(:users, on_delete: :delete_all)

      timestamps(type: :utc_datetime)
    end

    create index(:reports, [:status])
    create index(:reports, [:reporter_id])
    create index(:reports, [:reviewer_id])
    create index(:reports, [:post_id])
    create index(:reports, [:reply_id])
    create index(:reports, [:user_id])

    create constraint(:reports, :must_have_target,
      check: "(post_id IS NOT NULL)::int + (reply_id IS NOT NULL)::int + (user_id IS NOT NULL)::int = 1"
    )
  end
end
