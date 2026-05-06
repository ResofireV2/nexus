defmodule NexusWeb.API.V1.ThreadController do
  use NexusWeb, :controller

  alias Nexus.{Messaging, Accounts}

  # GET /api/v1/threads
  def index(conn, _params) do
    user_id = conn.assigns.current_user.id
    threads = Messaging.list_threads(user_id)
    json(conn, %{threads: Enum.map(threads, &thread_json(&1, user_id))})
  end

  # POST /api/v1/threads/direct
  def create_direct(conn, %{"username" => username}) do
    me = conn.assigns.current_user

    case Accounts.get_user_by_username(username) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "User not found"})

      target ->
        if target.id == me.id do
          conn |> put_status(:bad_request) |> json(%{error: "Cannot DM yourself"})
        else
          case Messaging.create_direct_thread(me.id, target.id) do
            {:ok, thread} ->
              conn |> put_status(:created) |> json(%{thread: thread_json(thread)})

            {:error, reason} ->
              conn |> put_status(:unprocessable_entity) |> json(%{error: inspect(reason)})
          end
        end
    end
  end

  # POST /api/v1/threads/group
  def create_group(conn, %{"name" => name} = params) do
    me = conn.assigns.current_user
    usernames = Map.get(params, "members", [])

    member_ids =
      usernames
      |> Enum.map(&Accounts.get_user_by_username/1)
      |> Enum.reject(&is_nil/1)
      |> Enum.map(& &1.id)

    case Messaging.create_group_thread(me.id, %{"name" => name, "emoji" => params["emoji"], "image_url" => params["image_url"]}, member_ids) do
      {:ok, thread} ->
        conn |> put_status(:created) |> json(%{thread: thread_json(thread)})

      {:error, reason} ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: inspect(reason)})
    end
  end

  # POST /api/v1/threads/:id/mute
  def mute(conn, %{"id" => id}) do
    user_id = conn.assigns.current_user.id

    case Messaging.get_thread_for_user(id, user_id) do
      {:error, :not_found} ->
        conn |> put_status(:not_found) |> json(%{error: "Thread not found"})

      {:ok, thread} ->
        member = Enum.find(thread.members, &(&1.user_id == user_id))
        Messaging.mute_thread(thread.id, user_id, !member.muted)
        json(conn, %{ok: true})
    end
  end

  # POST /api/v1/threads/:id/read
  def mark_read(conn, %{"id" => id}) do
    user_id = conn.assigns.current_user.id

    case Messaging.get_thread_for_user(id, user_id) do
      {:error, :not_found} ->
        conn |> put_status(:not_found) |> json(%{error: "Thread not found"})

      {:ok, _thread} ->
        Messaging.mark_read(id, user_id)
        json(conn, %{ok: true})
    end
  end

  # GET /api/v1/threads/unread
  def unread(conn, _params) do
    count = Messaging.unread_count(conn.assigns.current_user.id)
    json(conn, %{unread: count})
  end

  defp thread_json(thread, user_id \\ nil) do
    member = user_id && Enum.find(thread.members, &(&1.user_id == user_id))
    last_read = member && member.last_read_at
    unread_count = if last_read && thread.last_message_at do
      if DateTime.compare(thread.last_message_at, last_read) == :gt, do: 1, else: 0
    else
      if thread.last_message_at && is_nil(last_read), do: 1, else: 0
    end
    %{
      id: thread.id,
      kind: thread.kind,
      name: thread.name,
      emoji: thread.emoji,
      image_url: thread.image_url,
      last_message_at: thread.last_message_at,
      unread_count: unread_count,
      members: Enum.map(thread.members, &member_json/1)
    }
  end

  defp member_json(member) do
    %{
      user_id: member.user_id,
      muted: member.muted,
      last_read_at: member.last_read_at,
      user: user_json(member.user)
    }
  end

  defp user_json(nil), do: nil
  defp user_json(u), do: %{id: u.id, username: u.username, avatar_url: u.avatar_url}
end
