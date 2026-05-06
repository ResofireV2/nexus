defmodule NexusWeb.API.V1.AdminController do
  use NexusWeb, :controller

  alias Nexus.{Admin, Accounts}

  # GET /api/v1/admin/dashboard
  def dashboard(conn, _params) do
    json(conn, %{stats: Admin.dashboard_stats()})
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

  # ---------------------------------------------------------------------------
  # Site settings
  # ---------------------------------------------------------------------------

  # GET /api/v1/admin/settings
  def get_settings(conn, _params) do
    json(conn, %{settings: Admin.get_settings()})
  end

  # PATCH /api/v1/admin/settings/:key
  def update_settings(conn, %{"key" => key, "value" => value}) do
    case Admin.update_setting(key, value) do
      {:ok, _}   -> json(conn, %{ok: true, settings: Admin.get_settings()})
      {:error, cs} -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
    end
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
    q = params["q"]
    users = if q && String.length(q) > 0 do
      Accounts.search_users(q)
    else
      Accounts.list_users_public()
    end
    json(conn, %{members: Enum.map(users, fn u -> %{
      id: u.id,
      username: u.username,
      role: u.role,
      avatar_url: u.avatar_url,
      inserted_at: u.inserted_at,
      status: u.status
    } end)})
  end

  # GET /api/v1/users/:username  (public — no admin auth required)
  def get_user_public(conn, %{"username" => username}) do
    case Accounts.get_user_by_username(username) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "User not found"})

      user ->
        json(conn, %{
          user: %{
            id: user.id,
            username: user.username,
            role: user.role,
            bio: user.bio,
            avatar_url: user.avatar_url,
            cover_url: user.cover_url,
            inserted_at: user.inserted_at
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
