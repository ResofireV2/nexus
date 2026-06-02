defmodule Nexus.Extensions.Loader do
  @moduledoc """
  Compiles and loads extension source code into the running Nexus VM.

  ## How it works

  1. Downloads the extension's GitHub release tarball
  2. Extracts it to a temp directory
  3. Compiles all .ex files using Code.compile_file/2
  4. Finds the root module that implements Nexus.Extensions.Behaviour
  5. Runs database migrations through Nexus.Repo
  6. Starts child processes under ExtensionSupervisor
  7. Registers hooks, slots, and routes in the Registry
  8. Copies static assets (JS bundle, images) to the extension's static path

  ## Security note

  Compiled code runs with the same privileges as the Nexus process. Only
  install extensions from authors you trust. Extensions from the official
  Nexus store are reviewed before listing.
  """

  require Logger

  alias Nexus.Extensions.{Registry, ExtensionSupervisor, Storage}
  alias Nexus.Repo

  @extensions_build_dir "/tmp/nexus_extensions"

  # Tarball cache lives on the persistent uploads volume so extensions can be
  # loaded from disk on every container restart without hitting GitHub.
  # Path layout: <uploads_dir>/extensions/.cache/<slug>/<version>/release.tar.gz
  # The dot-prefix keeps it separate from extension asset directories.
  @cache_subpath ["extensions", ".cache"]

  # ---------------------------------------------------------------------------
  # Public API
  # ---------------------------------------------------------------------------

  @doc """
  Loads an extension from a GitHub release tarball URL.
  Downloads, compiles, migrates, and registers the extension.

  When `version` is provided, checks the local tarball cache first. If a
  cached tarball exists for `slug` + `version`, the download is skipped
  entirely and the cached file is used. This means container restarts do
  not require a live GitHub connection for already-installed extensions.

  Returns `{:ok, module, manifest}` or `{:error, {step, reason}}`.
  """
  def load_from_url(tarball_url, slug, token \\ nil, version \\ nil) do
    build_dir = Path.join(@extensions_build_dir, slug)

    # Check tarball cache first when version is known. A cache hit means we
    # can skip the download entirely — the tarball is already on disk from a
    # previous install or successful load.
    download_step =
      if version && cached_tarball_exists?(slug, version) do
        Logger.info("Loader: loading #{slug} v#{version} from cache (skipping download)")
        extract_cached_tarball(slug, version, build_dir)
      else
        Logger.info("Loader: loading #{slug} from #{tarball_url}")
        download_and_extract(tarball_url, build_dir, token, slug, version)
      end

    result =
      with :ok             <- tag(:download,         download_step),
           {:ok, manifest} <- tag(:manifest_invalid, read_and_validate_manifest(build_dir, slug)),
           {:ok, modules}  <- tag(:compile,          compile_extension(build_dir, slug)),
           {:ok, module}   <- tag(:manifest_invalid, find_declared_module(modules, manifest)),
           :ok             <- tag(:manifest_invalid, check_module_exports(manifest, module)),
           :ok             <- tag(:migration,        run_migrations(module, slug)),
           :ok             <- tag(:assets,           copy_static_assets(build_dir, slug, module)),
           :ok             <- tag(:supervisor,       ExtensionSupervisor.start_extension(slug, module)),
           :ok             <- tag(:registry,         Registry.register(slug, module, manifest)) do
        {:ok, module, manifest}
      end

    case result do
      {:ok, module, manifest} ->
        {:ok, module, manifest}

      {:error, {step, reason}} ->
        Logger.error("Loader: failed to load #{slug} at #{step}: #{inspect(reason)}")
        cleanup_build_dir(build_dir)
        {:error, {step, reason}}
    end
  end

  @doc """
  Deletes all cached tarballs for a given extension slug.
  Called during uninstall and force-remove.
  """
  def delete_cache(slug) do
    cache_slug_dir = cache_dir(slug)
    File.rm_rf(cache_slug_dir)
    :ok
  end

  @doc """
  Deletes cached tarballs for a slug except for the given version.
  Called after a successful update to clean up stale version entries.
  """
  def prune_cache(slug, keep_version) do
    cache_slug_dir = cache_dir(slug)
    case File.ls(cache_slug_dir) do
      {:ok, versions} ->
        versions
        |> Enum.reject(&(&1 == keep_version))
        |> Enum.each(fn version ->
          File.rm_rf(Path.join(cache_slug_dir, version))
        end)
      {:error, _} -> :ok
    end
    :ok
  end

  # Wraps a step's return value with its step name on failure.
  defp tag(_step, :ok),               do: :ok
  defp tag(_step, {:ok, _} = ok),     do: ok
  defp tag(step,  {:error, reason}),  do: {:error, {step, reason}}

  @doc """
  Unloads a running extension. Stops child processes, unregisters from
  the registry, and purges compiled modules from the VM.
  Does NOT roll back database migrations — call rollback_migrations/1 first
  if you need to remove the extension's tables.
  """
  def unload(slug, module) do
    Registry.unregister(slug)
    ExtensionSupervisor.stop_extension(slug)
    purge_modules(module)
    cleanup_build_dir(Path.join(@extensions_build_dir, slug))
    :ok
  end

  @doc """
  Rolls back all migrations for an extension in reverse order.
  Called during uninstall after on_uninstall/0 has run.
  The slug is required to correctly derive the collision-free version integer.
  """
  def rollback_migrations(module, slug) do
    migrations = safe_migrations(module)
    if migrations == [] do
      :ok
    else
      Logger.info("Loader: rolling back #{length(migrations)} migration(s) for #{module}")
      migrations
      |> Enum.reverse()
      |> Enum.each(fn migration_module ->
        version = migration_version(migration_module, slug)
        try do
          Ecto.Migrator.down(Repo, version, migration_module)
        rescue
          e -> Logger.warning("Loader: rollback failed for #{migration_module}: #{inspect(e)}")
        end
        # Explicitly delete the schema_migrations entry regardless of whether
        # down/0 had any DDL to execute. Ecto.Migrator.down only removes the
        # version if there was something to roll back — empty or no-op migrations
        # leave the version recorded, causing reinstall to skip them. We force
        # the removal so a fresh install always runs the migration from scratch.
        try do
          Repo.query!("DELETE FROM schema_migrations WHERE version = $1", [version])
        rescue
          e -> Logger.warning("Loader: failed to delete schema_migrations entry for version #{version}: #{inspect(e)}")
        end
      end)
      :ok
    end
  end

  @doc """
  Reloads an extension after an update — stops the old version, purges its
  modules, then loads the new version from the updated tarball.
  """
  def reload(tarball_url, slug, old_module, token \\ nil, version \\ nil) do
    Logger.info("Loader: reloading #{slug}")
    unload(slug, old_module)
    load_from_url(tarball_url, slug, token, version)
  end

  # ---------------------------------------------------------------------------
  # Private — download and extract
  # ---------------------------------------------------------------------------

  # Rewrite GitHub's archive URL to point directly at the codeload host.
  # github.com/<owner>/<repo>/archive/refs/tags/<tag>.tar.gz responds with
  # HTTP 302 → codeload.github.com/<owner>/<repo>/tar.gz/refs/tags/<tag>.
  # Req's default redirect following has had intermittent issues when
  # combined with an Authorization header (the security policy strips
  # auth on cross-origin redirects, and the resulting bare request to
  # codeload has occasionally returned non-200 in production).
  #
  # Going directly to codeload bypasses the redirect entirely. codeload
  # serves the tarball directly without requiring authentication for
  # public repos; private repos still need the token (which we pass).
  #
  # Non-GitHub URLs (other forges, direct hosted tarballs) pass through
  # unchanged.
  defp rewrite_github_archive_url(url) do
    case Regex.run(
      ~r{^https://github\.com/([^/]+)/([^/]+)/archive/refs/tags/(.+)\.tar\.gz$},
      url
    ) do
      [_, owner, repo, tag] ->
        "https://codeload.github.com/#{owner}/#{repo}/tar.gz/refs/tags/#{tag}"
      _ ->
        url
    end
  end

  # ---------------------------------------------------------------------------
  # Private — tarball cache
  # ---------------------------------------------------------------------------

  defp cache_base do
    uploads_dir = Application.get_env(:nexus, :uploads_dir, "/app/uploads")
    Path.join([uploads_dir | @cache_subpath])
  end

  defp cache_dir(slug) do
    Path.join(cache_base(), slug)
  end

  defp cache_tarball_path(slug, version) do
    Path.join([cache_base(), slug, version, "release.tar.gz"])
  end

  defp cached_tarball_exists?(slug, version) do
    cache_tarball_path(slug, version) |> File.exists?()
  end

  # Extracts the cached tarball into build_dir, preparing it for compilation.
  defp extract_cached_tarball(slug, version, build_dir) do
    tarball_path = cache_tarball_path(slug, version)
    File.rm_rf(build_dir)
    File.mkdir_p!(build_dir)
    # Copy cached tarball into build dir for extraction
    stage_path = Path.join(build_dir, "release.tar.gz")
    case File.cp(tarball_path, stage_path) do
      :ok    -> extract_tarball(stage_path, build_dir)
      err    -> err
    end
  end

  # Saves tarball bytes to the persistent cache after a successful download.
  defp save_to_cache(body, slug, version) do
    tarball_path = cache_tarball_path(slug, version)
    File.mkdir_p!(Path.dirname(tarball_path))
    case File.write(tarball_path, body) do
      :ok ->
        Logger.info("Loader: cached tarball for #{slug} v#{version} at #{tarball_path}")
        :ok
      {:error, reason} ->
        Logger.warning("Loader: failed to cache tarball for #{slug} v#{version}: #{inspect(reason)}")
        # Non-fatal — the extension still loaded; next restart will re-download
        :ok
    end
  end

  defp download_and_extract(url, build_dir, token \\ nil, slug \\ nil, version \\ nil) do
    File.rm_rf(build_dir)
    File.mkdir_p!(build_dir)

    tarball_path = Path.join(build_dir, "release.tar.gz")

    resolved_url = rewrite_github_archive_url(url)
    if resolved_url != url do
      Logger.info("Loader: rewrote archive URL to codeload host: #{resolved_url}")
    end

    # Pass the GitHub token if provided — required for private repo tarballs.
    # The token is supplied by the caller (install/update actions) and is never
    # fetched here, avoiding any startup timing issues.
    headers = if token do
      [{"Authorization", "Bearer #{token}"},
       {"Accept", "application/octet-stream"}]
    else
      [{"Accept", "application/octet-stream"}]
    end

    case Req.get(resolved_url, headers: headers, receive_timeout: 60_000,
                 decode_body: false, redirect: true) do
      {:ok, %{status: 200, body: body}} ->
        # Save to persistent cache before extracting so future container
        # restarts can load from disk without hitting GitHub.
        if slug && version, do: save_to_cache(body, slug, version)

        case File.write(tarball_path, body) do
          :ok -> extract_tarball(tarball_path, build_dir)
          {:error, reason} -> {:error, "Failed to write tarball: #{inspect(reason)}"}
        end

      {:ok, %{status: status}} ->
        {:error, "Failed to download tarball: HTTP #{status} from #{resolved_url}"}

      {:error, reason} ->
        {:error, "Network error downloading tarball: #{inspect(reason)}"}
    end
  end

  defp extract_tarball(tarball_path, build_dir) do
    # Use Erlang's built-in :erl_tar instead of system tar to avoid
    # depending on GNU tar features (--strip-components) not available
    # in Alpine Linux's busybox tar.
    case :erl_tar.extract(String.to_charlist(tarball_path), [:compressed, {:cwd, String.to_charlist(build_dir)}]) do
      :ok ->
        File.rm(tarball_path)
        # GitHub tarballs extract to a single top-level directory named
        # "{repo}-{tag}/". Strip it by moving contents up one level.
        case File.ls!(build_dir) do
          [single_dir] ->
            top = Path.join(build_dir, single_dir)
            if File.dir?(top) do
              File.ls!(top)
              |> Enum.each(fn entry ->
                File.rename(Path.join(top, entry), Path.join(build_dir, entry))
              end)
              File.rmdir(top)
            end
            :ok

          _ ->
            :ok
        end

      {:error, reason} ->
        {:error, "Tarball extraction failed: #{inspect(reason)}"}
    end
  end

  # ---------------------------------------------------------------------------
  # Private — compilation
  # ---------------------------------------------------------------------------

  defp compile_extension(build_dir, slug) do
    lib_dir = Path.join(build_dir, "lib")

    unless File.dir?(lib_dir) do
      {:error, "Extension package has no lib/ directory"}
    else
      ex_files = Path.wildcard(Path.join(lib_dir, "**/*.ex"))

      if ex_files == [] do
        {:error, "Extension package has no .ex files in lib/"}
      else
        Logger.info("Loader: compiling #{length(ex_files)} file(s) for #{slug}")

        # Tell the Elixir compiler to silently override already-loaded modules
        # rather than skipping the :code.load_binary call for redefined modules.
        # Without this, hot-reloading an extension leaves the old module code
        # in the VM because ParallelCompiler tracks redefines and skips loading.
        # We restore the previous value after compilation so this option does
        # not affect anything else running in the VM.
        prev_conflict_opt = Code.get_compiler_option(:ignore_module_conflict)
        Code.put_compiler_option(:ignore_module_conflict, true)

        result =
          case Kernel.ParallelCompiler.compile(ex_files) do
            {:ok, modules, _warnings} ->
              {:ok, modules}

            {:error, errors, _warnings} ->
              messages = Enum.map(errors, fn {file, line, msg} ->
                "#{Path.basename(file)}:#{line}: #{msg}"
              end) |> Enum.join(", ")
              {:error, "Compilation failed: #{messages}"}
          end

        Code.put_compiler_option(:ignore_module_conflict, prev_conflict_opt)
        result
      end
    end
  end

  # Find the compiled module whose name matches the manifest's "module" field.
  # The manifest is the source of truth for which module is the extension's
  # root; we no longer scan for "the module implementing the behaviour with
  # the right manifest()/0 slug." We DO still confirm the resolved module
  # implements Nexus.Extensions.Behaviour as a sanity check.
  defp find_declared_module(modules, manifest) do
    declared_name = manifest["module"]

    target = Module.concat([declared_name])

    cond do
      target in modules ->
        behaviours =
          target.module_info(:attributes)
          |> Keyword.get_values(:behaviour)
          |> List.flatten()

        if Nexus.Extensions.Behaviour in behaviours do
          {:ok, target}
        else
          {:error,
           "module #{inspect(target)} declared in manifest does not implement Nexus.Extensions.Behaviour. " <>
             "Add `use Nexus.Extensions.Behaviour` to that module."}
        end

      true ->
        {:error,
         "manifest declares module #{inspect(declared_name)} but no such module was produced by compiling the extension's source. " <>
           "Check that the module name in manifest.json matches the one defined in lib/."}
    end
  end

  # ---------------------------------------------------------------------------
  # Private — manifest read + cross-check
  #
  # The manifest is the canonical declaration of what the extension contributes
  # to Nexus. read_and_validate_manifest/2 runs as the first step after the
  # tarball is extracted, so subsequent steps (compile, module discovery,
  # export-check) can rely on a validated, normalized manifest.
  #
  # check_module_exports/2 runs after compile and verifies the module actually
  # implements the callbacks it declared subscriptions to.
  #
  # Slot, route, widget, and toolbar declarations are JS-side concerns and
  # cannot be cross-checked here — they're validated at runtime by the bundle
  # (sub-stage 7D). We just store the normalized manifest for that check.
  # ---------------------------------------------------------------------------

  defp read_and_validate_manifest(build_dir, slug) do
    manifest_path = Path.join(build_dir, "manifest.json")

    with {:ok, body}     <- File.read(manifest_path),
         {:ok, raw}      <- Jason.decode(body),
         {:ok, manifest} <- validate_against_schema(raw),
         :ok             <- check_slug_match(manifest, slug) do
      {:ok, manifest}
    else
      {:error, :enoent} ->
        {:error, "manifest.json is missing from the extension package"}

      {:error, %Jason.DecodeError{}} ->
        {:error, "manifest.json is not valid JSON"}

      {:error, reason} when is_binary(reason) ->
        {:error, reason}

      {:error, reason} ->
        {:error, "manifest read failed: #{inspect(reason)}"}
    end
  end

  defp check_module_exports(manifest, module) do
    with :ok <- check_hook_exports(manifest, module),
         :ok <- check_digest_exports(manifest, module) do
      :ok
    end
  end

  defp validate_against_schema(raw) do
    case Nexus.Extensions.ManifestSchema.validate(raw) do
      {:ok, normalized, warnings} ->
        # Log warnings; surfacing them in the admin UI is sub-stage 7D's job.
        for w <- warnings, do: Logger.warning("manifest warning: #{w}")
        {:ok, normalized}

      {:error, errors} ->
        # Take the top 3 errors for the load_error message; full list is logged.
        Logger.warning("manifest validation failed: #{Enum.join(errors, "; ")}")
        summary =
          errors
          |> Enum.take(3)
          |> Enum.join("; ")
        {:error, summary}
    end
  end

  defp check_slug_match(%{"slug" => slug}, slug), do: :ok
  defp check_slug_match(%{"slug" => other}, expected) do
    {:error, "manifest slug #{inspect(other)} does not match the slug being installed #{inspect(expected)}"}
  end

  defp check_hook_exports(%{"hooks" => []}, _module), do: :ok
  defp check_hook_exports(%{"hooks" => [_ | _]}, module) do
    if function_exported?(module, :handle_event, 3) do
      :ok
    else
      {:error,
       "manifest declares hook subscriptions but #{inspect(module)} does not export handle_event/3. " <>
         "Add a handle_event/3 callback (with a catch-all clause) to handle the declared events."}
    end
  end
  defp check_hook_exports(_, _), do: :ok

  defp check_digest_exports(%{"digest_sections" => []}, _module), do: :ok
  defp check_digest_exports(%{"digest_sections" => [_ | _]}, module) do
    if function_exported?(module, :handle_digest_section, 3) do
      :ok
    else
      {:error,
       "manifest declares digest_sections but #{inspect(module)} does not export handle_digest_section/3. " <>
         "Add a handle_digest_section/3 callback to produce content for each declared section."}
    end
  end
  defp check_digest_exports(_, _), do: :ok

  # ---------------------------------------------------------------------------
  # Private — migrations
  # ---------------------------------------------------------------------------

  @doc """
  Public entry point to run pending migrations for an already-loaded extension
  module. Used by the admin "Run migrations" action as a recovery tool when
  schema_migrations has gotten out of sync.

  Returns `{:ok, count}` where count is the number of migrations that ran,
  or `{:error, reason}` if something failed.
  """
  def run_pending_migrations(module, slug) do
    migrations = safe_migrations(module)
    if migrations == [] do
      {:ok, 0}
    else
      ran =
        Enum.reduce(migrations, 0, fn migration_module, count ->
          version = migration_version(migration_module, slug)
          # Check if already recorded — only run if missing
          result = Repo.query!("SELECT 1 FROM schema_migrations WHERE version = $1", [version])
          if result.num_rows == 0 do
            Ecto.Migrator.up(Repo, version, migration_module)
            count + 1
          else
            count
          end
        end)
      {:ok, ran}
    end
  rescue
    e -> {:error, "Migration failed: #{inspect(e)}"}
  end

  defp run_migrations(module, slug) do
    migrations = safe_migrations(module)
    if migrations == [] do
      :ok
    else
      Logger.info("Loader: running #{length(migrations)} migration(s) for #{module}")
      Enum.each(migrations, fn migration_module ->
        version = migration_version(migration_module, slug)
        Ecto.Migrator.up(Repo, version, migration_module)
      end)
      :ok
    end
  rescue
    e ->
      {:error, "Migration failed: #{inspect(e)}"}
  end

  defp safe_migrations(module) do
    if function_exported?(module, :migrations, 0) do
      try do
        module.migrations()
      rescue
        _ -> []
      end
    else
      []
    end
  end

  # Derive a collision-free migration version integer from the module name and
  # extension slug. This is the single place that maps (slug, migration) pairs
  # to schema_migrations version integers.
  #
  # Design:
  #   - Extract the sequence number N from the module name (V1 → 1, V42 → 42).
  #   - Hash the string "#{slug}:#{N}" with phash2 into the range 0..2_999_999_999.
  #   - Add 1_000_000_000 so the result is always in 1_000_000_000..3_999_999_999
  #     (10 digits). Range is capped at 3_000_000_000 because :erlang.phash2's
  #     range argument must be <= 2^32 (4_294_967_296). 9_000_000_000 overflows.
  #   - Nexus core migrations are 14-digit timestamps (20260501000001…). No
  #     overlap is possible.
  #   - Two extensions with the same V1 get different integers because the slug
  #     is part of the hash input.
  #   - Collision probability for any (slug, N) pair: 1 in 3,000,000,000.
  #
  # Extension developers simply use V1, V2, V3… in their module names.
  # No date prefixes, no awareness of Nexus core's version range required.
  defp migration_version(module, slug) do
    last_segment =
      module
      |> Atom.to_string()
      |> String.split(".")
      |> List.last()

    n =
      case Regex.run(~r/^V(\d+)/i, last_segment) do
        [_, version_str] -> String.to_integer(version_str)
        nil              -> :erlang.phash2(last_segment, 3_000_000_000)
      end

    :erlang.phash2("#{slug}:#{n}", 3_000_000_000) + 1_000_000_000
  end

  # ---------------------------------------------------------------------------
  # Private — static assets
  # ---------------------------------------------------------------------------

  defp copy_static_assets(build_dir, slug, _module) do
    static_dir = Path.join(build_dir, "priv/static")
    dest_dir   = Path.join([Application.get_env(:nexus, :uploads_dir, "/app/uploads"),
                            "extensions", slug, "assets"])

    unless File.dir?(static_dir) do
      Logger.warning("Loader: no priv/static/ found for #{slug}")
      :ok
    else
      File.mkdir_p!(dest_dir)

      # Copy all files from priv/static/ directly into assets dir.
      # logo.webp and banner.webp are required by convention — no manifest URLs needed.
      copied =
        static_dir
        |> File.ls!()
        |> Enum.map(fn filename ->
          src  = Path.join(static_dir, filename)
          dest = Path.join(dest_dir, filename)
          case File.cp(src, dest) do
            :ok ->
              Logger.info("Loader: copied #{filename} for #{slug}")
              :ok
            {:error, reason} ->
              Logger.warning("Loader: failed to copy #{filename} for #{slug}: #{inspect(reason)}")
              :error
          end
        end)

      if Enum.any?(copied, & &1 == :ok) do
        Logger.info("Loader: static assets copied for #{slug} → #{dest_dir}")
      end

      :ok
    end
  end

  # ---------------------------------------------------------------------------
  # Private — module purging
  # ---------------------------------------------------------------------------

  defp purge_modules(root_module) do
    # Derive the top-level namespace from the root module name.
    # e.g. Elixir.Gamepedia -> "Elixir.Gamepedia"
    # Only purge modules whose full name starts with this exact prefix
    # followed by "." or is exactly the prefix — never purge anything else.
    prefix = root_module |> Atom.to_string()

    :code.all_loaded()
    |> Enum.filter(fn {mod, _} ->
      mod_str = Atom.to_string(mod)
      mod_str == prefix || String.starts_with?(mod_str, prefix <> ".")
    end)
    |> Enum.each(fn {mod, _} ->
      # Correct BEAM sequence: delete first (marks current as old),
      # then purge (removes old from memory). Reversed order is a no-op
      # on first update since there is no prior "old" version to purge.
      :code.delete(mod)
      :code.purge(mod)
    end)

    :ok
  end

  defp cleanup_build_dir(dir) do
    File.rm_rf(dir)
  end
end
