defmodule Nexus.Workers.UpdateScore do
  @moduledoc """
  Oban worker that recomputes and persists a user's leaderboard score.
  Enqueued after scoring actions (post, reply, reaction, login, pin).
  """

  use Oban.Worker,
    queue: :default,
    max_attempts: 3

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"user_id" => user_id}}) do
    Nexus.Leaderboard.update_score(user_id)
    :ok
  end
end
