defmodule Nexus.Repo.Migrations.CreateUserBadges do
  use Ecto.Migration

  def change do
    create table(:user_badges) do
      add :user_id,       references(:users,  on_delete: :delete_all), null: false
      add :badge_id,      references(:badges, on_delete: :delete_all), null: false
      add :awarded_by_id, references(:users,  on_delete: :nilify_all)
      # awarded_by_id is set for manual awards; nil for auto-awarded badges
      add :awarded_at,    :utc_datetime, null: false
    end

    create unique_index(:user_badges, [:user_id, :badge_id])
    create index(:user_badges, [:user_id])
    create index(:user_badges, [:badge_id])
    create index(:user_badges, [:awarded_at])
  end
end
