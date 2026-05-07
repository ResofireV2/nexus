defmodule Nexus.Moderation do
  @moduledoc """
  The Moderation context. Handles user actions (ban, mute, suspend),
  content actions (hide, delete), reports, and audit logging.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Accounts
  alias Nexus.Forum
  alias Nexus.Moderation.{Log, Report}

  # ---------------------------------------------------------------------------
  # User moderation
  # ---------------------------------------------------------------------------

  def ban_user(moderator, target_user, reason \\ nil) do
    with {:ok, user} <- Accounts.update_status(target_user, "banned", reason: reason) do
      log_action(moderator.id, "ban", %{target_user_id: target_user.id, reason: reason})
      Accounts.revoke_all_user_tokens(target_user.id)
      {:ok, user}
    end
  end

  def unban_user(moderator, target_user) do
    with {:ok, user} <- Accounts.update_status(target_user, "active") do
      log_action(moderator.id, "unban", %{target_user_id: target_user.id})
      {:ok, user}
    end
  end

  def mute_user(moderator, target_user, opts \\ []) do
    duration = Keyword.get(opts, :duration)
    reason   = Keyword.get(opts, :reason)
    until    = if duration, do: DateTime.utc_now() |> DateTime.add(duration * 60, :second) |> DateTime.truncate(:second)

    with {:ok, user} <- Accounts.update_status(target_user, "muted", reason: reason, until: until) do
      log_action(moderator.id, "mute", %{target_user_id: target_user.id, reason: reason, duration: duration})
      {:ok, user}
    end
  end

  def unmute_user(moderator, target_user) do
    with {:ok, user} <- Accounts.update_status(target_user, "active") do
      log_action(moderator.id, "unmute", %{target_user_id: target_user.id})
      {:ok, user}
    end
  end

  def suspend_user(moderator, target_user, opts \\ []) do
    duration = Keyword.get(opts, :duration)
    reason   = Keyword.get(opts, :reason)
    until    = if duration, do: DateTime.utc_now() |> DateTime.add(duration * 60, :second) |> DateTime.truncate(:second)

    with {:ok, user} <- Accounts.update_status(target_user, "suspended", reason: reason, until: until) do
      log_action(moderator.id, "suspend", %{target_user_id: target_user.id, reason: reason, duration: duration})
      Accounts.revoke_all_user_tokens(target_user.id)
      {:ok, user}
    end
  end

  def unsuspend_user(moderator, target_user) do
    with {:ok, user} <- Accounts.update_status(target_user, "active") do
      log_action(moderator.id, "unsuspend", %{target_user_id: target_user.id})
      {:ok, user}
    end
  end

  # ---------------------------------------------------------------------------
  # Content moderation
  # ---------------------------------------------------------------------------

  def hide_post(moderator, post) do
    with {:ok, hidden} <- Forum.hide_post(post, moderator.id) do
      log_action(moderator.id, "post_hide", %{post_id: post.id})
      {:ok, hidden}
    end
  end

  def delete_post(moderator, post) do
    with {:ok, _} <- Forum.delete_post(post) do
      log_action(moderator.id, "post_delete", %{post_id: post.id})
      {:ok, :deleted}
    end
  end

  def hide_reply(moderator, reply) do
    with {:ok, hidden} <- Forum.hide_reply(reply, moderator.id) do
      log_action(moderator.id, "reply_hide", %{reply_id: reply.id})
      {:ok, hidden}
    end
  end

  def delete_reply(moderator, reply) do
    with {:ok, _} <- Forum.delete_reply(reply) do
      log_action(moderator.id, "reply_delete", %{reply_id: reply.id})
      {:ok, :deleted}
    end
  end

  # ---------------------------------------------------------------------------
  # Reports
  # ---------------------------------------------------------------------------

  def create_report(attrs) do
    %Report{}
    |> Report.changeset(attrs)
    |> Repo.insert()
  end

  def list_reports(opts \\ []) do
    status = Keyword.get(opts, :status, "pending")
    sort   = Keyword.get(opts, :sort, "newest")

    order = case sort do
      "oldest" -> [asc: :inserted_at]
      _        -> [desc: :inserted_at]
    end

    Report
    |> where([r], r.status == ^status)
    |> order_by(^order)
    |> preload([:reporter, :reviewer, :user, post: [:space, :user], reply: [:user]])
    |> Repo.all()
  end

  def list_hidden_posts(opts \\ []) do
    alias Nexus.Forum.{Post, Reply}
    import Ecto.Query
    type = Keyword.get(opts, :type, "all")

    posts = if type in ["all", "posts"] do
      Nexus.Repo.all(
        from p in Post,
        where: p.hidden == true,
        order_by: [desc: p.hidden_at],
        preload: [:user, :space],
        limit: 50
      )
      |> Enum.map(fn p -> %{
        id: p.id, type: "post", body: String.slice(p.body || p.title || "", 0, 200),
        title: p.title, space_name: p.space && p.space.name,
        user: p.user && %{id: p.user.id, username: p.user.username},
        hidden_at: p.hidden_at
      } end)
    else [] end

    replies = if type in ["all", "replies"] do
      Nexus.Repo.all(
        from r in Reply,
        where: r.hidden == true,
        order_by: [desc: r.hidden_at],
        preload: [:user],
        limit: 50
      )
      |> Enum.map(fn r -> %{
        id: r.id, type: "reply", body: String.slice(r.body || "", 0, 200),
        title: nil, space_name: nil,
        user: r.user && %{id: r.user.id, username: r.user.username},
        hidden_at: r.hidden_at
      } end)
    else [] end

    (posts ++ replies) |> Enum.sort_by(& &1.hidden_at, {:desc, DateTime})
  end

  def get_report(id), do: Repo.get(Report, id) |> Repo.preload([:reporter, :post, :reply, :user])

  def review_report(report, moderator, status) do
    report
    |> Report.review_changeset(%{status: status, reviewer_id: moderator.id})
    |> Repo.update()
  end

  # ---------------------------------------------------------------------------
  # Moderation log
  # ---------------------------------------------------------------------------

  def list_logs(opts \\ []) do
    query = Log |> order_by([l], [desc: l.inserted_at]) |> preload([:moderator, :target_user])

    query =
      case Keyword.get(opts, :target_user_id) do
        nil -> query
        id  -> where(query, [l], l.target_user_id == ^id)
      end

    query =
      case Keyword.get(opts, :limit) do
        nil -> limit(query, 50)
        n   -> limit(query, ^n)
      end

    Repo.all(query)
  end

  defp log_action(moderator_id, action, attrs \\ %{}) do
    %Log{}
    |> Log.changeset(Map.merge(attrs, %{action: action, moderator_id: moderator_id}))
    |> Repo.insert()
  end
end
