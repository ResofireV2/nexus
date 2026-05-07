defmodule Nexus.Repo.Migrations.CreateUserScores do
  use Ecto.Migration

  def change do
    create table(:user_scores) do
      add :user_id,      references(:users, on_delete: :delete_all), null: false
      add :score_all,    :integer, null: false, default: 0
      add :score_month,  :integer, null: false, default: 0
      add :score_week,   :integer, null: false, default: 0
      add :updated_at,   :utc_datetime, null: false
    end

    create unique_index(:user_scores, [:user_id])
    create index(:user_scores, [:score_all])
    create index(:user_scores, [:score_month])
    create index(:user_scores, [:score_week])
  end
end
