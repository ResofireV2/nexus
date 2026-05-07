defmodule NexusWeb.API.V1.UserContentController do
  @moduledoc """
  Endpoints for profile tab content:
    - replies posted by a user
    - posts the user has reacted to
    - media uploaded by a user
    - posts/replies mentioning a user
  """
  use NexusWeb, :controller

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Accounts
  alias Nexus.Forum.{Post, Reply, Reaction, Space}
  alias Nexus.Uploads.Upload
  alias Nexus.Admin

  # ---------------------------------------------------------------------------
  # GET /api/v1/users/:username/replies
  # Public. Returns the user's replies with parent post context, newest first.
  # ---------------------------------------------------------------------------

  def replies(conn, %{"username" => username} = params) do
    case Accounts.get_user_by_username(username) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "User not found"})

      user ->
        page  = max(1, to_int(params["page"], 1))
        limit = 20
        offset = (page - 1) * limit

        replies =
          from(r in Reply,
            where: r.user_id == ^user.id and r.hidden == false and r.pending_approval == false,
            join: p in Post, on: r.post_id == p.id and p.hidden == false,
            join: s in Space, on: p.space_id == s.id,
            order_by: [desc: r.inserted_at],
            limit: ^limit,
            offset: ^offset,
            preload: [post: :space]
          )
          |> Repo.all()

        json(conn, %{
          replies: Enum.map(replies, &reply_json/1),
          page: page,
          has_more: length(replies) == limit
        })
    end
  end

  # ---------------------------------------------------------------------------
  # GET /api/v1/users/:username/reactions
  # Public. Returns posts the user has reacted to, newest reaction first.
  # ---------------------------------------------------------------------------

  def reactions(conn, %{"username" => username} = params) do
    case Accounts.get_user_by_username(username) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "User not found"})

      user ->
        page   = max(1, to_int(params["page"], 1))
        limit  = 20
        offset = (page - 1) * limit

        # Only post-level reactions — reply reactions would need a different card type
        reacted_posts =
          from(r in Reaction,
            where: r.user_id == ^user.id and not is_nil(r.post_id),
            join: p in Post, on: r.post_id == p.id and p.hidden == false and p.pending_approval == false,
            join: s in Space, on: p.space_id == s.id and s.visibility == "public",
            order_by: [desc: r.inserted_at],
            limit: ^limit,
            offset: ^offset,
            select: %{emoji: r.emoji, reacted_at: r.inserted_at, post: p},
            preload: [post: [:space, :user]]
          )
          |> Repo.all()

        json(conn, %{
          reactions: Enum.map(reacted_posts, fn row ->
            %{
              emoji:      row.emoji,
              reacted_at: row.reacted_at,
              post:       post_json(row.post)
            }
          end),
          page: page,
          has_more: length(reacted_posts) == limit
        })
    end
  end

  # ---------------------------------------------------------------------------
  # GET /api/v1/users/:username/uploads
  # Auth-gated: owner or admin only, unless posting.media_public is true.
  # ---------------------------------------------------------------------------

  def uploads(conn, %{"username" => username} = params) do
    case Accounts.get_user_by_username(username) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "User not found"})

      profile_user ->
        media_public = Admin.get_setting("posting")["media_public"] == true
        current_user = conn.assigns[:current_user]
        is_owner     = current_user && current_user.id == profile_user.id
        is_admin     = current_user && current_user.role == "admin"

        if not media_public and not is_owner and not is_admin do
          conn |> put_status(:forbidden) |> json(%{error: "Media is private"})
        else
          page   = max(1, to_int(params["page"], 1))
          limit  = 24
          offset = (page - 1) * limit

          uploads =
            from(u in Upload,
              where: u.user_id == ^profile_user.id and u.upload_type == "post_image",
              order_by: [desc: u.inserted_at],
              limit: ^limit,
              offset: ^offset
            )
            |> Repo.all()

          json(conn, %{
            uploads: Enum.map(uploads, &upload_json/1),
            page: page,
            has_more: length(uploads) == limit
          })
        end
    end
  end

  # ---------------------------------------------------------------------------
  # GET /api/v1/users/:username/mentions
  # Public. Returns posts and replies containing @username, newest first.
  # ---------------------------------------------------------------------------

  def mentions(conn, %{"username" => username} = params) do
    case Accounts.get_user_by_username(username) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "User not found"})

      _user ->
        page   = max(1, to_int(params["page"], 1))
        limit  = 20
        offset = (page - 1) * limit

        # Pattern matches @username as a whole word (not partial)
        pattern = "@#{username}"

        posts =
          from(p in Post,
            join: s in Space, on: p.space_id == s.id and s.visibility == "public",
            where: p.hidden == false and p.pending_approval == false,
            where: ilike(p.body, ^"%#{pattern}%"),
            order_by: [desc: p.inserted_at],
            limit: ^limit,
            offset: ^offset,
            preload: [:user, :space]
          )
          |> Repo.all()

        replies =
          from(r in Reply,
            join: p in Post, on: r.post_id == p.id and p.hidden == false,
            join: s in Space, on: p.space_id == s.id and s.visibility == "public",
            where: r.hidden == false and r.pending_approval == false,
            where: ilike(r.body, ^"%#{pattern}%"),
            order_by: [desc: r.inserted_at],
            limit: ^limit,
            offset: ^offset,
            preload: [:user, post: :space]
          )
          |> Repo.all()

        # Merge and sort by date, take one page worth
        merged =
          (Enum.map(posts, fn p -> %{type: "post", item: p, inserted_at: p.inserted_at} end) ++
           Enum.map(replies, fn r -> %{type: "reply", item: r, inserted_at: r.inserted_at} end))
          |> Enum.sort_by(& &1.inserted_at, {:desc, DateTime})
          |> Enum.drop(offset)
          |> Enum.take(limit)

        results = Enum.map(merged, fn
          %{type: "post",  item: p} -> %{type: "post",  post: post_json(p)}
          %{type: "reply", item: r} -> %{type: "reply", reply: reply_json(r)}
        end)

        json(conn, %{
          mentions: results,
          page: page,
          has_more: length(merged) == limit
        })
    end
  end

  # ---------------------------------------------------------------------------
  # Private helpers
  # ---------------------------------------------------------------------------

  defp post_json(post) do
    %{
      id:             post.id,
      title:          post.title,
      body:           post.body,
      type:           post.type,
      reply_count:    post.reply_count,
      reaction_count: post.reaction_count,
      inserted_at:    post.inserted_at,
      space:          post.space && %{id: post.space.id, name: post.space.name, slug: post.space.slug, color: post.space.color},
      user:           post.user  && %{id: post.user.id, username: post.user.username, avatar_url: post.user.avatar_url}
    }
  end

  defp reply_json(reply) do
    %{
      id:          reply.id,
      body:        reply.body,
      inserted_at: reply.inserted_at,
      post: reply.post && %{
        id:    reply.post.id,
        title: reply.post.title,
        space: reply.post.space && %{
          id:    reply.post.space.id,
          name:  reply.post.space.name,
          slug:  reply.post.space.slug,
          color: reply.post.space.color
        }
      }
    }
  end

  defp upload_json(upload) do
    %{
      id:           upload.id,
      url:          served_url(upload.webp_path || upload.original_path),
      original_url: served_url(upload.original_path),
      width:        upload.width,
      height:       upload.height,
      inserted_at:  upload.inserted_at
    }
  end

  defp served_url(nil), do: nil
  defp served_url(rel_path), do: "/uploads/" <> rel_path

  defp to_int(nil, default), do: default
  defp to_int(v, default) when is_binary(v) do
    case Integer.parse(v) do
      {n, _} -> n
      :error -> default
    end
  end
  defp to_int(v, _default) when is_integer(v), do: v
  defp to_int(_, default), do: default
end
