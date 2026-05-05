defmodule Nexus.Uploads.Upload do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}

  schema "uploads" do
    field :upload_type,   :string
    field :original_path, :string
    field :webp_path,     :string
    field :original_name, :string
    field :mime_type,     :string
    field :size_bytes,    :integer
    field :width,         :integer
    field :height,        :integer

    belongs_to :user, Nexus.Accounts.User
    belongs_to :post, Nexus.Forum.Post

    timestamps(type: :utc_datetime)
  end

  @valid_types ~w(post_image avatar logo favicon)
  @valid_mime  ~w(image/jpeg image/png image/gif image/webp image/svg+xml image/x-icon image/vnd.microsoft.icon)

  def changeset(upload, attrs) do
    upload
    |> cast(attrs, [:user_id, :post_id, :upload_type, :original_path, :webp_path,
                    :original_name, :mime_type, :size_bytes, :width, :height])
    |> validate_required([:upload_type, :original_path, :original_name, :mime_type, :size_bytes])
    |> validate_inclusion(:upload_type, @valid_types)
    |> validate_inclusion(:mime_type, @valid_mime)
  end
end
