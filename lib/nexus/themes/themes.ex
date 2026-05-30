defmodule Nexus.Themes do
  @moduledoc """
  Context for managing Nexus themes.

  Themes are visual presentation packages installed from GitHub releases.
  Unlike extensions, themes require no Elixir compilation — they consist of
  a theme.json manifest (declaring CSS variable overrides and optional settings)
  and an optional theme.css stylesheet.

  Themes do not take effect until explicitly assigned to a mode by the admin:
    - set_active(theme, :dark)  — assigns this theme to dark mode
    - set_active(theme, :light) — assigns this theme to light mode
    - set_active(theme, :both)  — assigns to both modes

  Only one theme can be active per mode. Setting a new active theme for a mode
  automatically deactivates any previously active theme for that mode.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Themes.{Theme, ThemeLoader}
  alias Nexus.Extensions.GitHub

  # ---------------------------------------------------------------------------
  # Queries
  # ---------------------------------------------------------------------------

  @doc "Returns all installed themes."
  def list_themes do
    Repo.all(from t in Theme, order_by: [asc: t.name])
  end

  @doc "Returns the theme currently active for the given mode (:dark or :light)."
  def get_active_theme(:dark),  do: Repo.one(from t in Theme, where: t.active_dark  == true)
  def get_active_theme(:light), do: Repo.one(from t in Theme, where: t.active_light == true)

  @doc "Returns a theme by slug, or nil."
  def get_theme_by_slug(slug), do: Repo.get_by(Theme, slug: slug)

  # ---------------------------------------------------------------------------
  # Install / update
  # ---------------------------------------------------------------------------

  @doc """
  Installs a theme from a GitHub repository URL.
  Fetches the latest release, downloads the tarball, validates theme.json,
  copies the stylesheet, and inserts the theme record.
  """
  def install_theme_from_url(url) do
    github_repo = GitHub.repo_from_url(url)
    unless github_repo do
      {:error, "Not a valid GitHub URL"}
    else
      token = GitHub.get_token()
      case GitHub.latest_release(github_repo, token) do
        {:error, reason} ->
          {:error, "Could not fetch latest release: #{inspect(reason)}"}

        {:ok, release} ->
          tag          = release.tag
          clean_tag    = String.trim_leading(tag, "v")
          tarball_url  = "https://github.com/#{github_repo}/archive/refs/tags/#{tag}.tar.gz"
          slug_hint    = github_repo |> String.split("/") |> List.last() |> String.downcase()

          case ThemeLoader.install_from_url(tarball_url, slug_hint, clean_tag) do
            {:error, reason} -> {:error, reason}

            {:ok, %{manifest: manifest, stylesheet_path: css_path}} ->
              slug = manifest["slug"] || slug_hint
              # Check for duplicate
              if get_theme_by_slug(slug) do
                {:error, "A theme with slug '#{slug}' is already installed"}
              else
                attrs = %{
                  name:              manifest["name"],
                  slug:              slug,
                  version:           manifest["version"],
                  description:       manifest["description"],
                  author:            manifest["author"],
                  homepage:          manifest["homepage"],
                  github_repo:       github_repo,
                  installed_version: clean_tag,
                  latest_version:    clean_tag,
                  release_notes:     release.body,
                  manifest:          manifest,
                  stylesheet_path:   css_path,
                  settings:          default_settings(manifest)
                }
                %Theme{}
                |> Theme.changeset(attrs)
                |> Repo.insert()
              end
          end
      end
    end
  end

  @doc """
  Checks GitHub for a newer release and updates the theme if one is found.
  """
  def update_theme(%Theme{} = theme) do
    token = GitHub.get_token()
    case GitHub.latest_release(theme.github_repo, token) do
      {:error, reason} ->
        {:error, "Could not check for updates: #{inspect(reason)}"}

      {:ok, release} ->
        clean_tag = String.trim_leading(release.tag, "v")
        if clean_tag == theme.installed_version do
          {:ok, :already_up_to_date}
        else
          tarball_url = "https://github.com/#{theme.github_repo}/archive/refs/tags/#{release.tag}.tar.gz"
          case ThemeLoader.install_from_url(tarball_url, theme.slug, clean_tag) do
            {:error, reason} -> {:error, reason}

            {:ok, %{manifest: manifest, stylesheet_path: css_path}} ->
              ThemeLoader.prune_cache(theme.slug, clean_tag)
              {:ok, updated} =
                theme
                |> Theme.changeset(%{
                  version:           manifest["version"],
                  installed_version: clean_tag,
                  latest_version:    clean_tag,
                  release_notes:     release.body,
                  manifest:          manifest,
                  stylesheet_path:   css_path
                })
                |> Repo.update()
              {:ok, updated}
          end
        end
    end
  end

  @doc """
  Saves admin-configured settings for a theme.
  """
  def update_theme_settings(%Theme{} = theme, settings) do
    theme
    |> Theme.settings_changeset(settings)
    |> Repo.update()
  end

  # ---------------------------------------------------------------------------
  # Mode assignment
  # ---------------------------------------------------------------------------

  @doc """
  Sets a theme as active for the given mode. Automatically deactivates any
  previously active theme for that mode.

  mode can be :dark, :light, or :both.
  Pass nil to deactivate (use default Nexus appearance for that mode).
  """
  def set_active(%Theme{} = theme, mode) when mode in [:dark, :light, :both] do
    Repo.transaction(fn ->
      # Clear existing active theme(s) for the requested mode(s)
      case mode do
        :dark  -> clear_active(:dark)
        :light -> clear_active(:light)
        :both  -> clear_active(:dark); clear_active(:light)
      end

      # Set the new active flags
      changes =
        case mode do
          :dark  -> %{active_dark: true}
          :light -> %{active_light: true}
          :both  -> %{active_dark: true, active_light: true}
        end

      theme |> Theme.changeset(changes) |> Repo.update!()
    end)
  end

  @doc "Deactivates a theme for the given mode without assigning another."
  def deactivate(%Theme{} = theme, mode) when mode in [:dark, :light, :both] do
    changes =
      case mode do
        :dark  -> %{active_dark: false}
        :light -> %{active_light: false}
        :both  -> %{active_dark: false, active_light: false}
      end
    theme |> Theme.changeset(changes) |> Repo.update()
  end

  # ---------------------------------------------------------------------------
  # Uninstall
  # ---------------------------------------------------------------------------

  @doc "Uninstalls a theme — deletes the DB record and all associated files."
  def uninstall_theme(%Theme{} = theme) do
    ThemeLoader.delete_theme_files(theme.slug)
    Repo.delete(theme)
  end

  # ---------------------------------------------------------------------------
  # Latest version check
  # ---------------------------------------------------------------------------

  @doc "Checks GitHub for the latest release tag and updates latest_version on the record."
  def check_for_update(%Theme{} = theme) do
    token = GitHub.get_token()
    case GitHub.latest_release(theme.github_repo, token) do
      {:ok, release} ->
        clean = String.trim_leading(release.tag, "v")
        theme
        |> Theme.changeset(%{latest_version: clean, release_notes: release.body})
        |> Repo.update()

      {:error, _} ->
        {:ok, theme}
    end
  end

  # ---------------------------------------------------------------------------
  # Store — fetch themes from the shared registry
  # ---------------------------------------------------------------------------

  # Themes are listed in the same registry as extensions.
  # Entries with "type": "theme" are returned; all others are ignored.
  @registry_url "https://raw.githubusercontent.com/ResofireV2/nexus-extensions/main/registry.json"

  def fetch_store(registry_url \\ @registry_url) do
    with :ok <- Nexus.URLSafeGuard.validate(registry_url) do
      case Req.get(registry_url, receive_timeout: 15_000, decode_body: false) do
        {:ok, %{status: 200, body: body}} ->
          entries =
            case Jason.decode(body) do
              {:ok, %{"extensions" => list}} when is_list(list) -> list
              {:ok, list} when is_list(list) -> list
              _ -> :decode_error
            end

          case entries do
            :decode_error ->
              {:error, "The registry returned invalid JSON."}

            entries ->
              # Filter to theme entries only
              themes = Enum.filter(entries, fn e -> e["type"] == "theme" end)
              installed_slugs = Repo.all(from t in Theme, select: t.slug) |> MapSet.new()
              enriched = Enum.map(themes, fn entry ->
                Map.put(entry, "installed", MapSet.member?(installed_slugs, entry["slug"]))
              end)
              {:ok, enriched}
          end

        {:ok, %{status: status}} ->
          {:error, "Registry returned HTTP #{status}"}

        {:error, reason} ->
          {:error, "Could not reach registry: #{inspect(reason)}"}
      end
    else
      {:error, reason} -> {:error, "Invalid registry URL: #{reason}"}
    end
  end

  defp clear_active(:dark) do
    Repo.update_all(from(t in Theme, where: t.active_dark == true), set: [active_dark: false])
  end

  defp clear_active(:light) do
    Repo.update_all(from(t in Theme, where: t.active_light == true), set: [active_light: false])
  end

  # Build default settings map from the theme's settings schema
  defp default_settings(manifest) do
    case manifest["settings"] do
      nil -> %{}
      settings when is_list(settings) ->
        Enum.reduce(settings, %{}, fn setting, acc ->
          Map.put(acc, setting["key"], setting["default"])
        end)
      _ -> %{}
    end
  end
end
