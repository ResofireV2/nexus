defmodule Nexus.Repo.Migrations.CreateDrafts do
  use Ecto.Migration

  def change do
    create table(:drafts) do
      add :user_id,   references(:users, on_delete: :delete_all), null: false
      add :type,      :string, null: false, default: "post"   # "post" | "reply"
      add :title,     :string                                  # post drafts only
      add :body,      :text,   null: false, default: ""
      add :post_type, :string, default: "discussion"           # discussion | announcement | question
      add :space_id,  references(:spaces, on_delete: :nilify_all)
      add :post_id,   references(:posts, on_delete: :delete_all)  # reply drafts only
      add :tag_ids,   {:array, :integer}, default: []

      timestamps(type: :utc_datetime)
    end

    create index(:drafts, [:user_id])
    create index(:drafts, [:user_id, :type])
  end
end
