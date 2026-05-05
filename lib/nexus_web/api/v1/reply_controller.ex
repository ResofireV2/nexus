defmodule NexusWeb.API.V1.ReplyController do
  use NexusWeb, :controller

  alias Nexus.Forum
  alias Nexus.Accounts.User

  # GET /api/v1/posts/:post_id/replies
  def index(conn, %{"post_id" => post_id} = params) do
    case Forum.get_post(post_id) do
      nil -> conn |> put_status(:not_found) |> json(%{error: "Post not found"})
      post ->
        %{replies: replies, next_cursor: next_cursor} =
          Forum.list_replies(post.id, cursor: params["cursor"])

        json(conn, %{
          replies: Enum.map(replies, &reply_json/1),
          next_cursor: next_cursor
        })
    end
  end

  # POST /api/v1/posts/:post_id/replies
  def create(conn, %{"post_id" => post_id} = params) do
    user = conn.assigns.current_user

    case Forum.get_post(post_id) do
      nil  -> conn |> put_status(:not_found) |> json(%{error: "Post not found"})
      %{locked: true} -> conn |> put_status(:forbidden) |> json(%{error: "Post is locked"})
      post ->
        case Forum.create_reply(post, params, user) do
          {:ok, reply} ->
            conn |> put_status(:created) |> json(%{reply: reply_json(reply)})

          {:error, changeset} ->
            conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
        end
    end
  end

  # PATCH /api/v1/posts/:post_id/replies/:id
  def update(conn, %{"id" => id} = params) do
    user = conn.assigns.current_user

    case Forum.get_reply(id) do
      nil   -> conn |> put_status(:not_found) |> json(%{error: "Reply not found"})
      reply ->
        if can_edit?(user, reply) do
          case Forum.update_reply(reply, params) do
            {:ok, updated} -> json(conn, %{reply: reply_json(updated)})
            {:error, cs}   -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
          end
        else
          conn |> put_status(:forbidden) |> json(%{error: "Not authorized"})
        end
    end
  end

  # DELETE /api/v1/posts/:post_id/replies/:id
  def delete(conn, %{"id" => id}) do
    user = conn.assigns.current_user

    case Forum.get_reply(id) do
      nil   -> conn |> put_status(:not_found) |> json(%{error: "Reply not found"})
      reply ->
        if can_edit?(user, reply) do
          {:ok, _} = Forum.delete_reply(reply)
          json(conn, %{ok: true})
        else
          conn |> put_status(:forbidden) |> json(%{error: "Not authorized"})
        end
    end
  end

  # POST /api/v1/posts/:post_id/replies/:id/hide  (moderator+)
  def hide(conn, %{"id" => id}) do
    case Forum.get_reply(id) do
      nil   -> conn |> put_status(:not_found) |> json(%{error: "Reply not found"})
      reply ->
        {:ok, _} = Forum.hide_reply(reply, conn.assigns.current_user.id)
        json(conn, %{ok: true})
    end
  end

  defp can_edit?(user, reply) do
    user.id == reply.user_id || User.moderator?(user)
  end

  defp reply_json(reply) do
    %{
      id: reply.id,
      body: reply.body,
      body_format: reply.body_format,
      post_id: reply.post_id,
      reaction_count: reply.reaction_count,
      reactions: Nexus.Forum.list_reactions(reply_id: reply.id),
      inserted_at: reply.inserted_at,
      updated_at: reply.updated_at,
      user: user_json(reply.user)
    }
  end

  defp user_json(nil), do: nil
  defp user_json(u), do: %{id: u.id, username: u.username, avatar_url: u.avatar_url}

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", to_string(v)) end)
    end)
  end
end
