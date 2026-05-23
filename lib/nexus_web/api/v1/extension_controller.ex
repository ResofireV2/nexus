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

  # GET /api/v1/admin/extensions/:slug/runtime
  #
  # Returns what the in-memory Registry currently knows about a slug:
  # which module is loaded, which hooks/slots/routes/digest_sections are
  # registered. Useful for the admin UI to verify that an extension's
  # registrations went through and to debug "I'm sure I registered that"
  # situations.
  #
  # GET /api/v1/admin/extensions/:slug/runtime
  #
  # Returns the runtime-introspection payload the admin runtime panel uses to
  # show what the extension actually has loaded into the VM right now AND
  # what its manifest declared. The two halves are compared in the UI to
  # surface mismatches:
  #
  #   * `runtime.declared` — the validated normalized manifest as stored in
  #     :nexus_ext_declared at load time. Source of truth for what the
  #     extension promised.
  #
  #   * `runtime.module`, `runtime.hooks`, `runtime.slots`, `runtime.routes`,
  #     `runtime.digest_sections` — what the registry actually has registered.
  #     `runtime.module` is the resolved Elixir module name. The lists are
  #     populated from the ETS registry tables.
  #
  # Note: the DB row is the source of truth for whether the extension is
  # *installed*, while the Registry is the source of truth for whether
  # it's currently *loaded into the VM*. They can disagree if a compile
  # failed after the row was inserted. We 404 only when there is no DB
  # row at all; if the row exists but the Registry has no module, we
  # return the runtime payload with module=nil and empty lists so the UI
  # can show "installed but not loaded".
  def runtime(conn, %{"slug" => slug}) do
    case Extensions.get_extension_by_slug(slug) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "Extension not found"})

      _ext ->
        info = Nexus.Extensions.Registry.runtime_info(slug)
        declared = Nexus.Extensions.Registry.get_declared(slug)

        json(conn, %{runtime: %{
          # `module` from the registry is an atom (or nil). Inspect it for
          # JSON-safe transport; the UI just displays it as a string.
          module:          info.module && inspect(info.module),
          hooks:           info.hooks,
          routes:          info.routes,
          digest_sections: info.digest_sections,
          declared:        declared,
        }})
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
        case Extensions.uninstall_extension(ext) do
          {:ok, %{warnings: warnings}} ->
            # Piece 5: surface any warnings from the uninstall process.
            # The extension is gone either way — these are informational
            # so the admin knows if cleanup wasn't perfectly clean.
            json(conn, %{ok: true, warnings: warnings})

          {:ok, _} ->
            json(conn, %{ok: true, warnings: []})

          {:error, reason} ->
            conn |> put_status(:unprocessable_entity) |> json(%{error: inspect(reason)})
        end
    end
  end

  def sync_manifest(conn, %{"slug" => slug}) do
    case Extensions.get_extension_by_slug(slug) do
      nil -> conn |> put_status(:not_found) |> json(%{error: "Extension not found"})
      ext ->
        case Extensions.sync_manifest(ext) do
          {:ok, updated} -> json(conn, %{extension: extension_json(updated)})
          {:error, reason} -> conn |> put_status(:unprocessable_entity) |> json(%{error: reason})
        end
    end
  end

  # GET /api/v1/admin/extensions/slot-contracts
  #
  # Returns the declared slot contracts — what slots exist, what they're
  # for, and what props each slot's registered components receive.
  # Sourced from Nexus.Extensions.SlotContracts. Surfaced in the admin
  # runtime panel so extension authors can see slot signatures alongside
  # other manifest-declared surfaces.
  def slot_contracts(conn, _params) do
    json(conn, %{contracts: Nexus.Extensions.SlotContracts.all()})
  end

  # GET /api/v1/admin/extensions/hook-contracts
  #
  # Returns the declared hook contracts — what events Nexus fires, when
  # each fires, and what payload each event carries. Sourced from
  # Nexus.Extensions.HookContracts. Surfaced in the admin runtime panel
  # so extension authors can see the contract for every hook their
  # extension subscribes to, including the exact payload shape they'll
  # receive in handle_event/3.
  def hook_contracts(conn, _params) do
    json(conn, %{contracts: Nexus.Extensions.HookContracts.all()})
  end

  # POST /api/v1/admin/extensions/check-updates
  def check_updates(conn, _params) do
    token = Nexus.Extensions.GitHub.get_token()
    unless token do
      conn
      |> put_status(:unprocessable_entity)
      |> json(%{error: "No GitHub token configured. Add one in Admin → Settings → Integrations."})
    else
      updates = Extensions.check_for_updates()
      json(conn, %{updates: updates})
    end
  end

  # POST /api/v1/admin/extensions/:slug/update
  def update_extension(conn, %{"slug" => slug}) do
    token = Nexus.Extensions.GitHub.get_token()
    unless token do
      conn
      |> put_status(:unprocessable_entity)
      |> json(%{error: "No GitHub token configured. Add one in Admin → Settings → Integrations."})
    else
      case Extensions.get_extension_by_slug(slug) do
        nil -> conn |> put_status(:not_found) |> json(%{error: "Extension not found"})
        ext ->
          case Extensions.update_extension_from_release(ext) do
            {:ok, updated} ->
              json(conn, %{extension: extension_json(updated)})
            {:error, reason} ->
              conn |> put_status(:unprocessable_entity) |> json(%{error: reason})
          end
      end
    end
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
      js_bundle_url:  ext.js_bundle_url,
      manifest_url:   ext.manifest_url,
      logo_url:           manifest["logo_url"],
      banner_url:         manifest["banner_url"],
      github_repo:        ext.github_repo,
      installed_version:  ext.installed_version,
      latest_version:     ext.latest_version,
      release_notes:      ext.release_notes,
      # Load status — populated by the loader / install flow. The admin UI
      # uses these to show a status badge and inline error message per card.
      load_status:        ext.load_status,
      load_error:         ext.load_error,
      loaded_at:          ext.loaded_at,
      # Expose schema so admin UI can render settings forms automatically
      settings_schema: manifest["settings_schema"] || %{},
      settings_tabs:   manifest["settings_tabs"]   || [],
    }
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", if(is_binary(v), do: v, else: inspect(v))) end)
    end)
  end
end
