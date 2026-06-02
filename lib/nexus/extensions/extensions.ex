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

  # Canonical list of all hook events Nexus fires. MUST stay in sync with:
  #   - @known_hook_events in Nexus.Extensions.ManifestSchema
  #   - @contracts in Nexus.Extensions.HookContracts
  #
  # When adding an event, update all three locations AND wire up the fire
  # site. Nexus.Extensions.fire/2 raises on unknown events, so a fire
  # site for an event not in this list will fail loudly at runtime.
  @hook_events ~w(
    post_created
    post_updated
    post_deleted
    reply_created
    reply_deleted
    reaction_added
    reaction_removed
    report_created
    report_resolved
    user_registered
    user_login
  )

  def hook_events, do: @hook_events

  # ---------------------------------------------------------------------------
  # Well-known UI slots
  # ---------------------------------------------------------------------------

  # UI slots are positional render points in the host UI where extensions
  # can contribute components. Each name in this list MUST correspond to a
  # real `getSlot(name)` call in the host React code; advertising a slot
  # that has no render site produces phantom registrations (extensions
  # register, but nothing appears on screen).
  #
  # Per-slot contracts (purpose, render conditions, declared props) live in
  # Nexus.Extensions.SlotContracts. Both this list and that module must be
  # updated in lockstep when adding or removing a slot.
  #
  # When adding a new slot here, also:
  #   1. Add an entry to Nexus.Extensions.SlotContracts.@contracts
  #   2. Add a corresponding entry to @known_slots in manifest_schema.ex
  #   3. Add a getSlot call at the new render site in the JS, using
  #      propsForSlot to resolve declared props
  @ui_slots ~w(
    post_footer
    profile_sidebar
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
          # Pass installed_version so the loader can serve from the local
          # tarball cache on restart rather than re-downloading from GitHub.
          case Nexus.Extensions.Loader.load_from_url(url, ext.slug, nil, ext.installed_version) do
            {:ok, _module, _manifest} ->
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

  @doc """
  Inserts a new extension row from a manifest map.

  The full normalized manifest is stored in the `manifest` JSON column —
  this is the authoritative source for the extension's declared contract.
  Scalar columns (slug, name, version, description, author, homepage,
  github_repo, manifest_url, installed_version) are populated from
  matching fields in the manifest plus any install-flow extras present
  in `attrs` that the manifest itself doesn't carry.

  This function validates the manifest before doing anything else.
  Callers that have already validated (like `install_from_url/1`) pay
  the cost twice — that's fine, the validator is pure and fast — but
  every direct entry point goes through the guard.
  """
  def install_extension(attrs) do
    case Nexus.Extensions.ManifestSchema.validate(attrs) do
      {:ok, manifest, _warnings} ->
        do_install_extension(manifest, attrs)

      {:error, errors} ->
        require Logger
        Logger.warning("install_extension: manifest validation failed: #{Enum.join(errors, "; ")}")
        summary = errors |> Enum.take(3) |> Enum.join("; ")
        {:error, "manifest is invalid: #{summary}"}
    end
  end

  defp do_install_extension(manifest, attrs) do
    # The scalar DB columns are derived from the manifest. Install-flow extras
    # (manifest_url, github_repo, installed_version, js_bundle_url, version)
    # are passed through from `attrs` when present — these are populated by
    # install_from_url; direct callers that omit them get sensible defaults.
    ext_attrs = %{
      "slug"              => manifest["slug"],
      "name"              => manifest["name"],
      "version"           => attrs["version"] || manifest["version"],
      "description"       => manifest["description"],
      "author"            => manifest["author"],
      "homepage"          => manifest["homepage"],
      "github_repo"       => attrs["github_repo"],
      "manifest_url"      => attrs["manifest_url"],
      "installed_version" => attrs["installed_version"] || manifest["version"],
      "js_bundle_url"     => attrs["js_bundle_url"],
      # Store the full normalized manifest. Downstream code (loader, registry,
      # digest controller, admin UI) reads its declared contract from here
      # rather than calling legacy behaviour callbacks on the loaded module.
      "manifest"          => manifest,
      # Start every new row in a known load state. install_from_url overwrites
      # this immediately after the loader returns; direct callers of
      # install_extension/1 (e.g. the store one-click install path) leave it
      # at "not_loaded" so the admin UI shows that clearly until something
      # else triggers a load.
      "load_status"       => "not_loaded"
    }

    %Extension{} |> Extension.changeset(ext_attrs) |> Repo.insert()
  end

  def uninstall_extension(%Extension{} = ext) do
    require Logger
    module = Nexus.Extensions.Registry.get_module(ext.slug)
    warnings = []

    # Call on_uninstall before removing anything. Piece 5: capture errors
    # as warnings to surface to the admin in the uninstall response.
    warnings =
      if module && function_exported?(module, :on_uninstall, 0) do
        try do
          module.on_uninstall()
          warnings
        rescue
          e ->
            msg = "on_uninstall/0 raised: #{Exception.message(e)}"
            Logger.error("Extensions: #{ext.slug} #{msg}")
            [msg | warnings]
        end
      else
        warnings
      end

    # Piece 5: cancel any pending Oban jobs owned by this extension's
    # module namespace. Workers nested under the extension's root module
    # (e.g. Gamepedia.Workers.* for a Gamepedia extension) get cancelled.
    # Jobs already running are NOT killed — they run to completion. Jobs
    # waiting or retrying are dropped from the queue.
    warnings =
      case cancel_extension_oban_jobs(ext, module) do
        {:ok, 0}       -> warnings
        {:ok, n}       ->
          Logger.info("Extensions: cancelled #{n} Oban job(s) for #{ext.slug}")
          warnings
        {:error, msg}  ->
          Logger.warning("Extensions: failed to cancel Oban jobs for #{ext.slug}: #{msg}")
          ["Could not cancel pending Oban jobs: #{msg}" | warnings]
      end

    # Roll back database migrations
    if module do
      Nexus.Extensions.Loader.rollback_migrations(module, ext.slug)
    end

    # Unload from VM
    if module do
      Nexus.Extensions.Loader.unload(ext.slug, module)
    end

    # Delete extension files, upload DB records, and cached tarballs
    Nexus.Extensions.Storage.delete_all(ext.slug)
    Nexus.Uploads.delete_extension_uploads(ext.slug)
    Nexus.Extensions.Loader.delete_cache(ext.slug)

    # Remove DB record
    result = Repo.delete(ext)

    # Clean up any layout config entries registered by this extension.
    # explore_items, right_widgets, and toolbar entries with _ext flag
    # matching this slug are removed from the saved layout settings.
    purge_from_layout(ext.slug)

    case result do
      {:ok, _} -> {:ok, %{warnings: Enum.reverse(warnings)}}
      err      -> err
    end
  end

  @doc """
  Force-removes an extension that is stuck in a broken state and cannot be
  uninstalled through the normal flow.

  Unlike `uninstall_extension/1`, this function:
  - Does NOT call `on_uninstall/0` on the extension module
  - Does NOT roll back the extension's database migrations
  - Does NOT attempt to unload the extension module from the VM
  - Wraps all cleanup steps in try/rescue so nothing blocks the DB delete

  Use only when the normal uninstall returns a 500 or the extension record
  is otherwise stuck. The admin is responsible for manually cleaning up any
  database tables the extension created via migrations.
  """
  def force_uninstall_extension(%Extension{} = ext) do
    require Logger
    warnings = []

    # Cancel any pending Oban jobs — best-effort, ignore failures
    module = Nexus.Extensions.Registry.get_module(ext.slug)
    warnings =
      case cancel_extension_oban_jobs(ext, module) do
        {:ok, 0}      -> warnings
        {:ok, n}      -> Logger.info("Extensions: force-uninstall cancelled #{n} Oban job(s) for #{ext.slug}"); warnings
        {:error, msg} -> ["Could not cancel pending Oban jobs: #{msg}" | warnings]
      end

    # Delete extension files — best-effort
    warnings =
      try do
        Nexus.Extensions.Storage.delete_all(ext.slug)
        warnings
      rescue
        e ->
          msg = "File cleanup raised: #{Exception.message(e)}"
          Logger.warning("Extensions: force-uninstall #{ext.slug} — #{msg}")
          [msg | warnings]
      end

    # Delete upload records — best-effort
    warnings =
      try do
        Nexus.Uploads.delete_extension_uploads(ext.slug)
        warnings
      rescue
        e ->
          msg = "Upload cleanup raised: #{Exception.message(e)}"
          Logger.warning("Extensions: force-uninstall #{ext.slug} — #{msg}")
          [msg | warnings]
      end

    # Delete cached tarballs — best-effort
    warnings =
      try do
        Nexus.Extensions.Loader.delete_cache(ext.slug)
        warnings
      rescue
        e ->
          msg = "Cache cleanup raised: #{Exception.message(e)}"
          Logger.warning("Extensions: force-uninstall #{ext.slug} — #{msg}")
          [msg | warnings]
      end

    # Delete DB record — this must succeed
    case Repo.delete(ext) do
      {:ok, _} ->
        purge_from_layout(ext.slug)
        {:ok, %{warnings: Enum.reverse(warnings)}}

      {:error, reason} ->
        {:error, reason}
    end
  end
  # the extension's root module. Returns {:ok, count_cancelled} or
  # {:error, message}.
  #
  # The convention this enforces: extensions should put their Oban workers
  # under their main module's namespace, e.g. Gamepedia.Workers.FetchGame
  # for a Gamepedia extension. Workers outside this namespace are NOT
  # cleaned up — they'd survive the uninstall and crash trying to call
  # nonexistent modules on next execution.
  defp cancel_extension_oban_jobs(_ext, nil), do: {:ok, 0}
  defp cancel_extension_oban_jobs(_ext, module) do
    module_prefix = inspect(module)

    try do
      # Match any job whose worker starts with the extension's module prefix
      # (e.g. "Gamepedia" matches "Gamepedia.Workers.FetchGame"). We delete
      # available, scheduled, and retryable jobs; jobs already executing
      # are left alone (they'll run to completion against the not-yet-
      # unloaded module).
      import Ecto.Query
      query = from j in Oban.Job,
              where: like(j.worker, ^"#{module_prefix}%") and
                     j.state in ["available", "scheduled", "retryable"]

      {count, _} = Repo.delete_all(query)
      {:ok, count}
    rescue
      e -> {:error, Exception.message(e)}
    end
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

      # Derive the served js bundle URL from the manifest's relative js_bundle path.
      # The asset is copied to /ext/<slug>/assets/ at load time; here we only need
      # the URL the frontend will fetch it from.
      js_bundle_url =
        case manifest["js_bundle"] do
          nil  -> ext.js_bundle_url
          path -> "/ext/#{ext.slug}/assets/#{path}"
        end

      update_attrs = %{
        "name"          => manifest["name"],
        "version"       => ext.version,
        "description"   => manifest["description"],
        "author"        => manifest["author"],
        "homepage"      => manifest["homepage"],
        "js_bundle_url" => js_bundle_url,
        "github_repo"   => github_repo,
        # Store the full normalized manifest. This replaces the previous
        # 4-field selective merge — downstream code now reads the whole
        # declared contract (hooks, slots, routes, widgets, etc.) from here.
        "manifest"      => manifest
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

  @doc """
  Toggles an extension's enabled state with live disable/enable semantics.

  Disable: stops the extension's supervised children, sets the ETS enabled
  flag to false so every dispatch site filters the extension out, but
  leaves modules loaded so re-enable is instant.

  Enable: if modules are still loaded (the common case — extension was
  disabled in this same VM lifetime), restarts the children and clears
  the filter. If modules are not loaded (extension was disabled across
  a restart, so boot skipped loading it), triggers a fresh load.

  Returns {:ok, updated_extension}. Failures during the live state
  transition log but don't block — the DB row update is the
  source-of-truth flip, and the runtime state catches up as best it can.
  """
  def toggle_extension(%Extension{} = ext) do
    require Logger

    with {:ok, updated} <- ext |> Extension.toggle_changeset() |> Repo.update() do
      slug = updated.slug

      if updated.enabled do
        # Enabling — figure out whether modules are loaded.
        case Nexus.Extensions.Registry.get_module(slug) do
          nil ->
            # Modules not loaded (post-restart of a disabled extension).
            # Trigger a fresh load. If load fails, status reflects it.
            Logger.info("Extensions: enabling #{slug} via fresh load")
            case build_tarball_url(updated) do
              {:ok, url} ->
                token = Nexus.Extensions.GitHub.get_token()
                case Nexus.Extensions.Loader.load_from_url(url, slug, token) do
                  {:ok, _module, _manifest} ->
                    Nexus.Extensions.Registry.set_enabled(slug, true)
                    set_load_status(slug, "loaded")
                  {:error, _} = err ->
                    {status, message} = load_error_to_status(err)
                    Logger.error("Extensions: enable-load failed for #{slug}: #{message}")
                    set_load_status(slug, status, message)
                end

              {:error, reason} ->
                Logger.error("Extensions: cannot enable #{slug}: #{inspect(reason)}")
                set_load_status(slug, "no_release", inspect(reason))
            end

          module ->
            # Modules already loaded — just resume processing.
            Logger.info("Extensions: live-enabling #{slug}")
            try do
              Nexus.Extensions.ExtensionSupervisor.start_extension(slug, module)
            rescue
              e -> Logger.warning("Extensions: failed to restart supervisor for #{slug}: #{inspect(e)}")
            end
            Nexus.Extensions.Registry.set_enabled(slug, true)
            set_load_status(slug, "loaded")
        end
      else
        # Disabling — stop the supervised children and flip the dispatch
        # filter. Modules stay loaded.
        Logger.info("Extensions: live-disabling #{slug}")
        Nexus.Extensions.Registry.set_enabled(slug, false)
        try do
          Nexus.Extensions.ExtensionSupervisor.stop_extension(slug)
        rescue
          e -> Logger.warning("Extensions: failed to stop supervisor for #{slug}: #{inspect(e)}")
        end
        set_load_status(slug, "disabled")
      end

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
            {:ok, module, manifest} ->
              # Derive js_bundle_url from the validated manifest. This replaces
              # the previous module.js_bundle_path/0 callback read — the
              # manifest is now the single source of truth for what gets served.
              bundle_url =
                case manifest["js_bundle"] do
                  nil  -> nil
                  path -> "/ext/#{slug}/assets/#{path}"
                end

              require Logger
              Logger.info("install_from_url: #{slug} bundle_url = #{inspect(bundle_url)}")

              if bundle_url do
                result = ext
                  |> Extension.changeset(%{"js_bundle_url" => bundle_url})
                  |> Repo.update()
                Logger.info("install_from_url: #{slug} bundle_url update result = #{inspect(result)}")
              end

              case on_install_safe(module, ext.settings || %{}) do
                :ok ->
                  set_load_status(slug, "loaded")

                {:error, reason} ->
                  # Piece 5: on_install raised. Module is loaded, registry is
                  # populated, migrations have run — the extension is "installed"
                  # but its initialization hook failed. Surface this to the
                  # admin instead of pretending everything is fine.
                  require Logger
                  Logger.warning("install_from_url: #{slug} loaded but on_install/1 failed: #{reason}")
                  set_load_status(slug, "install_failed", reason)
              end

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
        case module.on_install(settings) do
          :ok            -> :ok
          {:ok, _}       -> :ok
          {:error, msg}  -> {:error, "on_install/1 returned error: #{inspect(msg)}"}
          other          -> {:error, "on_install/1 returned unexpected: #{inspect(other)}"}
        end
      rescue
        e ->
          require Logger
          Logger.error("on_install/1 raised for #{module}: #{inspect(e)}")
          {:error, "on_install/1 raised: #{Exception.message(e)}"}
      end
    else
      :ok
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

      # Derive js_bundle_url from the manifest's relative js_bundle path.
      js_bundle_url =
        case manifest["js_bundle"] do
          nil  -> ext.js_bundle_url
          path -> "/ext/#{ext.slug}/assets/#{path}"
        end

      update_attrs = %{
        "name"              => manifest["name"],
        "version"           => clean_tag,
        "description"       => manifest["description"],
        "author"            => manifest["author"],
        "homepage"          => manifest["homepage"],
        "js_bundle_url"     => js_bundle_url,
        "installed_version" => clean_tag,
        "latest_version"    => clean_tag,
        "release_notes"     => release.body,
        # Store the full normalized manifest — single source of truth for the
        # extension's declared contract.
        "manifest"          => manifest
      }

      tarball_url = "https://github.com/#{ext.github_repo}/archive/refs/tags/#{release.tag}.tar.gz"
      old_module  = Nexus.Extensions.Registry.get_module(ext.slug)

      with {:ok, updated} <- ext |> Extension.changeset(update_attrs) |> Repo.update() do
        # Reload the extension in the VM — stop old, compile new, restart.
        # Pass clean_tag so the loader caches the new tarball by version.
        case Nexus.Extensions.Loader.reload(tarball_url, ext.slug, old_module, token, clean_tag) do
          {:ok, new_module, reloaded_manifest} ->
            # Re-derive bundle URL from the freshly loaded manifest — if the
            # release happened to change the js_bundle path, this picks it up.
            reloaded_bundle_url =
              case reloaded_manifest["js_bundle"] do
                nil  -> nil
                path -> "/ext/#{ext.slug}/assets/#{path}"
              end

            if reloaded_bundle_url do
              updated
              |> Extension.changeset(%{"js_bundle_url" => reloaded_bundle_url})
              |> Repo.update()
            end

            # Call on_update lifecycle callback. Piece 5: synchronous about
            # error reporting — failures become "update_failed" load_status
            # instead of being silently logged. Still runs in a Task so the
            # caller's response isn't blocked by slow extensions.
            if function_exported?(new_module, :on_update, 2) do
              slug = ext.slug
              from_version = ext.installed_version || "0.0.0"
              Task.start(fn ->
                try do
                  case new_module.on_update(from_version, clean_tag) do
                    :ok      -> :ok
                    {:ok, _} -> :ok
                    other    ->
                      require Logger
                      msg = "on_update/2 returned non-ok: #{inspect(other)}"
                      Logger.warning("Extensions: #{slug} #{msg}")
                      set_load_status(slug, "update_failed", msg)
                  end
                rescue
                  e ->
                    require Logger
                    msg = "on_update/2 raised: #{Exception.message(e)}"
                    Logger.error("Extensions: #{slug} #{msg}")
                    set_load_status(slug, "update_failed", msg)
                end
              end)
            end

            # Prune stale cache entries for this slug — keep only the new
            # version. Old version tarballs are no longer needed.
            Nexus.Extensions.Loader.prune_cache(ext.slug, clean_tag)
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
            # Exclude theme-type entries — those belong in the Themes page.
            # Registry entries with type == "theme" are surfaced by the themes
            # store endpoint. Entries with no type field are extensions.
            extensions = Enum.filter(entries, fn e -> e["type"] != "theme" end)

            installed_slugs =
              Repo.all(from e in Extension, select: e.slug)
              |> MapSet.new()

            enriched =
              Enum.map(extensions, fn entry ->
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
  #
  # ## Strict contract enforcement (piece 2)
  #
  # Before dispatch, the payload is validated against the event's contract
  # in `Nexus.Extensions.HookContracts`. Two failure modes are possible:
  #
  #   1. Unknown event — raises ArgumentError. This catches typos at fire
  #      sites (e.g. "post_creates" instead of "post_created") which the
  #      old catch-all silently swallowed. Fire-site bugs surface at the
  #      first invocation, not when an admin wonders why their extension
  #      never fires.
  #
  #   2. Invalid payload — logs a warning and skips dispatch. Includes
  #      missing/extra keys and non-JSON-serializable values (DateTime,
  #      structs, PIDs, etc.). We log+skip rather than raise here because
  #      a contract violation at runtime is recoverable — extensions just
  #      don't get the event — whereas the alternative (raising in a
  #      Task) would dump a stacktrace and might crash supervised callers.
  #
  # ## How to call fire/2 safely
  #
  # Use `HookContracts.build_payload(event, ctx)` to construct the payload
  # from a context map. This guarantees the payload matches the contract.
  # Fire sites that construct payloads inline (legacy pattern) still work,
  # but the validation will catch them if they get it wrong.
  # ---------------------------------------------------------------------------

  def fire(event, payload \\ %{})

  def fire(event, payload) when is_binary(event) and is_map(payload) do
    unless event in @hook_events do
      raise ArgumentError,
            "Unknown hook event: #{inspect(event)}. " <>
            "Declared events: #{inspect(@hook_events)}. " <>
            "If you're adding a new event, update @hook_events in " <>
            "Nexus.Extensions, @known_hook_events in " <>
            "Nexus.Extensions.ManifestSchema, and add a contract entry " <>
            "in Nexus.Extensions.HookContracts."
    end

    case Nexus.Extensions.HookContracts.validate_payload(event, payload) do
      :ok ->
        dispatch_to_handlers(event, payload)

      {:error, reason} ->
        require Logger
        Logger.warning("Skipping hook #{event} — payload contract violation: #{reason}")
        :ok
    end
  end

  def fire(event, payload) do
    raise ArgumentError,
          "Nexus.Extensions.fire/2 requires a binary event name and a map " <>
          "payload. Got event=#{inspect(event)}, payload=#{inspect(payload)}."
  end

  # Dispatches an event to all subscribed handlers sequentially, in priority
  # order, inside a single background Task.
  #
  # ## Ordering semantics (piece 2.5)
  #
  # `Registry.hooks_for/1` returns handlers already sorted by their manifest-
  # declared priority (lower runs first; default 50). We iterate in that
  # order. Each handler waits for the previous one to return before running.
  #
  # This is what "priority" actually means: handler A at priority 10 is
  # guaranteed to finish before handler B at priority 50 starts, so B can
  # observe any side effects A performed (DB writes, settings changes, etc.).
  #
  # ## Why a single Task wraps the loop
  #
  # The outer fire() call is still async — the controller fires the hook
  # and returns immediately, without waiting for any handler. Inside the
  # Task we run handlers sequentially because parallel-with-priority is a
  # semantic contradiction.
  #
  # ## Failure isolation
  #
  # Each handler runs inside a try/rescue. A crashing extension logs the
  # error and the loop continues to the next handler. One bad extension
  # cannot block or skip others.
  #
  # ## Performance note for extension authors
  #
  # Because dispatch is sequential, a slow handler delays every later
  # handler subscribed to the same event. Extensions doing expensive work
  # (HTTP calls, large DB queries) should enqueue an Oban job from their
  # handle_event/3 and return quickly. The handler itself should be fast.
  defp dispatch_to_handlers(event, payload) do
    handlers =
      Nexus.Extensions.Registry.hooks_for(event)
      |> Enum.filter(fn {slug, _module} ->
        # Piece 5: skip disabled extensions. Hot enable/disable means the
        # registry may have entries for slugs whose modules are still
        # loaded but whose admin disabled them. Filter them out here.
        Nexus.Extensions.Registry.enabled?(slug)
      end)

    Task.start(fn ->
      for {slug, module} <- handlers do
        ext = get_extension_by_slug(slug)
        settings = if ext, do: ext.settings || %{}, else: %{}

        try do
          module.handle_event(event, payload, settings)
        rescue
          e ->
            require Logger
            Logger.error("Extension #{slug} raised in handle_event(#{event}): #{inspect(e)}")
        end
      end
    end)

    :ok
  end

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
