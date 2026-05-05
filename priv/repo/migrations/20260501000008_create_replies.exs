defmodule Nexus.Repo.Migrations.CreateReplies do
  use Ecto.Migration

  def change do
    create table(:replies) do
      add :body,          :text, null: false
      add :body_format,   :string, null: false, default: "markdown"

      add :user_id,       references(:users, on_delete: :nilify_all)
      add :post_id,       references(:posts, on_delete: :delete_all), null: false

      add :reaction_count, :integer, null: false, default: 0

      # Moderation
      add :hidden,        :boolean, null: false, default: false
      add :hidden_at,     :utc_datetime
      add :hidden_by_id,  references(:users, on_delete: :nilify_all)

      # Full-text search vector
      add :search_vector, :tsvector

      timestamps(type: :utc_datetime)
    end

    create index(:replies, [:post_id])
    create index(:replies, [:user_id])
    create index(:replies, [:hidden])
    create index(:replies, [:inserted_at])
    create index(:replies, [:search_vector], using: :gin)

    execute """
      CREATE OR REPLACE FUNCTION replies_search_vector_update() RETURNS trigger AS $$
      BEGIN
        NEW.search_vector :=
          setweight(to_tsvector('english', coalesce(NEW.body, '')), 'C');
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql;
    """,
    "DROP FUNCTION IF EXISTS replies_search_vector_update"

    execute """
      CREATE TRIGGER replies_search_vector_trigger
      BEFORE INSERT OR UPDATE ON replies
      FOR EACH ROW EXECUTE FUNCTION replies_search_vector_update();
    """,
    "DROP TRIGGER IF EXISTS replies_search_vector_trigger ON replies"
  end
end
