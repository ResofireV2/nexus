defmodule NexusWeb.API.V1.LeaderboardController do
  use NexusWeb, :controller

  alias Nexus.Leaderboard
  alias Nexus.Admin
  alias Nexus.Badges

  # ---------------------------------------------------------------------------
  # GET /api/v1/leaderboard?period=all|month|week
  # Public. Returns top 20 plus the current user's rank if authenticated.
  # ---------------------------------------------------------------------------

  def index(conn, params) do
    unless Leaderboard.enabled?() do
      conn |> put_status(:not_found) |> json(%{error: "Leaderboard is disabled"})
    else
      period = params["period"] || "all"
      top    = Leaderboard.get_leaderboard(period, 20)

      # Enrich with badges (top 2 badges per user, for display in rank table)
      top_with_badges =
        Enum.map(top, fn row ->
          badges =
            Badges.list_user_badges(row.user_id)
            |> Enum.take(2)
            |> Enum.map(fn ub ->
              %{name: ub.badge.name, color: ub.badge.color, rarity: ub.badge.rarity}
            end)

          Map.put(row, :badges, badges)
        end)

      # Current user's rank (if logged in)
      my_rank =
        case conn.assigns[:current_user] do
          nil  -> nil
          user -> Leaderboard.get_user_rank(user.id, period)
        end

      json(conn, %{
        leaderboard:  Enum.map(top_with_badges, &entry_json/1),
        my_rank:      my_rank,
        points_name:  Leaderboard.points_name(),
        period:       period
      })
    end
  end

  # ---------------------------------------------------------------------------
  # GET /api/v1/leaderboard/me?period=all|month|week
  # Authenticated. Returns the current user's rank and score.
  # ---------------------------------------------------------------------------

  def me(conn, params) do
    unless Leaderboard.enabled?() do
      conn |> put_status(:not_found) |> json(%{error: "Leaderboard is disabled"})
    else
      period = params["period"] || "all"
      user   = conn.assigns.current_user
      rank   = Leaderboard.get_user_rank(user.id, period)
      json(conn, %{rank: rank, points_name: Leaderboard.points_name(), period: period})
    end
  end

  # ---------------------------------------------------------------------------
  # Admin — GET /api/v1/admin/leaderboard/settings
  # ---------------------------------------------------------------------------

  def get_settings(conn, _params) do
    json(conn, %{settings: Admin.get_setting("leaderboard") || %{}})
  end

  # ---------------------------------------------------------------------------
  # Admin — PATCH /api/v1/admin/leaderboard/settings
  # ---------------------------------------------------------------------------

  def update_settings(conn, %{"value" => value}) do
    case Admin.update_setting("leaderboard", value) do
      {:ok, _}  -> json(conn, %{ok: true})
      {:error, cs} ->
        conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
    end
  end

  # ---------------------------------------------------------------------------
  # Admin — POST /api/v1/admin/leaderboard/recalculate
  # Enqueues UpdateScore jobs for all users.
  # ---------------------------------------------------------------------------

  def recalculate(conn, _params) do
    count = Leaderboard.backfill_all()
    json(conn, %{ok: true, enqueued: count})
  end

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------

  defp entry_json(row) do
    %{
      user_id:        row.user_id,
      username:       row.username,
      avatar_url:     row.avatar_url,
      avatar_color:   Map.get(row, :avatar_color),
      score:          row.score,
      badges:         Map.get(row, :badges, []),
      current_streak: Map.get(row, :current_streak, 0)
    }
  end

  # GET /api/v1/leaderboard/streaks
  def streaks(conn, _params) do
    unless Leaderboard.enabled?() do
      conn |> put_status(:not_found) |> json(%{error: "Leaderboard is disabled"})
    else
      top = Nexus.Repo.all(
        from u in Nexus.Accounts.User,
          where: u.status == "active" and u.current_streak > 0,
          order_by: [desc: u.current_streak],
          limit: 5,
          select: %{
            user_id:        u.id,
            username:       u.username,
            avatar_url:     u.avatar_url,
            avatar_color:   u.avatar_color,
            current_streak: u.current_streak
          }
      )
      json(conn, %{streaks: top})
    end
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", to_string(v)) end)
    end)
  end
end
