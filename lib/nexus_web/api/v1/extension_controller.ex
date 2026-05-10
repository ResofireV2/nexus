defmodule NexusWeb.API.V1.ExtensionController do
  use NexusWeb, :controller

  alias Nexus.Extensions

  # GET /api/v1/admin/extensions
  def index(conn, _params) do
    extensions = Extensions.list_extensions()
    json(conn, %{extensions: Enum.map(extensions, &extension_json/1)})
  end

  # GET /api/v1/admin/extensions/:slug
  def show(conn, %{"slug" => slug}) do
    case Extensions.get_extension_by_slug(slug) do
      nil -> conn |> put_status(:not_found) |> json(%{error: "Extension not found"})
      ext -> json(conn, %{extension: extension_json(ext)})
    end
  end

  # POST /api/v1/admin/extensions
  # Installs from a raw manifest map (used by the store one-click install)
  def install(conn, params) do
    case Extensions.install_extension(params) do
      {:ok, ext} ->
        conn |> put_status(:created) |> json(%{extension: extension_json(ext)})

      {:error, changeset} when is_struct(changeset, Ecto.Changeset) ->
        conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})

      {:error, reason} when is_binary(reason) ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: reason})
    end
  end

  # POST /api/v1/admin/extensions/install-from-url
  # Installs from a GitHub URL or any direct manifest.json URL
  def install_from_url(conn, %{"url" => url}) do
    case Extensions.install_from_url(url) do
      {:ok, ext} ->
        conn |> put_status(:created) |> json(%{extension: extension_json(ext)})

      {:error, reason} ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: reason})
    end
  end

  # GET /api/v1/admin/extensions/store
  # Fetches the community extension registry
  def store(conn, params) do
    registry_url = params["registry_url"]

    result =
      if registry_url && registry_url != "" do
        Extensions.fetch_store(registry_url)
      else
        Extensions.fetch_store()
      end

    case result do
      {:ok, entries}  -> json(conn, %{extensions: entries})
      {:error, reason} -> conn |> put_status(:bad_gateway) |> json(%{error: reason})
    end
  end

  # POST /api/v1/admin/extensions/:slug/toggle
  def toggle(conn, %{"slug" => slug}) do
    case Extensions.get_extension_by_slug(slug) do
      nil -> conn |> put_status(:not_found) |> json(%{error: "Extension not found"})
      ext ->
        case Extensions.toggle_extension(ext) do
          {:ok, updated} -> json(conn, %{extension: extension_json(updated)})
          {:error, cs}   -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
        end
    end
  end

  # PATCH /api/v1/admin/extensions/:slug/settings
  def update_settings(conn, %{"slug" => slug, "settings" => settings}) do
    case Extensions.get_extension_by_slug(slug) do
      nil -> conn |> put_status(:not_found) |> json(%{error: "Extension not found"})
      ext ->
        case Extensions.update_extension_settings(ext, settings) do
          {:ok, updated} -> json(conn, %{extension: extension_json(updated)})
          {:error, cs}   -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
        end
    end
  end

  # DELETE /api/v1/admin/extensions/:slug
  def uninstall(conn, %{"slug" => slug}) do
    case Extensions.get_extension_by_slug(slug) do
      nil -> conn |> put_status(:not_found) |> json(%{error: "Extension not found"})
      ext ->
        {:ok, _} = Extensions.uninstall_extension(ext)
        json(conn, %{ok: true})
    end
  end

  # GET /api/v1/slots/:slot  (public — no auth required)
  def slots(conn, %{"slot" => slot}) do
    components = Extensions.slots_for(slot)
    json(conn, %{slot: slot, components: components})
  end

  # GET /api/v1/slots/all  (public — returns all unique JS bundle URLs for enabled extensions)
  def slots_all(conn, _params) do
    bundles =
      Extensions.list_extensions()
      |> Enum.filter(& &1.enabled && &1.js_bundle_url)
      |> Enum.map(& &1.js_bundle_url)
      |> Enum.uniq()

    json(conn, %{bundles: bundles})
  end

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------

  defp extension_json(ext) do
    manifest = ext.manifest || %{}

    %{
      id:             ext.id,
      name:           ext.name,
      slug:           ext.slug,
      version:        ext.version,
      description:    ext.description,
      author:         ext.author,
      homepage:       ext.homepage,
      enabled:        ext.enabled,
      settings:       ext.settings,
      webhook_url:    ext.webhook_url,
      js_bundle_url:  ext.js_bundle_url,
      manifest_url:   ext.manifest_url,
      service_url:    ext.service_url,
      # Never expose proxy_secret to the frontend
      # Expose schema so admin UI can render settings forms automatically
      settings_schema: manifest["settings_schema"] || %{},
      settings_tabs:   manifest["settings_tabs"]   || [],
      hooks: Enum.map(ext.hooks, fn h ->
        %{id: h.id, event: h.event, handler: h.handler, priority: h.priority, enabled: h.enabled}
      end),
      slots: Enum.map(ext.slots, fn s ->
        %{id: s.id, slot: s.slot, component: s.component, priority: s.priority, enabled: s.enabled}
      end)
    }
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", to_string(v)) end)
    end)
  end
end
