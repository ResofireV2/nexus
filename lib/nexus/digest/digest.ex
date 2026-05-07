defmodule Nexus.Digest do
  @moduledoc """
  Builds the content for digest emails.
  All queries are scoped to a date range matching the digest frequency.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Accounts.User
  alias Nexus.Forum.{Post, Reply, Space}
  alias Nexus.Activity.UserDailyStat
  alias Nexus.Badges.UserBadge
  alias Nexus.Leaderboard.UserScore
  alias Nexus.Admin

  # ---------------------------------------------------------------------------
  # Date range helpers
  # ---------------------------------------------------------------------------

  def date_range("daily") do
    now  = DateTime.utc_now()
    from = DateTime.add(now, -86400, :second) |> DateTime.truncate(:second)
    {from, now}
  end

  def date_range("weekly") do
    now  = DateTime.utc_now()
    from = DateTime.add(now, -7 * 86400, :second) |> DateTime.truncate(:second)
    {from, now}
  end

  def date_range("monthly") do
    now  = DateTime.utc_now()
    from = DateTime.add(now, -30 * 86400, :second) |> DateTime.truncate(:second)
    {from, now}
  end

  # ---------------------------------------------------------------------------
  # Settings
  # ---------------------------------------------------------------------------

  def settings do
    case Admin.get_setting("digest") do
      s when is_map(s) -> s
      _ -> %{}
    end
  end

  def enabled? do
    settings()["enabled"] == true
  end

  # Decide whether NOW (in admin's configured timezone) matches the send time.
  # The cron job runs hourly; this check gates whether emails actually go out.
  def should_send_now?(frequency) do
    cfg       = settings()
    tz        = cfg["timezone"] || "UTC"
    send_time = cfg["send_time"] || "08:00"
    [h_str, m_str] = String.split(send_time, ":")
    target_hour   = String.to_integer(h_str)
    target_minute = String.to_integer(m_str)

    now_local =
      DateTime.utc_now()
      |> DateTime.shift_zone!(tz)

    hour_match   = now_local.hour == target_hour && now_local.minute < 60
    minute_match = now_local.minute >= target_minute && now_local.minute < target_minute + 60

    day_match = case frequency do
      "daily"   -> true
      "weekly"  ->
        day_name = cfg["weekly_day"] || "monday"
        day_of_week = Date.day_of_week(DateTime.to_date(now_local))
        day_names = ~w(monday tuesday wednesday thursday friday saturday sunday)
        configured_dow = Enum.find_index(day_names, &(&1 == day_name))
        configured_dow != nil && configured_dow + 1 == day_of_week
      "monthly" ->
        target_day = cfg["monthly_day"] || 1
        now_local.day == target_day
      _ -> false
    end

    hour_match && minute_match && day_match
  end

  # ---------------------------------------------------------------------------
  # Content queries
  # ---------------------------------------------------------------------------

  @doc "Top posts by engagement (reactions + replies) in the period."
  def top_posts(from_dt, to_dt, limit) do
    Repo.all(
      from p in Post,
      join: s in Space, on: p.space_id == s.id,
      join: u in User,  on: p.user_id  == u.id,
      where: p.inserted_at >= ^from_dt
         and p.inserted_at <= ^to_dt
         and p.hidden == false
         and p.pending_approval == false,
      order_by: [desc: p.reaction_count + p.reply_count],
      limit: ^limit,
      select: %{
        id:             p.id,
        title:          p.title,
        body:           p.body,
        reply_count:    p.reply_count,
        reaction_count: p.reaction_count,
        inserted_at:    p.inserted_at,
        space_name:     s.name,
        space_color:    s.color,
        author:         u.username,
        avatar_url:     u.avatar_url
      }
    )
  end

  @doc "Top 3 users by score for the period plus total ranked user count."
  def leaderboard_snapshot(period) do
    score_field = case period do
      "weekly"  -> :score_week
      "monthly" -> :score_month
      _         -> :score_all
    end

    top3 = Repo.all(
      from s in UserScore,
      join: u in User, on: s.user_id == u.id,
      where: u.status != "banned",
      order_by: [desc: field(s, ^score_field)],
      limit: 3,
      select: %{
        user_id:   s.user_id,
        username:  u.username,
        avatar_url: u.avatar_url,
        score:     field(s, ^score_field)
      }
    )

    total = Repo.aggregate(UserScore, :count)
    %{top3: top3, total: total, points_name: Nexus.Leaderboard.points_name()}
  end

  @doc "Badges awarded in the period, grouped by badge with holder names."
  def badge_highlights(from_dt, to_dt) do
    rows = Repo.all(
      from ub in UserBadge,
      join: u in User,              on: ub.user_id  == u.id,
      join: b in Nexus.Badges.Badge, on: ub.badge_id == b.id,
      where: ub.awarded_at >= ^from_dt and ub.awarded_at <= ^to_dt,
      order_by: [desc: b.rarity, asc: b.name],
      select: %{
        badge_name:  b.name,
        badge_color: b.color,
        badge_icon:  b.icon,
        rarity:      b.rarity,
        username:    u.username
      }
    )

    # Group by badge name, collect holders
    rows
    |> Enum.group_by(& &1.badge_name)
    |> Enum.map(fn {_name, entries} ->
      first = List.first(entries)
      %{
        badge_name:  first.badge_name,
        badge_color: first.badge_color,
        badge_icon:  first.badge_icon,
        rarity:      first.rarity,
        holders:     Enum.map(entries, & &1.username)
      }
    end)
    |> Enum.sort_by(fn b ->
      rarity_order = %{"legendary" => 0, "epic" => 1, "rare" => 2, "common" => 3}
      Map.get(rarity_order, b.rarity, 99)
    end)
    |> Enum.take(5)
  end

  @doc "Users who joined in the period."
  def new_members(from_dt, to_dt) do
    Repo.all(
      from u in User,
      where: u.inserted_at >= ^from_dt and u.inserted_at <= ^to_dt,
      order_by: [asc: u.inserted_at],
      limit: 10,
      select: %{username: u.username, avatar_url: u.avatar_url, inserted_at: u.inserted_at}
    )
  end

  @doc "Most active spaces by post count in the period."
  def trending_spaces(from_dt, to_dt) do
    Repo.all(
      from p in Post,
      join: s in Space, on: p.space_id == s.id,
      where: p.inserted_at >= ^from_dt and p.inserted_at <= ^to_dt
         and p.hidden == false,
      group_by: [s.id, s.name, s.color, s.icon],
      order_by: [desc: count(p.id)],
      limit: 5,
      select: %{
        space_id:   s.id,
        name:       s.name,
        color:      s.color,
        icon:       s.icon,
        post_count: count(p.id)
      }
    )
  end

  # ---------------------------------------------------------------------------
  # Build full digest payload for a frequency
  # ---------------------------------------------------------------------------

  def build(frequency) do
    cfg           = settings()
    {from_dt, to_dt} = date_range(frequency)
    limit         = cfg["top_posts_count"] || 5
    section_order = cfg["section_order"] || ["posts","leaderboard","badges","members","spaces"]

    period_label = case frequency do
      "daily"   -> "today"
      "weekly"  -> "this week"
      "monthly" -> "this month"
    end

    lb_period = case frequency do
      "daily"   -> "all"
      "weekly"  -> "weekly"
      "monthly" -> "monthly"
    end

    sections = %{
      "posts"       => top_posts(from_dt, to_dt, limit),
      "leaderboard" => if(cfg["include_leaderboard"] != false, do: leaderboard_snapshot(lb_period), else: nil),
      "badges"      => if(cfg["include_badges"]      != false, do: badge_highlights(from_dt, to_dt), else: nil),
      "members"     => if(cfg["include_new_members"] != false, do: new_members(from_dt, to_dt), else: nil),
      "spaces"      => if(cfg["include_trending_spaces"] != false, do: trending_spaces(from_dt, to_dt), else: nil)
    }

    %{
      frequency:     frequency,
      period_label:  period_label,
      from_dt:       from_dt,
      to_dt:         to_dt,
      section_order: section_order,
      sections:      sections
    }
  end

  # ---------------------------------------------------------------------------
  # Fetch users subscribed to a given digest frequency
  # ---------------------------------------------------------------------------

  def subscribers(frequency) do
    Repo.all(
      from u in User,
      where: u.status == "active",
      where: fragment("?->>'digest_frequency' = ?", u.preferences, ^frequency)
    )
  end
end
