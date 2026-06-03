defmodule Nexus.Repo.Migrations.CreateGroups do
  use Ecto.Migration

  def change do
    create table(:groups) do
      add :name,            :string,  null: false
      add :slug,            :string,  null: false
      add :description,     :text

      # Visibility — false = backend-only (permissions gate only),
      #              true  = badge displayed on profile/posts/popover
      add :public,          :boolean, null: false, default: false

      # Public display fields — only meaningful when public is true
      add :badge_label,     :string
      add :badge_color,     :string
      add :badge_icon,      :string

      # Where the badge appears — only meaningful when public is true
      add :show_on_profile, :boolean, null: false, default: true
      add :show_on_posts,   :boolean, null: false, default: false
      add :show_on_popover, :boolean, null: false, default: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:groups, [:name])
    create unique_index(:groups, [:slug])
  end
end
