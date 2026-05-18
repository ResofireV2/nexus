defmodule Nexus.Workers.PruneBlockedRegistrations do
  @moduledoc """
  Deletes blocked_registrations older than 1 year.
  Scheduled weekly via Oban cron.
  """

  use Oban.Worker, queue: :default, max_attempts: 1

  import Ecto.Query
  alias Nexus.Repo

  @retention_days 365

  @impl Oban.Worker
  def perform(_job) do
    cutoff = DateTime.utc_now() |> DateTime.add(-@retention_days * 24 * 60 * 60, :second)
    {count, _} = Repo.delete_all(from b in "blocked_registrations", where: b.inserted_at < ^cutoff)
    if count > 0, do: require(Logger); Logger.info("PruneBlockedRegistrations: deleted #{count} records older than #{@retention_days} days")
    :ok
  end
end
