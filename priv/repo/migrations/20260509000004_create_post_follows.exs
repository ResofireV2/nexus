defmodule Nexus.Repo.Migrations.CreatePostFollows do
  use Ecto.Migration

  def change do
    create table(:post_follows) do
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :post_id, references(:posts, on_delete: :delete_all), null: false
      timestamps(updated_at: false)
    end

    create unique_index(:post_follows, [:user_id, :post_id])
    create index(:post_follows, [:post_id])
    create index(:post_follows, [:user_id])
  end
end
