defmodule Nexus.Analytics do
  @moduledoc """
  Analytics context for the admin panel.

  All functions accept a `{from_date, to_date}` date range tuple and a
  matching `prev_range` tuple so callers can compute period-over-period
  deltas. Dates are `Date` structs; queries cast to `utc_datetime`
  boundaries internally.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Accounts.User
  alias Nexus.Activity.{LoginEvent, UserDailyStat}
  alias Nexus.Forum.{Post, Reply, Reaction, Space}
  alias Nexus.Moderation.Report

  # ---------------------------------------------------------------------------
  # Date helpers
  # ---------------------------------------------------------------------------

  @doc """
  Returns `{from_date, to_date, prev_from, prev_to}` for a named period atom.
  Periods: :p7d | :p28d | :p90d | :p1y
  """
  def date_range(:p7d) do
    to   = Date.utc_today()
    from = Date.add(to, -6)
    {from, to, Date.add(from, -7), Date.add(to, -7)}
  end

  def date_range(:p28d) do
    to   = Date.utc_today()
    from = Date.add(to, -27)
    {from, to, Date.add(from, -28), Date.add(to, -28)}
  end

  def date_range(:p90d) do
    to   = Date.utc_today()
    from = Date.add(to, -89)
    {from, to, Date.add(from, -90), Date.add(to, -90)}
  end

  def date_range(:p1y) do
    to   = Date.utc_today()
    from = Date.add(to, -364)
    {from, to, Date.add(from, -365), Date.add(to, -365)}
  end

  # Convert a Date to a UTC midnight DateTime for timestamp comparisons.
  defp dt_start(date), do: DateTime.new!(date, ~T[00:00:00], "Etc/UTC")
  defp dt_end(date),   do: DateTime.new!(date, ~T[23:59:59], "Etc/UTC")

  # ---------------------------------------------------------------------------
  # Overview tab
  # ---------------------------------------------------------------------------

  @doc "Builds the full overview payload for a given period."
  def overview(from_date, to_date, prev_from, prev_to) do
    %{
      dau:                    dau_for_period(from_date, to_date),
      dau_prev:               dau_for_period(prev_from, prev_to),
      new_members:            new_members_count(from_date, to_date),
      new_members_prev:       new_members_count(prev_from, prev_to),
      posts_count:            posts_count(from_date, to_date),
      posts_count_prev:       posts_count(prev_from, prev_to),
      median_first_reply_sec: median_first_reply_seconds(from_date, to_date),
      dau_series:             dau_timeseries(from_date, to_date),
      alerts:                 health_alerts()
    }
  end

  # Average DAU for a period (total unique active days / days in period).
  defp dau_for_period(from_date, to_date) do
    days = Date.diff(to_date, from_date) + 1

    total_active =
      Repo.one(
        from e in LoginEvent,
        where: fragment("?::date", e.inserted_at) >= ^from_date
           and fragment("?::date", e.inserted_at) <= ^to_date,
        select: count(e.user_id, :distinct)
      ) || 0

    # This gives the mean DAU rather than a single day snapshot, which is
    # more meaningful for period comparisons.
    if days > 0, do: Float.round(total_active / days, 1), else: 0.0
  end

  defp new_members_count(from_date, to_date) do
    Repo.aggregate(
      from(u in User,
        where: u.inserted_at >= ^dt_start(from_date)
           and u.inserted_at <= ^dt_end(to_date)),
      :count
    )
  end

  defp posts_count(from_date, to_date) do
    Repo.aggregate(
      from(p in Post,
        where: p.inserted_at >= ^dt_start(from_date)
           and p.inserted_at <= ^dt_end(to_date)),
      :count
    )
  end

  defp median_first_reply_seconds(from_date, to_date) do
    # Compute first reply time per post in a subquery, then take the median
    # across all posts. percentile_cont cannot nest MIN() directly in Postgres.
    Repo.one(
      fragment(
        """
        SELECT percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (first_reply - post_created))
        )
        FROM (
          SELECT p.inserted_at AS post_created,
                 MIN(r.inserted_at) AS first_reply
          FROM posts p
          JOIN replies r ON r.post_id = p.id
          WHERE p.inserted_at >= ? AND p.inserted_at <= ?
          GROUP BY p.id
        ) sub
        """,
        ^dt_start(from_date),
        ^dt_end(to_date)
      )
    )
  end

  defp dau_timeseries(from_date, to_date) do
    Repo.all(
      from e in LoginEvent,
      where: fragment("?::date", e.inserted_at) >= ^from_date
         and fragment("?::date", e.inserted_at) <= ^to_date,
      group_by: fragment("?::date", e.inserted_at),
      select: %{
        date:  fragment("?::date", e.inserted_at),
        count: count(e.user_id, :distinct)
      },
      order_by: fragment("?::date", e.inserted_at)
    )
  end

  defp health_alerts do
    now = DateTime.utc_now()

    # Stale flags: pending reports older than 48 hours
    stale_cutoff = DateTime.add(now, -48 * 3600, :second)
    stale_flags =
      Repo.one(
        from r in Report,
        where: r.status == "pending" and r.inserted_at < ^stale_cutoff,
        select: %{
          count:           count(r.id),
          oldest_age_hours:
            fragment(
              "EXTRACT(EPOCH FROM (NOW() - MIN(?))) / 3600",
              r.inserted_at
            )
        }
      )

    # Registration spike: compare last 2 hours vs prior 7-day hourly baseline
    two_hours_ago = DateTime.add(now, -2 * 3600, :second)
    recent_signups =
      Repo.aggregate(
        from(u in User, where: u.inserted_at >= ^two_hours_ago),
        :count
      )

    seven_days_ago = DateTime.add(now, -7 * 24 * 3600, :second)
    week_signups =
      Repo.aggregate(
        from(u in User, where: u.inserted_at >= ^seven_days_ago),
        :count
      )
    baseline_hourly = week_signups / (7 * 24)
    spike_ratio     = if baseline_hourly > 0, do: recent_signups / baseline_hourly / 2, else: nil

    # Pending approvals
    pending_posts   = Repo.aggregate(from(p in Post,  where: p.pending_approval == true), :count)
    pending_replies = Repo.aggregate(from(r in Reply, where: r.pending_approval == true), :count)
    pending_total   = pending_posts + pending_replies

    oldest_pending_hours =
      if pending_total > 0 do
        Repo.one(
          from p in Post,
          where: p.pending_approval == true,
          select:
            fragment(
              "EXTRACT(EPOCH FROM (NOW() - MIN(?))) / 3600",
              p.inserted_at
            )
        )
      else
        nil
      end

    %{
      stale_flags: %{
        count:            (stale_flags[:count] || 0),
        oldest_age_hours: stale_flags[:oldest_age_hours]
      },
      registration_spike: %{
        recent_count:     recent_signups,
        baseline_hourly:  Float.round(baseline_hourly, 2),
        ratio:            spike_ratio && Float.round(spike_ratio, 2),
        spiking:          spike_ratio != nil and spike_ratio > 3.0
      },
      pending_approvals: %{
        count:            pending_total,
        oldest_age_hours: oldest_pending_hours
      }
    }
  end

  # ---------------------------------------------------------------------------
  # Content tab
  # ---------------------------------------------------------------------------

  @doc "Builds the full content payload for a given period."
  def content(from_date, to_date) do
    %{
      posts_and_replies_series: posts_and_replies_series(from_date, to_date),
      heatmap:                  activity_heatmap(from_date, to_date),
      space_activity:           space_activity(from_date, to_date)
    }
  end

  defp posts_and_replies_series(from_date, to_date) do
    posts =
      Repo.all(
        from p in Post,
        where: p.inserted_at >= ^dt_start(from_date)
           and p.inserted_at <= ^dt_end(to_date),
        group_by: fragment("?::date", p.inserted_at),
        select: %{
          date:  fragment("?::date", p.inserted_at),
          count: count(p.id)
        },
        order_by: fragment("?::date", p.inserted_at)
      )

    replies =
      Repo.all(
        from r in Reply,
        where: r.inserted_at >= ^dt_start(from_date)
           and r.inserted_at <= ^dt_end(to_date),
        group_by: fragment("?::date", r.inserted_at),
        select: %{
          date:  fragment("?::date", r.inserted_at),
          count: count(r.id)
        },
        order_by: fragment("?::date", r.inserted_at)
      )

    %{posts: posts, replies: replies}
  end

  # Returns a 7×24 matrix (rows = Mon–Sun, cols = hour 0–23) of post+reply
  # counts, normalised to 0.0–1.0 relative to the cell with the highest value.
  defp activity_heatmap(from_date, to_date) do
    raw =
      Repo.all(
        from p in Post,
        where: p.inserted_at >= ^dt_start(from_date)
           and p.inserted_at <= ^dt_end(to_date),
        group_by: [
          fragment("EXTRACT(DOW FROM ?)::int", p.inserted_at),
          fragment("EXTRACT(HOUR FROM ?)::int", p.inserted_at)
        ],
        select: %{
          dow:   fragment("EXTRACT(DOW FROM ?)::int", p.inserted_at),
          hour:  fragment("EXTRACT(HOUR FROM ?)::int", p.inserted_at),
          count: count(p.id)
        }
      )

    # Postgres DOW: 0=Sun, 1=Mon … 6=Sat. We want Mon=0 … Sun=6.
    # Build a map keyed by {mon_index, hour} then fill into 7×24 grid.
    cell_map =
      Map.new(raw, fn %{dow: dow, hour: hour, count: count} ->
        mon_index = Integer.mod(dow - 1, 7)
        {{mon_index, hour}, count}
      end)

    max_val = cell_map |> Map.values() |> Enum.max(fn -> 1 end)

    for day <- 0..6 do
      for hour <- 0..23 do
        count = Map.get(cell_map, {day, hour}, 0)
        Float.round(count / max_val, 3)
      end
    end
  end

  defp space_activity(from_date, to_date) do
    posts_by_space =
      Repo.all(
        from p in Post,
        join: s in Space, on: s.id == p.space_id,
        where: p.inserted_at >= ^dt_start(from_date)
           and p.inserted_at <= ^dt_end(to_date),
        group_by: [s.id, s.name, s.slug, s.color],
        select: %{
          space_id: s.id,
          name:     s.name,
          slug:     s.slug,
          color:    s.color,
          posts:    count(p.id)
        },
        order_by: [desc: count(p.id)],
        limit: 8
      )

    replies_by_space =
      Repo.all(
        from r in Reply,
        join: p in Post,  on: p.id == r.post_id,
        join: s in Space, on: s.id == p.space_id,
        where: r.inserted_at >= ^dt_start(from_date)
           and r.inserted_at <= ^dt_end(to_date),
        group_by: [s.id],
        select: %{space_id: s.id, replies: count(r.id)}
      )

    reply_map = Map.new(replies_by_space, &{&1.space_id, &1.replies})

    Enum.map(posts_by_space, fn s ->
      Map.put(s, :replies, Map.get(reply_map, s.space_id, 0))
    end)
  end

  # ---------------------------------------------------------------------------
  # Users tab
  # ---------------------------------------------------------------------------

  @doc "Builds the full users payload for a given period."
  def users(from_date, to_date) do
    %{
      top_contributors:  top_contributors(from_date, to_date),
      new_vs_returning:  new_vs_returning(from_date, to_date),
      inactive_counts:   inactive_counts()
    }
  end

  defp top_contributors(from_date, to_date) do
    Repo.all(
      from s in UserDailyStat,
      join: u in User, on: u.id == s.user_id,
      where: s.date >= ^from_date and s.date <= ^to_date,
      group_by: [s.user_id, u.username, u.avatar_url, u.avatar_color],
      select: %{
        user_id:    s.user_id,
        username:   u.username,
        avatar_url: u.avatar_url,
        avatar_color: u.avatar_color,
        posts:      sum(s.posts_count),
        replies:    sum(s.replies_count)
      },
      order_by: [desc: sum(s.posts_count) + sum(s.replies_count)],
      limit: 10
    )
  end

  # Members who posted during the period: "returning" if inserted_at < from_date,
  # "new" if inserted_at >= from_date.
  defp new_vs_returning(from_date, to_date) do
    active_user_ids =
      Repo.all(
        from e in LoginEvent,
        where: fragment("?::date", e.inserted_at) >= ^from_date
           and fragment("?::date", e.inserted_at) <= ^to_date,
        select: e.user_id,
        distinct: true
      )

    total = length(active_user_ids)

    if total == 0 do
      %{new_count: 0, returning_count: 0, new_pct: 0.0, returning_pct: 0.0}
    else
      new_count =
        Repo.aggregate(
          from(u in User,
            where: u.id in ^active_user_ids
               and u.inserted_at >= ^dt_start(from_date)),
          :count
        )

      returning_count = total - new_count
      new_pct         = Float.round(new_count / total * 100, 1)
      returning_pct   = Float.round(returning_count / total * 100, 1)

      %{
        new_count:       new_count,
        returning_count: returning_count,
        new_pct:         new_pct,
        returning_pct:   returning_pct
      }
    end
  end

  # Live counts, not period-scoped — these describe the current member base.
  defp inactive_counts do
    now = DateTime.utc_now()

    cutoff_90  = DateTime.add(now, -90  * 86_400, :second)
    cutoff_180 = DateTime.add(now, -180 * 86_400, :second)
    cutoff_365 = DateTime.add(now, -365 * 86_400, :second)

    %{
      days_90:  Repo.aggregate(from(u in User, where: u.last_seen_at < ^cutoff_90  or is_nil(u.last_seen_at)), :count),
      days_180: Repo.aggregate(from(u in User, where: u.last_seen_at < ^cutoff_180 or is_nil(u.last_seen_at)), :count),
      days_365: Repo.aggregate(from(u in User, where: u.last_seen_at < ^cutoff_365 or is_nil(u.last_seen_at)), :count)
    }
  end

  # ---------------------------------------------------------------------------
  # Moderation tab
  # ---------------------------------------------------------------------------

  @doc "Builds the full moderation payload for a given period."
  def moderation(from_date, to_date, prev_from, prev_to) do
    %{
      report_count:       report_count(from_date, to_date),
      report_count_prev:  report_count(prev_from, prev_to),
      report_series:      report_series(from_date, to_date),
      report_reasons:     report_reasons(from_date, to_date),
      hidden_series:      hidden_series(from_date, to_date),
      pending_approvals:  pending_approvals_detail()
    }
  end

  defp report_count(from_date, to_date) do
    Repo.aggregate(
      from(r in Report,
        where: r.inserted_at >= ^dt_start(from_date)
           and r.inserted_at <= ^dt_end(to_date)),
      :count
    )
  end

  defp report_series(from_date, to_date) do
    Repo.all(
      from r in Report,
      where: r.inserted_at >= ^dt_start(from_date)
         and r.inserted_at <= ^dt_end(to_date),
      group_by: fragment("?::date", r.inserted_at),
      select: %{
        date:  fragment("?::date", r.inserted_at),
        count: count(r.id)
      },
      order_by: fragment("?::date", r.inserted_at)
    )
  end

  defp report_reasons(from_date, to_date) do
    total = max(report_count(from_date, to_date), 1)

    Repo.all(
      from r in Report,
      where: r.inserted_at >= ^dt_start(from_date)
         and r.inserted_at <= ^dt_end(to_date),
      group_by: r.reason,
      select: %{reason: r.reason, count: count(r.id)},
      order_by: [desc: count(r.id)]
    )
    |> Enum.map(fn row ->
      Map.put(row, :pct, Float.round(row.count / total * 100, 1))
    end)
  end

  defp hidden_series(from_date, to_date) do
    posts =
      Repo.all(
        from p in Post,
        where: p.hidden == true
           and p.hidden_at >= ^dt_start(from_date)
           and p.hidden_at <= ^dt_end(to_date),
        group_by: fragment("?::date", p.hidden_at),
        select: %{date: fragment("?::date", p.hidden_at), count: count(p.id)},
        order_by: fragment("?::date", p.hidden_at)
      )

    replies =
      Repo.all(
        from r in Reply,
        where: r.hidden == true
           and r.hidden_at >= ^dt_start(from_date)
           and r.hidden_at <= ^dt_end(to_date),
        group_by: fragment("?::date", r.hidden_at),
        select: %{date: fragment("?::date", r.hidden_at), count: count(r.id)},
        order_by: fragment("?::date", r.hidden_at)
      )

    %{posts: posts, replies: replies}
  end

  defp pending_approvals_detail do
    %{
      posts:   Repo.aggregate(from(p in Post,  where: p.pending_approval == true), :count),
      replies: Repo.aggregate(from(r in Reply, where: r.pending_approval == true), :count)
    }
  end

  # ---------------------------------------------------------------------------
  # Engagement tab
  # ---------------------------------------------------------------------------

  @doc "Builds the full engagement payload for a given period."
  def engagement(from_date, to_date, prev_from, prev_to) do
    %{
      participation_pct:      participation_pct(from_date, to_date),
      participation_pct_prev: participation_pct(prev_from, prev_to),
      reaction_ratio:         reaction_ratio(from_date, to_date),
      reaction_ratio_prev:    reaction_ratio(prev_from, prev_to),
      reaction_breakdown:     reaction_breakdown(from_date, to_date),
      reply_time_series:      reply_time_series(from_date, to_date)
    }
  end

  # % of active members (logged in during period) who posted or replied.
  defp participation_pct(from_date, to_date) do
    active_users =
      Repo.one(
        from e in LoginEvent,
        where: fragment("?::date", e.inserted_at) >= ^from_date
           and fragment("?::date", e.inserted_at) <= ^to_date,
        select: count(e.user_id, :distinct)
      ) || 0

    if active_users == 0 do
      nil
    else
      posting_users =
        Repo.one(
          from s in UserDailyStat,
          where: s.date >= ^from_date
             and s.date <= ^to_date
             and (s.posts_count > 0 or s.replies_count > 0),
          select: count(s.user_id, :distinct)
        ) || 0

      Float.round(posting_users / active_users * 100, 1)
    end
  end

  defp reaction_ratio(from_date, to_date) do
    total_reactions =
      Repo.aggregate(
        from(rx in Reaction,
          where: rx.inserted_at >= ^dt_start(from_date)
             and rx.inserted_at <= ^dt_end(to_date)),
        :count
      )

    total_posts =
      Repo.aggregate(
        from(p in Post,
          where: p.inserted_at >= ^dt_start(from_date)
             and p.inserted_at <= ^dt_end(to_date)),
        :count
      )

    ratio =
      if total_posts > 0,
        do: Float.round(total_reactions / total_posts, 2),
        else: nil

    %{total_reactions: total_reactions, total_posts: total_posts, ratio: ratio}
  end

  defp reaction_breakdown(from_date, to_date) do
    Repo.all(
      from rx in Reaction,
      where: rx.inserted_at >= ^dt_start(from_date)
         and rx.inserted_at <= ^dt_end(to_date),
      group_by: rx.emoji,
      select: %{emoji: rx.emoji, count: count(rx.id)},
      order_by: [desc: count(rx.id)],
      limit: 10
    )
  end

  # Daily median reply time (seconds) over the period.
  defp reply_time_series(from_date, to_date) do
    # Subquery computes first reply per post; outer query takes daily median.
    Repo.all(
      fragment(
        """
        SELECT day::date AS date,
               percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY EXTRACT(EPOCH FROM (first_reply - post_created))
               ) AS median_seconds
        FROM (
          SELECT p.inserted_at::date AS day,
                 p.inserted_at       AS post_created,
                 MIN(r.inserted_at)  AS first_reply
          FROM posts p
          JOIN replies r ON r.post_id = p.id
          WHERE p.inserted_at >= ? AND p.inserted_at <= ?
          GROUP BY p.id
        ) sub
        GROUP BY day
        ORDER BY day
        """,
        ^dt_start(from_date),
        ^dt_end(to_date)
      )
    )
  end
end
