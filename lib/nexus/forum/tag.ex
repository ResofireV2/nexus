defmodule Nexus.Forum.Tag do
  use Ecto.Schema
  import Ecto.Changeset

  schema "tags" do
    field :name,       :string
    field :slug,       :string
    field :color,      :string, default: "#5B4EF5"
    field :post_count, :integer, default: 0

    many_to_many :posts, Nexus.Forum.Post, join_through: "post_tags"
    has_many :tag_subscriptions, Nexus.Forum.TagSubscription

    timestamps(type: :utc_datetime)
  end

  def changeset(tag, attrs) do
    tag
    |> cast(attrs, [:name, :color])
    |> validate_required([:name])
    |> validate_length(:name, min: 1, max: 30)
    |> validate_format(:color, ~r/^#[0-9a-fA-F]{6}$/, message: "must be a hex color")
    |> slugify()
    |> unique_constraint(:name)
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
end
