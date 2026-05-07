defmodule Nexus.Repo.Migrations.CreatePostSaves do
  use Ecto.Migration

  def change do
    create table(:post_saves) do
      add :user_id,  references(:users, on_delete: :delete_all), null: false
      add :post_id,  references(:posts, on_delete: :delete_all)
      add :reply_id, references(:replies, on_delete: :delete_all)
      add :inserted_at, :utc_datetime, null: false
    end

    create unique_index(:post_saves, [:user_id, :post_id],  where: "post_id IS NOT NULL")
    create unique_index(:post_saves, [:user_id, :reply_id], where: "reply_id IS NOT NULL")
    create index(:post_saves, [:user_id])
  end
end
