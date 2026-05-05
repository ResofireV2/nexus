defmodule NexusWeb.API.V1.SearchController do
  use NexusWeb, :controller

  alias Nexus.Search

  # GET /api/v1/search?q=...&kind=posts&space=general&sort=relevance&cursor=...
  def index(conn, %{"q" => q} = params) do
    opts = [
      kind:   params["kind"] || "all",
      space:  params["space"],
      tag:    params["tag"],
      sort:   params["sort"] || "relevance",
      cursor: params["cursor"],
      user:   conn.assigns[:current_user]
    ]

    results = Search.search(q, opts)

    json(conn, %{
      query: q,
      posts:       Enum.map(results.posts,   &post_json/1),
      replies:     Enum.map(results.replies, &reply_json/1),
      next_cursor: results.next_cursor
    })
  end

  def index(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: "q parameter is required"})
  end

  defp post_json(post) do
    %{
      id: post.id,
      title: post.title,
      body: excerpt(post.body),
      type: post.type,
      reply_count: post.reply_count,
      reaction_count: post.reaction_count,
      inserted_at: post.inserted_at,
      space: space_json(post.space),
      tags: Enum.map(post.tags, &tag_json/1),
      user: user_json(post.user)
    }
  end

  defp reply_json(reply) do
    %{
      id: reply.id,
      body: excerpt(reply.body),
      post_id: reply.post_id,
      inserted_at: reply.inserted_at,
      post: post_stub_json(reply.post),
      user: user_json(reply.user)
    }
  end

  defp post_stub_json(nil), do: nil
  defp post_stub_json(post) do
    %{id: post.id, title: post.title, space: space_json(post.space)}
  end

  defp space_json(nil), do: nil
  defp space_json(s), do: %{id: s.id, name: s.name, slug: s.slug, color: s.color}

  defp tag_json(t), do: %{id: t.id, name: t.name, slug: t.slug, color: t.color}

  defp user_json(nil), do: nil
  defp user_json(u), do: %{id: u.id, username: u.username, avatar_url: u.avatar_url}

  # Return a short excerpt of long body text
  defp excerpt(nil), do: nil
  defp excerpt(body) when byte_size(body) <= 300, do: body
  defp excerpt(body), do: String.slice(body, 0, 297) <> "..."
end
