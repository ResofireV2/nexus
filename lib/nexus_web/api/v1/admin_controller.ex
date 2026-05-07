defmodule NexusWeb.API.V1.AdminController do
  use NexusWeb, :controller

  alias Nexus.{Admin, Accounts}

  # GET /api/v1/admin/dashboard
  def dashboard(conn, _params) do
    stats    = Admin.dashboard_stats()
    extended = Admin.extended_stats()
    dau_7    = Nexus.Activity.daily_active_users(7)
    dau_30   = Nexus.Activity.daily_active_users(30)
    json(conn, %{stats: Map.merge(stats, %{dau_7: dau_7, dau_30: dau_30, extended: extended})})
  end

  def queues(conn, _params) do
    json(conn, Admin.queue_stats())
  end

  def system(conn, _params) do
    json(conn, %{system: Admin.system_stats()})
  end

  # GET /api/v1/admin/threads/:id — show single thread for DM page
  def show_thread(conn, %{"id" => id}) do
    user_id = conn.assigns.current_user.id
    case Nexus.Messaging.get_thread_for_user(id, user_id) do
      {:ok, thread} ->
        member = Enum.find(thread.members, &(&1.user_id == user_id))
        last_read = member && member.last_read_at
        unread_count = if last_read && thread.last_message_at do
          if DateTime.compare(thread.last_message_at, last_read) == :gt, do: 1, else: 0
        else
          if thread.last_message_at && is_nil(last_read), do: 1, else: 0
        end
        t = thread
        json(conn, %{thread: %{
          id: t.id, kind: t.kind, name: t.name, emoji: t.emoji,
          image_url: Map.get(t, :image_url), creator_id: Map.get(t, :creator_id),
          last_message_at: t.last_message_at, unread_count: unread_count,
          members: Enum.map(t.members, fn m ->
            u = m.user
            %{user_id: m.user_id, muted: m.muted, last_read_at: m.last_read_at,
              user: u && %{id: u.id, username: u.username, avatar_url: u.avatar_url}}
          end)
        }})
      {:error, :not_found} ->
        conn |> put_status(:not_found) |> json(%{error: "Thread not found"})
    end
  end

  # ---------------------------------------------------------------------------
  # Users
  # ---------------------------------------------------------------------------

  # GET /api/v1/admin/users
  def list_users(conn, params) do
    opts = [
      search: params["search"],
      role:   params["role"],
      status: params["status"],
      page:   String.to_integer(params["page"] || "1")
    ]

    %{users: users, total: total, page: page, pages: pages} = Admin.list_users(opts)

    json(conn, %{
      users: Enum.map(users, &user_json/1),
      total: total,
      page:  page,
      pages: pages
    })
  end

  # GET /api/v1/admin/users/:id
  def get_user(conn, %{"id" => id}) do
    case Admin.get_user_detail(id) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "User not found"})

      %{user: user, post_count: pc, reply_count: rc, mod_logs: logs} ->
        json(conn, %{
          user: user_json(user),
          post_count: pc,
          reply_count: rc,
          mod_logs: Enum.map(logs, &log_json/1)
        })
    end
  end

  # PATCH /api/v1/admin/users/:id/role
  def update_role(conn, %{"id" => id, "role" => role}) do
    case Accounts.get_user(id) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "User not found"})

      user ->
        case Accounts.update_role(user, role) do
          {:ok, updated} -> json(conn, %{user: user_json(updated)})
          {:error, cs}   -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
        end
    end
  end

  # DELETE /api/v1/admin/users/:id
  def delete_user(conn, %{"id" => id}) do
    me = conn.assigns.current_user

    if to_string(me.id) == to_string(id) do
      conn |> put_status(:forbidden) |> json(%{error: "Cannot delete your own account"})
    else
      case Accounts.get_user(id) do
        nil  -> conn |> put_status(:not_found) |> json(%{error: "User not found"})
        user ->
          Nexus.Repo.delete(user)
          json(conn, %{ok: true})
      end
    end
  end

  # PATCH /api/v1/admin/users/:id/verify-email
  def verify_email(conn, %{"id" => id}) do
    case Nexus.Accounts.admin_verify_email(String.to_integer("#{id}")) do
      {:ok, _}          -> json(conn, %{ok: true})
      {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "User not found"})
      {:error, cs}      -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
    end
  end

  # POST /api/v1/admin/users  — admin creates a user
  def create_user(conn, params) do
    attrs = Map.take(params, ["username", "email", "password", "role", "skip_verification"])
    case Nexus.Accounts.admin_create_user(attrs) do
      {:ok, user}  -> json(conn, %{user: user_json(user)})
      {:error, cs} -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
    end
  end

  # ---------------------------------------------------------------------------
  # Site settings
  # ---------------------------------------------------------------------------

  # GET /api/v1/admin/settings
  def get_settings(conn, _params) do
    json(conn, %{settings: Admin.get_settings()})
  end

  # GET /api/v1/branding — public, returns only safe display settings
  def get_branding(conn, _params) do
    s = Admin.get_settings()
    json(conn, %{
      settings: %{
        general:      Map.take(s["general"]||%{}, ["site_name","site_description","logo_url","favicon_url","hero_enabled","hero_title","hero_body"]),
        appearance:   Map.take(s["appearance"]||%{}, ["accent_color","avatar_radius","custom_css"]),
        registration: Map.take(s["registration"]||%{}, ["open", "require_email_verification"]),
        layout:       s["layout"] || %{},
        digest:       Map.take(s["digest"]||%{}, ["enabled","frequencies"])
      }
    })
  end

  # PATCH /api/v1/admin/settings/:key
  def update_settings(conn, %{"key" => key, "value" => value}) do
    admin_id = conn.assigns.current_user.id
    case Admin.update_setting(key, value, admin_id) do
      {:ok, _}   -> json(conn, %{ok: true, settings: Admin.get_settings()})
      {:error, cs} -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
    end
  end

  # GET /api/v1/admin/logs/settings
  def setting_changes(conn, _params) do
    logs = Admin.list_setting_changes(200)
    json(conn, %{logs: Enum.map(logs, fn l ->
      %{
        id:          l.id,
        section:     l.section,
        old_value:   l.old_value,
        new_value:   l.new_value,
        inserted_at: l.inserted_at,
        admin:       l.admin
      }
    end)})
  end

  # GET /api/v1/admin/logs/jobs
  def job_failures(conn, _params) do
    jobs = Admin.list_job_failures(200)
    json(conn, %{jobs: Enum.map(jobs, fn j ->
      last_error =
        case j.errors do
          [_ | _] = errs ->
            err = List.last(errs)
            %{message: err["error"] || err["message"] || "Unknown error",
              at:      err["attempt_at"] || err["at"]}
          _ -> nil
        end
      %{
        id:           j.id,
        queue:        j.queue,
        worker:       j.worker |> String.replace("Elixir.", ""),
        state:        j.state,
        attempt:      j.attempt,
        max_attempts: j.max_attempts,
        last_error:   last_error,
        attempted_at: j.attempted_at,
        inserted_at:  j.inserted_at
      }
    end)})
  end

  # GET /api/v1/admin/pending — list posts and replies pending approval
  def pending(conn, _params) do
    import Ecto.Query
    alias Nexus.Repo
    alias Nexus.Forum.{Post, Reply}

    posts = Repo.all(
      from p in Post,
      where: p.pending_approval == true,
      left_join: u in assoc(p, :user),
      preload: [user: u, space: :space_subscriptions],
      order_by: [asc: p.inserted_at]
    ) |> Enum.map(fn p ->
      %{id: p.id, type: "post", title: p.title, body: p.body,
        user: p.user && %{id: p.user.id, username: p.user.username},
        inserted_at: p.inserted_at}
    end)

    replies = Repo.all(
      from r in Reply,
      where: r.pending_approval == true,
      left_join: u in assoc(r, :user),
      preload: [user: u],
      order_by: [asc: r.inserted_at]
    ) |> Enum.map(fn r ->
      %{id: r.id, type: "reply", body: r.body, post_id: r.post_id,
        user: r.user && %{id: r.user.id, username: r.user.username},
        inserted_at: r.inserted_at}
    end)

    json(conn, %{pending: posts ++ replies |> Enum.sort_by(& &1.inserted_at)})
  end

  # POST /api/v1/admin/pending/:type/:id/approve
  def approve_pending(conn, %{"type" => type, "id" => id}) do
    import Ecto.Query
    alias Nexus.Repo

    case type do
      "post" ->
        post = Repo.get(Nexus.Forum.Post, id)
        if post do
          {:ok, updated} = post |> Ecto.Changeset.change(pending_approval: false) |> Repo.update()
          NexusWeb.FeedChannel.broadcast_new_post(updated)
          json(conn, %{ok: true})
        else
          conn |> put_status(:not_found) |> json(%{error: "Not found"})
        end
      "reply" ->
        reply = Repo.get(Nexus.Forum.Reply, id)
        if reply do
          {:ok, _} = reply |> Ecto.Changeset.change(pending_approval: false) |> Repo.update()
          json(conn, %{ok: true})
        else
          conn |> put_status(:not_found) |> json(%{error: "Not found"})
        end
      _ -> conn |> put_status(:bad_request) |> json(%{error: "Invalid type"})
    end
  end

  # DELETE /api/v1/admin/pending/:type/:id
  def reject_pending(conn, %{"type" => type, "id" => id}) do
    alias Nexus.Repo
    case type do
      "post"  ->
        post = Repo.get(Nexus.Forum.Post, id)
        if post, do: Repo.delete(post)
      "reply" ->
        reply = Repo.get(Nexus.Forum.Reply, id)
        if reply, do: Repo.delete(reply)
      _ -> nil
    end
    json(conn, %{ok: true})
  end

  # POST /api/v1/admin/test-email
  def test_email(conn, _params) do
    user = conn.assigns.current_user
    case Nexus.Mailer.send_notification_email(user, %{type: "test", actor: "Nexus Admin"}) do
      {:ok, _}        -> json(conn, %{ok: true})
      {:error, reason} -> conn |> put_status(:unprocessable_entity) |> json(%{error: inspect(reason)})
    end
  end

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------

  # GET /api/v1/users  (public — no admin auth required)
  def list_users_public(conn, params) do
    q    = params["q"]
    sort = params["sort"] || "newest"
    users = if q && String.length(q) > 0 do
      Accounts.search_users(q, sort)
    else
      Accounts.list_users_public(sort)
    end
    json(conn, %{members: Enum.map(users, fn u -> %{
      id:                 u.id,
      username:           u.username,
      role:               u.role,
      bio:                Map.get(u, :bio),
      avatar_url:         u.avatar_url,
      inserted_at:        u.inserted_at,
      status:             u.status,
      post_count:         Map.get(u, :post_count, 0),
      reply_count:        Map.get(u, :reply_count, 0),
      reactions_received: Map.get(u, :reactions_received, 0)
    } end)})
  end

  # GET /api/v1/users/:username  (public — no admin auth required)
  def get_user_public(conn, %{"username" => username}) do
    case Accounts.get_user_by_username(username) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "User not found"})

      user ->
        # Fetch post/reply counts and reactions received
        import Ecto.Query
        alias Nexus.Repo

        post_count = Repo.one(from p in Nexus.Forum.Post,
          where: p.user_id == ^user.id and p.hidden == false and p.pending_approval == false,
          select: count(p.id)) || 0

        reply_count = Repo.one(from r in Nexus.Forum.Reply,
          where: r.user_id == ^user.id and r.hidden == false,
          select: count(r.id)) || 0

        reactions_received = Repo.one(from s in Nexus.Activity.UserDailyStat,
          where: s.user_id == ^user.id,
          select: sum(s.reactions_received)) || 0

        reactions_given = Repo.one(from s in Nexus.Activity.UserDailyStat,
          where: s.user_id == ^user.id,
          select: sum(s.reactions_given)) || 0

        json(conn, %{
          user: %{
            id: user.id,
            username: user.username,
            role: user.role,
            bio: user.bio,
            avatar_url: user.avatar_url,
            cover_url: user.cover_url,
            last_seen_at: user.last_seen_at,
            inserted_at: user.inserted_at,
            post_count: post_count,
            reply_count: reply_count,
            reactions_received: reactions_received,
            reactions_given: reactions_given
          }
        })
    end
  end


  defp user_json(u) do
    %{
      id: u.id,
      username: u.username,
      email: u.email,
      role: u.role,
      status: u.status,
      status_reason: u.status_reason,
      status_until: u.status_until,
      email_verified: u.email_verified,
      avatar_url: u.avatar_url,
      inserted_at: u.inserted_at
    }
  end

  defp log_json(log) do
    %{
      id: log.id,
      action: log.action,
      reason: log.reason,
      moderator: log.moderator && %{id: log.moderator.id, username: log.moderator.username},
      inserted_at: log.inserted_at
    }
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", to_string(v)) end)
    end)
  end
end
