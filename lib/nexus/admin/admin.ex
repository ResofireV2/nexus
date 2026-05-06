defmodule Nexus.Admin do
  @moduledoc """
  The Admin context. Dashboard stats, user management, site settings.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Admin.SiteSetting
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
    DateTime.utc_now()
    |> DateTime.to_date()
    |> DateTime.new!(~T[00:00:00], "Etc/UTC")
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
      "who_can_upload"             => "member"
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

  def update_setting(key, value) do
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
  end
end
