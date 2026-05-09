defmodule Nexus.Leaderboard do
  @moduledoc """
  The Leaderboard context.

  Computes and materialises user scores from activity stats, badges,
  pins, and login streaks. Scores are stored in user_scores for fast
  ranked queries and updated by the UpdateScore Oban worker.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Leaderboard.UserScore
  alias Nexus.Activity.UserDailyStat
  alias Nexus.Accounts.User
  alias Nexus.Forum.{Post, Reply}
  alias Nexus.Badges.UserBadge
  alias Nexus.Admin

  # ---------------------------------------------------------------------------
  # Settings helpers
  # ---------------------------------------------------------------------------

  @default_settings %{
    "enabled"                   => true,
    "points_name"               => "points",
    "post_points"               => 1,
    "reply_points"              => 1,
    "reaction_given_points"     => 1,
    "reaction_received_points"  => 1,
    "login_points"              => 1,
    "streak_multiplier"         => 0.1,
    "streak_cap"                => 3.0,
    "badge_points"              => 5,
    "pin_points"                => 3,
    "mention_received_points"   => 1
  }

  def settings do
    stored = Admin.get_setting("leaderboard")
    Map.merge(@default_settings, stored || %{})
  end

  def enabled? do
    settings()["enabled"] != false
  end

  def points_name do
    settings()["points_name"] || "points"
  end

  # ---------------------------------------------------------------------------
  # Score computation
  # ---------------------------------------------------------------------------

  @doc """
  Compute the total score for a user over a given date range.
  Uses current admin settings for point values.
  """
  def compute_score(user_id, from_date, to_date) do
    cfg = settings()

    # Aggregate activity stats for the period
    stats =
      Repo.one(
        from s in UserDailyStat,
        where: s.user_id == ^user_id and s.date >= ^from_date and s.date <= ^to_date,
        select: %{
          posts:              coalesce(sum(s.posts_count), 0),
          replies:            coalesce(sum(s.replies_count), 0),
          reactions_given:    coalesce(sum(s.reactions_given), 0),
          reactions_received: coalesce(sum(s.reactions_received), 0),
          active_days:        count(s.date)
        }
      ) || %{posts: 0, replies: 0, reactions_given: 0, reactions_received: 0, active_days: 0}

    # Badges earned in the period
    badge_count =
      Repo.aggregate(
        from(ub in UserBadge,
          where: ub.user_id == ^user_id
            and fragment("?::date", ub.awarded_at) >= ^from_date
            and fragment("?::date", ub.awarded_at) <= ^to_date
        ),
        :count
      )

    # Posts pinned in the period — count posts where pinned=true and
    # last updated in range (proxy for when they were pinned)
    pin_count =
      Repo.aggregate(
        from(p in Post,
          where: p.user_id == ^user_id
            and p.pinned == true
            and fragment("?::date", p.updated_at) >= ^from_date
            and fragment("?::date", p.updated_at) <= ^to_date
        ),
        :count
      )

    # Mentions received — count of posts/replies mentioning @username in period
    user = Repo.one(from u in User, where: u.id == ^user_id, select: u.username)
    mention_count =
      if user do
        pattern = "@#{user}"
        post_mentions =
          Repo.aggregate(
            from(p in Post,
              where: ilike(p.body, ^"%#{pattern}%")
                and fragment("?::date", p.inserted_at) >= ^from_date
                and fragment("?::date", p.inserted_at) <= ^to_date
                and p.hidden == false
            ),
            :count
          )
        reply_mentions =
          Repo.aggregate(
            from(r in Reply,
              where: ilike(r.body, ^"%#{pattern}%")
                and fragment("?::date", r.inserted_at) >= ^from_date
                and fragment("?::date", r.inserted_at) <= ^to_date
                and r.hidden == false
            ),
            :count
          )
        post_mentions + reply_mentions
      else
        0
      end

    # Login streak bonus for the period
    # Use the streak at the end of the period (current_streak from user row)
    # for all-time/month; for short periods we count active_days
    streak =
      Repo.one(from u in User, where: u.id == ^user_id, select: u.current_streak) || 0

    streak_multiplier = min(
      cfg["streak_cap"] || 3.0,
      1.0 + (streak * (cfg["streak_multiplier"] || 0.1))
    )

    login_raw = stats.active_days * to_float(cfg["login_points"] || 1)
    login_score = round(login_raw * streak_multiplier)

    score =
      round(stats.posts              * to_float(cfg["post_points"] || 1)) +
      round(stats.replies            * to_float(cfg["reply_points"] || 1)) +
      round(stats.reactions_given    * to_float(cfg["reaction_given_points"] || 1)) +
      round(stats.reactions_received * to_float(cfg["reaction_received_points"] || 1)) +
      login_score +
      (badge_count * to_int(cfg["badge_points"] || 5)) +
      (pin_count   * to_int(cfg["pin_points"] || 3)) +
      (mention_count * to_int(cfg["mention_received_points"] || 1))

    max(0, score)
  end

  # ---------------------------------------------------------------------------
  # Score upsert
  # ---------------------------------------------------------------------------

  @doc """
  Recompute and persist a user's score for all three windows
  (week, month, all-time). Called by UpdateScore worker.
  """
  def update_score(user_id) do
    today      = Date.utc_today()
    week_start = Date.add(today, -7)
    month_start = Date.add(today, -30)
    epoch      = ~D[2000-01-01]

    score_week  = compute_score(user_id, week_start,  today)
    score_month = compute_score(user_id, month_start, today)
    score_all   = compute_score(user_id, epoch,       today)

    now = DateTime.utc_now() |> DateTime.truncate(:second)

    Repo.insert!(
      %UserScore{
        user_id:     user_id,
        score_all:   score_all,
        score_month: score_month,
        score_week:  score_week,
        updated_at:  now
      },
      on_conflict: [set: [
        score_all:   score_all,
        score_month: score_month,
        score_week:  score_week,
        updated_at:  now
      ]],
      conflict_target: [:user_id]
    )

    :ok
  end

  # ---------------------------------------------------------------------------
  # Leaderboard queries
  # ---------------------------------------------------------------------------

  @doc """
  Returns the top `limit` users for the given period.
  period: "week" | "month" | "all"
  """
  def get_leaderboard(period \\ "all", limit \\ 20) do
    score_field = score_field_for(period)

    Repo.all(
      from s in UserScore,
      join: u in User, on: s.user_id == u.id,
      where: u.status != "banned",
      order_by: [desc: field(s, ^score_field)],
      limit: ^limit,
      select: %{
        user_id:      s.user_id,
        username:     u.username,
        avatar_url:   u.avatar_url,
        avatar_color: u.avatar_color,
        score:        field(s, ^score_field),
        score_all:    s.score_all,
        score_week:   s.score_week,
        score_month:  s.score_month
      }
    )
  end

  @doc """
  Returns the rank, score, and total user count for the current user
  in the given period.
  """
  def get_user_rank(user_id, period \\ "all") do
    score_field = score_field_for(period)

    # Get the user's own score
    user_score =
      Repo.one(
        from s in UserScore,
        where: s.user_id == ^user_id,
        select: field(s, ^score_field)
      ) || 0

    # Count how many non-banned users have a higher score
    rank =
      Repo.one(
        from s in UserScore,
        join: u in User, on: s.user_id == u.id,
        where: u.status != "banned" and field(s, ^score_field) > ^user_score,
        select: count(s.user_id)
      ) + 1

    total =
      Repo.aggregate(
        from(s in UserScore,
          join: u in User, on: s.user_id == u.id,
          where: u.status != "banned"
        ),
        :count
      )

    pct =
      if total > 0,
        do: round((1 - (rank - 1) / total) * 100),
        else: 100

    %{rank: rank, score: user_score, total: total, pct: pct}
  end

  # ---------------------------------------------------------------------------
  # Backfill
  # ---------------------------------------------------------------------------

  @doc """
  Enqueue UpdateScore jobs for every user, staggered by 2s each.
  """
  def backfill_all do
    user_ids = Repo.all(from u in User, select: u.id)

    user_ids
    |> Enum.with_index()
    |> Enum.each(fn {user_id, idx} ->
      %{"user_id" => user_id}
      |> Nexus.Workers.UpdateScore.new(schedule_in: idx * 2)
      |> Oban.insert()
    end)

    length(user_ids)
  end

  # ---------------------------------------------------------------------------
  # Private helpers
  # ---------------------------------------------------------------------------

  defp score_field_for("week"),  do: :score_week
  defp score_field_for("month"), do: :score_month
  defp score_field_for(_),       do: :score_all

  defp to_float(v) when is_float(v),   do: v
  defp to_float(v) when is_integer(v), do: v * 1.0
  defp to_float(_),                    do: 1.0

  defp to_int(v) when is_integer(v), do: v
  defp to_int(v) when is_float(v),   do: round(v)
  defp to_int(_),                    do: 1
end
