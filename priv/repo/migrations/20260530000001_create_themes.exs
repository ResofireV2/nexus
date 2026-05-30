defmodule Nexus.Repo.Migrations.CreateThemes do
  use Ecto.Migration

  def change do
    create table(:themes) do
      add :name,              :string,  null: false
      add :slug,              :string,  null: false
      add :version,           :string,  null: false
      add :description,       :string
      add :author,            :string
      add :homepage,          :string

      # GitHub release tracking — same pattern as extensions
      add :github_repo,       :string   # "owner/repo"
      add :installed_version, :string   # tag installed e.g. "v1.0.0"
      add :latest_version,    :string
      add :release_notes,     :string

      # The full parsed theme.json stored as a map
      add :manifest,          :map,     default: %{}, null: false

      # Path to theme.css on disk, relative to /app/uploads/themes/:slug/
      add :stylesheet_path,   :string

      # Admin-configured settings (from theme's settings schema)
      add :settings,          :map,     default: %{}, null: false

      # Mode assignment — a theme can be assigned to dark, light, both, or neither
      add :active_dark,       :boolean, default: false, null: false
      add :active_light,      :boolean, default: false, null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:themes, [:slug])
    # Only one theme can be active per mode
    create unique_index(:themes, [:active_dark],  where: "active_dark = true",  name: :themes_unique_active_dark)
    create unique_index(:themes, [:active_light], where: "active_light = true", name: :themes_unique_active_light)
  end
end
