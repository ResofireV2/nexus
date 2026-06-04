defmodule NexusWeb.API.V1.ModerationController do
  use NexusWeb, :controller

  alias Nexus.Accounts
  alias Nexus.Forum
  alias Nexus.Moderation

  # ---------------------------------------------------------------------------
  # User actions
  # ---------------------------------------------------------------------------

  # POST /api/v1/moderation/users/:username/ban
  def ban(conn, %{"username" => username} = params) do
    with_target_user(conn, username, fn moderator, user ->
      case Moderation.ban_user(moderator, user, params["reason"]) do
        {:ok, _} -> json(conn, %{ok: true})
        {:error, cs} -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
      end
    end)
  end

  # DELETE /api/v1/moderation/users/:username/ban
  def unban(conn, %{"username" => username}) do
    with_target_user(conn, username, fn moderator, user ->
      case Moderation.unban_user(moderator, user) do
        {:ok, _} -> json(conn, %{ok: true})
        {:error, cs} -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
      end
    end)
  end

  # POST /api/v1/moderation/users/:username/suspend
  def suspend(conn, %{"username" => username} = params) do
    with_target_user(conn, username, fn moderator, user ->
      opts = [duration: params["duration"], reason: params["reason"]]
      case Moderation.suspend_user(moderator, user, opts) do
        {:ok, _} -> json(conn, %{ok: true})
        {:error, cs} -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
      end
    end)
  end

  # DELETE /api/v1/moderation/users/:username/suspend
  def unsuspend(conn, %{"username" => username}) do
    with_target_user(conn, username, fn moderator, user ->
      case Moderation.unsuspend_user(moderator, user) do
        {:ok, _} -> json(conn, %{ok: true})
        {:error, cs} -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
      end
    end)
  end

  # ---------------------------------------------------------------------------
  # Moderation log
  # ---------------------------------------------------------------------------

  # GET /api/v1/moderation/log
  def log(conn, params) do
    opts = []
    opts = if params["user"], do: [{:target_user_id, params["user"]} | opts], else: opts
    logs = Moderation.list_logs(opts)
    json(conn, %{logs: Enum.map(logs, &log_json/1)})
  end

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------

  defp with_target_user(conn, username, fun) do
    moderator = conn.assigns.current_user

    case Accounts.get_user_by_username(username) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "User not found"})

      target ->
        if target.id == moderator.id do
          conn |> put_status(:forbidden) |> json(%{error: "Cannot moderate yourself"})
        else
          fun.(moderator, target)
        end
    end
  end

  defp log_json(log) do
    %{
      id: log.id,
      action: log.action,
      reason: log.reason,
      duration: log.duration,
      moderator: user_json(log.moderator),
      target_user: user_json(log.target_user),
      inserted_at: log.inserted_at
    }
  end

  defp user_json(nil), do: nil
  defp user_json(u), do: %{id: u.id, username: u.username}

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", if(is_binary(v), do: v, else: inspect(v))) end)
    end)
  end

  # GET /api/v1/moderation/hidden
  def hidden(conn, params) do
    type = params["type"] || "all"
    items = Nexus.Moderation.list_hidden_posts(type: type)
    json(conn, %{items: items})
  end

end