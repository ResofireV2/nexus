defmodule Nexus.Updates do
  @moduledoc """
  Checks for available Nexus updates against the GitHub Releases API.

  This module is intentionally check-only. Applying an update is the job of
  the host-side `nexus-update` script written by install.sh — it has the
  privileges (docker access, write access to /opt/nexus, ability to restart
  the container that's running this code) that a container-bound process
  does not. Trying to do it from inside the container led to a long chain
  of correctness and architecture problems; the host-side script is the
  simple, working answer.

  The admin UI uses this module to surface "an update is available" with
  copy-to-clipboard instructions for the host command.
  """

  @github_repo "ResofireV2/nexus"

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
          {:ok, decoded} -> {:ok, decoded}
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

  defp version_gte?(a, b) do
    parse_ver(a) >= parse_ver(b)
  end

  defp parse_ver(v) do
    v
    |> strip_v()
    |> String.split(~r/[.\-+]/)
    |> Enum.map(fn part ->
      case Integer.parse(part) do
        {n, _} -> n
        :error -> 0
      end
    end)
  end

  defp strip_v(tag), do: String.trim_leading(tag, "v")
end
