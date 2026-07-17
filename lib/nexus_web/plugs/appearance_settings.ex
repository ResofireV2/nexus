defmodule NexusWeb.Plugs.AppearanceSettings do
  @moduledoc """
  Computes the fully-resolved theme CSS variables for both modes on the server
  and assigns them (plus branding) to the conn so `root.html.heex` can paint the
  correct accent colour, surfaces, logo and favicon on the very first byte —
  before the React bundle loads and before the `/branding` fetch resolves.

  This is what removes the accent-colour flash and the logo/favicon flash on a
  cold localStorage cache. Settings are read through `Nexus.Admin.get_setting/1`,
  which is cache-backed (`Nexus.SettingsCache`), so this adds no meaningful
  request cost.

  Assigns:

    * `:theme_vars_css`      — a `<style>` body: a `:root{}` fallback for the
                               admin default theme plus `:root[data-theme=dark]`
                               and `:root[data-theme=light]` rules.
    * `:theme_cfg_json`      — JSON `{darkEnabled, lightEnabled, defaultTheme}`
                               for the inline theme-resolution script.
    * `:branding_json`       — JSON branding blob for `window.__nexusBranding`.
    * `:branding_logo_url`   — logo URL (or nil) for the preload `<link>`.
    * `:branding_favicon_url`— favicon URL (or nil) for the icon `<link>`.
  """

  import Plug.Conn

  alias Nexus.Appearance.ThemeVars

  def init(opts), do: opts

  def call(conn, _opts) do
    app0    = Nexus.Admin.get_setting("appearance") || %{}
    general = Nexus.Admin.get_setting("general") || %{}

    # Attach active themes in the same shape ThemeVars expects, mirroring the
    # serialisation used by GET /api/v1/branding.
    {active_dark, active_light} = active_themes()
    app =
      app0
      |> Map.put("active_theme_dark", active_dark)
      |> Map.put("active_theme_light", active_light)

    dark_enabled  = app["dark_enabled"] != false
    light_enabled = app["light_enabled"] != false
    default_theme = present(app["default_theme"], "dark")
    server_default = server_default_mode(default_theme, dark_enabled, light_enabled)

    css =
      # Bare :root fallback (used before the inline script sets data-theme, and
      # if JS is disabled). Lower specificity than the [data-theme] rules, which
      # take over the instant data-theme is set.
      ThemeVars.css_root(server_default, app) <>
        ThemeVars.css_rule("dark", app) <>
        ThemeVars.css_rule("light", app)

    theme_cfg =
      Jason.encode!(
        %{
          darkEnabled: dark_enabled,
          lightEnabled: light_enabled,
          defaultTheme: default_theme
        },
        escape: :html_safe
      )

    logo_url    = present(general["logo_url"], nil)
    favicon_url = present(general["favicon_url"], nil)

    branding =
      Jason.encode!(
        %{
          logo_url: logo_url,
          site_name: present(general["site_name"], nil),
          favicon_url: favicon_url,
          hero_title: present(general["hero_title"], nil),
          hero_body: present(general["hero_body"], nil),
          hero_enabled: general["hero_enabled"] == true
        },
        escape: :html_safe
      )

    conn
    |> assign(:theme_vars_css, css)
    |> assign(:theme_cfg_json, theme_cfg)
    |> assign(:branding_json, branding)
    |> assign(:branding_logo_url, logo_url)
    |> assign(:branding_favicon_url, favicon_url)
  end

  # Mirror admin_controller's serialize_active/1 shape, reduced to the variable
  # maps ThemeVars needs.
  defp active_themes do
    themes = Nexus.Themes.list_themes()
    {shape(Enum.find(themes, & &1.active_dark)), shape(Enum.find(themes, & &1.active_light))}
  rescue
    # If the themes context is unavailable for any reason, fall back to no
    # overrides rather than failing the page render.
    _ -> {nil, nil}
  end

  defp shape(nil), do: nil

  defp shape(theme) do
    %{
      "variables" => get_in(theme.manifest, ["variables"]) || %{},
      "dark_variables" => get_in(theme.manifest, ["modes", "dark", "variables"]) || %{},
      "light_variables" => get_in(theme.manifest, ["modes", "light", "variables"]) || %{}
    }
  end

  # Server can't know the user's stored pref or OS, so it paints the admin
  # default. The inline script re-resolves against localStorage before paint and
  # sets data-theme, at which point the higher-specificity rule takes over.
  defp server_default_mode(default_theme, dark_enabled, light_enabled) do
    cond do
      default_theme == "light" and light_enabled -> "light"
      default_theme == "dark" and dark_enabled -> "dark"
      dark_enabled -> "dark"
      light_enabled -> "light"
      true -> "dark"
    end
  end

  defp present(val, default), do: if(is_binary(val) and val != "", do: val, else: default)
end
