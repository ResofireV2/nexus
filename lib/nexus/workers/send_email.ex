defmodule Nexus.Workers.SendEmail do
  @moduledoc """
  Oban worker for sending transactional emails that are triggered by user
  actions. Using Oban gives these emails retry semantics — if the mail
  server is temporarily unavailable the job is retried with backoff rather
  than silently dropped.

  Supported types:
    - "verification"  — email address verification on registration / resend
    - "mod_report"    — notifies moderators/admins of a new content report

  For notification emails (reply, reaction, mention, etc.) see
  Nexus.Workers.DeliverNotification which handles those inline as part of
  broader notification delivery.
  """

  use Oban.Worker,
    queue: :mailers,
    max_attempts: 5,
    unique: [period: 300, fields: [:args], keys: [:type, :user_id]]

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"type" => "verification", "user_id" => user_id}}) do
    user = Nexus.Accounts.get_user(user_id)
    if user && !user.email_verified do
      Nexus.Accounts.send_verification_email(user)
    end
    :ok
  end

  def perform(%Oban.Job{args: %{"type" => "mod_report", "report_id" => report_id}}) do
    import Ecto.Query
    report = Nexus.Repo.get(Nexus.Moderation.Report, report_id)
    if report do
      mods = Nexus.Repo.all(
        from u in Nexus.Accounts.User,
          where: u.role in ["admin", "moderator"] and u.status == "active",
          select: u
      )
      Enum.each(mods, fn mod ->
        Nexus.Mailer.send_mod_report_email(mod, report)
      end)
    end
    :ok
  end
end
