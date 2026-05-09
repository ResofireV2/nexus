defmodule Nexus.Badges do
  @moduledoc """
  The Badges context.

  Handles badge definitions, awarding (auto and manual), progress
  computation, and querying a user's earned badges.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Badges.{Badge, UserBadge}
  alias Nexus.Accounts.User
  alias Nexus.Activity.UserDailyStat
  alias Nexus.Forum.Post

  # ---------------------------------------------------------------------------
  # Badge CRUD
  # ---------------------------------------------------------------------------

  def list_badges do
    Badge
    |> order_by([b], [asc: b.inserted_at])
    |> Repo.all()
  end

  def get_badge(id), do: Repo.get(Badge, id)
  def get_badge!(id), do: Repo.get!(Badge, id)

  def create_badge(attrs) do
    %Badge{}
    |> Badge.changeset(attrs)
    |> Repo.insert()
  end

  def update_badge(%Badge{} = badge, attrs) do
    badge
    |> Badge.changeset(attrs)
    |> Repo.update()
  end

  def delete_badge(%Badge{} = badge) do
    Repo.delete(badge)
  end

  # ---------------------------------------------------------------------------
  # Preset installation
  # ---------------------------------------------------------------------------

  @presets [
    %{name: "New Member",      description: "Your account has been active for 30 days.",                             icon: "fa-seedling",       color: "#34d399", rarity: "common",    award_type: "auto", trigger_type: "account_age_days",   trigger_threshold: 30,   is_preset: true},
    %{name: "First Steps",     description: "Posted your very first thread.",                                         icon: "fa-shoe-prints",    color: "#a78bfa", rarity: "common",    award_type: "auto", trigger_type: "post_count",          trigger_threshold: 1,    is_preset: true},
    %{name: "Conversationalist",description: "Replied to 10 threads.",                                               icon: "fa-comments",       color: "#60a5fa", rarity: "common",    award_type: "auto", trigger_type: "reply_count",         trigger_threshold: 10,   is_preset: true},
    %{name: "Generous",        description: "Given 50 reactions to other members' posts.",                            icon: "fa-heart",          color: "#f472b6", rarity: "common",    award_type: "auto", trigger_type: "reactions_given",     trigger_threshold: 50,   is_preset: true},
    %{name: "Appreciated",     description: "Received 10 reactions across your posts.",                               icon: "fa-thumbs-up",      color: "#fbbf24", rarity: "common",    award_type: "auto", trigger_type: "reactions_received",  trigger_threshold: 10,   is_preset: true},
    %{name: "Regular",         description: "Logged in for 7 consecutive days.",                                      icon: "fa-calendar-check", color: "#34d399", rarity: "common",    award_type: "auto", trigger_type: "streak_days",         trigger_threshold: 7,    is_preset: true},
    %{name: "Century",         description: "Posted 100 threads.",                                                    icon: "fa-bolt",           color: "#fbbf24", rarity: "rare",      award_type: "auto", trigger_type: "post_count",          trigger_threshold: 100,  is_preset: true},
    %{name: "Popular",         description: "Received 100 reactions across your posts.",                              icon: "fa-star",           color: "#fbbf24", rarity: "rare",      award_type: "auto", trigger_type: "reactions_received",  trigger_threshold: 100,  is_preset: true},
    %{name: "Enthusiast",      description: "Given 250 reactions to other members.",                                  icon: "fa-fire",           color: "#f87171", rarity: "rare",      award_type: "auto", trigger_type: "reactions_given",     trigger_threshold: 250,  is_preset: true},
    %{name: "Veteran",         description: "Your account has been active for 1 year.",                               icon: "fa-shield-halved",  color: "#a78bfa", rarity: "rare",      award_type: "auto", trigger_type: "account_age_days",   trigger_threshold: 365,  is_preset: true},
    %{name: "On Fire",         description: "Logged in for 30 consecutive days without missing one.",                 icon: "fa-fire-flame-curved", color: "#f97316", rarity: "rare",   award_type: "auto", trigger_type: "streak_days",         trigger_threshold: 30,   is_preset: true},
    %{name: "Prolific",        description: "Posted 500 threads.",                                                    icon: "fa-pen-nib",        color: "#a78bfa", rarity: "epic",      award_type: "auto", trigger_type: "post_count",          trigger_threshold: 500,  is_preset: true},
    %{name: "Thought Leader",  description: "Received 500 reactions across your posts.",                              icon: "fa-lightbulb",      color: "#a78bfa", rarity: "epic",      award_type: "auto", trigger_type: "reactions_received",  trigger_threshold: 500,  is_preset: true},
    %{name: "Elder",           description: "Your account has been active for 3 years.",                              icon: "fa-crown",          color: "#fbbf24", rarity: "epic",      award_type: "auto", trigger_type: "account_age_days",   trigger_threshold: 1095, is_preset: true},
    %{name: "Legend",          description: "Received 1,000 reactions across your posts.",                            icon: "fa-trophy",         color: "#fbbf24", rarity: "legendary", award_type: "auto", trigger_type: "reactions_received",  trigger_threshold: 1000, is_preset: true},
    %{name: "Iron Will",       description: "Logged in for 365 consecutive days without missing one.",                icon: "fa-hourglass-half", color: "#a78bfa", rarity: "legendary", award_type: "auto", trigger_type: "streak_days",         trigger_threshold: 365,  is_preset: true},
  ]

  def presets, do: @presets

  @doc """
  Install all presets that have not already been installed (matched by name).
  Returns {:ok, count} where count is the number of newly inserted badges.
  """
  def install_presets do
    existing_names =
      from(b in Badge, where: b.is_preset == true, select: b.name)
      |> Repo.all()
      |> MapSet.new()

    to_insert = Enum.reject(@presets, fn p -> MapSet.member?(existing_names, p.name) end)

    results =
      Enum.map(to_insert, fn attrs ->
        %Badge{}
        |> Badge.changeset(attrs)
        |> Repo.insert()
      end)

    errors = Enum.filter(results, fn
      {:error, _} -> true
      _ -> false
    end)

    if Enum.empty?(errors) do
      {:ok, length(to_insert)}
    else
      {:error, errors}
    end
  end

  # ---------------------------------------------------------------------------
  # User badge queries
  # ---------------------------------------------------------------------------

  def list_user_badges(user_id) do
    from(ub in UserBadge,
      where: ub.user_id == ^user_id,
      join: b in Badge, on: ub.badge_id == b.id,
      order_by: [desc: ub.awarded_at],
      preload: [:badge, :awarded_by]
    )
    |> Repo.all()
  end

  def list_badge_holders(badge_id) do
    from(ub in UserBadge,
      where: ub.badge_id == ^badge_id,
      join: u in User, on: ub.user_id == u.id,
      order_by: [desc: ub.awarded_at],
      preload: [:user, :awarded_by]
    )
    |> Repo.all()
  end

  def holder_count(badge_id) do
    from(ub in UserBadge, where: ub.badge_id == ^badge_id, select: count(ub.user_id))
    |> Repo.one() || 0
  end

  def user_has_badge?(user_id, badge_id) do
    Repo.exists?(from ub in UserBadge, where: ub.user_id == ^user_id and ub.badge_id == ^badge_id)
  end

  # ---------------------------------------------------------------------------
  # Awarding
  # ---------------------------------------------------------------------------

  @doc """
  Award a badge to a user. Idempotent — silently succeeds if already awarded.
  `awarded_by_id` is nil for automatic awards, or an admin user id for manual.
  """
  def award_badge(user_id, badge_id, awarded_by_id \\ nil) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    result =
      %UserBadge{}
      |> UserBadge.changeset(%{
        user_id:       user_id,
        badge_id:      badge_id,
        awarded_by_id: awarded_by_id,
        awarded_at:    now
      })
      |> Repo.insert(on_conflict: :nothing, conflict_target: [:user_id, :badge_id])

    case result do
      {:ok, %UserBadge{id: nil}} ->
        # on_conflict: :nothing — already had this badge, not an error
        {:ok, :already_awarded}

      {:ok, user_badge} ->
        badge = get_badge(badge_id)
        # Route through DeliverNotification so push and email are sent
        %{attrs: %{
          type:     "badge",
          user_id:  user_id,
          actor_id: awarded_by_id,
          data:     %{badge_id: badge_id, badge_name: badge && badge.name,
                      badge_icon: badge && badge.icon, badge_color: badge && badge.color}
        }}
        |> Nexus.Workers.DeliverNotification.new()
        |> Oban.insert()
        {:ok, user_badge}

      error ->
        error
    end
  end

  @doc """
  Revoke a badge from a user.
  """
  def revoke_badge(user_id, badge_id) do
    case Repo.get_by(UserBadge, user_id: user_id, badge_id: badge_id) do
      nil        -> {:error, :not_found}
      user_badge -> Repo.delete(user_badge)
    end
  end

  # ---------------------------------------------------------------------------
  # Progress computation (on-the-fly from existing stats)
  # ---------------------------------------------------------------------------

  @doc """
  Compute the current value of a trigger type for a given user.
  Returns an integer.
  """
  def compute_stat(user_id, trigger_type) do
    case trigger_type do
      "post_count" ->
        Repo.one(
          from s in UserDailyStat,
          where: s.user_id == ^user_id,
          select: sum(s.posts_count)
        ) || 0

      "reply_count" ->
        Repo.one(
          from s in UserDailyStat,
          where: s.user_id == ^user_id,
          select: sum(s.replies_count)
        ) || 0

      "reactions_received" ->
        Repo.one(
          from s in UserDailyStat,
          where: s.user_id == ^user_id,
          select: sum(s.reactions_received)
        ) || 0

      "reactions_given" ->
        Repo.one(
          from s in UserDailyStat,
          where: s.user_id == ^user_id,
          select: sum(s.reactions_given)
        ) || 0

      "streak_days" ->
        Repo.one(from u in User, where: u.id == ^user_id, select: u.current_streak) || 0

      "account_age_days" ->
        case Repo.one(from u in User, where: u.id == ^user_id, select: u.inserted_at) do
          nil -> 0
          inserted_at ->
            DateTime.diff(DateTime.utc_now(), inserted_at, :second) |> div(86_400)
        end

      "spaces_covered" ->
        Repo.one(
          from p in Post,
          where: p.user_id == ^user_id and p.hidden == false,
          select: count(p.space_id, :distinct)
        ) || 0

      _ -> 0
    end
  end

  @doc """
  For each auto badge the user has NOT yet earned, compute their progress.
  Returns a list of maps: %{badge, current_value, pct}
  """
  def progress_for_user(user_id) do
    earned_ids =
      from(ub in UserBadge, where: ub.user_id == ^user_id, select: ub.badge_id)
      |> Repo.all()
      |> MapSet.new()

    auto_badges =
      from(b in Badge, where: b.award_type == "auto")
      |> Repo.all()

    unearned = Enum.reject(auto_badges, fn b -> MapSet.member?(earned_ids, b.id) end)

    Enum.map(unearned, fn badge ->
      current = compute_stat(user_id, badge.trigger_type)
      pct     = min(100, round(current / badge.trigger_threshold * 100))
      %{badge: badge, current_value: current, pct: pct}
    end)
  end

  # ---------------------------------------------------------------------------
  # Auto-award check for a single user
  # Called by CheckBadges worker.
  # ---------------------------------------------------------------------------

  @doc """
  Check all auto badges against a user's current stats and award
  any that are newly met. Returns a list of newly awarded badge ids.
  """
  def check_and_award(user_id) do
    earned_ids =
      from(ub in UserBadge, where: ub.user_id == ^user_id, select: ub.badge_id)
      |> Repo.all()
      |> MapSet.new()

    auto_badges =
      from(b in Badge, where: b.award_type == "auto")
      |> Repo.all()

    unearned = Enum.reject(auto_badges, fn b -> MapSet.member?(earned_ids, b.id) end)

    Enum.flat_map(unearned, fn badge ->
      current = compute_stat(user_id, badge.trigger_type)

      if current >= badge.trigger_threshold do
        case award_badge(user_id, badge.id, nil) do
          {:ok, %UserBadge{id: id}} when not is_nil(id) -> [badge.id]
          _ -> []
        end
      else
        []
      end
    end)
  end
end
