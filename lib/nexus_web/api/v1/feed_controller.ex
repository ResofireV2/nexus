defmodule NexusWeb.API.V1.FeedController do
  use NexusWeb, :controller

  alias Nexus.Forum

  # GET /api/v1/feed
  # Query params: sort (latest|top|activity), space, tag, cursor
  def index(conn, params) do
    if !conn.assigns[:current_user] && !Nexus.Permissions.guest_browsing?() do
      conn |> put_status(:unauthorized) |> json(%{error: "Please log in to view this forum"}) |> halt()
    else
    opts = [
      user: conn.assigns[:current_user],
      space: params["space"],
      tag: params["tag"],
      sort: params["sort"] || "latest",
      cursor: params["cursor"],
      following: params["following"] == "true",
      username: params["user"]
    ]

    %{posts: posts, next_cursor: next_cursor} = Forum.list_feed(opts)

    # Fetch last replier for all posts in one extra query — wrapped defensively
    # so a missing function or DB error never breaks the feed.
    post_ids = Enum.map(posts, & &1.id)
    last_reply_map =
      try do
        Forum.last_reply_users(post_ids)
      rescue
        _ -> %{}
      end

    json(conn, %{
      posts: Enum.map(posts, &post_json(&1, last_reply_map)),
      next_cursor: next_cursor
    })
    end
  end

  # GET /api/v1/stats — public community stats for the right panel
  def stats(conn, _params) do
    alias Nexus.Repo
    alias Nexus.Accounts.User
    alias Nexus.Forum.Post

    import Ecto.Query

    total_members = Repo.aggregate(User, :count, :id)
    total_posts   = Repo.aggregate(from(p in Post, where: not p.hidden), :count, :id)

    json(conn, %{
      members: total_members,
      threads: total_posts
    })
  end


  defp post_json(post, last_reply_map \\ %{}) do
    %{
      id: post.id,
      title: post.title,
      body: post.body,
      type: post.type,
      pinned: post.pinned,
      locked: post.locked,
      reply_count: post.reply_count,
      reaction_count: post.reaction_count,
      last_reply_at: post.last_reply_at,
      inserted_at: post.inserted_at,
      space: space_json(post.space),
      tags: Enum.map(post.tags, &tag_json/1),
      user: user_json(post.user),
      last_reply_user: user_json(Map.get(last_reply_map, post.id))
    }
  end

  defp space_json(nil), do: nil
  defp space_json(space) do
    %{id: space.id, name: space.name, slug: space.slug, color: space.color}
  end

  defp tag_json(tag) do
    %{id: tag.id, name: tag.name, slug: tag.slug, color: tag.color}
  end

  defp user_json(nil), do: nil
  defp user_json(user) do
    %{id: user.id, username: user.username, avatar_url: user.avatar_url, avatar_color: user.avatar_color}
  end
end
