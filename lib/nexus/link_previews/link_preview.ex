defmodule Nexus.LinkPreviews.LinkPreview do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}

  schema "link_previews" do
    field :url,          :string
    field :domain,       :string
    field :title,        :string
    field :description,  :string
    field :site_name,    :string
    field :image_path,   :string
    field :favicon_path, :string
    field :fetched_at,   :naive_datetime

    timestamps(type: :utc_datetime)
  end

  def changeset(preview, attrs) do
    preview
    |> cast(attrs, [:url, :domain, :title, :description, :site_name,
                    :image_path, :favicon_path, :fetched_at])
    |> validate_required([:url, :domain, :title, :fetched_at])
    |> unique_constraint(:url)
  end
end
