defmodule Nexus.Workers.SendDigest do
  @moduledoc """
  Oban worker that sends digest emails to subscribers.

  Runs hourly via cron for each frequency (daily/weekly/monthly).
  The worker checks whether the current time in the admin's configured
  timezone matches the configured send time and day before proceeding,
  so only one hourly run per period actually sends email.
  """

  use Oban.Worker, queue: :mailers, max_attempts: 1

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"frequency" => frequency}}) do
    unless Nexus.Digest.enabled?() do
      :ok
    else
      unless Nexus.Digest.should_send_now?(frequency) do
        :ok
      else
        digest    = Nexus.Digest.build(frequency)
        users     = Nexus.Digest.subscribers(frequency)

        Enum.each(users, fn user ->
          Task.start(fn ->
            Nexus.Mailer.send_digest_email(user, digest)
          end)
        end)

        :ok
      end
    end
  end
end
