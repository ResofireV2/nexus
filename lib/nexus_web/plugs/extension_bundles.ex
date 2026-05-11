defmodule NexusWeb.Plugs.ExtensionBundles do
  @moduledoc """
  Assigns enabled extension JS bundle URLs to conn so root.html.heex can
  render them as <script> tags in the HTML head — loaded synchronously
  alongside app.js, before React mounts.

  This replaces the deferred fetch("/api/v1/slots/all") + dynamic script
  injection approach, eliminating timing issues where extension bundles
  registered toolbar buttons and other hooks after the React component
  tree had already rendered its initial state.
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

    assign(conn, :extension_bundle_urls, bundles)
  rescue
    _ -> assign(conn, :extension_bundle_urls, [])
  end
end
