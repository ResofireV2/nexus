defmodule Nexus.Extensions.Extension do
  use Ecto.Schema
  import Ecto.Changeset

  schema "extensions" do
    field :name,              :string
    field :slug,              :string
    field :version,           :string
    field :description,       :string
    field :author,            :string
    field :homepage,          :string
    field :enabled,           :boolean, default: true
    field :settings,          :map, default: %{}
    field :manifest,          :map, default: %{}

    # JS bundle + manifest source
    field :js_bundle_url,     :string
    field :manifest_url,      :string
    field :install_count,     :integer, default: 0

    # GitHub release tracking
    field :github_repo,       :string   # "owner/repo"
    field :installed_version, :string   # tag installed e.g. "v0.2.0"
    field :latest_version,    :string   # latest tag from GitHub Releases API
    field :release_notes,     :string   # markdown body of latest release

    # Load status tracking — populated by the loader / install flow.
    # See migration 20260521000001 for the meaning of each status string.
    field :load_status,       :string
    field :load_error,        :string
    field :loaded_at,         :utc_datetime

    timestamps(type: :utc_datetime)
  end

  def changeset(ext, attrs) do
    ext
    |> cast(attrs, [:name, :slug, :version, :description, :author, :homepage,
                    :enabled, :settings, :manifest, :js_bundle_url,
                    :manifest_url, :install_count,
                    :github_repo, :installed_version, :latest_version, :release_notes,
                    :load_status, :load_error, :loaded_at])
    |> validate_required([:name, :slug, :version])
    |> validate_format(:slug, ~r/^[a-z0-9\-]+$/, message: "only lowercase letters, numbers, and hyphens")
    |> validate_format(:manifest_url,  ~r/^https?:\/\//, message: "must be a valid URL", allow_nil: true)
    |> unique_constraint(:slug)
  end

  def toggle_changeset(ext) do
    change(ext, enabled: !ext.enabled)
  end

  def settings_changeset(ext, settings) do
    change(ext, settings: Map.merge(ext.settings, settings))
  end
end
