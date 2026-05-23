defmodule Nexus.Pages.PageWidget do
  use Ecto.Schema
  import Ecto.Changeset

  schema "page_widgets" do
    field :name,     :string
    field :position, :integer, default: 0

    has_many :pages, Nexus.Pages.Page

    timestamps(type: :utc_datetime)
  end

  def changeset(widget, attrs) do
    widget
    |> cast(attrs, [:name, :position])
    |> validate_required([:name])
    |> validate_length(:name, min: 1, max: 100)
    |> unsafe_validate_unique(:name, Nexus.Repo)
    |> unique_constraint(:name)
  end
end
