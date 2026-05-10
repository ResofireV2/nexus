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
    Repo.delete(ext)
  end

  def sync_manifest(%Extension{manifest_url: nil}), do: {:error, "No manifest URL stored for this extension"}
  def sync_manifest(%Extension{} = ext) do
    raw_url = to_raw_manifest_url(ext.manifest_url)

    with {:ok, %{status: 200, body: body}} <- Req.get(raw_url, receive_timeout: 10_000),
         {:ok, manifest}                   <- parse_manifest(body),
         :ok                               <- validate_manifest(manifest) do

      # Fields we allow the manifest to update on sync — settings and slug are excluded
      # intentionally: settings are admin-managed, slug changes would break installs.
      update_attrs = %{
        "name"          => manifest["name"],
        "version"       => manifest["version"],
        "description"   => manifest["description"],
        "author"        => manifest["author"],
        "homepage"      => manifest["homepage"],
        "webhook_url"   => manifest["webhook_url"],
        "js_bundle_url" => manifest["js_bundle_url"],
        "service_url"   => manifest["service_url"],
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

    with {:ok, %{status: 200, body: body}} <- Req.get(raw_url, receive_timeout: 10_000),
         {:ok, manifest} <- parse_manifest(body),
         :ok             <- validate_manifest(manifest) do

      attrs = Map.merge(manifest, %{"manifest_url" => url})
      install_extension(attrs)
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
    hooks =
      from(h in Hook,
        join: e in Extension, on: h.extension_id == e.id,
        where: h.event == ^event and h.enabled == true and e.enabled == true
              and not is_nil(e.webhook_url),
        order_by: [asc: h.priority],
        preload: :extension
      )
      |> Repo.all()

    for hook <- hooks do
      Task.start(fn -> deliver_webhook(hook.extension, event, payload) end)
    end

    :ok
  end

  def fire(_event, _payload), do: :ok

  # ---------------------------------------------------------------------------
  # Slot system
  # ---------------------------------------------------------------------------

  def slots_for(slot_name) when slot_name in @ui_slots do
    from(s in Slot,
      join: e in Extension, on: s.extension_id == e.id,
      where: s.slot == ^slot_name and s.enabled == true and e.enabled == true,
      order_by: [asc: s.priority],
      select: %{
        id: s.id,
        slot: s.slot,
        component: s.component,
        priority: s.priority,
        extension_slug: e.slug,
        js_bundle_url: e.js_bundle_url
      }
    )
    |> Repo.all()
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
    required = ["name", "slug", "version"]
    missing  = Enum.filter(required, &(not Map.has_key?(manifest, &1)))

    if missing == [] do
      :ok
    else
      {:error, "manifest.json is missing required fields: #{Enum.join(missing, ", ")}"}
    end
  end
end
