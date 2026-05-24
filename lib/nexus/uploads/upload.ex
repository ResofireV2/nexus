defmodule Nexus.Uploads.Upload do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}

  schema "uploads" do
    field :upload_type,          :string
    field :original_path,        :string
    field :webp_path,            :string
    field :original_name,        :string
    field :mime_type,            :string
    field :size_bytes,           :integer
    field :width,                :integer
    field :height,               :integer
    field :extension_slug,       :string
    field :extension_record_id,  :string

    belongs_to :user, Nexus.Accounts.User
    belongs_to :post, Nexus.Forum.Post

    timestamps(type: :utc_datetime)
  end

  @valid_types ~w(post_image avatar cover_image logo favicon og_image group_image
                  extension_image extension_file)

  @valid_mime  ~w(image/jpeg image/png image/gif image/webp image/svg+xml
                  image/x-icon image/vnd.microsoft.icon)

  # MIME types permitted for raw extension file uploads.
  # Deliberately excludes executables, scripts, and anything that could
  # be served and executed by a browser.
  @extension_file_mime ~w(
    video/mp4 video/webm video/ogg video/quicktime
    audio/mpeg audio/ogg audio/wav audio/webm audio/flac
    application/pdf
    application/zip application/x-zip-compressed
    text/plain text/csv text/markdown
    application/json
    application/vnd.openxmlformats-officedocument.wordprocessingml.document
    application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
    application/vnd.openxmlformats-officedocument.presentationml.presentation
  )

  def changeset(upload, attrs) do
    upload
    |> cast(attrs, [:user_id, :post_id, :upload_type, :original_path, :webp_path,
                    :original_name, :mime_type, :size_bytes, :width, :height,
                    :extension_slug, :extension_record_id])
    |> validate_required([:upload_type, :original_path, :original_name, :mime_type, :size_bytes])
    |> validate_inclusion(:upload_type, @valid_types)
    |> validate_mime_for_type()
    |> validate_extension_fields()
  end

  def extension_file_mime_types, do: @extension_file_mime

  # For extension_image, allow the same image MIME types as core uploads
  # (minus SVG — XSS risk when served directly). For extension_file, allow
  # the broader raw file list. For all core types, apply the original image-only list.
  defp validate_mime_for_type(changeset) do
    type = get_field(changeset, :upload_type)
    mime = get_field(changeset, :mime_type)

    allowed =
      case type do
        "extension_image" -> @valid_mime
        "extension_file"  -> @extension_file_mime
        _                 -> @valid_mime
      end

    if mime && mime not in allowed do
      add_error(changeset, :mime_type, "#{mime} is not permitted for upload type #{type}")
    else
      changeset
    end
  end

  # Extension uploads must carry an extension_slug.
  defp validate_extension_fields(changeset) do
    type = get_field(changeset, :upload_type)

    if type in ["extension_image", "extension_file"] do
      validate_required(changeset, [:extension_slug])
    else
      changeset
    end
  end
end
