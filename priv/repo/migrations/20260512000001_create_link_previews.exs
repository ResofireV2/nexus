defmodule Nexus.Repo.Migrations.CreateLinkPreviews do
  use Ecto.Migration

  def change do
    create table(:link_previews) do
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
