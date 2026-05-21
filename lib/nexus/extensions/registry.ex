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
  - :nexus_ext_slots    — {slot, slug}  → {component, priority, js_bundle_url}
  - :nexus_ext_routes   — slug → [{path, plug, opts}]
  - :nexus_ext_digest   — {section_key, slug} → {label, icon, enabled_by_default}
  """

  use GenServer

  require Logger

  @tables [
    :nexus_ext_modules,
    :nexus_ext_hooks,
    :nexus_ext_slots,
    :nexus_ext_routes,
    :nexus_ext_digest,
  ]

  # ---------------------------------------------------------------------------
  # Client API
  # ---------------------------------------------------------------------------

  def start_link(_), do: GenServer.start_link(__MODULE__, [], name: __MODULE__)

  @doc "Register a loaded extension module."
  def register(slug, module) do
    GenServer.call(__MODULE__, {:register, slug, module})
  end

  @doc "Unregister an extension (on uninstall or disable)."
  def unregister(slug) do
    GenServer.call(__MODULE__, {:unregister, slug})
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

  @doc "Returns slot registrations for a slot name, ordered by priority."
  def slots_for(slot) do
    :ets.match_object(:nexus_ext_slots, {{slot, :_}, :_})
    |> Enum.sort_by(fn {{_slot, _slug}, {_component, priority, _url}} -> priority end)
    |> Enum.map(fn {{_slot, slug}, {component, priority, js_url}} ->
      %{slot: slot, extension_slug: slug, component: component,
        priority: priority, js_bundle_url: js_url}
    end)
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
        slots:           [%{slot: String.t(), component: String.t(), priority: integer(), js_bundle_url: String.t() | nil}],
        routes:          [%{prefix: String.t(), plug: String.t(), opts: list()}],
        digest_sections: [%{key: String.t(), label: String.t(), icon: String.t(), enabled_by_default: boolean()}],
      }

  Returns `nil` for `module` if the slug is not currently loaded. Hooks/slots/
  routes/digest_sections will then be empty lists, since registration is
  keyed on slug and removed on unregister.
  """
  def runtime_info(slug) when is_binary(slug) do
    %{
      module:          get_module(slug),
      hooks:           hooks_for_slug(slug),
      slots:           slots_for_slug(slug),
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

  defp slots_for_slug(slug) do
    :ets.match_object(:nexus_ext_slots, {{:_, slug}, :_})
    |> Enum.sort_by(fn {{_slot, _slug}, {_component, priority, _url}} -> priority end)
    |> Enum.map(fn {{slot, _slug}, {component, priority, js_url}} ->
      %{slot: slot, component: component, priority: priority, js_bundle_url: js_url}
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
  def handle_call({:register, slug, module}, _from, state) do
    manifest = safe_call(module, :manifest, [], %{})

    :ets.insert(:nexus_ext_modules, {slug, module})

    # Register hooks
    events = Nexus.Extensions.hook_events()
    if function_exported?(module, :handle_event, 3) do
      for event <- events do
        :ets.insert(:nexus_ext_hooks, {{event, slug}, {module, 50}})
      end
    end

    # Register slots — derived from manifest
    for %{slot: slot, component: component, priority: priority} <-
        Map.get(manifest, :slots, []) do
      js_url = safe_call(module, :js_bundle_path, [], nil)
        |> then(fn path ->
          if path, do: "/ext/#{slug}/assets/#{path}", else: nil
        end)
      :ets.insert(:nexus_ext_slots, {{slot, slug}, {component, priority, js_url}})
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

    # Register digest sections
    sections = safe_call(module, :digest_sections, [], [])
    for %{key: key, label: label, icon: icon, enabled_by_default: enabled} <- sections do
      :ets.insert(:nexus_ext_digest, {{key, slug}, {label, icon, enabled}})
    end

    Logger.info("Registry: registered #{slug} (#{inspect(module)})")
    {:reply, :ok, state}
  end

  @impl true
  def handle_call({:unregister, slug}, _from, state) do
    :ets.delete(:nexus_ext_modules, slug)

    :ets.match_delete(:nexus_ext_hooks,   {{:_, slug}, :_})
    :ets.match_delete(:nexus_ext_slots,   {{:_, slug}, :_})
    :ets.match_delete(:nexus_ext_digest,  {{:_, slug}, :_})
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
