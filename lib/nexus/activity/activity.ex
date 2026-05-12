defmodule Nexus.Activity do
  @moduledoc """
  Tracks user activity: logins, streaks, and daily stat rollups.
  All writes are async (Task.start) so they never block request handling.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Activity.{LoginEvent, UserDailyStat}
  alias Nexus.Accounts.User

  # ---------------------------------------------------------------------------
  # Login / last-seen tracking
  # Called from the ActivityTracker plug on every authenticated request.
  # ---------------------------------------------------------------------------

  def track_request(user, opts \\ []) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)
    today = Date.utc_today()

    Task.start(fn ->
      # Always update last_seen_at
      Repo.update_all(
        from(u in User, where: u.id == ^user.id),
        set: [last_seen_at: now]
      )

      # Check if we already have a login event for today
      already_logged_today =
        Repo.exists?(
          from e in LoginEvent,
          where: e.user_id == ^user.id and fragment("?::date", e.inserted_at) == ^today
        )

      unless already_logged_today do
        # Record login event
        %LoginEvent{}
        |> LoginEvent.changeset(%{
          user_id:    user.id,
          ip_address: opts[:ip_address],
          user_agent: opts[:user_agent]
        })
        |> Repo.insert(on_conflict: :nothing)

        # Update streak
        update_streak(user.id, today)
      end
    end)
  end

  defp update_streak(user_id, today) do
    yesterday = Date.add(today, -1)

    # Check if user logged in yesterday
    logged_yesterday =
      Repo.exists?(
        from e in LoginEvent,
        where: e.user_id == ^user_id and fragment("?::date", e.inserted_at) == ^yesterday
      )

    user = Repo.get(User, user_id)
    if user do
      new_streak = if logged_yesterday, do: (user.current_streak || 0) + 1, else: 1
      longest    = max(new_streak, user.longest_streak || 0)

      Repo.update_all(
        from(u in User, where: u.id == ^user_id),
        set: [current_streak: new_streak, longest_streak: longest]
      )
    end
  end

  # ---------------------------------------------------------------------------
  # Daily stat increments
  # Called after post/reply/reaction creation.
  # ---------------------------------------------------------------------------

  def increment_stat(user_id, field) when field in [:posts_count, :replies_count, :reactions_given] do
    Task.start(fn -> do_increment(user_id, field, 1) end)
  end

  def increment_stat(user_id, :reactions_received) do
    Task.start(fn -> do_increment(user_id, :reactions_received, 1) end)
  end

  defp do_increment(user_id, field, amount) do
    today = Date.utc_today()
    col   = Atom.to_string(field)
    now   = DateTime.utc_now() |> DateTime.truncate(:second)

    # Single atomic upsert. On insert, the target column starts at `amount`
    # (not 0). On conflict, it increments by `amount`. This correctly handles
    # both the first activity of the day AND concurrent requests.
    #
    # The previous Ecto approach (on_conflict: [inc: ...]) only ran the
    # increment on conflict — a fresh INSERT set the column to 0, silently
    # dropping the first activity of each day from leaderboard scores.
    Repo.query!(
      """
      INSERT INTO user_daily_stats
        (user_id, date, posts_count, replies_count,
         reactions_given, reactions_received, inserted_at, updated_at)
      VALUES (
        $1, $2,
        #{if col == "posts_count",        do: "$4", else: "0"},
        #{if col == "replies_count",      do: "$4", else: "0"},
        #{if col == "reactions_given",    do: "$4", else: "0"},
        #{if col == "reactions_received", do: "$4", else: "0"},
        $3, $3
      )
      ON CONFLICT (user_id, date) DO UPDATE
        SET #{col} = user_daily_stats.#{col} + $4,
            updated_at = EXCLUDED.updated_at
      """,
      [user_id, today, now, amount]
    )
  rescue
    _ -> :ok
  end

  # ---------------------------------------------------------------------------
  # Query helpers (for admin dashboard and future leaderboard/recap)
  # ---------------------------------------------------------------------------

  @doc "Daily active users for the last N days."
  def daily_active_users(days \\ 30) do
    cutoff = Date.add(Date.utc_today(), -days)

    Repo.all(
      from e in LoginEvent,
      where: fragment("?::date", e.inserted_at) >= ^cutoff,
      group_by: fragment("?::date", e.inserted_at),
      select: %{
        date: fragment("?::date", e.inserted_at),
        count: count(e.user_id, :distinct)
      },
      order_by: fragment("?::date", e.inserted_at)
    )
  end

  @doc "Monthly active users for the last N months."
  def monthly_active_users(months \\ 12) do
    cutoff = Date.add(Date.utc_today(), -(months * 31))

    Repo.all(
      from e in LoginEvent,
      where: fragment("?::date", e.inserted_at) >= ^cutoff,
      group_by: fragment("date_trunc('month', ?)", e.inserted_at),
      select: %{
        month: fragment("date_trunc('month', ?)", e.inserted_at),
        count: count(e.user_id, :distinct)
      },
      order_by: fragment("date_trunc('month', ?)", e.inserted_at)
    )
  end

  @doc "Aggregate stats for a user over a date range."
  def user_stats(user_id, from_date, to_date) do
    Repo.one(
      from s in UserDailyStat,
      where: s.user_id == ^user_id and s.date >= ^from_date and s.date <= ^to_date,
      select: %{
        posts:              sum(s.posts_count),
        replies:            sum(s.replies_count),
        reactions_given:    sum(s.reactions_given),
        reactions_received: sum(s.reactions_received),
        active_days:        count(s.date)
      }
    )
  end

  @doc "Top users by total activity score in a date range."
  def leaderboard(from_date, to_date, limit \\ 20) do
    Repo.all(
      from s in UserDailyStat,
      join: u in assoc(s, :user),
      where: s.date >= ^from_date and s.date <= ^to_date,
      group_by: [s.user_id, u.username, u.avatar_url],
      select: %{
        user_id:            s.user_id,
        username:           u.username,
        avatar_url:         u.avatar_url,
        posts:              sum(s.posts_count),
        replies:            sum(s.replies_count),
        reactions_given:    sum(s.reactions_given),
        reactions_received: sum(s.reactions_received),
        active_days:        count(s.date)
      },
      order_by: [desc: sum(s.posts_count) + sum(s.replies_count) + sum(s.reactions_received)],
      limit: ^limit
    )
  end

  @doc "Year in review data for a user."
  def year_in_review(user_id, year) do
    from_date = Date.new!(year, 1, 1)
    to_date   = Date.new!(year, 12, 31)

    totals = user_stats(user_id, from_date, to_date)

    # Best month
    monthly = Repo.all(
      from s in UserDailyStat,
      where: s.user_id == ^user_id and s.date >= ^from_date and s.date <= ^to_date,
      group_by: fragment("date_trunc('month', ?)", s.date),
      select: %{
        month: fragment("date_trunc('month', ?)", s.date),
        score: sum(s.posts_count) + sum(s.replies_count)
      },
      order_by: [desc: sum(s.posts_count) + sum(s.replies_count)]
    )

    %{
      year:    year,
      totals:  totals,
      monthly: monthly,
      streak:  Repo.one(from u in User, where: u.id == ^user_id, select: u.longest_streak)
    }
  end
end
