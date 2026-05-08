defmodule Nexus.Uploads do
  @moduledoc """
  Handles file uploads: validation, processing (WebP conversion + resize),
  disk storage, and DB tracking.

  Directory layout under priv/static/uploads/:
    avatars/   — user profile pictures
    posts/     — images attached to posts
    logos/     — site logo and favicon
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Uploads.Upload
  alias Nexus.Admin

  # ---------------------------------------------------------------------------
  # Public API
  # ---------------------------------------------------------------------------

  @doc """
  Process and store an uploaded file.

  `plug_upload` is a %Plug.Upload{} struct.
  `upload_type` is one of: "post_image" | "avatar" | "logo" | "favicon"
  `opts` may include: [user_id: uuid, post_id: uuid]
  """
  def store(plug_upload, upload_type, opts \\ []) do
    settings = Admin.get_setting("uploads")

    with :ok <- validate_size(plug_upload, settings),
         :ok <- validate_mime(plug_upload, upload_type, settings),
         {:ok, original_path} <- save_original(plug_upload, upload_type),
         {:ok, webp_path, dims} <- maybe_convert(original_path, upload_type, settings) do

      attrs = %{
        user_id:       Keyword.get(opts, :user_id),
        post_id:       Keyword.get(opts, :post_id),
        upload_type:   upload_type,
        original_path: original_path,
        webp_path:     webp_path,
        original_name: plug_upload.filename,
        mime_type:     plug_upload.content_type,
        size_bytes:    File.stat!(full_path(original_path)).size,
        width:         dims[:width],
        height:        dims[:height]
      }

      %Upload{}
      |> Upload.changeset(attrs)
      |> Repo.insert()
      |> case do
        {:ok, upload} -> {:ok, Repo.preload(upload, [:user, :post])}
        err -> err
      end
    end
  end

  @doc "List uploads, optionally filtered."
  def list_uploads(opts \\ []) do
    query = from u in Upload,
      left_join: user in assoc(u, :user),
      preload: [user: user],
      order_by: [desc: u.inserted_at]

    query = if t = opts[:upload_type], do: where(query, [u], u.upload_type == ^t), else: query
    query = if uid = opts[:user_id],   do: where(query, [u], u.user_id == ^uid),   else: query

    limit = Keyword.get(opts, :limit, 50)
    page  = Keyword.get(opts, :page, 1)
    total = Repo.aggregate(query, :count)

    uploads = Repo.all(from q in query, limit: ^limit, offset: ^((page - 1) * limit))
    %{uploads: uploads, total: total, page: page, pages: ceil(total / max(limit, 1))}
  end

  @doc "Get storage usage stats."
  def storage_stats do
    totals = Repo.all(
      from u in Upload,
      group_by: u.upload_type,
      select: {u.upload_type, count(u.id), sum(u.size_bytes)}
    )

    by_type = Map.new(totals, fn {t, cnt, bytes} ->
      {t, %{count: cnt, bytes: bytes || 0}}
    end)

    total_bytes = by_type |> Map.values() |> Enum.reduce(0, & &1.bytes + &2)
    total_count = by_type |> Map.values() |> Enum.reduce(0, & &1.count + &2)

    %{by_type: by_type, total_bytes: total_bytes, total_count: total_count}
  end

  @doc "Delete an upload record and its files from disk."
  def delete(%Upload{} = upload) do
    # Remove files from disk
    try_delete(full_path(upload.original_path))
    if upload.webp_path, do: try_delete(full_path(upload.webp_path))
    Repo.delete(upload)
  end

  def get_upload(id), do: Repo.get(Upload, id)

  # ---------------------------------------------------------------------------
  # Validation
  # ---------------------------------------------------------------------------

  defp validate_size(%Plug.Upload{path: tmp_path}, settings) do
    max_bytes = (settings["max_size_mb"] || 5) * 1_048_576
    size = File.stat!(tmp_path).size

    if size <= max_bytes do
      :ok
    else
      max_mb = settings["max_size_mb"] || 5
      {:error, "File exceeds maximum size of #{max_mb} MB"}
    end
  end

  defp validate_mime(%Plug.Upload{content_type: ct}, upload_type, _settings) do
    allowed =
      case upload_type do
        "favicon"    -> ~w(image/x-icon image/vnd.microsoft.icon image/png image/svg+xml image/webp)
        _            -> ~w(image/jpeg image/png image/gif image/webp image/svg+xml)
      end

    if ct in allowed do
      :ok
    else
      {:error, "File type #{ct} is not allowed"}
    end
  end

  # ---------------------------------------------------------------------------
  # Storage
  # ---------------------------------------------------------------------------

  defp save_original(%Plug.Upload{path: tmp, filename: filename, content_type: ct}, upload_type) do
    dir      = upload_dir(upload_type)
    ext      = ext_for(ct, filename)
    name     = "#{uuid()}#{ext}"
    rel_path = "#{dir}/#{name}"
    abs_path = full_path(rel_path)

    File.mkdir_p!(Path.dirname(abs_path))

    case File.cp(tmp, abs_path) do
      :ok    -> {:ok, rel_path}
      err    -> err
    end
  end

  # ---------------------------------------------------------------------------
  # Image processing
  # ---------------------------------------------------------------------------

  defp maybe_convert(original_path, "favicon", _settings) do
    # Favicons: never convert, just get dimensions if possible
    dims = safe_dims(full_path(original_path))
    {:ok, nil, dims}
  end

  defp maybe_convert(original_path, upload_type, settings) do
    convert? = settings["convert_to_webp"] != false  # default on
    quality  = settings["webp_quality"] || 85
    max_w    = max_width_for(upload_type, settings)
    abs_src  = full_path(original_path)

    # Skip conversion for SVGs and GIFs (GIF would lose animation)
    mime = MIME.from_path(abs_src)
    if mime in ["image/svg+xml", "image/gif"] do
      dims = safe_dims(abs_src)
      {:ok, nil, dims}
    else
      do_convert(abs_src, original_path, convert?, quality, max_w)
    end
  end

  defp do_convert(abs_src, original_path, convert?, quality, max_w) do
    with {:ok, image} <- Image.open(abs_src),
         {:ok, image} <- autorotate(image),
         {orig_w, orig_h, _} <- Image.shape(image),
         {:ok, resized} <- maybe_resize(image, orig_w, max_w),
         {final_w, final_h, _} <- Image.shape(resized) do

      dims = %{width: final_w, height: final_h}

      if convert? do
        webp_rel = String.replace(original_path, ~r/\.[^.]+$/, ".webp")
        # Put webp in a webp/ subdir parallel to the original
        webp_rel = "webp/" <> webp_rel
        abs_webp = full_path(webp_rel)

        File.mkdir_p!(Path.dirname(abs_webp))

        case Image.write(resized, abs_webp, quality: quality, suffix: ".webp") do
          {:ok, _} -> {:ok, webp_rel, dims}
          err      -> err
        end
      else
        # Just save the resized original back
        Image.write(resized, abs_src)
        {:ok, nil, dims}
      end
    else
      err -> {:error, "Image processing failed: #{inspect(err)}"}
    end
  end

  defp maybe_resize(image, orig_w, max_w) when orig_w > max_w do
    Image.resize(image, max_w / orig_w)
  end
  defp maybe_resize(image, _orig_w, _max_w), do: {:ok, image}

  defp safe_dims(path) do
    case Image.open(path) do
      {:ok, img} ->
        img = case Image.autorotate(img) do
          {:ok, rotated} -> rotated
          _ -> img
        end
        {w, h, _} = Image.shape(img)
        %{width: w, height: h}
      _ ->
        %{width: nil, height: nil}
    end
  end

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------

  defp upload_dir("post_image"),   do: "posts"
  defp upload_dir("avatar"),       do: "avatars"
  defp upload_dir("cover_image"),  do: "covers"
  defp upload_dir("logo"),         do: "logos"
  defp upload_dir("favicon"),      do: "logos"
  defp upload_dir("group_image"),  do: "avatars"

  defp max_width_for("avatar", _settings),       do: 400
  defp max_width_for("logo",   _settings),       do: 400
  defp max_width_for("cover_image", _settings),  do: 1920
  defp max_width_for(_, settings),               do: settings["max_width"] || 1200

  defp static_dir do
    # In a Mix release, Application.app_dir resolves to the versioned lib dir
    # (e.g. /app/lib/nexus-0.1.0/priv/static) which is inside the container image.
    # Instead we use /app/uploads which is bind-mounted from the host, so files
    # survive container rebuilds. In dev we fall back to priv/static/uploads.
    case Application.get_env(:nexus, :uploads_dir) do
      nil ->
        if Application.get_env(:nexus, :env) == :prod do
          "/app/uploads"
        else
          Path.join([:code.priv_dir(:nexus), "static", "uploads"])
        end
      dir -> dir
    end
  end

  defp full_path(rel) do
    Path.join(static_dir(), rel)
  end

  defp served_path(abs_path) do
    # Convert absolute path back to a URL path served by the static plug
    abs_path
    |> String.replace(static_dir(), "")
    |> then(&("/uploads" <> &1))
  end

  defp ext_for(content_type, filename) do
    case content_type do
      "image/jpeg"                    -> ".jpg"
      "image/png"                     -> ".png"
      "image/gif"                     -> ".gif"
      "image/webp"                    -> ".webp"
      "image/svg+xml"                 -> ".svg"
      "image/x-icon"                  -> ".ico"
      "image/vnd.microsoft.icon"      -> ".ico"
      _ ->
        # Fallback to original extension
        Path.extname(filename) |> String.downcase()
    end
  end

  defp uuid, do: Ecto.UUID.generate()

  defp try_delete(path) do
    File.rm(path)
  rescue
    _ -> :ok
  end

  # Rotate image pixels to match EXIF orientation tag, then strip the tag.
  # This ensures phone photos display correctly after WebP conversion strips EXIF.
  # Image.autorotate/1 is a no-op (returns {:ok, image}) if no rotation is needed.
  defp autorotate(image) do
    case Image.autorotate(image) do
      {:ok, rotated} -> {:ok, rotated}
      # If autorotate isn't available or fails, continue with original
      _ -> {:ok, image}
    end
  end
end
