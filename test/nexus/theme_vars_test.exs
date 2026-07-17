defmodule Nexus.Appearance.ThemeVarsTest do
  use ExUnit.Case, async: true

  alias Nexus.Appearance.ThemeVars

  # Golden values generated from the REAL JavaScript derivation functions in
  # assets/js/nexus.jsx (deriveAccentVars / deriveAccentVarsLight /
  # deriveTintVars / deriveTintVarsLight, run under Node). If the Elixir port
  # ever drifts from the JS, these assertions fail — which is the whole point:
  # a mismatch would reintroduce the accent-colour flash (server paints one
  # colour, applyTheme repaints a slightly different one).
  #
  # To regenerate after an intentional change, run the JS functions on these
  # same inputs and paste the outputs here, updating both sides together.

  describe "hex_to_rgb/1" do
    test "parses 6-char hex" do
      assert ThemeVars.hex_to_rgb("#4A90E2") == {74, 144, 226}
      assert ThemeVars.hex_to_rgb("#000000") == {0, 0, 0}
      assert ThemeVars.hex_to_rgb("#ffffff") == {255, 255, 255}
    end

    test "expands 3-char hex" do
      assert ThemeVars.hex_to_rgb("#abc") == ThemeVars.hex_to_rgb("#aabbcc")
    end
  end

  describe "accent_dark/1 matches JS deriveAccentVars" do
    for {hex, expected} <- [
          {"#4A90E2", %{on_accent: "#ffffff", ac_bg: "rgba(74,144,226,0.12)", ac_border: "rgba(74,144,226,0.30)", ac_text: "rgb(96,187,255)"}},
          {"#2563eb", %{on_accent: "#ffffff", ac_bg: "rgba(37,99,235,0.12)", ac_border: "rgba(37,99,235,0.30)", ac_text: "rgb(48,129,255)"}},
          # lum 0.336 (<0.35): brighten branch
          {"#a78bfa", %{on_accent: "#ffffff", ac_bg: "rgba(167,139,250,0.12)", ac_border: "rgba(167,139,250,0.30)", ac_text: "rgb(217,181,255)"}},
          # lum 0.733 (>0.6): darken branch
          {"#00ff88", %{on_accent: "#111111", ac_bg: "rgba(0,255,136,0.12)", ac_border: "rgba(0,255,136,0.30)", ac_text: "rgb(0,179,95)"}},
          {"#ffffff", %{on_accent: "#111111", ac_bg: "rgba(255,255,255,0.12)", ac_border: "rgba(255,255,255,0.30)", ac_text: "rgb(179,179,179)"}},
          # lum 0.439 (0.35..0.6): raw-hex branch
          {"#f59e0b", %{on_accent: "#111111", ac_bg: "rgba(245,158,11,0.12)", ac_border: "rgba(245,158,11,0.30)", ac_text: "#f59e0b"}},
          {"#000000", %{on_accent: "#ffffff", ac_bg: "rgba(0,0,0,0.12)", ac_border: "rgba(0,0,0,0.30)", ac_text: "rgb(0,0,0)"}}
        ] do
      test "accent_dark #{hex}" do
        assert ThemeVars.accent_dark(unquote(hex)) == unquote(Macro.escape(expected))
      end
    end

    test "returns nil for invalid hex" do
      assert ThemeVars.accent_dark("4A90E2") == nil
      assert ThemeVars.accent_dark("#fff") == nil
      assert ThemeVars.accent_dark("") == nil
    end
  end

  describe "accent_light/1 matches JS deriveAccentVarsLight" do
    for {hex, expected} <- [
          # lum 0.269 (<0.5): raw-hex branch
          {"#4A90E2", %{on_accent: "#ffffff", ac_bg: "rgba(74,144,226,0.09)", ac_border: "rgba(74,144,226,0.25)", ac_text: "#4A90E2"}},
          # lum 0.733 (>0.5): darken branch
          {"#00ff88", %{on_accent: "#111111", ac_bg: "rgba(0,255,136,0.09)", ac_border: "rgba(0,255,136,0.25)", ac_text: "rgb(0,140,75)"}},
          {"#ffffff", %{on_accent: "#111111", ac_bg: "rgba(255,255,255,0.09)", ac_border: "rgba(255,255,255,0.25)", ac_text: "rgb(140,140,140)"}},
          {"#f59e0b", %{on_accent: "#111111", ac_bg: "rgba(245,158,11,0.09)", ac_border: "rgba(245,158,11,0.25)", ac_text: "#f59e0b"}}
        ] do
      test "accent_light #{hex}" do
        assert ThemeVars.accent_light(unquote(hex)) == unquote(Macro.escape(expected))
      end
    end
  end

  describe "tint_dark/2 matches JS deriveTintVars" do
    test "explicit intensity" do
      assert ThemeVars.tint_dark("#4A90E2", 10) ==
               %{bg: "rgb(23,30,38)", s1: "rgb(31,38,46)", s2: "rgb(38,45,53)", s3: "rgb(45,52,60)"}

      assert ThemeVars.tint_dark("#7351db", 22) ==
               %{bg: "rgb(39,31,61)", s1: "rgb(46,38,68)", s2: "rgb(52,44,75)", s3: "rgb(58,51,81)"}
    end

    test "nil intensity defaults to 10" do
      assert ThemeVars.tint_dark("#4A90E2", nil) == ThemeVars.tint_dark("#4A90E2", 10)
    end
  end

  describe "tint_light/2 matches JS deriveTintVarsLight" do
    test "explicit intensity" do
      assert ThemeVars.tint_light("#4A90E2", 10) ==
               %{bg: "rgb(227,234,243)", s1: "rgb(243,247,253)", s2: "rgb(213,220,231)", s3: "rgb(198,205,217)"}

      assert ThemeVars.tint_light("#7351db", 22) ==
               %{bg: "rgb(216,208,239)", s1: "rgb(234,229,250)", s2: "rgb(203,196,228)", s3: "rgb(191,183,217)"}
    end

    test "nil intensity defaults to 22" do
      assert ThemeVars.tint_light("#4A90E2", nil) == ThemeVars.tint_light("#4A90E2", 22)
    end
  end

  describe "vars/2 assembly" do
    test "dark defaults reproduce applyTheme's dark output" do
      pairs = ThemeVars.vars("dark", %{}) |> Map.new()

      # Default accent when unconfigured
      assert pairs["--ac"] == "#4A90E2"
      assert pairs["--ac-text"] == "rgb(96,187,255)"
      assert pairs["--link-color"] == "#60a5fa"
      assert pairs["--av-radius"] == "22%"
      # Static var carried through
      assert pairs["--t1"] == "#f0eeff"
      # No tint configured -> surface fallback
      assert pairs["--bg"] == "#111111"
      assert pairs["--s1"] == "#1a1a1a"
    end

    test "light defaults reproduce applyTheme's light output" do
      pairs = ThemeVars.vars("light", %{}) |> Map.new()

      assert pairs["--ac"] == "#2563eb"
      assert pairs["--link-color"] == "#2563eb"
      assert pairs["--t1"] == "#1a1428"
      assert pairs["--bg"] == "#f4f4f5"
      assert pairs["--s1"] == "#ffffff"
    end

    test "custom accent + tint flow through" do
      app = %{"accent_color" => "#7351db", "tint_color" => "#7351db", "tint_intensity" => 22}
      pairs = ThemeVars.vars("dark", app) |> Map.new()

      assert pairs["--ac"] == "#7351db"
      assert pairs["--ac-text"] == "rgb(150,105,255)"
      assert pairs["--bg"] == "rgb(39,31,61)"
    end

    test "font-size vars only emitted when present and positive" do
      assert ThemeVars.vars("dark", %{}) |> Map.new() |> Map.has_key?("--fs-ui") == false
      pairs = ThemeVars.vars("dark", %{"fs_ui" => 15}) |> Map.new()
      assert pairs["--fs-ui"] == "15px"
    end

    test "active theme variables override and come last" do
      app = %{
        "accent_color" => "#4A90E2",
        "active_theme_dark" => %{
          "variables" => %{"--ac" => "#ff0000"},
          "dark_variables" => %{"--bg" => "#010101"}
        }
      }

      pairs = ThemeVars.vars("dark", app) |> Map.new()
      assert pairs["--ac"] == "#ff0000"
      assert pairs["--bg"] == "#010101"
    end
  end

  describe "css_rule/2" do
    test "wraps vars in a data-theme selector" do
      rule = ThemeVars.css_rule("dark", %{})
      assert String.starts_with?(rule, ~s(:root[data-theme="dark"]{))
      assert String.ends_with?(rule, "}")
      assert rule =~ "--ac:#4A90E2;"
    end
  end
end
