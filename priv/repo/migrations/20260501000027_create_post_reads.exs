defmodule Nexus.Repo.Migrations.CreatePostReads do
  use Ecto.Migration

  def change do
    create table(:post_reads) do
      add :user_id,        references(:users, on_delete: :delete_all), null: false
      add :post_id,        references(:posts, on_delete: :delete_all), null: false
      add :last_reply_id,  references(:replies, on_delete: :nilify_all)
      add :reply_count,    :integer, default: 0
      timestamps(updated_at: :updated_at)
    end

    create unique_index(:post_reads, [:user_id, :post_id])
    create index(:post_reads, [:post_id])
  end
end
