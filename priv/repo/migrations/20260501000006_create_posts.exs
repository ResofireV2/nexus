defmodule Nexus.Repo.Migrations.CreatePosts do
  use Ecto.Migration

  def change do
    create table(:posts) do
      add :title,         :string, null: false
      add :body,          :text, null: false
      add :body_format,   :string, null: false, default: "markdown"
      # body_format: "markdown" | "rich"
      add :type,          :string, null: false, default: "discussion"
      # type: "discussion" | "announcement"

      add :user_id,       references(:users, on_delete: :nilify_all)
      add :space_id,      references(:spaces, on_delete: :restrict), null: false

      # Engagement counters (denormalized for feed performance)
      add :reply_count,    :integer, null: false, default: 0
      add :reaction_count, :integer, null: false, default: 0

      # Moderation
      add :pinned,        :boolean, null: false, default: false
      add :locked,        :boolean, null: false, default: false
      add :hidden,        :boolean, null: false, default: false
      add :hidden_at,     :utc_datetime
      add :hidden_by_id,  references(:users, on_delete: :nilify_all)

      # Full-text search vectors (populated by triggers)
      add :search_vector, :tsvector

      # Last activity — used for feed sorting
      add :last_reply_at, :utc_datetime

      timestamps(type: :utc_datetime)
    end

    create index(:posts, [:space_id])
    create index(:posts, [:user_id])
    create index(:posts, [:type])
    create index(:posts, [:pinned])
    create index(:posts, [:hidden])
    create index(:posts, [:inserted_at])
    create index(:posts, [:last_reply_at])
    create index(:posts, [:reaction_count])
    create index(:posts, [:search_vector], using: :gin)

    # tsvector update trigger
    execute """
      CREATE OR REPLACE FUNCTION posts_search_vector_update() RETURNS trigger AS $$
      BEGIN
        NEW.search_vector :=
          setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(NEW.body, '')), 'B');
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql;
    """,
    "DROP FUNCTION IF EXISTS posts_search_vector_update"

    execute """
      CREATE TRIGGER posts_search_vector_trigger
      BEFORE INSERT OR UPDATE ON posts
      FOR EACH ROW EXECUTE FUNCTION posts_search_vector_update();
    """,
    "DROP TRIGGER IF EXISTS posts_search_vector_trigger ON posts"
  end
end
