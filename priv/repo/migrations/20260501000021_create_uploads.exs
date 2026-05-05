defmodule Nexus.Repo.Migrations.CreateUploads do
  use Ecto.Migration

  def change do
    create table(:uploads, primary_key: false) do
      add :id,            :binary_id, primary_key: true
      add :user_id,       references(:users, type: :id, on_delete: :nilify_all)
      add :upload_type,   :string, null: false          # "post_image" | "avatar" | "logo" | "favicon"
      add :original_path, :string, null: false          # relative to priv/static
      add :webp_path,     :string                       # nil for favicon
      add :original_name, :string, null: false          # original filename from user
      add :mime_type,     :string, null: false
      add :size_bytes,    :integer, null: false
      add :width,         :integer
      add :height,        :integer
      add :post_id,       references(:posts, type: :id, on_delete: :nilify_all)
      timestamps(type: :utc_datetime)
    end

    create index(:uploads, [:user_id])
    create index(:uploads, [:upload_type])
    create index(:uploads, [:post_id])
  end
end
