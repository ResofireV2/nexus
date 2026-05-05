defmodule Nexus.Forum.Space do
  use Ecto.Schema
  import Ecto.Changeset

  schema "spaces" do
    field :name,        :string
    field :slug,        :string
    field :description, :string
    field :color,       :string, default: "#5B4EF5"
    field :visibility,  :string, default: "public"
    field :position,    :integer, default: 0
    field :post_count,  :integer, default: 0

    belongs_to :created_by, Nexus.Accounts.User
    has_many :posts, Nexus.Forum.Post
    has_many :space_subscriptions, Nexus.Forum.SpaceSubscription

    timestamps(type: :utc_datetime)
  end

  def changeset(space, attrs) do
    space
    |> cast(attrs, [:name, :slug, :description, :color, :visibility, :position])
    |> validate_required([:name, :slug])
    |> validate_length(:name, min: 1, max: 50)
    |> validate_inclusion(:visibility, ~w(public private))
    |> validate_format(:color, ~r/^#[0-9a-fA-F]{6}$/, message: "must be a hex color")
    |> slugify()
    |> unique_constraint(:slug)
  end

  defp slugify(changeset) do
    case get_change(changeset, :name) do
      nil -> changeset
      name ->
        slug = name |> String.downcase() |> String.replace(~r/[^a-z0-9]+/, "-") |> String.trim("-")
        put_change(changeset, :slug, slug)
    end
  end

  def public?(%__MODULE__{visibility: "public"}), do: true
  def public?(_), do: false
end
