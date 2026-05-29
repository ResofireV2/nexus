defmodule Nexus.Extensions.ManifestSchemaTest do
  use ExUnit.Case, async: true

  alias Nexus.Extensions.ManifestSchema

  # ---------------------------------------------------------------------------
  # A minimal-but-valid manifest used as a baseline across tests. Individual
  # tests override or remove fields to exercise specific validation paths.
  # ---------------------------------------------------------------------------
  defp baseline_manifest do
    %{
      "manifest_version" => 2,
      "name"             => "Gamepedia",
      "slug"             => "gamepedia",
      "version"          => "1.0.0",
      "module"           => "Gamepedia"
    }
  end

  describe "manifest_version" do
    test "accepts supported version" do
      assert {:ok, norm, []} = ManifestSchema.validate(baseline_manifest())
      assert norm["manifest_version"] == 2
    end

    test "rejects missing manifest_version" do
      m = Map.delete(baseline_manifest(), "manifest_version")
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "manifest_version is required"))
    end

    test "rejects unsupported manifest_version" do
      m = Map.put(baseline_manifest(), "manifest_version", 99)
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "manifest_version must be one of"))
    end

    test "rejects manifest_version 1 (no backward compatibility)" do
      m = Map.put(baseline_manifest(), "manifest_version", 1)
      assert {:error, _} = ManifestSchema.validate(m)
    end
  end

  describe "identity fields" do
    test "rejects missing name" do
      m = Map.delete(baseline_manifest(), "name")
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "name is required"))
    end

    test "rejects missing slug" do
      m = Map.delete(baseline_manifest(), "slug")
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "slug is required"))
    end

    test "rejects slug with uppercase letters" do
      m = Map.put(baseline_manifest(), "slug", "GamePedia")
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "slug must match"))
    end

    test "rejects slug with spaces" do
      m = Map.put(baseline_manifest(), "slug", "game pedia")
      assert {:error, _} = ManifestSchema.validate(m)
    end

    test "accepts slug with hyphens" do
      m = Map.put(baseline_manifest(), "slug", "my-cool-extension")
      assert {:ok, norm, _} = ManifestSchema.validate(m)
      assert norm["slug"] == "my-cool-extension"
    end

    test "rejects malformed version" do
      m = Map.put(baseline_manifest(), "version", "not-a-version")
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "version must be a semver"))
    end

    test "accepts pre-release version" do
      m = Map.put(baseline_manifest(), "version", "1.0.0-beta.1")
      assert {:ok, _, _} = ManifestSchema.validate(m)
    end
  end

  describe "module field" do
    test "rejects missing module" do
      m = Map.delete(baseline_manifest(), "module")
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "module is required"))
    end

    test "rejects lowercase module name" do
      m = Map.put(baseline_manifest(), "module", "gamepedia")
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "module must be a valid Elixir module name"))
    end

    test "accepts namespaced module" do
      m = Map.put(baseline_manifest(), "module", "Gamepedia.Extension")
      assert {:ok, norm, _} = ManifestSchema.validate(m)
      assert norm["module"] == "Gamepedia.Extension"
    end
  end

  describe "js_bundle field" do
    test "defaults to nil when omitted" do
      assert {:ok, norm, _} = ManifestSchema.validate(baseline_manifest())
      assert norm["js_bundle"] == nil
    end

    test "accepts a relative path" do
      m = Map.put(baseline_manifest(), "js_bundle", "gamepedia.js")
      assert {:ok, norm, _} = ManifestSchema.validate(m)
      assert norm["js_bundle"] == "gamepedia.js"
    end

    test "rejects absolute path" do
      m = Map.put(baseline_manifest(), "js_bundle", "/absolute/path.js")
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "must be a relative path"))
    end

    test "rejects path traversal" do
      m = Map.put(baseline_manifest(), "js_bundle", "../escape.js")
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "must not contain '..'"))
    end
  end

  describe "hooks" do
    test "accepts a list of known hook events" do
      m = Map.put(baseline_manifest(), "hooks", ["post_created", "user_login"])
      assert {:ok, norm, _} = ManifestSchema.validate(m)
      assert norm["hooks"] == ["post_created", "user_login"]
    end

    test "rejects unknown hook event names" do
      m = Map.put(baseline_manifest(), "hooks", ["post_created", "totally_made_up"])
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "not a known hook event"))
    end

    test "defaults to empty list when omitted" do
      assert {:ok, norm, _} = ManifestSchema.validate(baseline_manifest())
      assert norm["hooks"] == []
    end
  end

  describe "slots" do
    test "accepts known slot names" do
      m = Map.put(baseline_manifest(), "slots", ["post_footer", "feed_sidebar"])
      assert {:ok, norm, _} = ManifestSchema.validate(m)
      assert norm["slots"] == ["post_footer", "feed_sidebar"]
    end

    test "rejects unknown slot names" do
      m = Map.put(baseline_manifest(), "slots", ["post_footer", "not_a_real_slot"])
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "not a known UI slot"))
    end
  end

  describe "routes" do
    test "accepts well-formed routes" do
      m = Map.put(baseline_manifest(), "routes", [
        %{"path" => "/"},
        %{"path" => "/users/:name", "title" => "Profile"}
      ])
      assert {:ok, norm, _} = ManifestSchema.validate(m)
      assert length(norm["routes"]) == 2
      assert hd(norm["routes"]) == %{"path" => "/", "title" => nil}
    end

    test "rejects route with /ext/ prefix" do
      m = Map.put(baseline_manifest(), "routes", [%{"path" => "/ext/gamepedia/x"}])
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "must not include /ext/"))
    end

    test "rejects route without leading slash" do
      m = Map.put(baseline_manifest(), "routes", [%{"path" => "users"}])
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "must start with '/'"))
    end

    test "rejects route missing path" do
      m = Map.put(baseline_manifest(), "routes", [%{"title" => "Oops"}])
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "path is required"))
    end
  end

  describe "right_widgets" do
    test "accepts widget with default scope" do
      m = Map.put(baseline_manifest(), "right_widgets", [
        %{"id" => "now-playing", "label" => "Now Playing"}
      ])
      assert {:ok, norm, _} = ManifestSchema.validate(m)
      [w] = norm["right_widgets"]
      assert w["scope"] == "extension"
      assert w["priority"] == 50
    end

    test "accepts widget with global scope" do
      m = Map.put(baseline_manifest(), "right_widgets", [
        %{"id" => "stats", "label" => "Stats", "scope" => "global"}
      ])
      assert {:ok, _, _} = ManifestSchema.validate(m)
    end

    test "accepts widget with path scope (string)" do
      m = Map.put(baseline_manifest(), "right_widgets", [
        %{"id" => "credits", "label" => "Credits", "scope" => %{"path" => "/:slug"}}
      ])
      assert {:ok, norm, _} = ManifestSchema.validate(m)
      [w] = norm["right_widgets"]
      assert w["scope"] == %{"path" => ["/:slug"]}
    end

    test "accepts widget with path scope (list)" do
      m = Map.put(baseline_manifest(), "right_widgets", [
        %{"id" => "trending", "label" => "Trending", "scope" => %{"path" => ["/", "/browse"]}}
      ])
      assert {:ok, _, _} = ManifestSchema.validate(m)
    end

    test "accepts widget with corePages scope" do
      m = Map.put(baseline_manifest(), "right_widgets", [
        %{"id" => "user-card", "label" => "User Card", "scope" => %{"corePages" => ["profile"]}}
      ])
      assert {:ok, _, _} = ManifestSchema.validate(m)
    end

    test "rejects unknown corePages entry" do
      m = Map.put(baseline_manifest(), "right_widgets", [
        %{"id" => "x", "label" => "X", "scope" => %{"corePages" => ["nonexistent"]}}
      ])
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "is not a known core page"))
    end

    test "rejects widget scope.path starting with /ext/" do
      m = Map.put(baseline_manifest(), "right_widgets", [
        %{"id" => "x", "label" => "X", "scope" => %{"path" => "/ext/foo"}}
      ])
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "must not include /ext/"))
    end

    test "rejects widget missing label" do
      m = Map.put(baseline_manifest(), "right_widgets", [%{"id" => "x"}])
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "label is required"))
    end
  end

  describe "toolbar_buttons" do
    test "accepts well-formed button" do
      m = Map.put(baseline_manifest(), "toolbar_buttons", [
        %{
          "id"   => "link-game",
          "icon" => "fa-solid fa-gamepad",
          "tip"  => "Link a game"
        }
      ])
      assert {:ok, norm, _} = ManifestSchema.validate(m)
      [b] = norm["toolbar_buttons"]
      assert b["scope"] == "both"
      assert b["priority"] == 50
    end

    test "rejects unknown scope" do
      m = Map.put(baseline_manifest(), "toolbar_buttons", [
        %{"id" => "x", "icon" => "fa-x", "tip" => "X", "scope" => "weird"}
      ])
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "scope must be"))
    end

    test "rejects missing icon" do
      m = Map.put(baseline_manifest(), "toolbar_buttons", [
        %{"id" => "x", "tip" => "X"}
      ])
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "icon is required"))
    end
  end

  describe "admin_panel" do
    test "accepts well-formed admin_panel" do
      m = Map.put(baseline_manifest(), "admin_panel", %{
        "label" => "Gamepedia",
        "icon"  => "fa-gamepad"
      })
      assert {:ok, norm, _} = ManifestSchema.validate(m)
      assert norm["admin_panel"] == %{"label" => "Gamepedia", "icon" => "fa-gamepad"}
    end

    test "rejects admin_panel missing label" do
      m = Map.put(baseline_manifest(), "admin_panel", %{"icon" => "fa-x"})
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "admin_panel.label must be a string"))
    end

    test "accepts null admin_panel" do
      m = Map.put(baseline_manifest(), "admin_panel", nil)
      assert {:ok, norm, _} = ManifestSchema.validate(m)
      assert norm["admin_panel"] == nil
    end
  end

  describe "explore" do
    test "accepts explore entry with default path" do
      m = Map.put(baseline_manifest(), "explore", %{
        "label" => "Games",
        "icon"  => "fa-gamepad"
      })
      assert {:ok, norm, _} = ManifestSchema.validate(m)
      assert norm["explore"]["path"] == "/"
    end

    test "accepts explore entry with custom path" do
      m = Map.put(baseline_manifest(), "explore", %{
        "label" => "Games",
        "icon"  => "fa-gamepad",
        "path"  => "/browse"
      })
      assert {:ok, norm, _} = ManifestSchema.validate(m)
      assert norm["explore"]["path"] == "/browse"
    end
  end

  describe "digest_sections" do
    test "accepts well-formed section" do
      m = Map.put(baseline_manifest(), "digest_sections", [
        %{
          "key"   => "gp_new_games",
          "label" => "New Games",
          "icon"  => "fa-gamepad",
          "enabled_by_default" => true
        }
      ])
      assert {:ok, norm, _} = ManifestSchema.validate(m)
      [s] = norm["digest_sections"]
      assert s["enabled_by_default"] == true
    end

    test "defaults enabled_by_default to false when omitted" do
      m = Map.put(baseline_manifest(), "digest_sections", [
        %{"key" => "gp_new_games", "label" => "New Games"}
      ])
      assert {:ok, norm, _} = ManifestSchema.validate(m)
      [s] = norm["digest_sections"]
      assert s["enabled_by_default"] == false
    end

    test "rejects section missing key" do
      m = Map.put(baseline_manifest(), "digest_sections", [%{"label" => "Oops"}])
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "digest_sections[0].key is required"))
    end
  end

  describe "capabilities" do
    test "accepts any string list (declare-now, enforce-later)" do
      m = Map.put(baseline_manifest(), "capabilities", ["users.read", "future.capability.no.one.has.defined"])
      assert {:ok, norm, _} = ManifestSchema.validate(m)
      assert "future.capability.no.one.has.defined" in norm["capabilities"]
    end

    test "rejects non-string entries" do
      m = Map.put(baseline_manifest(), "capabilities", ["users.read", 42])
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "capabilities entries must be strings"))
    end
  end

  describe "side_data" do
    test "accepts any string list" do
      m = Map.put(baseline_manifest(), "side_data", ["post", "user"])
      assert {:ok, norm, _} = ManifestSchema.validate(m)
      assert norm["side_data"] == ["post", "user"]
    end
  end

  describe "metadata fields" do
    test "accepts and normalizes optional URL fields" do
      m =
        baseline_manifest()
        |> Map.put("homepage",   "https://example.com")
        |> Map.put("repository", "https://github.com/example/example")
        |> Map.put("license",    "MIT")
        |> Map.put("tags",       ["games", "social"])
        |> Map.put("compatible_with", "^4.0")
        |> Map.put("logo_url",   "/ext/gamepedia/assets/logo.png")

      assert {:ok, norm, _} = ManifestSchema.validate(m)
      assert norm["homepage"]   == "https://example.com"
      assert norm["repository"] == "https://github.com/example/example"
      assert norm["license"]    == "MIT"
      assert norm["tags"]       == ["games", "social"]
      assert norm["compatible_with"] == "^4.0"
      assert norm["logo_url"]   == "/ext/gamepedia/assets/logo.png"
    end

    test "rejects URLs without scheme or slash" do
      m = Map.put(baseline_manifest(), "homepage", "example.com")
      assert {:error, errors} = ManifestSchema.validate(m)
      assert Enum.any?(errors, &String.contains?(&1, "homepage must be a URL"))
    end
  end

  describe "error accumulation" do
    test "reports multiple errors in one pass" do
      m =
        baseline_manifest()
        |> Map.delete("name")
        |> Map.delete("slug")
        |> Map.put("version", "garbage")

      assert {:error, errors} = ManifestSchema.validate(m)
      # All three problems should be reported.
      assert length(errors) >= 3
      assert Enum.any?(errors, &String.contains?(&1, "name"))
      assert Enum.any?(errors, &String.contains?(&1, "slug"))
      assert Enum.any?(errors, &String.contains?(&1, "version"))
    end
  end

  describe "non-map input" do
    test "rejects nil input with a helpful error" do
      assert {:error, [msg]} = ManifestSchema.validate(nil)
      assert msg =~ "manifest must be a JSON object"
    end

    test "rejects string input" do
      assert {:error, _} = ManifestSchema.validate("not a manifest")
    end
  end

  describe "kitchen-sink fully-populated manifest" do
    test "accepts a manifest with every field populated" do
      m = %{
        "manifest_version" => 2,
        "name"             => "Gamepedia",
        "slug"             => "gamepedia",
        "version"          => "1.2.3",
        "description"      => "Game database integration for Nexus",
        "author"           => "testauthor",
        "homepage"         => "https://gamepedia.example.com",
        "repository"       => "https://github.com/testauthor/gamepedia",
        "license"          => "MIT",
        "tags"             => ["games", "media"],
        "compatible_with"  => "^4.0",
        "logo_url"         => "/ext/gamepedia/assets/logo.png",
        "banner_url"       => "/ext/gamepedia/assets/banner.png",
        "module"           => "Gamepedia",
        "js_bundle"        => "gamepedia.js",
        "settings_schema"  => %{"api_key" => %{"type" => "string"}},
        "settings_tabs"    => [%{"key" => "general", "label" => "General"}],
        "capabilities"     => ["users.read", "posts.read"],
        "side_data"        => ["post"],
        "hooks"            => ["post_created", "post_deleted"],
        "slots"            => ["post_footer"],
        "routes"           => [
          %{"path" => "/"},
          %{"path" => "/:slug", "title" => "Game"}
        ],
        "admin_panel"      => %{"label" => "Gamepedia", "icon" => "fa-gamepad"},
        "explore"          => %{"label" => "Games", "icon" => "fa-gamepad", "path" => "/"},
        "digest_sections"  => [
          %{"key" => "gp_new", "label" => "New", "icon" => "fa-gamepad", "enabled_by_default" => true}
        ],
        "right_widgets"    => [
          %{"id" => "now-playing", "label" => "Now Playing"},
          %{"id" => "credits", "label" => "Credits", "scope" => %{"path" => "/:slug"}}
        ],
        "toolbar_buttons"  => [
          %{"id" => "link-game", "icon" => "fa-solid fa-gamepad", "tip" => "Link a game"}
        ]
      }

      assert {:ok, norm, []} = ManifestSchema.validate(m)
      # Spot-check that the normalized form has the expected shape
      assert norm["slug"] == "gamepedia"
      assert length(norm["routes"]) == 2
      assert length(norm["right_widgets"]) == 2
      assert hd(norm["right_widgets"])["scope"] == "extension"  # default applied
    end
  end
end
