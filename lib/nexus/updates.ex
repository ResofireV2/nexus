defmodule Nexus.Updates do
  @moduledoc """
  Handles Nexus version checks and in-place updates from GitHub releases.

  Version check hits the GitHub Releases API and compares against the running
  application version declared in mix.exs.

  Update applies the latest tagged release by:
    1. Downloading the release tarball from GitHub
    2. Extracting it over /opt/nexus (preserving .env and data)
    3. Rebuilding and restarting via docker compose
  """

  @github_repo "ResofireV2/nexus"
  @install_dir "/opt/nexus"

  # ── Version check ────────────────────────────────────────────────────────────

  @doc """
  Returns the current running version and the latest GitHub release.

  Result map:
    %{
      current:    "0.1.0",
      latest:     "0.2.0",
      up_to_date: false,
      release:    %{
        tag:         "v0.2.0",
        name:        "Nexus 0.2.0",
        body:        "## What's new\n...",
        published_at: "2026-05-01T12:00:00Z",
        tarball_url: "https://api.github.com/repos/.../tarball/v0.2.0",
        html_url:    "https://github.com/ResofireV2/nexus/releases/tag/v0.2.0"
      }
    }
  """
  def check_for_update do
    current = current_version()

    case fetch_latest_release() do
      {:ok, release} ->
        latest = strip_v(release["tag_name"] || "")
        {:ok, %{
          current:    current,
          latest:     latest,
          up_to_date: version_gte?(current, latest),
          release:    %{
            tag:          release["tag_name"],
            name:         release["name"],
            body:         release["body"],
            published_at: release["published_at"],
            tarball_url:  release["tarball_url"],
            html_url:     release["html_url"]
          }
        }}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # ── Apply update ─────────────────────────────────────────────────────────────

  @doc """
  Downloads the latest tagged release, extracts it over the install directory,
  and rebuilds the Docker container.

  Returns {:ok, log} or {:error, reason}.
  The log is a list of status strings shown to the admin in real time.
  """
  def apply_update do
    with {:ok, %{up_to_date: false, release: release}} <- check_for_update(),
         {:ok, log} <- do_apply(release) do
      {:ok, log}
    else
      {:ok, %{up_to_date: true}} -> {:error, "Already on the latest version."}
      {:error, reason}           -> {:error, reason}
    end
  end

  # ── Private ──────────────────────────────────────────────────────────────────

  defp current_version do
    Application.spec(:nexus, :vsn) |> to_string()
  rescue
    _ -> Mix.Project.config()[:version] || "unknown"
  end

  defp fetch_latest_release do
    url     = "https://api.github.com/repos/#{@github_repo}/releases/latest"
    headers = [{"User-Agent", "Nexus/#{current_version()}"}, {"Accept", "application/vnd.github+json"}]

    case Req.get(url, headers: headers, receive_timeout: 10_000) do
      {:ok, %{status: 200, body: body}} when is_map(body) ->
        {:ok, body}

      {:ok, %{status: 200, body: body}} when is_binary(body) ->
        case Jason.decode(body) do
          {:ok, release} -> {:ok, release}
          _              -> {:error, "Could not parse GitHub response"}
        end

      {:ok, %{status: 404}} ->
        {:error, "No releases found on GitHub"}

      {:ok, %{status: status}} ->
        {:error, "GitHub API returned HTTP #{status}"}

      {:error, reason} ->
        {:error, "Could not reach GitHub: #{inspect(reason)}"}
    end
  end

  defp do_apply(release) do
    tag         = release.tag
    tarball_url = release.tarball_url
    tmp_archive = "/tmp/nexus-release-#{tag}.tar.gz"
    tmp_extract = "/tmp/nexus-release-#{tag}"

    log = []

    with {:step, log, :ok} <- step(log, "Downloading release #{tag}…", fn ->
           download_tarball(tarball_url, tmp_archive)
         end),
         {:step, log, :ok} <- step(log, "Extracting archive…", fn ->
           extract_tarball(tmp_archive, tmp_extract)
         end),
         {:step, log, :ok} <- step(log, "Applying files to #{@install_dir}…", fn ->
           apply_files(tmp_extract)
         end),
         {:step, log, :ok} <- step(log, "Rebuilding container (this takes a few minutes)…", fn ->
           rebuild_container()
         end) do
      cleanup(tmp_archive, tmp_extract)
      {:ok, log ++ ["Update complete — Nexus is now running #{tag}."]}
    else
      {:step, log, {:error, reason}} ->
        cleanup(tmp_archive, tmp_extract)
        {:error, {reason, log}}
    end
  end

  defp step(log, message, fun) do
    result = fun.()
    entry  = if result == :ok, do: "✓ #{message}", else: "✗ #{message}"
    {:step, log ++ [entry], result}
  end

  defp download_tarball(url, dest) do
    # raw: true is essential here. Without it, Req's decompress_body step
    # sees Content-Encoding: gzip on the response from codeload.github.com
    # and transparently un-gzips the tarball bytes for us, leaving an
    # uncompressed tar archive on disk. tar -xzf then fails with the
    # cryptic "invalid magic, short read" because it tries to gunzip
    # bytes that have already been gunzipped.
    #
    # raw: true disables both decompress_body and decode_body, so we get
    # the exact bytes GitHub sent — which is what we want to write to a
    # .tar.gz file. See Req.Steps docs for the canonical explanation.
    #
    # Accept: application/octet-stream is also more explicit than the
    # previous application/vnd.github+json. The 302 redirect from
    # api.github.com to codeload happens either way, but octet-stream
    # signals "give us the bytes, not metadata about the bytes."
    case Req.get(url,
           headers: [
             {"User-Agent", "Nexus-Updater"},
             {"Accept", "application/octet-stream"}
           ],
           receive_timeout: 60_000,
           redirect: true,
           raw: true) do
      {:ok, %{status: 200, body: body}} when is_binary(body) ->
        # Sanity check: a real gzipped tar starts with 1F 8B. If we got
        # something else (HTML error page, JSON, truncated body), bail out
        # with a useful error instead of writing junk to disk and letting
        # tar fail later with "invalid magic".
        case body do
          <<0x1F, 0x8B, _rest::binary>> ->
            case File.write(dest, body) do
              :ok ->
                :ok
              {:error, reason} ->
                {:error, "Could not write tarball to #{dest}: #{inspect(reason)}"}
            end

          _ ->
            preview =
              body
              |> binary_part(0, min(byte_size(body), 80))
              |> Base.encode16(case: :lower)

            {:error,
             "Downloaded #{byte_size(body)} bytes but they are not a gzipped tarball " <>
             "(first bytes: #{preview}). Expected a file starting with 1f8b. " <>
             "If GitHub returned HTML or JSON, the release may not have an attached source archive."}
        end

      {:ok, %{status: status}} ->
        {:error, "Download failed: HTTP #{status}"}

      {:error, reason} ->
        {:error, "Download error: #{inspect(reason)}"}
    end
  end

  defp extract_tarball(archive, dest) do
    File.mkdir_p!(dest)
    case System.cmd("tar", ["--strip-components=1", "-xzf", archive, "-C", dest],
                    stderr_to_stdout: true) do
      {_, 0} -> :ok
      {out, code} -> {:error, "tar failed (exit #{code}): #{out}"}
    end
  end

  defp apply_files(src) do
    # Copy everything EXCEPT .env and docker-compose files —
    # those are instance-specific and must never be overwritten.
    protected = [".env", "docker-compose.yml", "docker-compose.prod.yml"]

    # Use the list form — never interpolate paths into a shell string.
    case System.cmd("rsync", [
      "-a",
      "--exclude=.env",
      "--exclude=docker-compose.yml",
      "--exclude=docker-compose.prod.yml",
      src <> "/",
      @install_dir <> "/"
    ], stderr_to_stdout: true) do
      {_, 0} ->
        :ok
      {_out, _} ->
        # rsync may not be installed — fall back to cp with manual exclusion
        Enum.each(File.ls!(src), fn file ->
          unless file in protected do
            src_path  = Path.join(src, file)
            dest_path = Path.join(@install_dir, file)
            File.cp_r!(src_path, dest_path)
          end
        end)
        :ok
    end
  end

  defp rebuild_container do
    case System.cmd("docker", ["compose", "-f", "#{@install_dir}/docker-compose.prod.yml",
                               "up", "-d", "--build"],
                    cd: @install_dir, stderr_to_stdout: true) do
      {_, 0} -> :ok
      {out, code} -> {:error, "docker compose failed (exit #{code}): #{String.slice(out, 0, 300)}"}
    end
  end

  defp cleanup(archive, extract_dir) do
    File.rm(archive)
    File.rm_rf(extract_dir)
  rescue
    _ -> :ok
  end

  # Simple semver comparison — returns true if a >= b.
  # Handles MAJOR.MINOR.PATCH and pre-release suffixes like 0.1.Beta or 0.1.0-beta.
  defp version_gte?(a, b) do
    parse_ver(a) >= parse_ver(b)
  end

  defp parse_ver(v) do
    v
    |> String.trim_leading("v")
    |> String.split(~r/[-.]/)
    |> Enum.take(3)
    |> Enum.map(fn part ->
      case Integer.parse(part) do
        {n, _} -> n
        :error  -> 0
      end
    end)
  rescue
    _ -> [0, 0, 0]
  end

  defp strip_v(tag), do: String.trim_leading(tag, "v")
end
