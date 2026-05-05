defmodule Nexus.Repo.Migrations.CreateSubscriptions do
  use Ecto.Migration

  def change do
    create table(:space_subscriptions, primary_key: false) do
      add :user_id,    references(:users, on_delete: :delete_all), null: false
      add :space_id,   references(:spaces, on_delete: :delete_all), null: false
      add :inserted_at, :utc_datetime, null: false
    end

    create unique_index(:space_subscriptions, [:user_id, :space_id])
    create index(:space_subscriptions, [:space_id])

    create table(:tag_subscriptions, primary_key: false) do
      add :user_id,    references(:users, on_delete: :delete_all), null: false
      add :tag_id,     references(:tags, on_delete: :delete_all), null: false
      add :inserted_at, :utc_datetime, null: false
    end

    create unique_index(:tag_subscriptions, [:user_id, :tag_id])
    create index(:tag_subscriptions, [:tag_id])
  end
end
