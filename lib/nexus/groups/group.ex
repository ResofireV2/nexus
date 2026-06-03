defmodule Nexus.Groups.Group do
  use Ecto.Schema
  import Ecto.Changeset

  schema "groups" do
    field :name,            :string
    field :slug,            :string
    field :description,     :string

    field :public,          :boolean, default: false

    # Public display — only used when public is true
    field :badge_label,     :string
    field :badge_color,     :string
    field :badge_icon,      :string

    field :show_on_profile, :boolean, default: true
    field :show_on_posts,   :boolean, default: false
    field :show_on_popover, :boolean, default: false

    has_many :memberships, Nexus.Groups.GroupMembership

    timestamps(type: :utc_datetime)
  end

  @doc """
  Changeset for creating or updating a group.

  When `public` is false the badge_label, badge_color, badge_icon, and
  show_on_* fields are cleared — they have no meaning for backend-only groups.
  """
  def changeset(group, attrs) do
    group
    |> cast(attrs, [
      :name, :slug, :description,
      :public,
      :badge_label, :badge_color, :badge_icon,
      :show_on_profile, :show_on_posts, :show_on_popover
    ])
    |> validate_required([:name, :slug])
    |> validate_length(:name, min: 1, max: 60)
    |> validate_length(:slug, min: 1, max: 60)
    |> validate_format(:slug, ~r/^[a-z0-9_]+$/,
        message: "only lowercase letters, numbers, and underscores")
    |> validate_length(:description, max: 500)
    |> validate_length(:badge_label, max: 30)
    |> validate_format(:badge_color, ~r/^#[0-9a-fA-F]{6}$/,
        message: "must be a hex color", allow_nil: true)
    |> unique_constraint(:name)
    |> unique_constraint(:slug)
    |> clear_public_fields_if_private()
  end

  # When a group is not public, nullify all display fields.
  # This keeps the DB clean and avoids stale display data on backend groups.
  defp clear_public_fields_if_private(changeset) do
    case get_field(changeset, :public) do
      true -> changeset
      _ ->
        changeset
        |> put_change(:badge_label, nil)
        |> put_change(:badge_color, nil)
        |> put_change(:badge_icon, nil)
        |> put_change(:show_on_profile, true)
        |> put_change(:show_on_posts, false)
        |> put_change(:show_on_popover, false)
    end
  end
end
