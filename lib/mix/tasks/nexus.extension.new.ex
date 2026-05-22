defmodule Mix.Tasks.Nexus.Extension.New do
  use Mix.Task

  @shortdoc "Scaffold a new Nexus extension"

  @moduledoc """
  Generates a new Nexus extension scaffold.

  Produces a minimal but correct extension package: a manifest_version 2
  manifest.json, an Elixir module that `use`s `Nexus.Extensions.Behaviour`,
  a JS bundle stub for browser-side registrations, and a README.

  The generated extension declares no contributions by default — every
  declaration in manifest.json is empty or omitted. As you add hooks,
  routes, slots, widgets, etc., update both the manifest (the contract)
  and the implementing code (Elixir handler or JS register call).

  ## Usage

      mix nexus.extension.new my_extension
      mix nexus.extension.new my_extension --author "Your Name" --description "Does something cool"

  ## Options

    * `--author` — Extension author name
    * `--description` — Short description
    * `--dir` — Output directory (default: `./extensions/<name>`)
  """

  @switches [author: :string, description: :string, dir: :string]

  def run(args) do
    {opts, argv, _} = OptionParser.parse(args, switches: @switches)

    name =
      case argv do
        [name | _] -> name
        [] ->
          Mix.raise("Extension name is required. Usage: mix nexus.extension.new <name>")
      end

    slug         = name |> String.downcase() |> String.replace(~r/[^a-z0-9]/, "-")
    underscored  = String.replace(slug, "-", "_")
    module_name  = name |> Macro.camelize()
    author       = Keyword.get(opts, :author, "Unknown")
    description  = Keyword.get(opts, :description, "A Nexus extension")
    dir          = Keyword.get(opts, :dir, "extensions/#{slug}")

    Mix.shell().info("Creating extension #{module_name} in #{dir}/")
    File.mkdir_p!(dir)

    # mix.exs
    write_file("#{dir}/mix.exs", mix_exs_template(module_name, slug, opts))

    # Main extension module — uses the behaviour, supplies no-op defaults.
    # All actual behaviour (hooks, lifecycle callbacks) is added here as
    # the extension grows. The filename uses the underscored slug so it's
    # conventional Elixir.
    File.mkdir_p!("#{dir}/lib")
    write_file("#{dir}/lib/#{underscored}.ex",
      extension_module_template(module_name))

    # Frontend bundle stub — left as a plain commented skeleton showing the
    # available register* calls. Empty by default; an extension that doesn't
    # need a frontend can simply delete this file and drop "js_bundle" from
    # the manifest.
    File.mkdir_p!("#{dir}/priv/static")
    write_file("#{dir}/priv/static/#{slug}.js",
      js_bundle_template(slug))

    # README
    write_file("#{dir}/README.md", readme_template(module_name, slug, description))

    # manifest.json — the contract. Everything the extension contributes
    # MUST be declared here; runtime registrations (Elixir handle_event/3
    # clauses, JS register* calls) are validated against these declarations
    # at load time.
    write_file("#{dir}/manifest.json",
      manifest_template(module_name, slug, description, author))

    Mix.shell().info("""

    Extension #{module_name} created successfully!

    Files:
      manifest.json              — declare hooks, slots, routes, widgets, etc.
      lib/#{underscored}.ex      — Elixir module (use this to implement handle_event/3)
      priv/static/#{slug}.js     — JS bundle (use this to register slots, routes, etc.)
      README.md                  — placeholder docs

    Next steps:
      1. cd #{dir}
      2. Edit manifest.json to declare what your extension contributes
      3. Add implementations in lib/#{underscored}.ex and priv/static/#{slug}.js
      4. Install into your Nexus instance:
           mix nexus.extension.install ./#{dir}

    The manifest schema is published at /manifest_schema.json on any
    Nexus instance — add this to your manifest.json for IDE validation:

        "$schema": "https://YOUR-NEXUS-HOST/manifest_schema.json"
    """)
  end

  defp write_file(path, content) do
    File.write!(path, content)
    Mix.shell().info("  created #{path}")
  end

  defp mix_exs_template(module_name, slug, opts) do
    version = Keyword.get(opts, :version, "0.1.0")
    underscored = String.replace(slug, "-", "_")
    """
    defmodule #{module_name}.MixProject do
      use Mix.Project

      def project do
        [
          app: :#{underscored},
          version: "#{version}",
          elixir: "~> 1.17",
          start_permanent: Mix.env() == :prod,
          deps: deps()
        ]
      end

      def application do
        [extra_applications: [:logger]]
      end

      defp deps do
        []
      end
    end
    """
  end

  defp extension_module_template(module_name) do
    """
    defmodule #{module_name} do
      @moduledoc \"\"\"
      Nexus extension implementation.

      The manifest at manifest.json is the source of truth for what this
      extension contributes. Implementations below dispatch on the hook
      events declared there.

      To subscribe to an event:
        1. Add the event name to the "hooks" array in manifest.json
        2. Add a handle_event/3 clause below that matches that event

      Nexus validates at install time that every declared hook has a
      matching handle_event/3 clause. Undeclared events fall through to
      the catch-all clause and are no-ops.
      \"\"\"

      use Nexus.Extensions.Behaviour

      # Example: handle a declared event. Add "post_created" to manifest.json
      # under "hooks" before uncommenting this clause.
      #
      # @impl true
      # def handle_event("post_created", %{"post_id" => post_id} = _payload, _settings) do
      #   require Logger
      #   Logger.info("#{module_name}: post created — \#{post_id}")
      #   :ok
      # end

      # Catch-all — every undeclared event reaches here as a no-op. Keep this
      # clause; declared events that don't have a specific clause above will
      # land here, which is fine.
      @impl true
      def handle_event(_event, _payload, _settings), do: :ok
    end
    """
  end

  defp js_bundle_template(slug) do
    """
    // #{slug} — Nexus extension bundle
    //
    // This file is served as window.NexusExtensions becomes available, BEFORE
    // React mounts. The slug must match manifest.json's "slug" field. Nexus
    // validates every register* call against the manifest's declarations at
    // register time; undeclared registrations log a console warning and
    // appear as a mismatch in Admin → Extensions → Runtime registrations.
    //
    // Available register* APIs (see EXTENSION_GUIDE.md for full details):
    //
    //   NE.registerSlot({slug, slot, component, priority?})
    //   NE.registerRoute(slug, path, Component, options?)
    //   NE.registerAdminPanel(slug, {label, icon, component})
    //   NE.registerExploreItem({slug, path?, id?, label, icon?, authOnly?, priority?})
    //   NE.registerRightWidget({slug, id, label, component, priority?, scope?})
    //   NE.registerToolbarButton({slug, id, icon, tip, onClick, scope?, priority?})

    (function() {
      "use strict";
      const NE   = window.NexusExtensions;
      const SLUG = "#{slug}";

      // Add your register* calls here. For example:
      //
      // NE.registerExploreItem({
      //   slug:  SLUG,
      //   path:  "/",
      //   label: "My Extension",
      //   icon:  "fa-puzzle-piece",
      // });
    })();
    """
  end

  defp readme_template(module_name, slug, description) do
    """
    # #{module_name}

    #{description}

    ## Installation

    Install via the Nexus admin panel (paste this repo's URL into the
    Install Extension form), or from the command line:

    ```bash
    mix nexus.extension.install ./path/to/#{slug}
    ```

    ## Configuration

    Configure via the Nexus admin panel at `/admin/extensions/#{slug}`.
    Settings declared in `manifest.json` under `settings_schema` appear
    as form fields automatically.

    ## Development

    The contract for what this extension contributes lives in
    `manifest.json`. The Elixir module under `lib/` implements server-side
    callbacks (hooks, lifecycle). The JS bundle under `priv/static/`
    implements browser-side registrations (slots, routes, widgets,
    toolbar buttons).

    Nexus validates manifest declarations against implementations at
    install time: declared hooks must have matching handle_event/3
    clauses, declared digest_sections must have matching
    handle_digest_section/3 clauses. JS-side registrations are validated
    in the browser at register time and surfaced in the admin runtime
    panel.

    For full API documentation, see Nexus's EXTENSION_GUIDE.md.
    """
  end

  defp manifest_template(module_name, slug, description, author) do
    Jason.encode!(%{
      "$schema":         "https://YOUR-NEXUS-HOST/manifest_schema.json",
      manifest_version:  2,
      name:              module_name,
      slug:              slug,
      version:           "0.1.0",
      description:       description,
      author:            author,
      homepage:          "https://github.com/#{author}/#{slug}",
      repository:        "https://github.com/#{author}/#{slug}",
      license:           "MIT",
      tags:              [],
      compatible_with:   "^1.0",
      module:            module_name,
      js_bundle:         "#{slug}.js",
      settings_schema:   %{},
      settings_tabs:     [],
      capabilities:      [],
      side_data:         [],
      hooks:             [],
      slots:             [],
      routes:            [],
      admin_panel:       nil,
      explore:           nil,
      digest_sections:   [],
      right_widgets:     [],
      toolbar_buttons:   []
    }, pretty: true)
  end
end
