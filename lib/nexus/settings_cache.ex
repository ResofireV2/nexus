defmodule Nexus.SettingsCache do
  @moduledoc """
  ETS-backed cache for site settings.

  Site settings are read on nearly every API request (Permissions checks,
  upload config, guest browsing, etc.) but change only when an admin edits
  them. This cache keeps a copy in ETS so reads are sub-microsecond instead
  of a Postgres round trip.

  Cache entries are invalidated explicitly whenever Admin.update_setting/3
  writes a new value. The cache is populated lazily on first read of each key.

  The ETS table is created by this GenServer's init/1 so it is available
  immediately after the process starts — before any request arrives.
  """

  use GenServer

  @table :nexus_settings_cache

  # ---------------------------------------------------------------------------
  # Supervision
  # ---------------------------------------------------------------------------

  def child_spec(_opts) do
    %{
      id:      __MODULE__,
      start:   {__MODULE__, :start_link, []},
      type:    :worker,
      restart: :permanent
    }
  end

  def start_link(_opts \\ []) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  # ---------------------------------------------------------------------------
  # Public API — called from Admin.get_setting and Admin.update_setting
  # ---------------------------------------------------------------------------

  @doc """
  Returns the cached value for `key`, or fetches from DB and caches if absent.
  Falls back to `fetch_fn.()` — a zero-arity function that reads from the DB.
  """
  def get(key, fetch_fn) do
    case :ets.lookup(@table, key) do
      [{^key, value}] -> value
      []              ->
        value = fetch_fn.()
        :ets.insert(@table, {key, value})
        value
    end
  end

  @doc "Remove a single key from the cache. Called after a successful write."
  def invalidate(key) do
    :ets.delete(@table, key)
    :ok
  end

  @doc "Clear the entire cache. Called e.g. after bulk operations."
  def invalidate_all do
    :ets.delete_all_objects(@table)
    :ok
  end

  # ---------------------------------------------------------------------------
  # GenServer callbacks
  # ---------------------------------------------------------------------------

  @impl true
  def init(_) do
    :ets.new(@table, [:named_table, :public, :set, read_concurrency: true])
    {:ok, %{}}
  end
end
