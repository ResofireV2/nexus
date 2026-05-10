defmodule NexusWeb.API.V1.BadgeController do
  use NexusWeb, :controller

  alias Nexus.Badges
  alias Nexus.Accounts

  # ---------------------------------------------------------------------------
  # Public
  # ---------------------------------------------------------------------------

  # GET /api/v1/badges
  # GET /api/v1/badges/recent
  def recent_earners(conn, _params) do
    earners = Nexus.Badges.list_recent_earners(4)
    json(conn, %{earners: Enum.map(earners, fn e ->
      %{
        username:     e.username,
        avatar_url:   e.avatar_url,
        avatar_color: e.avatar_color,
        user_id:      e.user_id,
        badge_name:   e.badge_name,
        badge_icon:   e.badge_icon,
        badge_color:  e.badge_color,
        badge_rarity: e.badge_rarity,
        awarded_at:   e.awarded_at
      }
    end)})
  end

  def index(conn, _params) do
    badges = Badges.list_badges()
    json(conn, %{badges: Enum.map(badges, &badge_json/1)})
  end

  # GET /api/v1/badges/my
  def my_badges(conn, _params) do
    user_id = conn.assigns.current_user.id

    earned   = Badges.list_user_badges(user_id)
    progress = Badges.progress_for_user(user_id)
    all      = Badges.list_badges()

    json(conn, %{
      earned:   Enum.map(earned, &user_badge_json/1),
      progress: Enum.map(progress, fn %{badge: b, current_value: cv, pct: pct} ->
        %{badge: badge_json(b), current_value: cv, pct: pct}
      end),
      total_badges: length(all),
      earned_count: length(earned)
    })
  end

  # GET /api/v1/users/:username/badges
  def user_badges(conn, %{"username" => username}) do
    case Accounts.get_user_by_username(username) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "User not found"})

      user ->
        earned = Badges.list_user_badges(user.id)
        json(conn, %{badges: Enum.map(earned, &user_badge_json/1)})
    end
  end

  # ---------------------------------------------------------------------------
  # Admin
  # ---------------------------------------------------------------------------

  # GET /api/v1/admin/badges
  def admin_index(conn, _params) do
    badges = Badges.list_badges()

    badges_with_counts =
      Enum.map(badges, fn b ->
        badge_json(b) |> Map.put(:holder_count, Badges.holder_count(b.id))
      end)

    json(conn, %{badges: badges_with_counts})
  end

  # POST /api/v1/admin/badges
  def create(conn, params) do
    attrs = Map.take(params, ["name", "description", "icon", "color", "rarity",
                               "award_type", "trigger_type", "trigger_threshold"])

    # Convert trigger_threshold to integer if present
    attrs = case attrs["trigger_threshold"] do
      nil -> attrs
      v   -> Map.put(attrs, "trigger_threshold", to_integer(v))
    end

    case Badges.create_badge(attrs) do
      {:ok, badge}     -> conn |> put_status(:created) |> json(%{badge: badge_json(badge)})
      {:error, cs}     -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
    end
  end

  # PATCH /api/v1/admin/badges/:id
  def update(conn, %{"id" => id} = params) do
    case Badges.get_badge(id) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "Badge not found"})

      badge ->
        attrs = Map.take(params, ["name", "description", "icon", "color", "rarity",
                                   "award_type", "trigger_type", "trigger_threshold"])

        attrs = case attrs["trigger_threshold"] do
          nil -> attrs
          v   -> Map.put(attrs, "trigger_threshold", to_integer(v))
        end

        case Badges.update_badge(badge, attrs) do
          {:ok, updated} -> json(conn, %{badge: badge_json(updated)})
          {:error, cs}   -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
        end
    end
  end

  # DELETE /api/v1/admin/badges/:id
  def delete(conn, %{"id" => id}) do
    case Badges.get_badge(id) do
      nil   -> conn |> put_status(:not_found) |> json(%{error: "Badge not found"})
      badge ->
        {:ok, _} = Badges.delete_badge(badge)
        json(conn, %{ok: true})
    end
  end

  # POST /api/v1/admin/badges/install-presets
  def install_presets(conn, _params) do
    case Badges.install_presets() do
      {:ok, count}  -> json(conn, %{ok: true, installed: count})
      {:error, _}   -> conn |> put_status(:unprocessable_entity) |> json(%{error: "Some presets failed to install"})
    end
  end

  # POST /api/v1/admin/badges/backfill
  # Enqueues a CheckBadges job for every user in the system.
  # Oban's unique constraint (60s per user) prevents duplicates,
  # and jobs are staggered to avoid hammering the DB all at once.
  def backfill(conn, _params) do
    import Ecto.Query
    user_ids = Nexus.Repo.all(from u in Nexus.Accounts.User, select: u.id)

    user_ids
    |> Enum.with_index()
    |> Enum.each(fn {user_id, idx} ->
      # Stagger by 2 seconds per user so the queue drains smoothly
      delay = idx * 2
      %{"user_id" => user_id}
      |> Nexus.Workers.CheckBadges.new(schedule_in: delay)
      |> Oban.insert()
    end)

    json(conn, %{ok: true, enqueued: length(user_ids)})
  end

  # POST /api/v1/admin/badges/:id/award
  def award(conn, %{"id" => id, "username" => username}) do
    admin = conn.assigns.current_user

    with badge when not is_nil(badge) <- Badges.get_badge(id),
         user  when not is_nil(user)  <- Accounts.get_user_by_username(username) do
      case Badges.award_badge(user.id, badge.id, admin.id) do
        {:ok, :already_awarded} ->
          conn |> put_status(:conflict) |> json(%{error: "User already has this badge"})

        {:ok, _user_badge} ->
          json(conn, %{ok: true})

        {:error, cs} ->
          conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
      end
    else
      nil -> conn |> put_status(:not_found) |> json(%{error: "Badge or user not found"})
    end
  end

  # DELETE /api/v1/admin/badges/:id/revoke/:user_id
  def revoke(conn, %{"id" => badge_id, "user_id" => user_id}) do
    case Badges.revoke_badge(to_integer(user_id), to_integer(badge_id)) do
      {:ok, _}          -> json(conn, %{ok: true})
      {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "User does not have this badge"})
      {:error, _}          -> conn |> put_status(:unprocessable_entity) |> json(%{error: "Failed to revoke badge"})
    end
  end

  # GET /api/v1/admin/badges/:id/holders
  def holders(conn, %{"id" => id}) do
    case Badges.get_badge(id) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "Badge not found"})

      _badge ->
        holders = Badges.list_badge_holders(id)
        json(conn, %{holders: Enum.map(holders, &holder_json/1)})
    end
  end

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------

  defp badge_json(b) do
    %{
      id:                b.id,
      name:              b.name,
      description:       b.description,
      icon:              b.icon,
      color:             b.color,
      rarity:            b.rarity,
      award_type:        b.award_type,
      trigger_type:      b.trigger_type,
      trigger_threshold: b.trigger_threshold,
      is_preset:         b.is_preset,
      inserted_at:       b.inserted_at
    }
  end

  defp user_badge_json(ub) do
    %{
      badge:       badge_json(ub.badge),
      awarded_at:  ub.awarded_at,
      awarded_by:  ub.awarded_by && %{id: ub.awarded_by.id, username: ub.awarded_by.username}
    }
  end

  defp holder_json(ub) do
    %{
      user:       ub.user && %{id: ub.user.id, username: ub.user.username, avatar_url: ub.user.avatar_url},
      awarded_at: ub.awarded_at,
      awarded_by: ub.awarded_by && %{id: ub.awarded_by.id, username: ub.awarded_by.username}
    }
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", to_string(v)) end)
    end)
  end

  defp to_integer(v) when is_integer(v), do: v
  defp to_integer(v) when is_binary(v) do
    case Integer.parse(v) do
      {n, _} -> n
      :error -> nil
    end
  end
  defp to_integer(_), do: nil
end
