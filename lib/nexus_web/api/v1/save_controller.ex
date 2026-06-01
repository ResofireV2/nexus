defmodule NexusWeb.API.V1.SaveController do
  use NexusWeb, :controller

  alias Nexus.Forum

  # GET /api/v1/saved
  def index(conn, params) do
    user   = conn.assigns.current_user
    cursor = params["cursor"]
    %{saved: items, next_cursor: next_cursor} = Forum.list_saved(user.id, cursor: cursor)
    json(conn, %{saved: Enum.map(items, &saved_json/1), next_cursor: next_cursor})
  end

  # GET /api/v1/posts/:id/saved
  # Returns whether the current user has saved this specific post.
  # Replaces the pattern of fetching all saved items just to check one post.
  def post_saved(conn, %{"id" => id}) do
    user = conn.assigns.current_user
    saved = Forum.post_saved?(user.id, id)
    json(conn, %{saved: saved})
  end

  # GET /api/v1/posts/:id/replies/saved
  # Returns the IDs of saved replies belonging to this post for the current user.
  def saved_reply_ids(conn, %{"id" => id}) do
    user = conn.assigns.current_user
    ids  = Forum.saved_reply_ids_for_post(user.id, id)
    json(conn, %{saved_reply_ids: ids})
  end

  # POST /api/v1/posts/:id/save
  def save_post(conn, %{"id" => id}) do
    user = conn.assigns.current_user
    case Forum.get_post(id) do
      nil  -> conn |> put_status(:not_found) |> json(%{error: "Post not found"})
      _post ->
        Forum.save_post(user.id, id)
        json(conn, %{ok: true, saved: true})
    end
  end

  # DELETE /api/v1/posts/:id/save
  def unsave_post(conn, %{"id" => id}) do
    user = conn.assigns.current_user
    Forum.unsave_post(user.id, id)
    json(conn, %{ok: true, saved: false})
  end

  # POST /api/v1/posts/:post_id/replies/:id/save
  def save_reply(conn, %{"id" => id}) do
    user = conn.assigns.current_user
    Forum.save_reply(user.id, id)
    json(conn, %{ok: true, saved: true})
  end

  # DELETE /api/v1/posts/:post_id/replies/:id/save
  def unsave_reply(conn, %{"id" => id}) do
    user = conn.assigns.current_user
    Forum.unsave_reply(user.id, id)
    json(conn, %{ok: true, saved: false})
  end

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------

  defp saved_json(%{type: "post"} = item) do
    %{
      type:        "post",
      saved_at:    item.saved_at,
      post: %{
        id:             item.post_id,
        title:          item.post_title,
        body:           item.post_body,
        reply_count:    item.post_reply_count,
        reaction_count: item.post_reaction_count,
        inserted_at:    item.post_inserted_at,
        space: item.post_space_name && %{
          name:  item.post_space_name,
          slug:  item.post_space_slug,
          color: item.post_space_color
        },
        user: item.post_username && %{
          id:           item.post_user_id,
          username:     item.post_username,
          avatar_url:   item.post_avatar_url,
          avatar_color: item.post_avatar_color
        }
      }
    }
  end

  defp saved_json(%{type: "reply"} = item) do
    %{
      type:     "reply",
      saved_at: item.saved_at,
      reply: %{
        id:          item.reply_id,
        body:        item.reply_body,
        inserted_at: item.reply_inserted_at,
        post: item.reply_post_id && %{
          id:    item.reply_post_id,
          title: item.reply_post_title,
          space: item.reply_space_name && %{
            name:  item.reply_space_name,
            color: item.reply_space_color
          }
        },
        user: item.reply_username && %{
          id:           item.reply_user_id,
          username:     item.reply_username,
          avatar_url:   item.reply_avatar_url,
          avatar_color: item.reply_avatar_color
        }
      }
    }
  end
end
