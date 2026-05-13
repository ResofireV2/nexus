defmodule NexusWeb.Plugs.PwaSettings do
  @moduledoc """
  Reads PWA settings from site_settings once per browser request and assigns
  them to conn so root.html.heex can render dynamic meta tags (status bar style,
  theme color, app title) without a separate database call in the template.
  """

  import Plug.Conn

  def init(opts), do: opts

  def call(conn, _opts) do
    pwa     = Nexus.Admin.get_setting("pwa") || %{}
    general = Nexus.Admin.get_setting("general") || %{}

    conn
    |> assign(:pwa_status_bar_style, pwa["status_bar_style"] || "black-translucent")
    |> assign(:pwa_theme_color,      pwa["theme_color"]      || "#5B4EF5")
    |> assign(:pwa_app_name,         pwa["app_name"] || general["site_name"] || "Nexus")
    |> assign(:pwa_icon_path,        pwa["icon_180_path"] || pwa["icon_192_path"] || "/images/icon-192.png")
    |> assign(:og_site_name,         general["site_name"] || "Nexus")
    |> assign(:og_description,       general["site_description"] || "")
    |> assign(:og_image_url,         case general["og_image_url"] do
         nil -> nil
         url ->
           # Ensure the URL is absolute — Twitter/X rejects relative og:image URLs
           if String.starts_with?(url, "http"), do: url, else: NexusWeb.Endpoint.url() <> url
       end)
  end
end
