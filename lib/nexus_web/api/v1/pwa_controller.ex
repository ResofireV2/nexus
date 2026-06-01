defmodule NexusWeb.API.V1.PwaController do
  use NexusWeb, :controller

  alias Nexus.Admin
  import Ecto.Query
  alias Nexus.Repo

  # ---------------------------------------------------------------------------
  # GET /api/v1/pwa/vapid-public-key  (public — no auth required)
  # Returns the VAPID public key so the frontend JS can call
  # PushManager.subscribe({ applicationServerKey: key }).
  # ---------------------------------------------------------------------------
  def vapid_public_key(conn, _params) do
    pwa = Admin.get_setting("pwa")

    case pwa["vapid_public"] do
      nil -> conn |> put_status(:not_found) |> json(%{error: "VAPID keys not configured"})
      key -> json(conn, %{public_key: key})
    end
  end

  # ---------------------------------------------------------------------------
  # POST /api/v1/admin/pwa/vapid  (admin only)
  # Generates a new EC P-256 keypair for VAPID using OTP :crypto — no external
  # dependency required. Stores both keys in site_settings["pwa"].
  # Clears all stored push subscriptions because they were signed with the old key.
  # ---------------------------------------------------------------------------
  def generate_vapid(conn, _params) do
    admin_id = conn.assigns.current_user.id

    case generate_vapid_keys() do
      {:ok, public_key, private_key} ->
        Admin.update_setting("pwa", %{
          "vapid_public"  => public_key,
          "vapid_private" => private_key
        }, admin_id)

        deleted = clear_push_subscriptions()

        json(conn, %{public_key: public_key, subscriptions_deleted: deleted})

      {:error, reason} ->
        conn
        |> put_status(:internal_server_error)
        |> json(%{error: "Failed to generate VAPID keys: #{reason}"})
    end
  end

  # ---------------------------------------------------------------------------
  # POST /api/v1/admin/pwa/icons  (admin only)
  # Expects multipart field "icon-source" — a JPEG, PNG, or WebP source image.
  # Generates all required PWA icon sizes using the Image library already in mix.exs.
  # Saves PNGs to priv/static/images/pwa/ (dev) or /app/uploads/pwa-icons/ (prod).
  # Stores URL paths in site_settings["pwa"].
  # ---------------------------------------------------------------------------
  def upload_icons(conn, params) do
    admin_id = conn.assigns.current_user.id

    case params["icon-source"] do
      %Plug.Upload{} = upload ->
        case generate_icons(upload) do
          {:ok, icon_paths} ->
            Admin.update_setting("pwa", icon_paths, admin_id)
            json(conn, %{ok: true, icons: icon_paths})

          {:error, reason} ->
            conn |> put_status(:unprocessable_entity) |> json(%{error: reason})
        end

      _ ->
        conn |> put_status(:bad_request) |> json(%{error: "No source image provided"})
    end
  end

  # ---------------------------------------------------------------------------
  # DELETE /api/v1/admin/pwa/icons  (admin only)
  # ---------------------------------------------------------------------------
  def delete_icons(conn, _params) do
    admin_id = conn.assigns.current_user.id
    dir      = icons_dir()

    Enum.each(@icon_sizes, fn size ->
      File.rm(Path.join(dir, "icon-#{size}.png"))
    end)

    cleared = Map.new(@icon_sizes, fn size -> {"icon_#{size}_path", nil} end)
    Admin.update_setting("pwa", cleared, admin_id)

    json(conn, %{ok: true})
  end

  # ---------------------------------------------------------------------------
  # POST /api/v1/admin/pwa/badge  (admin only)
  # Field name: "badge". Resizes to 96×96 PNG.
  # ---------------------------------------------------------------------------
  def upload_badge(conn, params) do
    admin_id = conn.assigns.current_user.id

    case params["badge"] do
      %Plug.Upload{} = upload ->
        case save_badge(upload) do
          {:ok, url} ->
            Admin.update_setting("pwa", %{"badge_url" => url}, admin_id)
            json(conn, %{url: url})

          {:error, reason} ->
            conn |> put_status(:unprocessable_entity) |> json(%{error: reason})
        end

      _ ->
        conn |> put_status(:bad_request) |> json(%{error: "No badge image provided"})
    end
  end

  # ---------------------------------------------------------------------------
  # DELETE /api/v1/admin/pwa/badge  (admin only)
  # ---------------------------------------------------------------------------
  def delete_badge(conn, _params) do
    admin_id = conn.assigns.current_user.id
    File.rm(Path.join(icons_dir(), "badge.png"))
    Admin.update_setting("pwa", %{"badge_url" => nil}, admin_id)
    json(conn, %{ok: true})
  end

  # ---------------------------------------------------------------------------
  # GET /manifest.json  (public — replaces the static file)
  # Builds the manifest dynamically from site_settings["pwa"].
  # Falls back to forum name and default colors when PWA settings are empty.
  # ---------------------------------------------------------------------------
  def manifest(conn, _params) do
    pwa     = Admin.get_setting("pwa")
    general = Admin.get_setting("general")

    forum_name  = general["site_name"] || "Nexus"
    app_name    = pwa["app_name"]      || forum_name
    short_name  = pwa["short_name"]    || app_name
    theme_color = pwa["theme_color"]   || "#5B4EF5"
    bg_color    = pwa["bg_color"]      || "#030712"
    start_url   = pwa["start_url"]     || "/"
    orientation = if pwa["force_portrait"], do: "portrait-primary", else: "any"

    manifest = %{
      "name"             => app_name,
      "short_name"       => short_name,
      "description"      => general["site_description"] || "",
      "start_url"        => start_url,
      "display"          => "standalone",
      "background_color" => bg_color,
      "theme_color"      => theme_color,
      "orientation"      => orientation,
      "icons"            => build_icon_list(pwa),
      "categories"       => ["social", "productivity"],
      "shortcuts" => [
        %{"name" => "Feed",     "url" => "/feed",    "description" => "View the latest posts"},
        %{"name" => "New Post", "url" => "/compose", "description" => "Create a new post"}
      ]
    }

    conn
    |> put_resp_content_type("application/manifest+json")
    |> json(manifest)
  end

  # ---------------------------------------------------------------------------
  # Private — VAPID key generation
  #
  # VAPID requires an uncompressed EC P-256 public key: 65 bytes (0x04 | x | y)
  # encoded as URL-safe base64 without padding per RFC 8292.
  # :crypto.generate_key(:ecdh, :prime256v1) returns the key in that format.
  # ---------------------------------------------------------------------------

  defp generate_vapid_keys do
    try do
      {public_key, private_key} = :crypto.generate_key(:ecdh, :prime256v1)
      {:ok, Base.url_encode64(public_key, padding: false),
            Base.url_encode64(private_key, padding: false)}
    rescue
      e -> {:error, Exception.message(e)}
    end
  end

  # ---------------------------------------------------------------------------
  # Private — icon generation
  # ---------------------------------------------------------------------------

  @icon_sizes [512, 384, 192, 180, 144, 96, 48]

  defp generate_icons(%Plug.Upload{path: tmp_path, content_type: content_type}) do
    allowed = ~w(image/jpeg image/png image/webp)
    # Use content_type from the upload struct — Plug writes temp files without
    # extensions so MIME.from_path always returns application/octet-stream.
    mime = content_type || "application/octet-stream"

    if mime not in allowed do
      {:error, "Source must be JPEG, PNG, or WebP. Received: #{mime}"}
    else
      dir = icons_dir()
      File.mkdir_p!(dir)

      serve_base = icons_serve_base()

      with {:ok, src} <- Image.open(tmp_path),
           {:ok, src} <- autorotate(src) do
        Enum.reduce_while(@icon_sizes, {:ok, %{}}, fn size, {:ok, acc} ->
          abs_path  = Path.join(dir, "icon-#{size}.png")
          serve_url = "#{serve_base}/icon-#{size}.png"

          case resize_square(src, size, abs_path) do
            :ok ->
              {:cont, {:ok, Map.put(acc, "icon_#{size}_path", serve_url)}}

            {:error, reason} ->
              {:halt, {:error, "Failed to write #{size}×#{size}: #{reason}"}}
          end
        end)
      else
        {:error, reason} -> {:error, "Could not open source image: #{inspect(reason)}"}
      end
    end
  end

  defp resize_square(image, size, abs_path) do
    with {:ok, resized} <- Image.thumbnail(image, size, fit: :cover),
         {:ok, _}       <- Image.write(resized, abs_path, suffix: ".png") do
      :ok
    else
      {:error, reason} -> {:error, inspect(reason)}
    end
  end

  # ---------------------------------------------------------------------------
  # Private — badge
  # ---------------------------------------------------------------------------

  defp save_badge(%Plug.Upload{path: tmp_path}) do
    dir = icons_dir()
    File.mkdir_p!(dir)

    with {:ok, img}     <- Image.open(tmp_path),
         {:ok, resized} <- Image.thumbnail(img, 96, fit: :cover),
         {:ok, _}       <- Image.write(resized, Path.join(dir, "badge.png"), suffix: ".png") do
      {:ok, "#{icons_serve_base()}/badge.png"}
    else
      {:error, reason} -> {:error, "Badge processing failed: #{inspect(reason)}"}
    end
  end

  # ---------------------------------------------------------------------------
  # Private — helpers
  # ---------------------------------------------------------------------------

  # Dev: priv/static/images/pwa/ — served by Plug.Static at "/" → URL prefix /images/pwa
  # Prod: /app/uploads/pwa-icons/ — served by Plug.Static at "/uploads" → URL prefix /uploads/pwa-icons
  defp icons_dir do
    case Application.get_env(:nexus, :env) do
      :prod -> "/app/uploads/pwa-icons"
      _     -> Path.join([:code.priv_dir(:nexus), "static", "images", "pwa"])
    end
  end

  defp icons_serve_base do
    case Application.get_env(:nexus, :env) do
      :prod -> "/uploads/pwa-icons"
      _     -> "/images/pwa"
    end
  end

  defp build_icon_list(pwa) do
    configured =
      Enum.flat_map(@icon_sizes, fn size ->
        case pwa["icon_#{size}_path"] do
          nil  -> []
          path ->
            [%{"src" => path, "sizes" => "#{size}x#{size}",
               "type" => "image/png", "purpose" => "any maskable"}]
        end
      end)

    if configured == [] do
      [%{"src" => "/images/icon-192.png", "sizes" => "192x192",
         "type" => "image/png", "purpose" => "any maskable"}]
    else
      configured
    end
  end

  defp autorotate(image) do
    case Image.autorotate(image) do
      {:ok, {rotated, _keywords}} -> {:ok, rotated}
      {:error, _}                 -> {:ok, image}
    end
  end

  defp clear_push_subscriptions do
    alias Nexus.Accounts.PushSubscription

    {count, _} = Repo.delete_all(PushSubscription)
    count
  end
end
