defmodule Nexus.Themes.Theme do
  use Ecto.Schema
  import Ecto.Changeset

  schema "themes" do
    field :name,              :string
    field :slug,              :string
    field :version,           :string
    field :description,       :string
    field :author,            :string
    field :homepage,          :string

    field :github_repo,       :string
    field :installed_version, :string
    field :latest_version,    :string
    field :release_notes,     :string

    field :manifest,          :map,    default: %{}
    field :stylesheet_path,   :string
    field :script_path,       :string
    field :settings,          :map,    default: %{}

    field :active_dark,       :boolean, default: false
    field :active_light,      :boolean, default: false

    timestamps(type: :utc_datetime)
  end

  def changeset(theme, attrs) do
    theme
    |> cast(attrs, [:name, :slug, :version, :description, :author, :homepage,
                    :github_repo, :installed_version, :latest_version, :release_notes,
                    :manifest, :stylesheet_path, :script_path, :settings,
                    :active_dark, :active_light])
    |> validate_required([:name, :slug, :version])
    |> validate_format(:slug, ~r/^[a-z0-9\-]+$/, message: "only lowercase letters, numbers, and hyphens")
    |> unique_constraint(:slug)
    |> unique_constraint(:active_dark,  name: :themes_unique_active_dark)
    |> unique_constraint(:active_light, name: :themes_unique_active_light)
  end

  def settings_changeset(theme, settings) do
    change(theme, settings: Map.merge(theme.settings || %{}, settings))
  end
end
