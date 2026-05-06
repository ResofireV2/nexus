defmodule Nexus.Repo.Migrations.AddActivityTracking do
  use Ecto.Migration

  def change do
    # Add activity fields to users
    alter table(:users) do
      add :last_seen_at,     :utc_datetime
      add :current_streak,   :integer, default: 0
      add :longest_streak,   :integer, default: 0
    end

    # One row per login session per day per user
    create table(:login_events) do
      add :user_id,    references(:users, on_delete: :delete_all), null: false
      add :ip_address, :string
      add :user_agent, :string
      timestamps(type: :utc_datetime, updated_at: false)
    end

    create index(:login_events, [:user_id])
    create index(:login_events, [:inserted_at])
    # Unique per user per day — prevents duplicate login events
    create unique_index(:login_events, [:user_id, :inserted_at],
      name: :login_events_user_day_index,
      where: "inserted_at::date = inserted_at::date"
    )

    # Daily activity rollup per user
    create table(:user_daily_stats) do
      add :user_id,            references(:users, on_delete: :delete_all), null: false
      add :date,               :date, null: false
      add :posts_count,        :integer, default: 0
      add :replies_count,      :integer, default: 0
      add :reactions_given,    :integer, default: 0
      add :reactions_received, :integer, default: 0
      timestamps(type: :utc_datetime)
    end

    create unique_index(:user_daily_stats, [:user_id, :date])
    create index(:user_daily_stats, [:date])
    create index(:user_daily_stats, [:user_id])
  end
end
