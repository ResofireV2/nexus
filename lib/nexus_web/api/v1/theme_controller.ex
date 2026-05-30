defmodule NexusWeb.API.V1.ThemeController do
  use NexusWeb, :controller

  alias Nexus.Themes

  # GET /api/v1/themes  (public — for theme showcase extensions)
  def index(conn, _params) do
    themes = Themes.list_themes()
    json(conn, %{themes: Enum.map(themes, &theme_json/1)})
  end

  # GET /api/v1/admin/themes
  def admin_index(conn, _params) do
    themes = Themes.list_themes()
    json(conn, %{themes: Enum.map(themes, &theme_json/1)})
  end

  # POST /api/v1/admin/themes/install-from-url
  def install_from_url(conn, %{"url" => url}) do
    case Themes.install_theme_from_url(url) do
      {:ok, theme} ->
        conn |> put_status(:created) |> json(%{theme: theme_json(theme)})

      {:error, reason} when is_binary(reason) ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: reason})

      {:error, changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
    end
  end

  # POST /api/v1/admin/themes/:slug/update
  def update_theme(conn, %{"slug" => slug}) do
    case Themes.get_theme_by_slug(slug) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "Theme not found"})

      theme ->
        case Themes.update_theme(theme) do
          {:ok, :already_up_to_date} ->
            json(conn, %{ok: true, message: "Already up to date"})

          {:ok, updated} ->
            json(conn, %{ok: true, theme: theme_json(updated)})

          {:error, reason} ->
            conn |> put_status(:unprocessable_entity) |> json(%{error: reason})
        end
    end
  end

  # POST /api/v1/admin/themes/:slug/activate
  # Assigns the theme to a mode. Body: {mode: "dark" | "light" | "both" | "none"}
  def activate(conn, %{"slug" => slug, "mode" => mode_str}) do
    case Themes.get_theme_by_slug(slug) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "Theme not found"})

      theme ->
        result =
          case mode_str do
            "dark"  -> Themes.set_active(theme, :dark)
            "light" -> Themes.set_active(theme, :light)
            "both"  -> Themes.set_active(theme, :both)
            "none"  -> Themes.deactivate(theme, :both)
            _       -> {:error, "mode must be dark, light, both, or none"}
          end

        case result do
          {:ok, updated} ->
            json(conn, %{ok: true, theme: theme_json(updated)})

          {:error, reason} when is_binary(reason) ->
            conn |> put_status(:unprocessable_entity) |> json(%{error: reason})
        end
    end
  end

  # PATCH /api/v1/admin/themes/:slug/settings
  def update_settings(conn, %{"slug" => slug, "settings" => settings}) do
    case Themes.get_theme_by_slug(slug) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "Theme not found"})

      theme ->
        case Themes.update_theme_settings(theme, settings) do
          {:ok, updated} -> json(conn, %{theme: theme_json(updated)})
          {:error, cs}   -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
        end
    end
  end

  # POST /api/v1/admin/themes/:slug/check-update
  def check_update(conn, %{"slug" => slug}) do
    case Themes.get_theme_by_slug(slug) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "Theme not found"})

      theme ->
        case Themes.check_for_update(theme) do
          {:ok, updated} -> json(conn, %{theme: theme_json(updated)})
          {:error, _}    -> json(conn, %{theme: theme_json(theme)})
        end
    end
  end

  # DELETE /api/v1/admin/themes/:slug
  def uninstall(conn, %{"slug" => slug}) do
    case Themes.get_theme_by_slug(slug) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "Theme not found"})

      theme ->
        case Themes.uninstall_theme(theme) do
          {:ok, _}       -> json(conn, %{ok: true})
          {:error, reason} -> conn |> put_status(:unprocessable_entity) |> json(%{error: inspect(reason)})
        end
    end
  end

  # ---------------------------------------------------------------------------
  # Serializer
  # ---------------------------------------------------------------------------

  def theme_json(%Themes.Theme{} = t) do
    %{
      id:                t.id,
      name:              t.name,
      slug:              t.slug,
      version:           t.version,
      description:       t.description,
      author:            t.author,
      homepage:          t.homepage,
      github_repo:       t.github_repo,
      installed_version: t.installed_version,
      latest_version:    t.latest_version,
      release_notes:     t.release_notes,
      manifest:          t.manifest,
      stylesheet_url:    stylesheet_url(t.stylesheet_path),
      settings:          t.settings,
      active_dark:       t.active_dark,
      active_light:      t.active_light,
      has_update:        has_update?(t),
      inserted_at:       t.inserted_at
    }
  end

  defp stylesheet_url(nil),  do: nil
  defp stylesheet_url(path), do: "/uploads/#{path}"

  defp has_update?(%{installed_version: iv, latest_version: lv})
    when is_binary(iv) and is_binary(lv), do: lv != iv
  defp has_update?(_), do: false

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc ->
        String.replace(acc, "%{#{k}}", if(is_binary(v), do: v, else: inspect(v)))
      end)
    end)
  end
end
