defmodule Nexus.Workers.PruneLoginEvents do
  @moduledoc """
  Deletes login_events older than 90 days.
  Scheduled daily via Oban cron.
  """

  use Oban.Worker, queue: :default, max_attempts: 1

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Activity.LoginEvent

  @retention_days 90

  @impl Oban.Worker
  def perform(_job) do
    cutoff = DateTime.utc_now() |> DateTime.add(-@retention_days * 24 * 60 * 60, :second)
    {count, _} = Repo.delete_all(from e in LoginEvent, where: e.inserted_at < ^cutoff)
    if count > 0, do: require(Logger); Logger.info("PruneLoginEvents: deleted #{count} records older than #{@retention_days} days")
    :ok
  end
end
