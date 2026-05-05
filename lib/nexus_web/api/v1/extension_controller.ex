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
  def install(conn, params) do
    case Extensions.install_extension(params) do
      {:ok, ext} ->
        conn |> put_status(:created) |> json(%{extension: extension_json(ext)})

      {:error, changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
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

  # GET /api/v1/slots/:slot
  def slots(conn, %{"slot" => slot}) do
    components = Extensions.slots_for(slot)
    json(conn, %{slot: slot, components: components})
  end

  defp extension_json(ext) do
    %{
      id: ext.id,
      name: ext.name,
      slug: ext.slug,
      version: ext.version,
      description: ext.description,
      author: ext.author,
      homepage: ext.homepage,
      enabled: ext.enabled,
      settings: ext.settings,
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
