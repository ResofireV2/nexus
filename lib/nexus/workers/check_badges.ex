defmodule Nexus.Workers.CheckBadges do
  @moduledoc """
  Oban worker that checks whether a user has met the criteria for any
  automatic badges and awards them if so.

  Enqueued after relevant user actions (post created, reply created,
  reaction added, login). Deduplicated per user within a 60-second
  window so bursts of activity only trigger one check.
  """

  use Oban.Worker,
    queue: :default,
    max_attempts: 3,
    unique: [period: 60, fields: [:args], keys: [:user_id]]

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"user_id" => user_id}}) do
    Nexus.Badges.check_and_award(user_id)
    :ok
  end
end
