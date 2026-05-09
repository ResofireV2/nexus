defmodule Nexus.Repo.Migrations.CreatePostEdits do
  use Ecto.Migration

  def change do
    create table(:post_edits) do
      add :post_id,   references(:posts,   on_delete: :delete_all)
      add :reply_id,  references(:replies, on_delete: :delete_all)
      add :user_id,   references(:users,   on_delete: :delete_all), null: false
      add :old_title, :string
      add :old_body,  :text, null: false
      add :edited_at, :utc_datetime, null: false
    end

    create index(:post_edits,  [:post_id])
    create index(:post_edits,  [:reply_id])
  end
end
