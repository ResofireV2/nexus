defmodule Nexus.Extensions.Behaviour do
  @moduledoc """
  The contract every Nexus extension must implement.

  An extension is an Elixir package that runs inside the Nexus VM — no
  separate container, no separate process, no Caddy config. Nexus compiles
  the extension's source code at install time using whatever Elixir/OTP
  version Nexus itself is running, so version mismatches are impossible.

  ## Minimal example

      defmodule MyExtension do
        @behaviour Nexus.Extensions.Behaviour

        @impl true
        def manifest do
          %{
            slug:        "my-extension",
            name:        "My Extension",
            version:     "1.0.0",
            description: "Does something cool.",
            author:      "your-github-username",
            homepage:    "https://github.com/you/my-extension",
            categories:  ["utilities"],
          }
        end
      end

  All callbacks except `manifest/0` are optional — the default implementations
  are no-ops. Only implement what your extension needs.

  ## Available packages

  Extensions can use any package already in Nexus's dependency tree without
  declaring additional dependencies. Key packages available:

  - `Ecto` / `Nexus.Repo` — database access
  - `Req` — HTTP client
  - `Jason` — JSON encoding/decoding
  - `Oban` — background job processing
  - `Image` — image processing (libvips)
  - `Phoenix.PubSub` — real-time messaging
  - All of Elixir's standard library

  ## File storage

  Use `Nexus.Extensions.Storage` for any files your extension needs to persist:

      path = Nexus.Extensions.Storage.path("my-extension", "image.webp")
      url  = Nexus.Extensions.Storage.url("my-extension", "image.webp")

  Files are stored under `/app/uploads/extensions/:slug/` and served via
  Nexus's existing static file infrastructure. No additional configuration needed.
  """

  # ---------------------------------------------------------------------------
  # Required callbacks
  # ---------------------------------------------------------------------------

  @doc """
  Returns extension metadata. This is the single source of truth for the
  extension's identity — slug, name, version, description, author, etc.

  The `slug` must be unique across all installed extensions and must match
  the GitHub repo name (used for update checking). Use only lowercase letters,
  numbers, and hyphens.

  The `version` must be a semver string matching the GitHub release tag
  (without the leading "v") — e.g. "1.0.0" for the tag "v1.0.0".

  Optional keys:
  - `homepage`   — GitHub repo URL or documentation URL
  - `logo_url`   — URL to a square icon (displayed at 48×48px)
  - `banner_url` — URL to a wide banner image (displayed at full card width, 120px tall)
  - `categories` — list of short category strings, e.g. ["games", "integrations"]
  - `github_repo` — "owner/repo" override (auto-derived from homepage if omitted)
  """
  @callback manifest() :: %{
    required(:slug)        => String.t(),
    required(:name)        => String.t(),
    required(:version)     => String.t(),
    required(:description) => String.t(),
    required(:author)      => String.t(),
    optional(:homepage)    => String.t() | nil,
    optional(:logo_url)    => String.t() | nil,
    optional(:banner_url)  => String.t() | nil,
    optional(:categories)  => [String.t()],
    optional(:github_repo) => String.t() | nil,
  }

  # ---------------------------------------------------------------------------
  # Optional callbacks — implement only what your extension needs
  # ---------------------------------------------------------------------------

  @doc """
  Returns Ecto migration modules to run when the extension is installed or
  updated. Nexus runs these through its own Repo in order on install and
  rolls them back in reverse order on uninstall.

  Each module must implement `Ecto.Migration`. Prefix your table names with
  your extension slug to avoid collisions with other extensions:

      defmodule MyExtension.Migrations.V001CreateItems do
        use Ecto.Migration

        def change do
          create table(:my_extension_items) do
            add :name,  :string, null: false
            add :value, :integer
            timestamps(type: :utc_datetime)
          end
        end
      end
  """
  @callback migrations() :: [module()]

  @doc """
  Returns child specs to start under Nexus's ExtensionSupervisor when the
  extension is loaded. Use this for GenServers, background workers, schedulers,
  or any long-running process your extension needs.

  If any of your child processes crash, the ExtensionSupervisor restarts them
  without affecting Nexus or other extensions.

      def child_specs do
        [
          {MyExtension.Cache, []},
          {MyExtension.Scheduler, interval: :timer.minutes(5)},
        ]
      end
  """
  @callback child_specs() :: [Supervisor.child_spec()]

  @doc """
  Returns API route definitions to mount under `/ext/:slug/` in Nexus's router.
  Each entry is a `{path, plug, opts}` tuple.

  Routes are mounted at: `/ext/my-extension/{path}`
  Your JS bundle should call these via `fetch("/ext/my-extension/api/items")`.

      def routes do
        [
          {"/api", MyExtension.ApiRouter, []},
        ]
      end
  """
  @callback routes() :: [{String.t(), module(), keyword()}]

  @doc """
  Handles a Nexus hook event. Called in a supervised Task — return value is
  ignored. Crashes are caught and logged without affecting the caller.

  Available events: post_created, post_updated, post_deleted, reply_created,
  user_registered, user_login, reaction_added, report_created.

      def handle_event("post_deleted", %{"post_id" => id}, _settings) do
        MyExtension.cleanup_for_post(id)
      end
      def handle_event(_event, _payload, _settings), do: :ok
  """
  @callback handle_event(event :: String.t(), payload :: map(), settings :: map()) :: any()

  @doc """
  Called once when the extension is first installed, after migrations have run.
  Use for seeding initial data. Return :ok or {:error, reason}.
  """
  @callback on_install(settings :: map()) :: :ok | {:error, term()}

  @doc """
  Called when the extension is updated to a new version, after new migrations
  have run. Use for data migrations or cache invalidation between versions.
  """
  @callback on_update(from_version :: String.t(), to_version :: String.t()) :: :ok

  @doc """
  Called just before the extension is uninstalled, before migrations are
  rolled back. Use for cleanup — deleting files, revoking external tokens, etc.
  """
  @callback on_uninstall() :: :ok

  @doc """
  Returns the filename of the JS bundle within the extension's `priv/static/`
  directory. Nexus serves it at `/ext/:slug/assets/{filename}`.

  Return nil if the extension has no frontend bundle (server-side only).

      def js_bundle_path, do: "my-extension.js"
  """
  @callback js_bundle_path() :: String.t() | nil

  @doc """
  Returns the extension's settings schema for the admin panel UI.
  Same format as the current manifest settings_schema — see EXTENSION_GUIDE.md.

      def settings_schema do
        %{
          "api_key" => %{"type" => "string", "label" => "API Key", "secret" => true},
          "enabled" => %{"type" => "boolean", "label" => "Enable feature", "default" => true},
        }
      end
  """
  @callback settings_schema() :: map()

  @doc """
  Returns settings tab definitions for the admin panel UI — same format as
  manifest settings_tabs. Used when settings should be split across tabs.
  If not implemented, settings_schema fields are shown on a single page.
  """
  @callback settings_tabs() :: [map()]

  @doc """
  Returns digest section definitions. Each map must have:
  - key: unique identifier (prefix with your slug)
  - label: section heading
  - icon: FontAwesome icon class
  - enabled_by_default: boolean

  When a digest is sent, Nexus calls handle_digest_section/3 for each enabled
  section to get the content to include.
  """
  @callback digest_sections() :: [map()]

  @doc """
  Handles a digest section request. Called by Nexus's digest system when
  building an email. Returns a map with title, layout, items, and optional cta.
  See EXTENSION_GUIDE.md for the full response format.
  """
  @callback handle_digest_section(
    section_key :: String.t(),
    period :: %{from: DateTime.t(), to: DateTime.t(), label: String.t()},
    settings :: map()
  ) :: map()

  # ---------------------------------------------------------------------------
  # Default implementations — extensions only override what they need
  # ---------------------------------------------------------------------------

  defmacro __using__(_opts) do
    quote do
      @behaviour Nexus.Extensions.Behaviour

      def migrations,      do: []
      def child_specs,     do: []
      def routes,          do: []
      def handle_event(_event, _payload, _settings), do: :ok
      def on_install(_settings), do: :ok
      def on_update(_from, _to), do: :ok
      def on_uninstall,    do: :ok
      def js_bundle_path,  do: nil
      def settings_schema, do: %{}
      def settings_tabs,   do: []
      def digest_sections, do: []
      def handle_digest_section(_key, _period, _settings), do: %{items: []}

      defoverridable [
        migrations: 0, child_specs: 0, routes: 0,
        handle_event: 3, on_install: 1, on_update: 2, on_uninstall: 0,
        js_bundle_path: 0, settings_schema: 0, settings_tabs: 0,
        digest_sections: 0, handle_digest_section: 3,
      ]
    end
  end

  @optional_callbacks [
    migrations: 0, child_specs: 0, routes: 0,
    handle_event: 3, on_install: 1, on_update: 2, on_uninstall: 0,
    js_bundle_path: 0, settings_schema: 0, settings_tabs: 0,
    digest_sections: 0, handle_digest_section: 3,
  ]
end
