defmodule NexusWeb.Plugs.ExtensionBundles do
  @moduledoc """
  Assigns enabled extension JS bundle URLs and their declared manifests
  to the conn so root.html.heex can render them as <script> tags in the
  HTML head — loaded synchronously alongside app.js, before React mounts.

  This replaces the deferred fetch("/api/v1/slots/all") + dynamic script
  injection approach, eliminating timing issues where extension bundles
  registered toolbar buttons and other hooks after the React component
  tree had already rendered its initial state.

  ## What's exposed to the frontend

  Two assigns are set:

    * `:extension_bundle_urls` — list of script URLs for `<script src=...>` tags.

    * `:extension_manifests` — map of `%{slug => normalized_manifest}` for every
      enabled, loaded extension. Inlined into the page as
      `window._nexusExtensionManifests = {...}` BEFORE the extension bundles
      load, so each bundle's `register*` calls can cross-check what they're
      registering against what the manifest declared (sub-stage 7D).

  Manifests are read from `Registry.all_declared/0` rather than from the DB
  `manifest` column. The registry holds only currently-loaded extensions, so
  disabled or failed-to-load extensions are correctly omitted from the
  manifest map even if their DB row still carries a manifest.
  """

  import Plug.Conn
  alias Nexus.Extensions

  def init(opts), do: opts

  def call(conn, _opts) do
    bundles =
      Extensions.list_extensions()
      |> Enum.filter(& &1.enabled && &1.js_bundle_url)
      |> Enum.map(fn ext ->
        vsn = ext.installed_version || ext.version || "0"
        "#{ext.js_bundle_url}?v=#{vsn}"
      end)
      |> Enum.uniq()

    manifests =
      Nexus.Extensions.Registry.all_declared()
      |> Enum.into(%{}, fn {slug, manifest} -> {slug, manifest} end)

    conn
    |> assign(:extension_bundle_urls, bundles)
    |> assign(:extension_manifests,   manifests)
  rescue
    _ ->
      conn
      |> assign(:extension_bundle_urls, [])
      |> assign(:extension_manifests,   %{})
  end
end
