defmodule Nexus.Workers.UpdateScore do
  @moduledoc """
  Oban worker that recomputes and persists a user's leaderboard score.

  Enqueued after scoring actions (post, reply, reaction, login, pin).
  Deduplicated per user within a 60-second window — but only against
  jobs that are still pending or executing. Completed jobs are excluded
  from deduplication so that a new activity after a recent score update
  still enqueues a fresh recalculation.
  """

  use Oban.Worker,
    queue: :default,
    max_attempts: 3,
    unique: [
      period: 60,
      fields: [:args],
      keys: [:user_id],
      states: [:available, :scheduled, :executing, :retryable]
    ]

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"user_id" => user_id}}) do
    Nexus.Leaderboard.update_score(user_id)
    :ok
  end
end
