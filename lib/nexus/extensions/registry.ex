defmodule Nexus.Extensions.Registry do
  @moduledoc """
  In-memory registry for loaded extension modules, hooks, slots, routes,
  and digest sections. Backed by ETS for fast concurrent reads.

  This replaces the pattern of querying the DB on every hook fire or slot
  render. The DB remains the source of truth for extension metadata and
  settings — the registry is populated from the DB on startup and updated
  whenever an extension is installed, updated, enabled, or disabled.

  Tables:
  - :nexus_ext_modules  — slug → module
  - :nexus_ext_hooks    — {event, slug} → {module, priority}
  - :nexus_ext_routes   — slug → [{path, plug, opts}]
  - :nexus_ext_digest   — {section_key, slug} → {label, icon, enabled_by_default}
  - :nexus_ext_declared — slug → manifest    (normalized JSON manifest; the
                                             extension's declared contract,
                                             stored alongside the live
                                             registrations so the admin
                                             runtime panel can compare them)

  UI slots are not tracked server-side — they're a purely client-side
  concept. Extensions register slot components via NexusExtensions.registerSlot
  from their JS bundle, and React reads them from window.NexusExtensions._slots
  at render time. The admin runtime panel reads the same client-side state
  and compares it against the manifest's declared slots.
  """

  use GenServer

  require Logger

  @tables [
    :nexus_ext_modules,
    :nexus_ext_hooks,
    :nexus_ext_routes,
    :nexus_ext_digest,
    :nexus_ext_declared,
    # Maps {entity, kind} → slug for side-data attachment dispatch.
    # Populated from each extension's normalized manifest side_data field.
    :nexus_ext_side_data_owners,
  ]

  # ---------------------------------------------------------------------------
  # Client API
  # ---------------------------------------------------------------------------

  def start_link(_), do: GenServer.start_link(__MODULE__, [], name: __MODULE__)

  @doc """
  Register a loaded extension module.

  The optional `manifest` argument is the normalized JSON manifest produced
  by `Nexus.Extensions.ManifestSchema.validate/1`. When provided, it is
  stored in :nexus_ext_declared for later comparison against runtime
  registrations (sub-stage 7D).

  The 2-arity form is preserved for callers that have not been updated to
  pass a manifest (for example, future test helpers that register a stub
  module without going through the full loader flow).
  """
  def register(slug, module, manifest \\ nil) do
    GenServer.call(__MODULE__, {:register, slug, module, manifest})
  end

  @doc "Unregister an extension (on uninstall or disable)."
  def unregister(slug) do
    GenServer.call(__MODULE__, {:unregister, slug})
  end

  @doc """
  Returns the declared (manifest) view of an extension's contract, or nil.
  This is the validated JSON manifest as stored at load time. Compare with
  the live registrations to find discrepancies.
  """
  def get_declared(slug) do
    case :ets.lookup(:nexus_ext_declared, slug) do
      [{^slug, manifest}] -> manifest
      []                  -> nil
    end
  end

  @doc "Returns all declared manifests as a {slug, manifest} list."
  def all_declared do
    :ets.tab2list(:nexus_ext_declared)
  end

  @doc "Returns the module for a loaded extension slug, or nil."
  def get_module(slug) do
    case :ets.lookup(:nexus_ext_modules, slug) do
      [{^slug, module}] -> module
      []                -> nil
    end
  end

  @doc "Returns all loaded extension modules as {slug, module} pairs."
  def all_modules do
    :ets.tab2list(:nexus_ext_modules)
  end

  @doc "Returns hook handlers for an event, ordered by priority."
  def hooks_for(event) do
    :ets.match_object(:nexus_ext_hooks, {{event, :_}, :_})
    |> Enum.sort_by(fn {{_event, _slug}, {_module, priority}} -> priority end)
    |> Enum.map(fn {{_event, slug}, {module, _priority}} -> {slug, module} end)
  end

  @doc """
  Returns the slug of the extension that declared the given side-data
  {entity, kind} pair, or nil if no extension declares it.

  Used by the compose attachment dispatch path to find the right extension
  for each incoming attachment.

  Only one extension can own a given {entity, kind} pair. If two extensions
  declare the same pair, the most-recently-registered one wins (ETS insert
  overwrites). This is a contract violation that should be surfaced in the
  admin runtime panel — TODO for a future polish step.
  """
  def side_data_owner_for(entity, kind) when is_binary(entity) and is_binary(kind) do
    case :ets.lookup(:nexus_ext_side_data_owners, {entity, kind}) do
      [{{^entity, ^kind}, slug}] -> slug
      []                         -> nil
    end
  end

  @doc "Returns API routes for an extension slug."
  def routes_for(slug) do
    case :ets.lookup(:nexus_ext_routes, slug) do
      [{^slug, routes}] -> routes
      []                -> []
    end
  end

  @doc "Returns all digest sections across all loaded extensions."
  def all_digest_sections do
    :ets.tab2list(:nexus_ext_digest)
    |> Enum.map(fn {{key, slug}, {label, icon, enabled_by_default}} ->
      %{key: key, extension_slug: slug, label: label,
        icon: icon, enabled_by_default: enabled_by_default}
    end)
  end

  @doc """
  Returns everything registered for a given slug, for admin introspection.

  Shape:

      %{
        module:          atom | nil,
        hooks:           [%{event: String.t(), priority: integer()}],
        routes:          [%{prefix: String.t(), plug: String.t(), opts: list()}],
        digest_sections: [%{key: String.t(), label: String.t(), icon: String.t(), enabled_by_default: boolean()}],
      }

  Returns `nil` for `module` if the slug is not currently loaded. Lists
  will then be empty, since registration is keyed on slug and removed on
  unregister.

  Slot registrations are NOT returned — they live entirely on the client
  side (window.NexusExtensions._slots). The admin runtime panel reads
  them from there and compares against the manifest's declared slots.
  """
  def runtime_info(slug) when is_binary(slug) do
    %{
      module:          get_module(slug),
      hooks:           hooks_for_slug(slug),
      routes:          routes_info_for_slug(slug),
      digest_sections: digest_sections_for_slug(slug),
    }
  end

  defp hooks_for_slug(slug) do
    :ets.match_object(:nexus_ext_hooks, {{:_, slug}, :_})
    |> Enum.sort_by(fn {{_event, _slug}, {_module, priority}} -> priority end)
    |> Enum.map(fn {{event, _slug}, {_module, priority}} ->
      %{event: event, priority: priority}
    end)
  end

  defp routes_info_for_slug(slug) do
    routes_for(slug)
    |> Enum.map(fn {prefix, plug_mod, opts} ->
      %{prefix: prefix, plug: inspect(plug_mod), opts: opts}
    end)
  end

  defp digest_sections_for_slug(slug) do
    :ets.match_object(:nexus_ext_digest, {{:_, slug}, :_})
    |> Enum.map(fn {{key, _slug}, {label, icon, enabled_by_default}} ->
      %{key: key, label: label, icon: icon, enabled_by_default: enabled_by_default}
    end)
  end

  # ---------------------------------------------------------------------------
  # Server callbacks
  # ---------------------------------------------------------------------------

  @impl true
  def init(_) do
    for table <- @tables do
      :ets.new(table, [:named_table, :public, :set, read_concurrency: true])
    end
    {:ok, %{}}
  end

  @impl true
  def handle_call({:register, slug, module, json_manifest}, _from, state) do
    # The JSON manifest is the authoritative source for what this extension
    # declares. Default to an empty map only as a defensive fallback for
    # bootstrap code paths that haven't been updated to pass a manifest.
    manifest = json_manifest || %{}

    :ets.insert(:nexus_ext_modules, {slug, module})

    # Store the normalized JSON manifest. Read back via get_declared/1 by the
    # admin runtime panel (7D) and by anywhere else that needs to know the
    # extension's declared contract.
    if json_manifest do
      :ets.insert(:nexus_ext_declared, {slug, json_manifest})
    end

    # Register hooks. Only events declared in the manifest are wired up —
    # this prevents an extension from accidentally subscribing to every
    # known hook event just by exporting handle_event/3 with a catch-all.
    #
    # Each hook entry is a normalized map %{"event" => name, "priority" => n}
    # produced by manifest validation. Priority is stored alongside the
    # module reference so hooks_for/1 can return handlers in priority
    # order at dispatch time.
    declared_hooks = Map.get(manifest, "hooks", [])

    if function_exported?(module, :handle_event, 3) do
      for hook <- declared_hooks do
        event    = hook["event"]
        priority = hook["priority"] || 50
        :ets.insert(:nexus_ext_hooks, {{event, slug}, {module, priority}})
      end
    end

    # Register routes — always insert so an empty result is visible in ETS.
    # safe_call returns [] both when routes/0 is not exported AND when it
    # raises. We log a warning for the raise case (safe_call already logs
    # the error), but we still do the insert so routes_for/1 returns []
    # rather than a stale entry from a previous registration. Extensions
    # that truly have no routes (server-side only) return [] intentionally
    # and that is fine — the warning is suppressed for them.
    routes = safe_call(module, :routes, [], [])
    :ets.insert(:nexus_ext_routes, {slug, routes})

    # Register digest sections from the JSON manifest. Each declared section
    # becomes a row in :nexus_ext_digest keyed on {key, slug}. The legacy
    # module.digest_sections/0 callback is no longer consulted — the manifest
    # is the source of truth.
    for section <- Map.get(manifest, "digest_sections", []) do
      key                = section["key"]
      label              = section["label"]
      icon               = section["icon"]
      enabled_by_default = section["enabled_by_default"] || false

      :ets.insert(:nexus_ext_digest, {{key, slug}, {label, icon, enabled_by_default}})
    end

    # Register side_data ownership. Each {entity, kind} pair this extension
    # declares becomes a row in :nexus_ext_side_data_owners. The compose
    # attachment dispatcher uses this lookup to route incoming attachments
    # to the correct extension's persist_attachment/3 callback.
    for entry <- Map.get(manifest, "side_data", []) do
      entity = entry["entity"]
      kind   = entry["kind"]
      :ets.insert(:nexus_ext_side_data_owners, {{entity, kind}, slug})
    end

    Logger.info("Registry: registered #{slug} (#{inspect(module)})")
    {:reply, :ok, state}
  end

  @impl true
  def handle_call({:unregister, slug}, _from, state) do
    :ets.delete(:nexus_ext_modules,  slug)
    :ets.delete(:nexus_ext_declared, slug)

    :ets.match_delete(:nexus_ext_hooks,              {{:_, slug}, :_})
    :ets.match_delete(:nexus_ext_digest,             {{:_, slug}, :_})
    :ets.match_delete(:nexus_ext_side_data_owners,   {{:_, :_}, slug})
    :ets.delete(:nexus_ext_routes, slug)

    Logger.info("Registry: unregistered #{slug}")
    {:reply, :ok, state}
  end

  defp safe_call(module, fun, args, default) do
    if function_exported?(module, fun, length(args)) do
      try do
        apply(module, fun, args)
      rescue
        e ->
          Logger.error("Registry: #{module}.#{fun}/#{length(args)} raised: #{inspect(e)}")
          default
      end
    else
      default
    end
  end
end
