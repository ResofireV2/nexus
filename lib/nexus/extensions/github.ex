defmodule Nexus.Extensions.GitHub do
  @moduledoc """
  GitHub Releases API integration for extension update checking.

  Fetches release metadata from the GitHub API. Requires a personal access
  token (classic or fine-grained with public_repo read access) stored in
  Admin → Settings → Integrations → github_token. Without a token the API
  is rate-limited to 60 requests/hour per IP; with a token it's 5,000/hour.
  """

  require Logger

  @api_base "https://api.github.com"

  # ---------------------------------------------------------------------------
  # Public API
  # ---------------------------------------------------------------------------

  @doc """
  Fetches the latest release for a GitHub repo. Returns:
    {:ok, %{tag: tag, name: name, body: markdown_body, published_at: datetime}}
    {:error, reason}
  """
  def latest_release(repo, token \\ nil) do
    url = "#{@api_base}/repos/#{repo}/releases/latest"
    case req_get(url, token) do
      {:ok, %{status: 200, body: body}} ->
        {:ok, %{
          tag:          body["tag_name"],
          name:         body["name"] || body["tag_name"],
          body:         body["body"] || "",
          published_at: body["published_at"],
          tarball_url:  body["tarball_url"],
        }}

      {:ok, %{status: 404}} ->
        {:error, :no_release}

      {:ok, %{status: 403}} ->
        {:error, :rate_limited}

      {:ok, %{status: status}} ->
        {:error, "GitHub API returned HTTP #{status}"}

      {:error, reason} ->
        {:error, "Network error: #{inspect(reason)}"}
    end
  end

  @doc """
  Fetches manifest.json from a specific tag in a GitHub repo.
  """
  def manifest_at_tag(repo, tag, token \\ nil) do
    url = "https://raw.githubusercontent.com/#{repo}/#{tag}/manifest.json"
    case req_get(url, token) do
      {:ok, %{status: 200, body: body}} when is_map(body) ->
        {:ok, body}

      {:ok, %{status: 200, body: body}} when is_binary(body) ->
        case Jason.decode(body) do
          {:ok, map} -> {:ok, map}
          {:error, _} -> {:error, "manifest.json is not valid JSON"}
        end

      {:ok, %{status: 404}} ->
        {:error, "manifest.json not found at tag #{tag}"}

      {:ok, %{status: status}} ->
        {:error, "HTTP #{status} fetching manifest at #{tag}"}

      {:error, reason} ->
        {:error, "Network error: #{inspect(reason)}"}
    end
  end

  @doc """
  Derives a github_repo ("owner/repo") from a GitHub URL or raw.githubusercontent URL.
  Returns nil if the URL is not a recognized GitHub URL.
  """
  def repo_from_url(nil), do: nil
  def repo_from_url(url) do
    cond do
      # https://github.com/owner/repo or https://github.com/owner/repo/...
      Regex.match?(~r{^https?://github\.com/([^/]+/[^/]+?)(/.*)?$}, url) ->
        [_, repo | _] = Regex.run(~r{^https?://github\.com/([^/]+/[^/]+?)(/.*)?$}, url)
        repo

      # https://raw.githubusercontent.com/owner/repo/branch/manifest.json
      Regex.match?(~r{^https?://raw\.githubusercontent\.com/([^/]+/[^/]+?)/}, url) ->
        [_, repo | _] = Regex.run(~r{^https?://raw\.githubusercontent\.com/([^/]+/[^/]+?)/}, url)
        repo

      true ->
        nil
    end
  end

  @doc """
  Gets the GitHub token from admin settings, if configured.
  """
  def get_token do
    cfg = Nexus.Admin.get_setting("integrations") || %{}
    token = cfg["github_token"]
    if is_binary(token) && String.trim(token) != "", do: String.trim(token), else: nil
  end

  # ---------------------------------------------------------------------------
  # Private
  # ---------------------------------------------------------------------------

  defp req_get(url, token) do
    headers = [{"Accept", "application/vnd.github+json"}, {"X-GitHub-Api-Version", "2022-11-28"}]
    headers = if token, do: [{"Authorization", "Bearer #{token}"} | headers], else: headers

    Req.get(url, headers: headers, receive_timeout: 10_000)
  end
end
