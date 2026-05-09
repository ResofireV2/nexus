defmodule Nexus.Repo.Migrations.CreatePushSubscriptions do
  use Ecto.Migration

  def change do
    create table(:push_subscriptions) do
      add :user_id,          references(:users, on_delete: :delete_all), null: false
      add :endpoint,         :text,   null: false
      add :p256dh,           :string, null: false
      add :auth,             :string, null: false
      add :vapid_public_key, :string
      add :last_used_at,     :utc_datetime
      timestamps(type: :utc_datetime)
    end

    # Endpoint uniqueness enforced at app level (text columns can't have
    # unique indexes in Postgres without length limits — use partial index)
    create index(:push_subscriptions, [:user_id])
    create index(:push_subscriptions, [:endpoint], unique: true)

    # Remove the now-redundant push_subscription column from users
    # (kept nullable so existing data isn't lost during the transition)
    alter table(:users) do
      modify :push_subscription, :map, null: true, default: nil
    end
  end
end
