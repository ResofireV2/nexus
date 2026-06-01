defmodule Nexus.StatsCache do
  @moduledoc """
  ETS-backed cache for the public community stats endpoint.

  GET /api/v1/stats runs three COUNT queries on every call and is polled
  by every connected client's sidebar every 5 minutes (reduced from 30s
  in Batch 2). This cache serves the result from ETS for up to 60 seconds,
  then lazily refreshes on the next request that finds the entry stale.

  The stats are approximate by nature (online count has a 15-minute window,
  member/thread counts change infrequently) so a 60-second staleness window
  is indistinguishable from live to users.
  """

  use GenServer

  @table   :nexus_stats_cache
  @key     :community_stats
  @ttl_sec 60

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
  # Public API
  # ---------------------------------------------------------------------------

  @doc """
  Returns cached stats, or computes fresh stats via `fetch_fn.()` if the
  cache is empty or the entry is older than #{@ttl_sec} seconds.
  """
  def get(fetch_fn) do
    now = System.system_time(:second)

    try do
      case :ets.lookup(@table, @key) do
        [{@key, stats, cached_at}] when now - cached_at < @ttl_sec ->
          stats

        _ ->
          stats = fetch_fn.()
          :ets.insert(@table, {@key, stats, now})
          stats
      end
    rescue
      ArgumentError -> fetch_fn.()
    end
  end

  @doc "Force-expire the cache entry. Useful after significant DB changes."
  def invalidate do
    :ets.delete(@table, @key)
    :ok
  end

  # ---------------------------------------------------------------------------
  # GenServer callbacks
  # ---------------------------------------------------------------------------

  @impl true
  def init(_) do
    if :ets.whereis(@table) == :undefined do
      :ets.new(@table, [:named_table, :public, :set, read_concurrency: true])
    end
    {:ok, %{}}
  end
end
