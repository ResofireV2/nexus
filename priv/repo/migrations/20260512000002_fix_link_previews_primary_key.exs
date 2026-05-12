defmodule Nexus.Repo.Migrations.FixLinkPreviewsPrimaryKey do
  use Ecto.Migration

  def change do
    drop_if_exists table(:link_previews)

    create table(:link_previews, primary_key: false) do
      add :id,           :binary_id, primary_key: true
      add :url,          :text,   null: false
      add :domain,       :string, null: false
      add :title,        :string, null: false
      add :description,  :text
      add :site_name,    :string
      add :image_path,   :string
      add :favicon_path, :string
      add :fetched_at,   :naive_datetime, null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:link_previews, [:url])
  end
end
