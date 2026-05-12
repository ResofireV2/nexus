defmodule Nexus.RateLimiter do
  @moduledoc """
  Simple ETS-backed rate limiter with a sliding-window counter.

  Uses a single public ETS table `:nexus_rate_limits`. Each entry is keyed
  by {bucket, window_start} and stores a hit count. Entries older than
  the window are pruned lazily on each check.

  Usage:
      case Nexus.RateLimiter.check("login:" <> ip, limit: 10, window_seconds: 60) do
        :allow -> ...
        {:deny, retry_after_seconds} -> ...
      end
  """

  @table :nexus_rate_limits

  def child_spec(_opts) do
    %{
      id:     __MODULE__,
      start:  {__MODULE__, :start_link, []},
      type:   :worker,
      restart: :permanent
    }
  end

  def start_link do
    :ets.new(@table, [:named_table, :public, :set, read_concurrency: true, write_concurrency: true])
    :ignore
  end

  @doc """
  Returns :allow or {:deny, retry_after_seconds}.

  Options:
    - limit           — max hits allowed per window (default: 10)
    - window_seconds  — window length in seconds (default: 60)
  """
  def check(bucket, opts \\ []) do
    limit          = Keyword.get(opts, :limit, 10)
    window_seconds = Keyword.get(opts, :window_seconds, 60)
    now            = System.system_time(:second)
    window_start   = div(now, window_seconds) * window_seconds
    key            = {bucket, window_start}

    count = :ets.update_counter(@table, key, {2, 1}, {key, 0})

    if count == 1 do
      # Schedule cleanup of this entry after the window expires
      Process.send_after(self(), {:rl_cleanup, key}, (window_seconds + 1) * 1000)
    end

    if count <= limit do
      :allow
    else
      retry_after = window_start + window_seconds - now
      {:deny, max(retry_after, 1)}
    end
  end

  # Called from supervised processes — ignore stale cleanup messages
  def handle_info({:rl_cleanup, key}, state) do
    :ets.delete(@table, key)
    {:noreply, state}
  end
end
