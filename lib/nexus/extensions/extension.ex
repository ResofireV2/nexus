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

    # Webhook + JS bundle — the core of the extensibility model
    field :webhook_url,       :string
    field :js_bundle_url,     :string
    field :manifest_url,      :string
    field :service_url,       :string
    field :proxy_secret,      :string
    field :install_count,     :integer, default: 0

    # GitHub release tracking
    field :github_repo,       :string   # "owner/repo"
    field :installed_version, :string   # tag installed e.g. "v0.2.0"
    field :latest_version,    :string   # latest tag from GitHub Releases API
    field :release_notes,     :string   # markdown body of latest release

    has_many :hooks, Nexus.Extensions.Hook
    has_many :slots, Nexus.Extensions.Slot

    timestamps(type: :utc_datetime)
  end

  def changeset(ext, attrs) do
    ext
    |> cast(attrs, [:name, :slug, :version, :description, :author, :homepage,
                    :enabled, :settings, :manifest, :webhook_url, :js_bundle_url,
                    :manifest_url, :service_url, :proxy_secret, :install_count,
                    :github_repo, :installed_version, :latest_version, :release_notes])
    |> validate_required([:name, :slug, :version])
    |> validate_format(:slug, ~r/^[a-z0-9\-]+$/, message: "only lowercase letters, numbers, and hyphens")
    |> validate_format(:webhook_url,   ~r/^https?:\/\//, message: "must be a valid URL", allow_nil: true)
    |> validate_format(:manifest_url,  ~r/^https?:\/\//, message: "must be a valid URL", allow_nil: true)
    |> validate_format(:service_url,   ~r/^https?:\/\//, message: "must be a valid URL", allow_nil: true)
    |> unique_constraint(:slug)
  end

  def toggle_changeset(ext) do
    change(ext, enabled: !ext.enabled)
  end

  def settings_changeset(ext, settings) do
    change(ext, settings: Map.merge(ext.settings, settings))
  end
end

defmodule Nexus.Extensions.Hook do
  use Ecto.Schema
  import Ecto.Changeset

  schema "extension_hooks" do
    field :event,    :string
    field :handler,  :string
    field :priority, :integer, default: 50
    field :enabled,  :boolean, default: true

    belongs_to :extension, Nexus.Extensions.Extension

    timestamps(type: :utc_datetime)
  end

  def changeset(hook, attrs) do
    hook
    |> cast(attrs, [:extension_id, :event, :handler, :priority, :enabled])
    |> validate_required([:extension_id, :event, :handler])
  end
end

defmodule Nexus.Extensions.Slot do
  use Ecto.Schema
  import Ecto.Changeset

  schema "extension_slots" do
    field :slot,      :string
    field :component, :string
    field :priority,  :integer, default: 50
    field :enabled,   :boolean, default: true

    belongs_to :extension, Nexus.Extensions.Extension

    timestamps(type: :utc_datetime)
  end

  def changeset(slot, attrs) do
    slot
    |> cast(attrs, [:extension_id, :slot, :component, :priority, :enabled])
    |> validate_required([:extension_id, :slot, :component])
  end
end
