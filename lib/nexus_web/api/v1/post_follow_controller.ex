defmodule NexusWeb.API.V1.PostFollowController do
  use NexusWeb, :controller
  alias Nexus.Forum

  # GET /api/v1/posts/:id/follow
  def show(conn, %{"id" => post_id}) do
    user_id = conn.assigns.current_user.id
    case Integer.parse(post_id) do
      {id, ""} ->
        followed = Forum.following_post?(user_id, id)
        json(conn, %{followed: followed})
      _ -> conn |> put_status(:bad_request) |> json(%{error: "Invalid id"})
    end
  end

  # POST /api/v1/posts/:id/follow
  def create(conn, %{"id" => post_id}) do
    user_id = conn.assigns.current_user.id
    case Integer.parse(post_id) do
      {id, ""} ->
        Forum.follow_post(user_id, id)
        json(conn, %{ok: true, followed: true})
      _ -> conn |> put_status(:bad_request) |> json(%{error: "Invalid id"})
    end
  end

  # DELETE /api/v1/posts/:id/follow
  def delete(conn, %{"id" => post_id}) do
    user_id = conn.assigns.current_user.id
    case Integer.parse(post_id) do
      {id, ""} ->
        Forum.unfollow_post(user_id, id)
        json(conn, %{ok: true, followed: false})
      _ -> conn |> put_status(:bad_request) |> json(%{error: "Invalid id"})
    end
  end
end
