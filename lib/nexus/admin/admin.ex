defmodule Nexus.Admin do
  @moduledoc """
  The Admin context. Dashboard stats, user management, site settings.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Admin.SiteSetting
  alias Nexus.Admin.SettingChangeLog
  alias Nexus.Accounts.User
  alias Nexus.Forum.{Post, Reply, Space}
  alias Nexus.Moderation.Report

  # ---------------------------------------------------------------------------
  # Dashboard stats
  # ---------------------------------------------------------------------------

  def dashboard_stats do
    %{
      users: %{
        total:     Repo.aggregate(User, :count),
        active:    Repo.aggregate(from(u in User, where: u.status == "active"), :count),
        banned:    Repo.aggregate(from(u in User, where: u.status == "banned"), :count),
        suspended: Repo.aggregate(from(u in User, where: u.status == "suspended"), :count),
        new_today: Repo.aggregate(from(u in User, where: u.inserted_at >= ^today()), :count)
      },
      content: %{
        posts:        Repo.aggregate(Post, :count),
        replies:      Repo.aggregate(Reply, :count),
        posts_today:  Repo.aggregate(from(p in Post, where: p.inserted_at >= ^today()), :count),
        hidden_posts: Repo.aggregate(from(p in Post, where: p.hidden == true), :count)
      },
      moderation: %{
        pending_reports: Repo.aggregate(from(r in Report, where: r.status == "pending"), :count)
      }
    }
  end

  defp today do
    DateTime.utc_now() |> DateTime.to_date() |> DateTime.new!(~T[00:00:00], "Etc/UTC")
  end
  defp days_ago(n) do
    DateTime.utc_now() |> DateTime.add(-n * 86400, :second) |> DateTime.truncate(:second)
  end

  def extended_stats do
    alias Nexus.Forum.{Post, Reply, Space}
    alias Nexus.Accounts.User
    alias Nexus.Moderation.Report

    # Time boundaries
    week_ago  = days_ago(7)
    month_ago = days_ago(30)

    # Posts per day last 30 days
    posts_per_day = Repo.all(
      from p in Post,
      where: p.inserted_at >= ^month_ago,
      group_by: fragment("?::date", p.inserted_at),
      select: %{date: fragment("?::date", p.inserted_at), count: count(p.id)},
      order_by: fragment("?::date", p.inserted_at)
    )

    # Replies today
    replies_today = Repo.aggregate(
      from(r in Reply, where: r.inserted_at >= ^today()), :count)

    # Replies this week
    replies_week = Repo.aggregate(
      from(r in Reply, where: r.inserted_at >= ^week_ago), :count)

    # Posts this week/month
    posts_week  = Repo.aggregate(from(p in Post, where: p.inserted_at >= ^week_ago), :count)
    posts_month = Repo.aggregate(from(p in Post, where: p.inserted_at >= ^month_ago), :count)

    # New members this week/month
    members_week  = Repo.aggregate(from(u in User, where: u.inserted_at >= ^week_ago), :count)
    members_month = Repo.aggregate(from(u in User, where: u.inserted_at >= ^month_ago), :count)

    # Active (posted at least once) vs lurkers
    active_member_ids = Repo.all(from p in Post, select: p.user_id, distinct: true)
    active_count = length(active_member_ids)
    total_members = Repo.aggregate(User, :count)
    lurker_count = max(total_members - active_count, 0)

    # Top contributors this week (by post + reply count)
    top_posters = Repo.all(
      from p in Post,
      where: p.inserted_at >= ^week_ago,
      group_by: p.user_id,
      select: %{user_id: p.user_id, count: count(p.id)},
      order_by: [desc: count(p.id)],
      limit: 5
    )
    top_poster_ids = Enum.map(top_posters, & &1.user_id)
    top_poster_users = Repo.all(from u in User, where: u.id in ^top_poster_ids, select: {u.id, u.username, u.avatar_url})
    user_map = Map.new(top_poster_users, fn {id, uname, av} -> {id, %{username: uname, avatar_url: av}} end)
    top_contributors = Enum.map(top_posters, fn p ->
      u = Map.get(user_map, p.user_id, %{username: "Unknown", avatar_url: nil})
      %{user_id: p.user_id, username: u.username, avatar_url: u.avatar_url, count: p.count}
    end)

    # Space activity (post counts per space)
    space_activity = Repo.all(
      from p in Post,
      join: s in Space, on: s.id == p.space_id,
      where: p.inserted_at >= ^month_ago,
      group_by: [s.id, s.name, s.slug],
      select: %{space_id: s.id, name: s.name, slug: s.slug, count: count(p.id)},
      order_by: [desc: count(p.id)],
      limit: 8
    )

    # Pending approvals
    pending_posts   = Repo.aggregate(from(p in Post,  where: p.pending_approval == true), :count)
    pending_replies = Repo.aggregate(from(r in Reply, where: r.pending_approval == true), :count)

    %{
      content: %{
        posts_week: posts_week, posts_month: posts_month,
        replies_today: replies_today, replies_week: replies_week,
        posts_per_day: posts_per_day
      },
      members: %{
        new_week: members_week, new_month: members_month,
        active: active_count, lurkers: lurker_count
      },
      top_contributors: top_contributors,
      space_activity: space_activity,
      pending: %{posts: pending_posts, replies: pending_replies}
    }
  end

  def queue_stats do
    # Oban queue counts by state and queue name from oban_jobs table
    rows = Repo.all(
      from j in "oban_jobs",
      group_by: [j.queue, j.state],
      select: %{queue: j.queue, state: j.state, count: count(j.id)}
    )

    queues = ~w(default mailers media webhooks)
    queue_map = Enum.reduce(rows, %{}, fn row, acc ->
      q = row.queue
      s = row.state
      acc
      |> Map.put_new(q, %{available: 0, executing: 0, retryable: 0, discarded: 0, completed: 0, scheduled: 0})
      |> put_in([q, s], row.count)
    end)

    # Ensure all known queues appear even if empty
    result = Enum.reduce(queues, queue_map, fn q, acc ->
      Map.put_new(acc, q, %{available: 0, executing: 0, retryable: 0, discarded: 0, completed: 0, scheduled: 0})
    end)

    %{queues: result}
  end

  def system_stats do
    mem = :erlang.memory()
    %{
      memory: %{
        total:   mem[:total],
        processes: mem[:processes],
        binary:  mem[:binary],
        ets:     mem[:ets]
      },
      process_count: :erlang.system_info(:process_count),
      process_limit: :erlang.system_info(:process_limit),
      uptime_seconds: :erlang.statistics(:wall_clock) |> elem(0) |> div(1000),
      otp_release: to_string(:erlang.system_info(:otp_release)),
      schedulers: :erlang.system_info(:schedulers_online)
    }
  end

  # ---------------------------------------------------------------------------
  # User management
  # ---------------------------------------------------------------------------

  def list_users(opts \\ []) do
    search = Keyword.get(opts, :search)
    role   = Keyword.get(opts, :role)
    status = Keyword.get(opts, :status)
    page   = Keyword.get(opts, :page, 1)
    limit  = 50

    query = from u in User, order_by: [desc: u.inserted_at]

    query =
      if search do
        where(query, [u], ilike(u.username, ^"%#{search}%") or ilike(u.email, ^"%#{search}%"))
      else
        query
      end

    query = if role,   do: where(query, [u], u.role == ^role),   else: query
    query = if status, do: where(query, [u], u.status == ^status), else: query

    total  = Repo.aggregate(query, :count)
    offset = (page - 1) * limit
    users  = Repo.all(from q in query, limit: ^limit, offset: ^offset)

    %{users: users, total: total, page: page, pages: ceil(total / limit)}
  end

  def get_user_detail(user_id) do
    user = Nexus.Accounts.get_user(user_id)

    if user do
      post_count  = Repo.aggregate(from(p in Post, where: p.user_id == ^user_id), :count)
      reply_count = Repo.aggregate(from(r in Reply, where: r.user_id == ^user_id), :count)
      mod_logs    = Nexus.Moderation.list_logs(target_user_id: user_id, limit: 10)

      %{user: user, post_count: post_count, reply_count: reply_count, mod_logs: mod_logs}
    else
      nil
    end
  end

  # ---------------------------------------------------------------------------
  # Site settings
  # ---------------------------------------------------------------------------

  @defaults %{
    "general" => %{
      "site_name"        => "Nexus",
      "site_description" => "Ultra fast · Ultra lightweight · Ultra modern",
      "logo_url"         => nil,
      "favicon_url"      => nil
    },
    "registration" => %{
      "open"                       => true,
      "require_email_verification" => false,
      "allowed_email_domains"      => [],
      "min_account_age_hours"      => 0
    },
    "posting" => %{
      "allow_anonymous"            => false,
      "max_post_length"            => 100_000,
      "max_reply_length"           => 50_000,
      "instant_post"               => true,
      "guest_browsing"             => true,
      "max_posts_per_hour"         => 0,
      "who_can_create_spaces"      => "admin",
      "who_can_upload"             => "member",
      "media_public"               => false
    },
    "appearance" => %{
      "accent_color"      => "#a78bfa",
      "dark_mode_default" => true,
      "avatar_radius"     => 22
    },
    "uploads" => %{
      "max_size_mb"      => 5,
      "convert_to_webp"  => true,
      "webp_quality"     => 85,
      "max_width"        => 1200,
      "allowed_types"    => ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"]
    },
    "email" => %{
      "from_address"     => "",
      "from_name"        => "Nexus",
      "smtp_host"        => "",
      "smtp_port"        => "587",
      "smtp_username"    => "",
      "smtp_password"    => "",
      "smtp_encryption"  => "tls",
      "provider"         => "smtp"
    },
    "leaderboard" => %{
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
    },
    "digest" => %{
      "enabled"                  => false,
      "frequencies"              => ["weekly"],
      "top_posts_count"          => 5,
      "include_leaderboard"      => true,
      "include_badges"           => true,
      "include_new_members"      => true,
      "include_trending_spaces"  => true,
      "section_order"            => ["posts","leaderboard","badges","members","spaces"],
      "timezone"                 => "UTC",
      "send_time"                => "08:00",
      "weekly_day"               => "monday",
      "monthly_day"              => 1
    },
    "pwa" => %{
      "app_name"         => nil,
      "short_name"       => nil,
      "theme_color"      => nil,
      "bg_color"         => nil,
      "start_url"        => "/",
      "force_portrait"   => false,
      "vapid_public"     => nil,
      "vapid_private"    => nil,
      "badge_url"        => nil,
      "icon_48_path"     => nil,
      "icon_96_path"     => nil,
      "icon_144_path"    => nil,
      "icon_180_path"    => nil,
      "icon_192_path"    => nil,
      "icon_384_path"    => nil,
      "icon_512_path"    => nil,
      "status_bar_style"          => "black-translucent",
      "ios_prompt_enabled"        => false,
      "ios_prompt_text"           => nil,
      "ios_prompt_delay"          => 10000,
      "ios_auto_detect_orientation" => true,
      "ios_pad_always_up"         => true
    }
  }

  def get_settings do
    existing =
      SiteSetting
      |> Repo.all()
      |> Map.new(fn s -> {s.key, s.value} end)

    Map.merge(@defaults, existing)
  end

  def get_setting(key) do
    case Repo.get(SiteSetting, key) do
      nil     -> Map.get(@defaults, key, %{})
      setting -> setting.value
    end
  end

  def update_setting(key, value, admin_id \\ nil) do
    old_value =
      case Repo.get(SiteSetting, key) do
        nil     -> %{}
        setting -> setting.value
      end

    result =
      case Repo.get(SiteSetting, key) do
        nil ->
          %SiteSetting{}
          |> SiteSetting.changeset(%{key: key, value: value})
          |> Repo.insert()

        setting ->
          setting
          |> SiteSetting.changeset(%{value: Map.merge(setting.value, value)})
          |> Repo.update()
      end

    # Record the change if an admin_id is supplied
    if admin_id && match?({:ok, _}, result) do
      %SettingChangeLog{}
      |> SettingChangeLog.changeset(%{
        section:    key,
        old_value:  old_value,
        new_value:  value,
        admin_id:   admin_id,
        inserted_at: DateTime.utc_now() |> DateTime.truncate(:second)
      })
      |> Repo.insert()
    end

    result
  end

  def list_setting_changes(limit \\ 100) do
    import Ecto.Query
    Repo.all(
      from l in SettingChangeLog,
      left_join: u in Nexus.Accounts.User, on: l.admin_id == u.id,
      order_by: [desc: l.inserted_at],
      limit: ^limit,
      select: %{
        id:          l.id,
        section:     l.section,
        old_value:   l.old_value,
        new_value:   l.new_value,
        inserted_at: l.inserted_at,
        admin: u.username
      }
    )
  end

  def list_job_failures(limit \\ 100) do
    import Ecto.Query
    Repo.all(
      from j in "oban_jobs",
      where: j.state in ["discarded", "retryable"],
      order_by: [desc: j.attempted_at],
      limit: ^limit,
      select: %{
        id:           j.id,
        queue:        j.queue,
        worker:       j.worker,
        state:        j.state,
        args:         j.args,
        errors:       j.errors,
        attempt:      j.attempt,
        max_attempts: j.max_attempts,
        attempted_at: j.attempted_at,
        inserted_at:  j.inserted_at
      }
    )
  end
end
