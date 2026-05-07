defmodule Nexus.Workers.UpdateScore do
  @moduledoc """
  Oban worker that recomputes and persists a user's leaderboard score.

  Enqueued alongside CheckBadges after scoring actions (post, reply,
  reaction, login, pin). Deduplicated per user within a 60-second
  window to avoid redundant recalculations from burst activity.
  """

  use Oban.Worker,
    queue: :default,
    max_attempts: 3,
    unique: [period: 60, fields: [:args], keys: [:user_id]]

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"user_id" => user_id}}) do
    Nexus.Leaderboard.update_score(user_id)
    :ok
  end
end
