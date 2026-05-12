defmodule Nexus.Repo.Migrations.AddPinScopeToPosts do
  use Ecto.Migration

  def change do
    alter table(:posts) do
      # "global" — appears at top of all feeds
      # "space"  — appears at top of the post's own space feed only
      # nil      — not pinned
      add :pin_scope, :string
    end

    create index(:posts, [:pin_scope], where: "pin_scope IS NOT NULL")
  end
end
