defmodule Nexus.Pages.Page do
  use Ecto.Schema
  import Ecto.Changeset

  schema "pages" do
    field :slug,      :string
    field :title,     :string
    field :body,      :string
    field :published, :boolean, default: false

    belongs_to :widget, Nexus.Pages.PageWidget

    timestamps(type: :utc_datetime)
  end

  def changeset(page, attrs) do
    page
    |> cast(attrs, [:slug, :title, :body, :published, :widget_id])
    |> validate_required([:slug, :title])
    |> validate_length(:slug, min: 1, max: 100)
    |> validate_format(:slug, ~r/^[a-z0-9\-]+$/, message: "only lowercase letters, numbers, and hyphens")
    |> validate_length(:title, min: 1, max: 200)
    |> unsafe_validate_unique(:slug, Nexus.Repo)
    |> unique_constraint(:slug)
  end
end
