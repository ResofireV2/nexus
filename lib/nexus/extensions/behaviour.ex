defmodule Nexus.Extensions.Behaviour do
  @moduledoc """
  The contract every Nexus extension must implement.

  An extension is an Elixir package that runs inside the Nexus VM — no
  separate container, no separate process, no Caddy config. Nexus compiles
  the extension's source code at install time using whatever Elixir/OTP
  version Nexus itself is running, so version mismatches are impossible.

  ## Minimal example

  Each extension consists of a `manifest.json` describing what it contributes,
  and an Elixir module implementing whichever callbacks correspond to those
  declarations.

      // manifest.json
      {
        "manifest_version": 2,
        "name":             "My Extension",
        "slug":             "my-extension",
        "version":          "1.0.0",
        "description":      "Does something cool.",
        "author":           "your-github-username",
        "homepage":         "https://github.com/you/my-extension",
        "module":           "MyExtension"
      }

      # lib/my_extension.ex
      defmodule MyExtension do
        use Nexus.Extensions.Behaviour
        # That's it. Override callbacks below as needed.
      end

  Every callback in this behaviour is optional. The `use` macro supplies no-op
  defaults; you only override what your extension needs. See the JSON schema
  at `/manifest_schema.json` for the full set of manifest fields.

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
  # Required: none.
  #
  # In manifest_version 2, an extension's identity (name, slug, version,
  # description, etc.) is declared in manifest.json — not in a manifest/0
  # callback on the module. The behaviour does not require any single
  # callback be implemented; each is optional and only matters if the
  # manifest declares an intent the callback fulfills (handle_event/3 for
  # declared hooks, handle_digest_section/3 for declared digest_sections,
  # etc.).
  # ---------------------------------------------------------------------------

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
  Handles a digest section request. Called by Nexus's digest system when
  building an email. The list of declared digest sections lives in the
  manifest's `digest_sections` field; this callback produces the content
  for each one. Returns a map with title, layout, items, and optional cta.
  See EXTENSION_GUIDE.md for the full response format.
  """
  @callback handle_digest_section(
    section_key :: String.t(),
    period :: %{from: DateTime.t(), to: DateTime.t(), label: String.t()},
    settings :: map()
  ) :: map()

  @doc """
  Persists an attachment submitted with a post or reply through the composer
  side-data attachment flow (piece 4).

  Called when a user submits a post or reply with attachments matching a
  {entity, kind} this extension declared in its manifest's side_data field.
  Runs inside a supervised Task — return value is ignored, crashes are
  caught and logged.

  The extension is responsible for persisting the attachment into its own
  tables (typically with a foreign key column referencing the entity_id),
  and for cleaning up linked rows when the entity is deleted (subscribe
  to the corresponding *_deleted hook event for cleanup).

      def persist_attachment("post", post_id, %{"kind" => "game_link", "data" => data}) do
        %MyExt.PostGame{}
        |> MyExt.PostGame.changeset(%{post_id: post_id, game_id: data["game_id"]})
        |> Repo.insert()
        :ok
      end
  """
  @callback persist_attachment(
    entity :: String.t(),
    entity_id :: term(),
    attachment :: map()
  ) :: any()

  @doc """
  Returns side-data this extension has attached to a given entity (piece 4).

  Used by the host's aggregator endpoint (GET /api/v1/posts/:id/side-data,
  for example) to list all attached data across all extensions. Optional —
  extensions are not required to expose their side-data this way; many
  will prefer to expose their own endpoints under /ext/<slug>/ for richer
  responses.

  Return value is a list of maps; the host serializes them as JSON. Each
  entry should include "kind" and "data" fields so clients can identify
  what kind of attachment they're looking at.

      def list_side_data("post", post_id) do
        Repo.all(from g in MyExt.PostGame, where: g.post_id == ^post_id)
        |> Enum.map(&%{"kind" => "game_link", "data" => %{"game_id" => &1.game_id}})
      end
  """
  @callback list_side_data(entity :: String.t(), entity_id :: term()) :: [map()]

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
      def settings_schema, do: %{}
      def settings_tabs,   do: []
      def handle_digest_section(_key, _period, _settings), do: %{items: []}
      def persist_attachment(_entity, _entity_id, _attachment), do: :ok
      def list_side_data(_entity, _entity_id), do: []

      defoverridable [
        migrations: 0, child_specs: 0, routes: 0,
        handle_event: 3, on_install: 1, on_update: 2, on_uninstall: 0,
        settings_schema: 0, settings_tabs: 0,
        handle_digest_section: 3,
        persist_attachment: 3, list_side_data: 2,
      ]
    end
  end

  @optional_callbacks [
    migrations: 0, child_specs: 0, routes: 0,
    handle_event: 3, on_install: 1, on_update: 2, on_uninstall: 0,
    settings_schema: 0, settings_tabs: 0,
    handle_digest_section: 3,
    persist_attachment: 3, list_side_data: 2,
  ]
end
