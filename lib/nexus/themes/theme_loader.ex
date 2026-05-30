defmodule Nexus.Themes.ThemeLoader do
  @moduledoc """
  Handles fetching, extracting, validating, and installing theme packages
  from GitHub release tarballs.

  A theme package is a GitHub release tarball containing at minimum:
    - theme.json  — theme manifest (name, slug, version, variables, settings)
    - theme.css   — optional stylesheet for structural CSS changes

  Unlike extensions, themes require no compilation. The loader:
    1. Downloads the tarball (or loads from cache)
    2. Extracts it to a temporary build directory
    3. Reads and validates theme.json
    4. Copies theme.css (if present) to /app/uploads/themes/:slug/
    5. Clears the build directory

  The tarball cache uses the same slug+version scheme as the extension loader
  so themes survive container restarts without re-downloading from GitHub.
  """

  require Logger

  @build_base "/tmp/nexus_themes"
  @cache_subpath ["themes", ".cache"]
  @valid_css_vars ~w(
    --bg --s1 --s2 --s3
    --b1 --b2 --b3
    --t1 --t2 --t3 --t4 --t5
    --ac --ac-on --ac-bg --ac-border --ac-text
    --green --red --amber --blue --pink
    --fs-ui --fs-body --fs-title --fs-feed-title --fs-content --fs-code
    --av-radius
  )

  # ---------------------------------------------------------------------------
  # Public API
  # ---------------------------------------------------------------------------

  @doc """
  Downloads and installs a theme from a GitHub release tarball URL.
  Returns {:ok, attrs} where attrs is a map ready to insert into the DB,
  or {:error, reason}.
  """
  def install_from_url(tarball_url, slug, version \\ nil) do
    build_dir = Path.join(@build_base, slug)

    result =
      with :ok <- fetch_and_extract(tarball_url, build_dir, slug, version),
           {:ok, manifest} <- read_and_validate_manifest(build_dir, slug),
           {:ok, css_path} <- copy_stylesheet(build_dir, manifest["slug"] || slug) do
        {:ok, %{manifest: manifest, stylesheet_path: css_path}}
      end

    File.rm_rf(build_dir)
    result
  end

  @doc """
  Deletes all cached tarballs and uploaded files for a theme slug.
  """
  def delete_theme_files(slug) do
    # Cached tarballs
    File.rm_rf(Path.join(cache_dir(slug), slug))
    # Uploaded CSS + assets
    uploads_dir = Application.get_env(:nexus, :uploads_dir, "/app/uploads")
    File.rm_rf(Path.join([uploads_dir, "themes", slug]))
    :ok
  end

  @doc """
  Deletes old cached tarballs for a slug, keeping only keep_version.
  """
  def prune_cache(slug, keep_version) do
    slug_cache = Path.join([cache_base(), slug])
    case File.ls(slug_cache) do
      {:ok, versions} ->
        versions
        |> Enum.reject(&(&1 == keep_version))
        |> Enum.each(&File.rm_rf(Path.join(slug_cache, &1)))
      {:error, _} -> :ok
    end
    :ok
  end

  # ---------------------------------------------------------------------------
  # Private — fetch and extract
  # ---------------------------------------------------------------------------

  defp fetch_and_extract(url, build_dir, slug, version) do
    if version && cached_tarball_exists?(slug, version) do
      Logger.info("ThemeLoader: loading #{slug} v#{version} from cache")
      extract_cached_tarball(slug, version, build_dir)
    else
      Logger.info("ThemeLoader: downloading #{slug} from #{url}")
      download_and_extract(url, build_dir, slug, version)
    end
  end

  defp download_and_extract(url, build_dir, slug, version) do
    File.rm_rf(build_dir)
    File.mkdir_p!(build_dir)

    resolved = rewrite_github_url(url)
    headers  = [{"Accept", "application/octet-stream"}]
    token    = Nexus.Extensions.GitHub.get_token()
    headers  = if token, do: [{"Authorization", "Bearer #{token}"} | headers], else: headers

    case Req.get(resolved, headers: headers, receive_timeout: 60_000, decode_body: false, redirect: true) do
      {:ok, %{status: 200, body: body}} ->
        if slug && version, do: save_to_cache(body, slug, version)
        tarball = Path.join(build_dir, "release.tar.gz")
        case File.write(tarball, body) do
          :ok    -> extract_tarball(tarball, build_dir)
          err    -> err
        end

      {:ok, %{status: status}} ->
        {:error, "Failed to download theme tarball: HTTP #{status}"}

      {:error, reason} ->
        {:error, "Network error downloading theme: #{inspect(reason)}"}
    end
  end

  defp extract_tarball(tarball_path, build_dir) do
    case :erl_tar.extract(String.to_charlist(tarball_path), [:compressed, {:cwd, String.to_charlist(build_dir)}]) do
      :ok ->
        File.rm(tarball_path)
        # GitHub tarballs have a single top-level directory — strip it
        case File.ls!(build_dir) do
          [single_dir] ->
            top = Path.join(build_dir, single_dir)
            if File.dir?(top) do
              File.ls!(top)
              |> Enum.each(fn e -> File.rename(Path.join(top, e), Path.join(build_dir, e)) end)
              File.rmdir(top)
            end
          _ -> :ok
        end
        :ok

      {:error, reason} ->
        {:error, "Theme tarball extraction failed: #{inspect(reason)}"}
    end
  end

  # ---------------------------------------------------------------------------
  # Private — manifest validation
  # ---------------------------------------------------------------------------

  defp read_and_validate_manifest(build_dir, slug) do
    path = Path.join(build_dir, "theme.json")

    unless File.exists?(path) do
      {:error, "theme.json not found in theme package"}
    else
      with {:ok, raw} <- File.read(path),
           {:ok, map} <- Jason.decode(raw) do
        validate_manifest(map, slug)
      else
        {:error, %Jason.DecodeError{} = e} -> {:error, "theme.json parse error: #{Exception.message(e)}"}
        err -> err
      end
    end
  end

  defp validate_manifest(m, _slug) do
    errors = []

    errors = if not (is_binary(m["name"]) and m["name"] != ""), do: ["name is required" | errors], else: errors
    errors = if not (is_binary(m["slug"]) and Regex.match?(~r/^[a-z0-9\-]+$/, m["slug"] || "")), do: ["slug must be lowercase alphanumeric with hyphens" | errors], else: errors
    errors = if not (is_binary(m["version"]) and m["version"] != ""), do: ["version is required" | errors], else: errors

    # Validate declared variables if present
    errors =
      case m["variables"] do
        nil -> errors
        vars when is_map(vars) ->
          invalid = Map.keys(vars) |> Enum.reject(&(&1 in @valid_css_vars))
          if invalid == [] do
            errors
          else
            ["Unknown CSS variables: #{Enum.join(invalid, ", ")}" | errors]
          end
        _ -> ["variables must be an object" | errors]
      end

    # Validate per-mode variables if present
    errors =
      Enum.reduce(["dark", "light"], errors, fn mode, acc ->
        case get_in(m, ["modes", mode, "variables"]) do
          nil -> acc
          vars when is_map(vars) ->
            invalid = Map.keys(vars) |> Enum.reject(&(&1 in @valid_css_vars))
            if invalid == [], do: acc, else: ["modes.#{mode}: unknown variables: #{Enum.join(invalid, ", ")}" | acc]
          _ -> ["modes.#{mode}.variables must be an object" | acc]
        end
      end)

    if errors == [] do
      {:ok, m}
    else
      {:error, "theme.json validation failed: #{Enum.join(Enum.reverse(errors), "; ")}"}
    end
  end

  # ---------------------------------------------------------------------------
  # Private — stylesheet
  # ---------------------------------------------------------------------------

  defp copy_stylesheet(build_dir, slug) do
    src = Path.join(build_dir, "theme.css")

    if File.exists?(src) do
      uploads_dir = Application.get_env(:nexus, :uploads_dir, "/app/uploads")
      dest_dir  = Path.join([uploads_dir, "themes", slug])
      dest_path = Path.join(dest_dir, "theme.css")
      File.mkdir_p!(dest_dir)
      case File.cp(src, dest_path) do
        :ok    -> {:ok, "themes/#{slug}/theme.css"}
        err    -> err
      end
    else
      {:ok, nil}
    end
  end

  # ---------------------------------------------------------------------------
  # Private — tarball cache (same scheme as extension loader)
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

  defp extract_cached_tarball(slug, version, build_dir) do
    tarball = cache_tarball_path(slug, version)
    File.rm_rf(build_dir)
    File.mkdir_p!(build_dir)
    stage = Path.join(build_dir, "release.tar.gz")
    case File.cp(tarball, stage) do
      :ok  -> extract_tarball(stage, build_dir)
      err  -> err
    end
  end

  defp save_to_cache(body, slug, version) do
    path = cache_tarball_path(slug, version)
    File.mkdir_p!(Path.dirname(path))
    case File.write(path, body) do
      :ok ->
        Logger.info("ThemeLoader: cached tarball for #{slug} v#{version}")
        :ok
      {:error, reason} ->
        Logger.warning("ThemeLoader: failed to cache #{slug} v#{version}: #{inspect(reason)}")
        :ok
    end
  end

  defp rewrite_github_url(url) do
    # Redirect github.com archive URLs to the faster codeload CDN
    if Regex.match?(~r{^https://github\.com/([^/]+)/([^/]+)/archive}, url) do
      String.replace(url, "https://github.com/", "https://codeload.github.com/")
      |> String.replace("/archive/refs/tags/", "/tar.gz/refs/tags/")
    else
      url
    end
  end
end
