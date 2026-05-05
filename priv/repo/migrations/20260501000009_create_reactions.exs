defmodule Nexus.Repo.Migrations.CreateReactions do
  use Ecto.Migration

  def change do
    create table(:reactions) do
      add :emoji,       :string, null: false
      add :user_id,     references(:users, on_delete: :delete_all), null: false

      # Polymorphic — either post_id or reply_id, never both
      add :post_id,     references(:posts, on_delete: :delete_all)
      add :reply_id,    references(:replies, on_delete: :delete_all)

      timestamps(type: :utc_datetime)
    end

    create unique_index(:reactions, [:user_id, :emoji, :post_id],
      where: "post_id IS NOT NULL",
      name: :reactions_user_emoji_post_unique
    )
    create unique_index(:reactions, [:user_id, :emoji, :reply_id],
      where: "reply_id IS NOT NULL",
      name: :reactions_user_emoji_reply_unique
    )
    create index(:reactions, [:post_id])
    create index(:reactions, [:reply_id])
    create index(:reactions, [:user_id])

    # Constraint: must belong to exactly one of post or reply
    create constraint(:reactions, :must_belong_to_one,
      check: "(post_id IS NOT NULL)::int + (reply_id IS NOT NULL)::int = 1"
    )
  end
end
