defmodule Nexus.Appearance.ThemeVars do
  @moduledoc """
  Server-side port of the theme-variable derivation that lives in JavaScript in
  `assets/js/nexus.jsx` (`deriveAccentVars`, `deriveTintVars`, and their light
  variants, plus `hexToRgb` / `luminance`).

  It exists so the HTML shell can render the fully-resolved CSS custom
  properties for both themes on the very first paint — before the React bundle
  loads and before the `/branding` fetch resolves. This eliminates the accent
  colour flash on a cold localStorage cache.

  This module MUST stay bit-for-bit identical to the JavaScript it mirrors.
  Because the same colours are computed twice (here, and again by `applyTheme`
  after `/branding` returns), any divergence would reintroduce a flash: the
  server paints one colour, then `applyTheme` overwrites it with a slightly
  different one. `test/nexus/theme_vars_test.exs` guards against that by
  asserting the output here matches values generated from the real JS math.

  Do not "clean up" the arithmetic, rounding, or string formatting without
  updating the JS side and the golden-value test in lockstep.
  """

  # Static per-mode text/border vars — copied verbatim from DARK_VARS / LIGHT_VARS
  # in nexus.jsx. These have no colour math; they are constants.
  @dark_static [
    {"--t1", "#f0eeff"},
    {"--t2", "rgba(255,255,255,0.65)"},
    {"--t3", "rgba(255,255,255,0.45)"},
    {"--t4", "rgba(255,255,255,0.25)"},
    {"--t5", "rgba(255,255,255,0.15)"},
    {"--b1", "rgba(255,255,255,0.07)"},
    {"--b2", "rgba(255,255,255,0.10)"},
    {"--b3", "rgba(255,255,255,0.14)"}
  ]

  @light_static [
    {"--t1", "#1a1428"},
    {"--t2", "rgba(26,20,80,0.70)"},
    {"--t3", "rgba(26,20,80,0.50)"},
    {"--t4", "rgba(26,20,80,0.30)"},
    {"--t5", "rgba(26,20,80,0.18)"},
    {"--b1", "rgba(26,20,80,0.07)"},
    {"--b2", "rgba(26,20,80,0.10)"},
    {"--b3", "rgba(26,20,80,0.14)"}
  ]

  # Non-tint surface fallbacks — mirror applyTheme's else-branch defaults.
  @dark_surface_default [
    {"--bg", "#111111"},
    {"--s1", "#1a1a1a"},
    {"--s2", "#222222"},
    {"--s3", "#2a2a2a"}
  ]

  @light_surface_default [
    {"--bg", "#f4f4f5"},
    {"--s1", "#ffffff"},
    {"--s2", "#e4e4e7"},
    {"--s3", "#d4d4d8"}
  ]

  @fs_keys ~w(fs_ui fs_body fs_title fs_content fs_feed_title fs_code)
  @fs_var %{
    "fs_ui" => "--fs-ui",
    "fs_body" => "--fs-body",
    "fs_title" => "--fs-title",
    "fs_content" => "--fs-content",
    "fs_feed_title" => "--fs-feed-title",
    "fs_code" => "--fs-code"
  }

  @doc """
  Build the ordered list of `{"--var", "value"}` pairs for a mode, exactly
  reproducing what `applyTheme(mode, app)` sets on the document element.

  `app` is a string-keyed appearance map (as returned by
  `Nexus.Admin.get_setting("appearance")`), optionally carrying
  `"active_theme_dark"` / `"active_theme_light"` maps with `"variables"`,
  `"dark_variables"` and `"light_variables"` sub-maps.
  """
  def vars("dark", app) do
    accent = present(app["accent_color"], "#4A90E2")

    @dark_static
    |> Kernel.++([{"--ac", accent}])
    |> Kernel.++(accent_pairs(accent_dark(accent)))
    |> Kernel.++(surface_pairs(app["tint_color"], &tint_dark(&1, app["tint_intensity"]), @dark_surface_default))
    |> Kernel.++([{"--link-color", present(app["link_color"], "#60a5fa")}])
    |> Kernel.++([{"--av-radius", "#{radius(app["avatar_radius"])}%"}])
    |> Kernel.++(fs_pairs(app))
    |> Kernel.++(theme_override_pairs(app["active_theme_dark"], "dark_variables"))
  end

  def vars("light", app) do
    accent = normalize_hash(present(app["light_accent_color"], "#2563eb"))

    @light_static
    |> Kernel.++([{"--ac", accent}])
    |> Kernel.++(accent_pairs(accent_light(accent)))
    |> Kernel.++(surface_pairs(app["light_tint_color"], &tint_light(&1, app["light_tint_intensity"]), @light_surface_default))
    |> Kernel.++([{"--link-color", present(app["light_link_color"], "#2563eb")}])
    |> Kernel.++([{"--av-radius", "#{radius(app["avatar_radius"])}%"}])
    |> Kernel.++(fs_pairs(app))
    |> Kernel.++(theme_override_pairs(app["active_theme_light"], "light_variables"))
  end

  @doc """
  Render a single `:root[data-theme="MODE"]{ ... }` CSS rule for a mode.

  Built with plain concatenation rather than a `~s(...)` sigil because the body
  contains `rgb(...)` / `rgba(...)` values whose parentheses would terminate a
  paren-delimited sigil early.
  """
  def css_rule(mode, app) do
    ":root[data-theme=\"" <> mode <> "\"]{" <> body_css(mode, app) <> "}"
  end

  @doc """
  Render a bare `:root{ ... }` rule for `mode`. Used as the pre-JS / no-JS
  fallback; its lower specificity means the `css_rule/2` `[data-theme]` rules
  win the instant the inline script sets `data-theme`.
  """
  def css_root(mode, app) do
    ":root{" <> body_css(mode, app) <> "}"
  end

  defp body_css(mode, app) do
    mode
    |> vars(app)
    |> Enum.map_join("", fn {k, v} -> "#{k}:#{v};" end)
  end

  # ── Derivation (faithful port — see moduledoc) ──────────────────────────────

  @doc "Parse #rrggbb or #rgb into `{r, g, b}` integers (0..255)."
  def hex_to_rgb(hex) do
    h = String.replace_prefix(hex, "#", "")

    full =
      if String.length(h) == 3 do
        h |> String.graphemes() |> Enum.map_join("", &(&1 <> &1))
      else
        h
      end

    n = String.to_integer(full, 16)
    {n |> Bitwise.bsr(16) |> Bitwise.band(255),
     n |> Bitwise.bsr(8) |> Bitwise.band(255),
     Bitwise.band(n, 255)}
  end

  @doc "Relative luminance (WCAG), matching the JS `luminance` helper."
  def luminance({r, g, b}) do
    0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
  end

  defp chan(v) do
    x = v / 255

    if x <= 0.03928 do
      x / 12.92
    else
      :math.pow((x + 0.055) / 1.055, 2.4)
    end
  end

  @doc "Dark-mode accent derivation. Returns a map or nil for invalid hex."
  def accent_dark(hex) do
    if valid6?(hex) do
      {r, g, b} = rgb = hex_to_rgb(hex)
      lum = luminance(rgb)

      %{
        on_accent: if(lum > 0.35, do: "#111111", else: "#ffffff"),
        ac_bg: "rgba(#{r},#{g},#{b},0.12)",
        ac_border: "rgba(#{r},#{g},#{b},0.30)",
        ac_text:
          cond do
            lum > 0.6 -> "rgb(#{rnd(r * 0.7)},#{rnd(g * 0.7)},#{rnd(b * 0.7)})"
            lum > 0.35 -> hex
            true -> "rgb(#{min(255, rnd(r * 1.3))},#{min(255, rnd(g * 1.3))},#{min(255, rnd(b * 1.3))})"
          end
      }
    end
  end

  @doc "Light-mode accent derivation. Returns a map or nil for invalid hex."
  def accent_light(hex) do
    if valid6?(hex) do
      {r, g, b} = rgb = hex_to_rgb(hex)
      lum = luminance(rgb)

      %{
        on_accent: if(lum > 0.35, do: "#111111", else: "#ffffff"),
        ac_bg: "rgba(#{r},#{g},#{b},0.09)",
        ac_border: "rgba(#{r},#{g},#{b},0.25)",
        ac_text: if(lum > 0.5, do: "rgb(#{rnd(r * 0.55)},#{rnd(g * 0.55)},#{rnd(b * 0.55)})", else: hex)
      }
    end
  end

  @doc "Dark-mode surface tint. Returns a map or nil for invalid hex."
  def tint_dark(hex, intensity) do
    if valid6?(hex) do
      {r, g, b} = hex_to_rgb(hex)
      amt = intensity_or(intensity, 10) / 100

      %{
        bg: mix(0x111111, r, g, b, amt),
        s1: mix(0x1A1A1A, r, g, b, amt),
        s2: mix(0x222222, r, g, b, amt),
        s3: mix(0x2A2A2A, r, g, b, amt)
      }
    end
  end

  @doc "Light-mode surface tint. Returns a map or nil for invalid hex."
  def tint_light(hex, intensity) do
    if valid6?(hex) do
      {r, g, b} = hex_to_rgb(hex)
      amt = intensity_or(intensity, 22) / 100

      %{
        bg: mix(0xF4F4F5, r, g, b, amt),
        s1: mix(0xFFFFFF, r, g, b, amt * 0.68),
        s2: mix(0xE4E4E7, r, g, b, amt),
        s3: mix(0xD4D4D8, r, g, b, amt)
      }
    end
  end

  @doc false
  def valid6?(hex) when is_binary(hex), do: Regex.match?(~r/^#[0-9a-fA-F]{6}$/, hex)
  def valid6?(_), do: false

  # ── Internal helpers ────────────────────────────────────────────────────────

  defp mix(base, r, g, b, amt) do
    br = base |> Bitwise.bsr(16) |> Bitwise.band(255)
    bg = base |> Bitwise.bsr(8) |> Bitwise.band(255)
    bb = Bitwise.band(base, 255)
    "rgb(#{rnd(br + (r - br) * amt)},#{rnd(bg + (g - bg) * amt)},#{rnd(bb + (b - bb) * amt)})"
  end

  # Elixir round/1 rounds halves away from zero; every value fed to rnd/1 here is
  # a weighted average of channel bytes in 0..255 (mix) or a byte scaled by a
  # positive factor (ac_text), so it is always non-negative and matches JS
  # Math.round over this domain.
  defp rnd(x), do: round(x)

  defp accent_pairs(nil), do: []

  defp accent_pairs(%{on_accent: on, ac_bg: bg, ac_border: bd, ac_text: tx}) do
    [{"--ac-on", on}, {"--ac-bg", bg}, {"--ac-border", bd}, {"--ac-text", tx}]
  end

  defp surface_pairs(tint_color, tint_fun, default_pairs) do
    if present?(tint_color) do
      case tint_fun.(tint_color) do
        %{bg: bg, s1: s1, s2: s2, s3: s3} ->
          [{"--bg", bg}, {"--s1", s1}, {"--s2", s2}, {"--s3", s3}]

        nil ->
          default_pairs
      end
    else
      default_pairs
    end
  end

  defp fs_pairs(app) do
    Enum.flat_map(@fs_keys, fn key ->
      case app[key] do
        v when is_number(v) and v > 0 -> [{@fs_var[key], "#{v}px"}]
        _ -> []
      end
    end)
  end

  defp theme_override_pairs(nil, _mode_key), do: []

  defp theme_override_pairs(theme, mode_key) when is_map(theme) do
    base = theme["variables"] || %{}
    mode = theme[mode_key] || %{}

    Map.merge(base, mode)
    |> Enum.map(fn {k, v} -> {to_string(k), to_string(v)} end)
    |> Enum.sort()
  end

  defp theme_override_pairs(_, _), do: []

  # JS falsy semantics: nil and "" fall through to the default.
  defp present(val, default), do: if(present?(val), do: val, else: default)
  defp present?(val), do: is_binary(val) and val != ""

  # `?? default` — only nil defaults; 0 is preserved.
  defp radius(nil), do: 22
  defp radius(v), do: v

  defp intensity_or(nil, default), do: default
  defp intensity_or(v, _default), do: v

  # Light accent normalises a missing leading '#'; dark does not (matches JS).
  defp normalize_hash("#" <> _ = hex), do: hex
  defp normalize_hash(hex) when is_binary(hex), do: "#" <> hex
end
