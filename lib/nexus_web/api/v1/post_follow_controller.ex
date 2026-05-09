defmodule NexusWeb.API.V1.PostFollowController do
  use NexusWeb, :controller
  alias Nexus.Forum

  # GET /api/v1/posts/:id/follow
  def show(conn, %{"id" => post_id}) do
    user_id = conn.assigns.current_user.id
    followed = Forum.following_post?(user_id, String.to_integer(post_id))
    json(conn, %{followed: followed})
  end

  # POST /api/v1/posts/:id/follow
  def create(conn, %{"id" => post_id}) do
    user_id = conn.assigns.current_user.id
    Forum.follow_post(user_id, String.to_integer(post_id))
    json(conn, %{ok: true, followed: true})
  end

  # DELETE /api/v1/posts/:id/follow
  def delete(conn, %{"id" => post_id}) do
    user_id = conn.assigns.current_user.id
    Forum.unfollow_post(user_id, String.to_integer(post_id))
    json(conn, %{ok: true, followed: false})
  end
end
