defmodule Nexus.Extensions do
  @moduledoc """
  The Extensions context. Manages installed extensions, webhooks, and UI slots.

  Extensions are installed from a manifest.json hosted on GitHub or any URL.
  Backend hooks fire as authenticated HTTP POST requests to the extension's
  webhook_url. Frontend slots are loaded from the extension's js_bundle_url
  at runtime in the browser — no recompile required.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Extensions.{Extension, Hook, Slot}

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
    |> preload([:hooks, :slots])
    |> Repo.all()
  end

  def get_extension(id), do: Repo.get(Extension, id) |> Repo.preload([:hooks, :slots])

  def get_extension_by_slug(slug), do: Repo.get_by(Extension, slug: slug) |> Repo.preload([:hooks, :slots])

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
            {:error, reason} ->
              Logger.error("Extensions: failed to load #{ext.slug}: #{inspect(reason)}")
          end

        {:error, reason} ->
          Logger.warning("Extensions: cannot determine tarball URL for #{ext.slug}: #{reason}")
      end
    end
  end

  def install_extension(attrs) do
    Repo.transaction(fn ->
      # Store settings_schema, settings_tabs, logo_url and banner_url inside the manifest field
      # so extension_json can read them back without needing extra DB columns.
      manifest = %{
        "settings_schema" => Map.get(attrs, "settings_schema", %{}),
        "settings_tabs"   => Map.get(attrs, "settings_tabs", []),
        "logo_url"        => Map.get(attrs, "logo_url"),
        "banner_url"      => Map.get(attrs, "banner_url"),
      }
      # Auto-generate a proxy secret if the extension has a service_url
      proxy_secret =
        if Map.get(attrs, "service_url") do
          :crypto.strong_rand_bytes(32) |> Base.url_encode64(padding: false)
        end

      ext_attrs =
        attrs
        |> Map.drop(["hooks", "slots", "settings_schema", "settings_tabs"])
        |> Map.put("manifest", manifest)
        |> Map.put("proxy_secret", proxy_secret)

      case %Extension{} |> Extension.changeset(ext_attrs) |> Repo.insert() do
        {:ok, ext} ->
          # Register hooks
          for hook <- Map.get(attrs, "hooks", []) do
            %Hook{}
            |> Hook.changeset(%{
              extension_id: ext.id,
              event:        hook["event"],
              handler:      hook["event"],  # for webhook model handler == event name
              priority:     hook["priority"] || 50
            })
            |> Repo.insert!()
          end

          # Register slots
          for slot <- Map.get(attrs, "slots", []) do
            %Slot{}
            |> Slot.changeset(%{
              extension_id: ext.id,
              slot:         slot["slot"],
              component:    slot["component"] || ext.slug,
              priority:     slot["priority"] || 50
            })
            |> Repo.insert!()
          end

          Repo.preload(ext, [:hooks, :slots])

        {:error, changeset} ->
          Repo.rollback(changeset)
      end
    end)
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
         {:ok, manifest}                   <- parse_manifest(body),
         :ok                               <- validate_manifest(manifest) do

      # Fields we allow the manifest to update on sync — settings and slug are excluded
      # intentionally: settings are admin-managed, slug changes would break installs.
      github_repo = Nexus.Extensions.GitHub.repo_from_url(ext.manifest_url) || ext.github_repo

      update_attrs = %{
        "name"          => manifest["name"],
        "version"       => ext.version,
        "description"   => manifest["description"],
        "author"        => manifest["author"],
        "homepage"      => manifest["homepage"],
        "webhook_url"   => manifest["webhook_url"],
        "js_bundle_url" => manifest["js_bundle_url"],
        "service_url"   => manifest["service_url"],
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
    ext
    |> Extension.toggle_changeset()
    |> Repo.update()
  end

  def update_extension_settings(%Extension{} = ext, settings) do
    ext
    |> Extension.settings_changeset(settings)
    |> Repo.update()
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
         {:ok, manifest}    <- parse_manifest(body),
         :ok                <- validate_manifest(manifest) do

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
          case Nexus.Extensions.Loader.load_from_url(tarball_url, slug) do
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

            {:error, reason} ->
              require Logger
              Logger.warning("install_from_url: saved #{slug} to DB but compile failed: #{inspect(reason)}")
          end
        end

        {:ok, Repo.preload(Repo.reload!(ext), [:hooks, :slots])}
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

    with {:ok, release}  <- Nexus.Extensions.GitHub.latest_release(ext.github_repo, token),
         {:ok, manifest} <- Nexus.Extensions.GitHub.manifest_at_tag(ext.github_repo, release.tag, token),
         :ok             <- validate_manifest(manifest) do

      # Strip leading "v" from the tag so version strings are consistent.
      # e.g. "v0.2.0" → "0.2.0" — the UI adds "v" prefix for display.
      clean_tag = String.trim_leading(release.tag, "v")

      update_attrs = %{
        "name"              => manifest["name"],
        "version"           => clean_tag,
        "description"       => manifest["description"],
        "author"            => manifest["author"],
        "homepage"          => manifest["homepage"],
        "webhook_url"       => manifest["webhook_url"],
        "js_bundle_url"     => manifest["js_bundle_url"],
        "service_url"       => manifest["service_url"],
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
        case Nexus.Extensions.Loader.reload(tarball_url, ext.slug, old_module) do
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

          {:error, reason} ->
            require Logger
            Logger.error("Failed to reload #{ext.slug} after update: #{inspect(reason)}")
        end

        {:ok, updated}
      end
    end
  end



  # ---------------------------------------------------------------------------
  # Store — fetch the community registry
  # ---------------------------------------------------------------------------

  @registry_url "https://cdn.jsdelivr.net/gh/ResofireV2/nexus-extensions@main/registry.json"

  def fetch_store(registry_url \\ @registry_url) do
    case Req.get(registry_url, receive_timeout: 15_000) do
      {:ok, %{status: 200, body: body}} ->
        entries = cond do
          is_list(body)              -> body
          is_map(body)               -> Map.get(body, "extensions", [])
          is_binary(body)            ->
            case Jason.decode(body) do
              {:ok, %{"extensions" => list}} -> list
              {:ok, list} when is_list(list) -> list
              _                              -> []
            end
          true -> []
        end

        # Mark which extensions are already installed
        installed_slugs =
          Repo.all(from e in Extension, select: e.slug)
          |> MapSet.new()

        enriched =
          Enum.map(entries, fn entry ->
            Map.put(entry, "installed", MapSet.member?(installed_slugs, entry["slug"]))
          end)

        {:ok, enriched}

      {:ok, %{status: status}} ->
        {:error, "Registry returned HTTP #{status}"}

      {:error, reason} ->
        {:error, "Could not fetch store: #{inspect(reason)}"}
    end
  end

  # ---------------------------------------------------------------------------
  # Hook system — webhook delivery
  #
  # Fires an event to all enabled extensions subscribed to it.
  # Each delivery is a signed HTTP POST to the extension's webhook_url.
  # Failures are non-fatal and logged as warnings.
  # ---------------------------------------------------------------------------

  def fire(event, payload \\ %{}) when event in @hook_events do
    # Call extension handle_event/3 directly — no HTTP, no serialization overhead.
    # Each call runs in its own supervised Task so a crashing extension can't
    # affect the caller or other extensions.
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
  # Slot system
  # ---------------------------------------------------------------------------

  def slots_for(slot_name) when slot_name in @ui_slots do
    Nexus.Extensions.Registry.slots_for(slot_name)
  end

  def slots_for(_), do: []

  def all_slot_assignments do
    from(s in Slot,
      join: e in Extension, on: s.extension_id == e.id,
      where: e.enabled == true,
      order_by: [asc: s.slot, asc: s.priority],
      select: %{
        slot: s.slot,
        component: s.component,
        priority: s.priority,
        extension_name: e.name,
        extension_slug: e.slug
      }
    )
    |> Repo.all()
    |> Enum.group_by(& &1.slot)
  end

  # ---------------------------------------------------------------------------
  # Legacy hook registration helpers (kept for compatibility)
  # ---------------------------------------------------------------------------

  def register_hook(extension_id, event, handler, priority \\ 50) do
    %Hook{}
    |> Hook.changeset(%{extension_id: extension_id, event: event,
                        handler: handler, priority: priority})
    |> Repo.insert()
  end

  def register_slot(extension_id, slot, component, priority \\ 50) do
    %Slot{}
    |> Slot.changeset(%{extension_id: extension_id, slot: slot,
                        component: component, priority: priority})
    |> Repo.insert()
  end

  # ---------------------------------------------------------------------------
  # Private — webhook delivery
  # ---------------------------------------------------------------------------

  defp deliver_webhook(extension, event, payload) do
    case Nexus.URLSafeGuard.validate(extension.webhook_url) do
      {:error, reason} ->
        require Logger
        Logger.warning("Extensions: blocked webhook delivery to #{extension.webhook_url}: #{reason}")
        :ok
      :ok ->
    body = %{
      event:      event,
      payload:    payload,
      settings:   extension.settings,
      extension:  extension.slug,
      timestamp:  DateTime.utc_now() |> DateTime.to_unix()
    }

    secret    = extension.settings["webhook_secret"]
    body_json = Jason.encode!(body)

    headers = [
      {"Content-Type", "application/json"},
      {"X-Nexus-Event", event},
      {"X-Nexus-Extension", extension.slug}
    ]

    headers =
      if secret do
        sig = :crypto.mac(:hmac, :sha256, secret, body_json) |> Base.encode16(case: :lower)
        [{"X-Nexus-Signature", "sha256=#{sig}"} | headers]
      else
        headers
      end

    case Req.post(extension.webhook_url,
           body: body_json,
           headers: headers,
           receive_timeout: 10_000) do
      {:ok, %{status: status}} when status in 200..299 ->
        :ok

      {:ok, %{status: status}} ->
        require Logger
        Logger.warning("Webhook for #{extension.slug} returned HTTP #{status} on event #{event}")

      {:error, reason} ->
        require Logger
        Logger.warning("Webhook delivery failed for #{extension.slug} on event #{event}: #{inspect(reason)}")
    end
    end # URLSafeGuard
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

  defp validate_manifest(manifest) do
    required = ["name", "slug"]
    missing  = Enum.filter(required, &(not Map.has_key?(manifest, &1)))

    if missing == [] do
      :ok
    else
      {:error, "manifest.json is missing required fields: #{Enum.join(missing, ", ")}"}
    end
  end
end
