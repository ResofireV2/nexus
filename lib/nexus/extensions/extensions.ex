defmodule Nexus.Extensions do
  @moduledoc """
  The Extensions context. Manages installed extensions and dispatches events
  to their in-VM handlers.

  Extensions are installed from a GitHub release tarball referenced by a
  manifest.json. Nexus compiles the extension's source into the running VM,
  runs its migrations, starts its child processes, and registers its hooks,
  slots, routes, and digest sections in an ETS-backed registry. Event hooks
  are direct function calls into the loaded module — there is no HTTP, no
  serialization, and no separate service to deploy.

  Frontend slots are loaded from the extension's JS bundle (served out of
  the extension's `priv/static/`) at runtime in the browser.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Extensions.Extension

  # ---------------------------------------------------------------------------
  # Well-known hook events
  # ---------------------------------------------------------------------------

  @hook_events ~w(
    post_created
    post_updated
    post_deleted
    reply_created
    user_registered
    user_login
    reaction_added
    report_created
  )

  def hook_events, do: @hook_events

  # ---------------------------------------------------------------------------
  # Well-known UI slots
  # ---------------------------------------------------------------------------

  @ui_slots ~w(
    feed_top
    feed_bottom
    feed_sidebar
    post_header
    post_footer
    post_sidebar
    reply_footer
    profile_header
    profile_sidebar
    nav_top
    nav_bottom
    admin_sidebar
  )

  def ui_slots, do: @ui_slots

  # ---------------------------------------------------------------------------
  # Extension CRUD
  # ---------------------------------------------------------------------------

  def list_extensions do
    Extension
    |> order_by([e], [asc: e.name])
    |> Repo.all()
  end

  def get_extension(id), do: Repo.get(Extension, id)

  def get_extension_by_slug(slug), do: Repo.get_by(Extension, slug: slug)

  @doc """
  Loads all enabled extensions from the DB into the VM on startup.
  Called once by Application after the supervision tree is running.
  """
  def load_all_enabled do
    require Logger

    enabled = from(e in Extension, where: e.enabled == true) |> Repo.all()
    Logger.info("Extensions: loading #{length(enabled)} enabled extension(s)")

    for ext <- enabled do
      case build_tarball_url(ext) do
        {:ok, url} ->
          case Nexus.Extensions.Loader.load_from_url(url, ext.slug) do
            {:ok, _module} ->
              Logger.info("Extensions: loaded #{ext.slug}")
              set_load_status(ext.slug, "loaded")
            {:error, _} = err ->
              {status, message} = load_error_to_status(err)
              Logger.error("Extensions: failed to load #{ext.slug}: #{message}")
              set_load_status(ext.slug, status, message)
          end

        {:error, reason} ->
          Logger.warning("Extensions: cannot determine tarball URL for #{ext.slug}: #{reason}")
          # build_tarball_url failures are always release-or-repo problems —
          # see its implementation. Use no_release when github_repo is set,
          # no_repo otherwise.
          status = if ext.github_repo, do: "no_release", else: "no_repo"
          set_load_status(ext.slug, status, to_string(reason))
      end
    end
  end

  def install_extension(attrs) do
    # Store settings_schema, settings_tabs, logo_url and banner_url inside the manifest field
    # so extension_json can read them back without needing extra DB columns.
    manifest = %{
      "settings_schema" => Map.get(attrs, "settings_schema", %{}),
      "settings_tabs"   => Map.get(attrs, "settings_tabs", []),
      "logo_url"        => Map.get(attrs, "logo_url"),
      "banner_url"      => Map.get(attrs, "banner_url"),
    }

    ext_attrs =
      attrs
      |> Map.drop(["hooks", "slots", "settings_schema", "settings_tabs"])
      |> Map.put("manifest", manifest)
      # Start every new row in a known load state. install_from_url overwrites
      # this immediately after the loader returns; direct callers of
      # install_extension/1 (e.g. the store one-click install path) leave it
      # at "not_loaded" so the admin UI shows that clearly until something
      # else triggers a load.
      |> Map.put("load_status", "not_loaded")

    %Extension{} |> Extension.changeset(ext_attrs) |> Repo.insert()
  end

  def uninstall_extension(%Extension{} = ext) do
    module = Nexus.Extensions.Registry.get_module(ext.slug)

    # Call on_uninstall before removing anything
    if module && function_exported?(module, :on_uninstall, 0) do
      try do
        module.on_uninstall()
      rescue
        e ->
          require Logger
          Logger.error("on_uninstall/0 raised for #{ext.slug}: #{inspect(e)}")
      end
    end

    # Roll back database migrations
    if module do
      Nexus.Extensions.Loader.rollback_migrations(module)
    end

    # Unload from VM
    if module do
      Nexus.Extensions.Loader.unload(ext.slug, module)
    end

    # Delete extension files
    Nexus.Extensions.Storage.delete_all(ext.slug)

    # Remove DB record
    result = Repo.delete(ext)

    # Clean up any layout config entries registered by this extension.
    # explore_items, right_widgets, and toolbar entries with _ext flag
    # matching this slug are removed from the saved layout settings.
    purge_from_layout(ext.slug)

    result
  end

  # Removes all layout entries that belong to the uninstalled extension.
  # Extension items have an "ext_slug" key or an id prefixed with the slug.
  defp purge_from_layout(slug) do
    layout = Nexus.Admin.get_setting("layout") || %{}

    cleaned = layout
      |> maybe_filter_layout_list("explore_items", slug)
      |> maybe_filter_layout_list("right_widgets", slug)
      |> maybe_filter_layout_list("toolbar", slug)

    if cleaned != layout do
      Nexus.Admin.update_setting("layout", cleaned)
    end
  end

  defp maybe_filter_layout_list(layout, key, slug) do
    case Map.get(layout, key) do
      nil  -> layout
      list ->
        filtered = Enum.reject(list, fn item ->
          ext_slug = item["ext_slug"] || item[:ext_slug]
          item_id  = to_string(item["id"] || item[:id] || "")
          ext_slug == slug || String.starts_with?(item_id, "#{slug}-") || String.starts_with?(item_id, "#{slug}_")
        end)
        Map.put(layout, key, filtered)
    end
  end

  def sync_manifest(%Extension{manifest_url: nil}), do: {:error, "No manifest URL stored for this extension"}
  def sync_manifest(%Extension{} = ext) do
    raw_url = to_raw_manifest_url(ext.manifest_url)

    with {:ok, %{status: 200, body: body}} <- Req.get(raw_url, receive_timeout: 10_000),
         {:ok, raw_manifest}               <- parse_manifest(body),
         {:ok, manifest}                   <- validate_manifest(raw_manifest) do

      # Fields we allow the manifest to update on sync — settings and slug are excluded
      # intentionally: settings are admin-managed, slug changes would break installs.
      github_repo = Nexus.Extensions.GitHub.repo_from_url(ext.manifest_url) || ext.github_repo

      update_attrs = %{
        "name"          => manifest["name"],
        "version"       => ext.version,
        "description"   => manifest["description"],
        "author"        => manifest["author"],
        "homepage"      => manifest["homepage"],
        "js_bundle_url" => manifest["js_bundle_url"],
        "github_repo"   => github_repo,
        "manifest"      => Map.merge(ext.manifest || %{}, %{
          "settings_schema" => manifest["settings_schema"] || %{},
          "settings_tabs"   => manifest["settings_tabs"]   || [],
          "logo_url"        => manifest["logo_url"],
          "banner_url"      => manifest["banner_url"],
        }),
      }

      ext
      |> Extension.changeset(update_attrs)
      |> Repo.update()
    else
      {:ok, %{status: status}} ->
        {:error, "Could not fetch manifest (HTTP #{status})"}

      {:error, %{reason: reason}} ->
        {:error, "Network error: #{inspect(reason)}"}

      {:error, reason} when is_binary(reason) ->
        {:error, reason}

      {:error, reason} ->
        {:error, "Sync failed: #{inspect(reason)}"}
    end
  end

  def toggle_extension(%Extension{} = ext) do
    # Flip the enabled boolean. Loader state is not actually changed here —
    # disabling does not unload from the VM, and enabling does not reload —
    # so the new load_status is informational only: it tells the admin what
    # *will* happen on the next boot.
    with {:ok, updated} <- ext |> Extension.toggle_changeset() |> Repo.update() do
      status = if updated.enabled, do: "not_loaded", else: "disabled"
      set_load_status(updated.slug, status)
      {:ok, updated}
    end
  end

  def update_extension_settings(%Extension{} = ext, settings) do
    ext
    |> Extension.settings_changeset(settings)
    |> Repo.update()
  end

  # ---------------------------------------------------------------------------
  # Load status tracking
  # ---------------------------------------------------------------------------

  @doc """
  Records a load-status transition on the extension row identified by `slug`.

  `status` is one of the strings documented in
  `priv/repo/migrations/20260521000001_add_load_status_to_extensions.exs`.
  `error` is an optional human-readable message attached to non-success states.

  Looks the extension up by slug rather than taking a struct, because the
  loader operates from slug + module and does not always hold a fresh struct.

  Returns `{:ok, ext}` on success, `{:error, :not_found}` if no row matches,
  or `{:error, changeset}` if the update fails. Callers in the loader treat
  any error as non-fatal and log it — we never want a status update to mask
  the real load result.
  """
  def set_load_status(slug, status, error \\ nil) when is_binary(slug) and is_binary(status) do
    case Repo.get_by(Extension, slug: slug) do
      nil ->
        {:error, :not_found}

      ext ->
        ext
        |> Extension.changeset(%{
          "load_status" => status,
          "load_error"  => error,
          "loaded_at"   => DateTime.utc_now() |> DateTime.truncate(:second)
        })
        |> Repo.update()
    end
  end

  @doc """
  Maps a Loader error tuple to a `{status, message}` pair for storage.

  The Loader returns `{:error, {step, reason}}` where step is one of
  `:download | :compile | :migration | :assets | :supervisor | :registry`.
  Each step has a corresponding load_status string. `reason` is preserved as
  the human-readable message and stringified for the load_error column.
  """
  def load_error_to_status({:error, {step, reason}}) do
    status =
      case step do
        :download         -> "download_failed"
        :compile          -> "compile_failed"
        :manifest_invalid -> "manifest_invalid"   # manifest.json failed schema validation or disagreed with module exports
        :migration        -> "migration_failed"
        :assets           -> "compile_failed"   # asset copy is part of the install package — treat as a compile-time issue
        :supervisor       -> "compile_failed"   # child_specs/0 raising is an extension-code issue
        :registry         -> "compile_failed"   # registry insert should never fail; if it does, classify here
        _                 -> "compile_failed"
      end

    {status, "#{step}: #{inspect(reason)}"}
  end

  # ---------------------------------------------------------------------------
  # GitHub / URL install
  #
  # Fetches a manifest.json from a GitHub repo URL or any raw URL,
  # parses it, and installs the extension.
  #
  # Accepts URLs in these forms:
  #   https://github.com/owner/repo
  #   https://github.com/owner/repo/tree/main
  #   https://raw.githubusercontent.com/owner/repo/main/manifest.json
  # ---------------------------------------------------------------------------

  def install_from_url(url) when is_binary(url) do
    raw_url = to_raw_manifest_url(url)

    with :ok                <- Nexus.URLSafeGuard.validate(raw_url),
         {:ok, %{status: 200, body: body}} <- Req.get(raw_url, receive_timeout: 10_000),
         {:ok, raw_manifest} <- parse_manifest(body),
         {:ok, manifest}     <- validate_manifest(raw_manifest) do

      github_repo = Nexus.Extensions.GitHub.repo_from_url(url)
      token       = Nexus.Extensions.GitHub.get_token()
      slug        = manifest["slug"]

      # Get the installed version and tarball URL from GitHub Releases API.
      # We construct the tarball URL from the tag rather than using the API's
      # tarball_url field, which requires authentication even for public repos.
      {installed_version, tarball_url} =
        if github_repo do
          case Nexus.Extensions.GitHub.latest_release(github_repo, token) do
            {:ok, release} ->
              clean       = String.trim_leading(release.tag, "v")
              tarball_url = "https://github.com/#{github_repo}/archive/refs/tags/#{release.tag}.tar.gz"
              require Logger
              Logger.info("install_from_url: #{slug} tarball_url=#{tarball_url}")
              {clean, tarball_url}
            {:error, reason} ->
              require Logger
              Logger.warning("install_from_url: #{slug} latest_release failed: #{inspect(reason)}")
              {"0.0.0", nil}
          end
        else
          require Logger
          Logger.warning("install_from_url: #{slug} no github_repo derived from #{url}")
          {"0.0.0", nil}
        end

      attrs = manifest
        |> Map.merge(%{
          "manifest_url"      => url,
          "github_repo"       => github_repo,
          "version"           => installed_version,
          "installed_version" => installed_version,
        })

      with {:ok, ext} <- install_extension(attrs) do
        # Load the extension into the VM if we have a tarball URL
        if tarball_url do
          case Nexus.Extensions.Loader.load_from_url(tarball_url, slug, token) do
            {:ok, module} ->
              # Derive js_bundle_url from the loaded module.
              bundle_url =
                try do
                  path = module.js_bundle_path()
                  require Logger
                  Logger.info("install_from_url: #{slug} js_bundle_path() = #{inspect(path)}, module = #{inspect(module)}")
                  case path do
                    nil  -> nil
                    path -> "/ext/#{slug}/assets/#{path}"
                  end
                rescue
                  e ->
                    require Logger
                    Logger.error("install_from_url: js_bundle_path() raised for #{slug}: #{inspect(e)}")
                    nil
                end

              require Logger
              Logger.info("install_from_url: #{slug} bundle_url = #{inspect(bundle_url)}")

              if bundle_url do
                result = ext
                  |> Extension.changeset(%{"js_bundle_url" => bundle_url})
                  |> Repo.update()
                Logger.info("install_from_url: #{slug} bundle_url update result = #{inspect(result)}")
              end

              on_install_safe(module, ext.settings || %{})
              set_load_status(slug, "loaded")

            {:error, _} = err ->
              {status, message} = load_error_to_status(err)
              require Logger
              Logger.warning("install_from_url: saved #{slug} to DB but loader failed: #{message}")
              set_load_status(slug, status, message)
          end
        else
          # No tarball URL means we never reached the Loader. Distinguish the
          # two reasons so the admin UI can show a specific message.
          if github_repo do
            set_load_status(slug, "no_release",
              "GitHub repo #{github_repo} has no published release. " <>
              "Publish a release on GitHub (Releases → Draft a new release) and reinstall.")
          else
            set_load_status(slug, "no_repo",
              "Could not derive a GitHub repo from #{url}. " <>
              "Install from a github.com URL or set github_repo in manifest.json.")
          end
        end

        {:ok, Repo.reload!(ext)}
      end
    else
      {:ok, %{status: status}} ->
        {:error, "Could not fetch manifest (HTTP #{status}). Check the URL is correct and the repo is public."}

      {:error, %{reason: reason}} ->
        {:error, "Network error fetching manifest: #{inspect(reason)}"}

      {:error, reason} when is_binary(reason) ->
        {:error, reason}

      {:error, reason} ->
        {:error, "Failed to install extension: #{inspect(reason)}"}
    end
  end

  defp on_install_safe(module, settings) do
    if function_exported?(module, :on_install, 1) do
      try do
        module.on_install(settings)
      rescue
        e ->
          require Logger
          Logger.error("on_install/1 raised for #{module}: #{inspect(e)}")
      end
    end
  end

  defp build_tarball_url(ext) do
    cond do
      ext.github_repo && ext.installed_version ->
        tag = "v#{ext.installed_version}"
        {:ok, "https://github.com/#{ext.github_repo}/archive/refs/tags/#{tag}.tar.gz"}

      ext.github_repo ->
        token = Nexus.Extensions.GitHub.get_token()
        case Nexus.Extensions.GitHub.latest_release(ext.github_repo, token) do
          {:ok, %{tag: tag}} ->
            {:ok, "https://github.com/#{ext.github_repo}/archive/refs/tags/#{tag}.tar.gz"}
          {:error, reason} ->
            {:error, reason}
        end

      true ->
        {:error, "No github_repo configured for #{ext.slug}"}
    end
  end

  # ---------------------------------------------------------------------------
  # GitHub update checking
  # ---------------------------------------------------------------------------

  @doc """
  Checks all installed extensions with a github_repo for available updates.
  Returns a list of maps for extensions that have a newer release available:
    %{extension: ext, current: "v0.2.0", latest: "v0.3.0", notes: "markdown"}
  """
  def check_for_updates do
    token = Nexus.Extensions.GitHub.get_token()

    list_extensions()
    |> Enum.filter(& &1.github_repo)
    |> Enum.map(fn ext ->
      case Nexus.Extensions.GitHub.latest_release(ext.github_repo, token) do
        {:ok, release} ->
          current = ext.installed_version || ext.version
          latest  = String.trim_leading(release.tag, "v")

          # Store the latest version and release notes on the extension record
          ext
          |> Extension.changeset(%{"latest_version" => latest, "release_notes" => release.body})
          |> Repo.update()

          if latest != current do
            %{
              slug:     ext.slug,
              name:     ext.name,
              current:  current,
              latest:   latest,
              notes:    release.body,
            }
          else
            nil
          end

        {:error, :no_release} ->
          nil

        {:error, reason} ->
          require Logger
          Logger.warning("Update check failed for #{ext.slug}: #{inspect(reason)}")
          nil
      end
    end)
    |> Enum.reject(&is_nil/1)
  end

  @doc """
  Updates an installed extension to the latest GitHub release.
  Fetches the manifest at the release tag, syncs all fields, and updates
  installed_version.
  """
  def update_extension_from_release(%Extension{github_repo: nil}),
    do: {:error, "Extension has no GitHub repo configured"}

  def update_extension_from_release(%Extension{} = ext) do
    token = Nexus.Extensions.GitHub.get_token()

    with {:ok, release}      <- Nexus.Extensions.GitHub.latest_release(ext.github_repo, token),
         {:ok, raw_manifest} <- Nexus.Extensions.GitHub.manifest_at_tag(ext.github_repo, release.tag, token),
         {:ok, manifest}     <- validate_manifest(raw_manifest) do

      # Strip leading "v" from the tag so version strings are consistent.
      # e.g. "v0.2.0" → "0.2.0" — the UI adds "v" prefix for display.
      clean_tag = String.trim_leading(release.tag, "v")

      update_attrs = %{
        "name"              => manifest["name"],
        "version"           => clean_tag,
        "description"       => manifest["description"],
        "author"            => manifest["author"],
        "homepage"          => manifest["homepage"],
        "js_bundle_url"     => manifest["js_bundle_url"],
        "installed_version" => clean_tag,
        "latest_version"    => clean_tag,
        "release_notes"     => release.body,
        "manifest"          => Map.merge(ext.manifest || %{}, %{
          "settings_schema" => manifest["settings_schema"] || %{},
          "settings_tabs"   => manifest["settings_tabs"]   || [],
          "logo_url"        => manifest["logo_url"],
          "banner_url"      => manifest["banner_url"],
        }),
      }

      tarball_url = "https://github.com/#{ext.github_repo}/archive/refs/tags/#{release.tag}.tar.gz"
      old_module  = Nexus.Extensions.Registry.get_module(ext.slug)

      with {:ok, updated} <- ext |> Extension.changeset(update_attrs) |> Repo.update() do
        # Reload the extension in the VM — stop old, compile new, restart
        case Nexus.Extensions.Loader.reload(tarball_url, ext.slug, old_module, token) do
          {:ok, new_module} ->
            # Update bundle URL from reloaded module
            bundle_url =
              if function_exported?(new_module, :js_bundle_path, 0) do
                case new_module.js_bundle_path() do
                  nil  -> nil
                  path -> "/ext/#{ext.slug}/assets/#{path}"
                end
              end

            if bundle_url do
              updated
              |> Extension.changeset(%{"js_bundle_url" => bundle_url})
              |> Repo.update()
            end

            # Call on_update lifecycle callback
            if function_exported?(new_module, :on_update, 2) do
              Task.start(fn ->
                try do
                  new_module.on_update(ext.installed_version || "0.0.0", clean_tag)
                rescue
                  e ->
                    require Logger
                    Logger.error("on_update/2 raised for #{ext.slug}: #{inspect(e)}")
                end
              end)
            end

            set_load_status(ext.slug, "loaded")

          {:error, _} = err ->
            {status, message} = load_error_to_status(err)
            require Logger
            Logger.error("Failed to reload #{ext.slug} after update: #{message}")
            set_load_status(ext.slug, status, message)
        end

        {:ok, updated}
      end
    end
  end



  # ---------------------------------------------------------------------------
  # Store — fetch the community registry
  # ---------------------------------------------------------------------------

  @registry_url "https://raw.githubusercontent.com/ResofireV2/nexus-extensions/main/registry.json"

  def fetch_store(registry_url \\ @registry_url) do
    with :ok <- Nexus.URLSafeGuard.validate(registry_url) do
    case Req.get(registry_url, receive_timeout: 15_000, decode_body: false) do
      {:ok, %{status: 200, body: body}} ->
        # body is always a raw binary since we set decode_body: false
        entries =
          case Jason.decode(body) do
            {:ok, %{"extensions" => list}} when is_list(list) -> list
            {:ok, list} when is_list(list) -> list
            {:ok, inner} when is_binary(inner) ->
              case Jason.decode(inner) do
                {:ok, %{"extensions" => list}} when is_list(list) -> list
                {:ok, list} when is_list(list) -> list
                _ -> :decode_error
              end
            {:ok, _}    -> []
            {:error, e} ->
              require Logger
              Logger.error("fetch_store JSON decode error: #{inspect(e)}\nbody: #{String.slice(body, 0, 200)}")
              :decode_error
          end

        case entries do
          :decode_error ->
            {:error, "The registry returned invalid JSON. Try again later."}
          entries ->
            installed_slugs =
              Repo.all(from e in Extension, select: e.slug)
              |> MapSet.new()

            enriched =
              Enum.map(entries, fn entry ->
                Map.put(entry, "installed", MapSet.member?(installed_slugs, entry["slug"]))
              end)

            {:ok, enriched}
        end

      {:ok, %{status: status, body: body}} ->
        require Logger
        Logger.error("fetch_store HTTP #{status}: #{String.slice(to_string(body), 0, 200)}")
        {:error, "Registry returned HTTP #{status}"}

      {:error, reason} ->
        require Logger
        Logger.error("fetch_store network error: #{inspect(reason)}")
        {:error, "Could not reach registry: #{inspect(reason)}"}
    end
    else
      {:error, reason} -> {:error, "Invalid registry URL: #{reason}"}
    end
  end

  # ---------------------------------------------------------------------------
  # Hook dispatch — in-VM
  #
  # Fires an event to all enabled extensions subscribed to it. Each call is
  # a direct invocation of the extension's handle_event/3 callback, run in a
  # supervised Task so a crashing extension can't affect the caller or other
  # extensions. No HTTP, no serialization.
  # ---------------------------------------------------------------------------

  def fire(event, payload \\ %{}) when event in @hook_events do
    for {slug, module} <- Nexus.Extensions.Registry.hooks_for(event) do
      ext = get_extension_by_slug(slug)
      settings = if ext, do: ext.settings || %{}, else: %{}

      Task.start(fn ->
        try do
          module.handle_event(event, payload, settings)
        rescue
          e ->
            require Logger
            Logger.error("Extension #{slug} raised in handle_event(#{event}): #{inspect(e)}")
        end
      end)
    end

    :ok
  end

  def fire(_event, _payload), do: :ok

  # ---------------------------------------------------------------------------
  # Slot lookup
  # ---------------------------------------------------------------------------

  def slots_for(slot_name) when slot_name in @ui_slots do
    Nexus.Extensions.Registry.slots_for(slot_name)
  end

  def slots_for(_), do: []

  # ---------------------------------------------------------------------------
  # Private — manifest helpers
  # ---------------------------------------------------------------------------

  defp to_raw_manifest_url(url) do
    cond do
      # Already a raw githubusercontent URL
      String.contains?(url, "raw.githubusercontent.com") ->
        url

      # GitHub repo URL — convert to raw manifest URL
      String.contains?(url, "github.com") ->
        path =
          url
          |> String.replace("https://github.com/", "")
          |> String.replace("/tree/", "/")
          |> String.trim_trailing("/")

        # If only owner/repo with no branch, append /main
        path = if length(String.split(path, "/")) == 2, do: path <> "/main", else: path

        "https://raw.githubusercontent.com/#{path}/manifest.json"

      # Assume direct URL to manifest.json
      true ->
        url
    end
  end

  defp parse_manifest(body) when is_map(body), do: {:ok, body}
  defp parse_manifest(body) when is_binary(body) do
    case Jason.decode(body) do
      {:ok, map} -> {:ok, map}
      {:error, _} -> {:error, "manifest.json is not valid JSON"}
    end
  end
  defp parse_manifest(_), do: {:error, "Unexpected manifest format"}

  # Validates a parsed manifest against the manifest_version 2 schema and
  # returns the normalized form (with defaults applied) on success. Callers
  # should consume the normalized manifest, not the raw decoded JSON — that
  # way every downstream consumer sees the same canonical shape regardless
  # of what the developer wrote in manifest.json.
  defp validate_manifest(manifest) do
    case Nexus.Extensions.ManifestSchema.validate(manifest) do
      {:ok, normalized, _warnings} ->
        # Warnings are intentionally discarded here. They are surfaced by the
        # admin runtime panel (sub-stage 7D), not at install time, because
        # they don't indicate a problem the operator can fix during install.
        {:ok, normalized}

      {:error, errors} ->
        # Concatenate up to the first 3 errors into a single message — the
        # admin UI shows one error line, so a deluge of validator messages
        # would be unhelpful. Full validation output is logged.
        require Logger
        Logger.warning("manifest validation failed: #{Enum.join(errors, "; ")}")
        summary =
          errors
          |> Enum.take(3)
          |> Enum.join("; ")
        {:error, "manifest.json is invalid: #{summary}"}
    end
  end
end
