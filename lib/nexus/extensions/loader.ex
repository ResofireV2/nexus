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

  # ---------------------------------------------------------------------------
  # Public API
  # ---------------------------------------------------------------------------

  @doc """
  Loads an extension from a GitHub release tarball URL.
  Downloads, compiles, migrates, and registers the extension.
  Returns {:ok, module} or {:error, reason}.
  """
  def load_from_url(tarball_url, slug) do
    Logger.info("Loader: loading #{slug} from #{tarball_url}")
    build_dir = Path.join(@extensions_build_dir, slug)

    with :ok          <- download_and_extract(tarball_url, build_dir),
         {:ok, module} <- compile_extension(build_dir, slug),
         :ok           <- run_migrations(module),
         :ok           <- copy_static_assets(build_dir, slug, module),
         :ok           <- ExtensionSupervisor.start_extension(slug, module),
         :ok           <- Registry.register(slug, module) do
      {:ok, module}
    else
      {:error, reason} ->
        Logger.error("Loader: failed to load #{slug}: #{inspect(reason)}")
        cleanup_build_dir(build_dir)
        {:error, reason}
    end
  end

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
  """
  def rollback_migrations(module) do
    migrations = safe_migrations(module)
    if migrations == [] do
      :ok
    else
      Logger.info("Loader: rolling back #{length(migrations)} migration(s) for #{module}")
      migrations
      |> Enum.reverse()
      |> Enum.each(fn migration_module ->
        try do
          Ecto.Migrator.down(Repo, migration_version(migration_module), migration_module)
        rescue
          e -> Logger.warning("Loader: rollback failed for #{migration_module}: #{inspect(e)}")
        end
      end)
      :ok
    end
  end

  @doc """
  Reloads an extension after an update — stops the old version, purges its
  modules, then loads the new version from the updated tarball.
  """
  def reload(tarball_url, slug, old_module) do
    Logger.info("Loader: reloading #{slug}")
    unload(slug, old_module)
    load_from_url(tarball_url, slug)
  end

  # ---------------------------------------------------------------------------
  # Private — download and extract
  # ---------------------------------------------------------------------------

  defp download_and_extract(url, build_dir) do
    File.rm_rf(build_dir)
    File.mkdir_p!(build_dir)

    tarball_path = Path.join(build_dir, "release.tar.gz")

    case Req.get(url, receive_timeout: 60_000, decode_body: false) do
      {:ok, %{status: 200, body: body}} ->
        case File.write(tarball_path, body) do
          :ok -> extract_tarball(tarball_path, build_dir)
          {:error, reason} -> {:error, "Failed to write tarball: #{inspect(reason)}"}
        end

      {:ok, %{status: status}} ->
        {:error, "Failed to download tarball: HTTP #{status}"}

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

        # Use Kernel.ParallelCompiler which resolves inter-module dependencies
        # automatically — schemas compile before contexts that reference them.
        case Kernel.ParallelCompiler.compile(ex_files) do
          {:ok, modules, _warnings} ->
            find_extension_module(modules, slug)

          {:error, errors, _warnings} ->
            messages = Enum.map(errors, fn {file, line, msg} ->
              "#{Path.basename(file)}:#{line}: #{msg}"
            end) |> Enum.join(", ")
            {:error, "Compilation failed: #{messages}"}
        end
      end
    end
  end

  defp find_extension_module(modules, slug) do
    # Find the module that implements Nexus.Extensions.Behaviour and whose
    # manifest/0 returns the matching slug.
    root = Enum.find(modules, fn mod ->
      behaviours = mod.module_info(:attributes)
        |> Keyword.get_values(:behaviour)
        |> List.flatten()

      Nexus.Extensions.Behaviour in behaviours &&
        function_exported?(mod, :manifest, 0) &&
        match?(%{slug: ^slug}, mod.manifest())
    end)

    case root do
      nil -> {:error, "No module implementing Nexus.Extensions.Behaviour with slug \"#{slug}\" found"}
      mod -> {:ok, mod}
    end
  end

  # ---------------------------------------------------------------------------
  # Private — migrations
  # ---------------------------------------------------------------------------

  defp run_migrations(module) do
    migrations = safe_migrations(module)
    if migrations == [] do
      :ok
    else
      Logger.info("Loader: running #{length(migrations)} migration(s) for #{module}")
      Enum.each(migrations, fn migration_module ->
        version = migration_version(migration_module)
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

  # Derive a migration version from the module name.
  # e.g. MyExt.Migrations.V001CreateItems → 1
  # e.g. MyExt.Migrations.V20260510000001CreateItems → 20260510000001
  defp migration_version(module) do
    module
    |> Atom.to_string()
    |> String.split(".")
    |> List.last()
    |> then(fn name ->
      case Regex.run(~r/^V(\d+)/, name) do
        [_, version_str] -> String.to_integer(version_str)
        nil ->
          # Fallback: hash the module name to get a unique integer
          :erlang.phash2(module, 1_000_000_000)
      end
    end)
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
      :code.purge(mod)
      :code.delete(mod)
    end)

    :ok
  end

  defp cleanup_build_dir(dir) do
    File.rm_rf(dir)
  end
end
