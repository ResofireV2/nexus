defmodule NexusWeb.API.V1.UploadController do
  use NexusWeb, :controller

  alias Nexus.{Uploads, Repo}
  alias Nexus.Uploads.Upload
  alias Nexus.Accounts

  # POST /api/v1/uploads
  # Params: file (multipart), type ("post_image" | "avatar" | "logo" | "favicon"), post_id (optional)
  def create(conn, params) do
    user    = conn.assigns.current_user
    type    = params["type"] || "post_image"
    post_id = params["post_id"]

    # Only admins can upload logos/favicons/og images
    if type in ["logo", "favicon", "og_image"] and user.role != "admin" do
      conn |> put_status(:forbidden) |> json(%{error: "Admin only"})
    else
      plug_upload = params["file"]

      if is_nil(plug_upload) or not match?(%Plug.Upload{}, plug_upload) do
        conn |> put_status(:bad_request) |> json(%{error: "No file provided"})
      else
        opts = [user_id: user.id] ++ if(post_id, do: [post_id: post_id], else: [])

        case Uploads.store(plug_upload, type, opts) do
          {:ok, upload} ->
            # If avatar upload, update the user's avatar_url to the webp (or original)
            if type == "avatar" do
              served_url = served_url(upload.webp_path || upload.original_path)
              Accounts.update_avatar(user, served_url)
            end

            # If cover upload, update the user's cover_url
            if type == "cover_image" do
              served_url = served_url(upload.webp_path || upload.original_path)
              Accounts.update_cover(user, served_url)
            end

            # If group_image, update the thread's image_url
            if type == "group_image" do
              thread_id = params["thread_id"]
              if thread_id do
                served_url = served_url(upload.webp_path || upload.original_path)
                case Nexus.Repo.get(Nexus.Messaging.Thread, String.to_integer("#{thread_id}")) do
                  nil    -> :not_found
                  thread ->
                    thread
                    |> Ecto.Changeset.change(image_url: served_url)
                    |> Nexus.Repo.update()
                end
              end
            end

            # If logo/favicon/og_image, update site_settings
            if type in ["logo", "favicon", "og_image"] do
              served_url = served_url(upload.original_path)
              key = case type do
                "logo"     -> "logo_url"
                "favicon"  -> "favicon_url"
                "og_image" -> "og_image_url"
              end
              Nexus.Admin.update_setting("general", %{key => served_url})
            end

            json(conn, %{
              upload: upload_json(upload),
              url:    served_url(upload.webp_path || upload.original_path),
              original_url: served_url(upload.original_path)
            })

          {:error, reason} when is_binary(reason) ->
            conn |> put_status(:unprocessable_entity) |> json(%{error: reason})

          {:error, %Ecto.Changeset{} = cs} ->
            conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
        end
      end
    end
  end

  # POST /api/v1/ext/:slug/upload
  # Extension upload endpoint — handles both extension_image and extension_file types.
  # `slug` in the path identifies which extension owns the upload.
  # Params: file (multipart), type ("extension_image" | "extension_file"),
  #         record_id (optional string — extension's own record association),
  #         allowed_mime (optional comma-separated list — for extension_file only)
  def extension_create(conn, %{"slug" => slug} = params) do
    user        = conn.assigns.current_user
    type        = params["type"] || "extension_image"
    record_id   = params["record_id"]
    plug_upload = params["file"]

    if type not in ["extension_image", "extension_file"] do
      conn |> put_status(:bad_request) |> json(%{error: "type must be extension_image or extension_file"})
    else
      if is_nil(plug_upload) or not match?(%Plug.Upload{}, plug_upload) do
        conn |> put_status(:bad_request) |> json(%{error: "No file provided"})
      else
        opts = [user_id: user.id, record_id: record_id] |> Enum.reject(fn {_, v} -> is_nil(v) end)

        opts =
          if type == "extension_file" && params["allowed_mime"] do
            allowed = params["allowed_mime"] |> String.split(",") |> Enum.map(&String.trim/1)
            Keyword.put(opts, :allowed_mime, allowed)
          else
            opts
          end

        result =
          try do
            case type do
              "extension_image" -> Uploads.store_extension_image(plug_upload, slug, opts)
              "extension_file"  -> Uploads.store_extension_file(plug_upload, slug, opts)
            end
          rescue
            e -> {:error, Exception.message(e)}
          end

        case result do
          {:ok, upload} ->
            json(conn, %{
              upload:       upload_json(upload),
              url:          served_url(upload.webp_path || upload.original_path),
              original_url: served_url(upload.original_path)
            })

          {:error, reason} when is_binary(reason) ->
            conn |> put_status(:unprocessable_entity) |> json(%{error: reason})

          {:error, %Ecto.Changeset{} = cs} ->
            conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})

          {:error, {_step, reason}} when is_binary(reason) ->
            conn |> put_status(:unprocessable_entity) |> json(%{error: reason})

          {:error, other} ->
            conn |> put_status(:unprocessable_entity) |> json(%{error: inspect(other)})
        end
      end
    end
  end

  # GET /api/v1/admin/uploads
  def index(conn, params) do
    opts = [
      upload_type: params["type"],
      user_id:     params["user_id"],
      page:        parse_int(params["page"], 1),
      limit:       parse_int(params["limit"], 50)
    ]

    %{uploads: uploads, total: total, page: page, pages: pages} = Uploads.list_uploads(opts)

    json(conn, %{
      uploads: Enum.map(uploads, &upload_json/1),
      total: total,
      page:  page,
      pages: pages
    })
  end

  # GET /api/v1/admin/uploads/stats
  def stats(conn, _params) do
    json(conn, %{stats: Uploads.storage_stats()})
  end

  # DELETE /api/v1/admin/uploads/:id
  def delete(conn, %{"id" => id}) do
    user = conn.assigns.current_user

    case Uploads.get_upload(id) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "Upload not found"})

      upload ->
        # Only owner or admin can delete
        if to_string(upload.user_id) == to_string(user.id) or user.role == "admin" do
          case Uploads.delete(upload) do
            {:ok, _}     -> json(conn, %{ok: true})
            {:error, cs} -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
          end
        else
          conn |> put_status(:forbidden) |> json(%{error: "Not authorized"})
        end
    end
  end

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------

  defp served_url(nil), do: nil
  defp served_url(rel_path) do
    Nexus.Uploads.Storage.public_url(rel_path)
  end

  defp upload_json(%Upload{} = u) do
    user = case u.user do
      %Ecto.Association.NotLoaded{} -> nil
      nil -> nil
      user -> %{id: user.id, username: user.username}
    end

    %{
      id:                  u.id,
      upload_type:         u.upload_type,
      original_name:       u.original_name,
      mime_type:           u.mime_type,
      size_bytes:          u.size_bytes,
      width:               u.width,
      height:              u.height,
      url:                 served_url(u.webp_path || u.original_path),
      original_url:        served_url(u.original_path),
      post_id:             u.post_id,
      extension_slug:      u.extension_slug,
      extension_record_id: u.extension_record_id,
      user:                user,
      inserted_at:         u.inserted_at
    }
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", if(is_binary(v), do: v, else: inspect(v))) end)
    end)
  end

  defp parse_int(nil, default), do: default
  defp parse_int(val, default) do
    case Integer.parse(to_string(val)) do
      {n, _} when n > 0 -> n
      _ -> default
    end
  end
end
