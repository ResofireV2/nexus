defmodule Nexus.Repo.Migrations.CreateCompositionVerdicts do
  use Ecto.Migration

  def change do
    create table(:composition_verdicts) do
      add :post_id,   references(:posts,   on_delete: :delete_all), null: false
      add :reply_id,  references(:replies, on_delete: :delete_all)
      add :user_id,   references(:users,   on_delete: :delete_all), null: false
      add :verdict,   :string, null: false
      add :details,   :map, default: %{}
      add :report_only, :boolean, default: false, null: false

      timestamps(type: :utc_datetime, updated_at: false)
    end

    create index(:composition_verdicts, [:post_id])
    create index(:composition_verdicts, [:reply_id])
    create index(:composition_verdicts, [:user_id])
    create index(:composition_verdicts, [:inserted_at])
  end
end
