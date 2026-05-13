defmodule NexusWeb.API.V1.UserContentController do
  @moduledoc """
  Endpoints for profile tab content:
    - replies posted by a user
    - posts the user has reacted to
    - media uploaded by a user
    - posts/replies mentioning a user
  All endpoints use cursor-based pagination with a `cursor` param and return `next_cursor`.
  """
  use NexusWeb, :controller

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Accounts
  alias Nexus.Forum.{Post, Reply, Reaction, Space}
  alias Nexus.Uploads.Upload
  alias Nexus.Admin

  @limit 25

  # ---------------------------------------------------------------------------
  # GET /api/v1/users/:username/replies
  # ---------------------------------------------------------------------------

  def replies(conn, %{"username" => username} = params) do
    case Accounts.get_user_by_username(username) do
      nil -> conn |> put_status(:not_found) |> json(%{error: "User not found"})
      user ->
        cursor_id = decode_id_cursor(params["cursor"])

        query =
          from(r in Reply,
            where: r.user_id == ^user.id and r.hidden == false and r.pending_approval == false,
            join: p in Post, on: r.post_id == p.id and p.hidden == false,
            join: s in Space, on: p.space_id == s.id,
            order_by: [desc: r.inserted_at, desc: r.id],
            limit: ^(@limit + 1),
            preload: [post: :space]
          )

        query = if cursor_id, do: where(query, [r], r.id < ^cursor_id), else: query
        replies = Repo.all(query)

        {items, next_cursor} = paginate(replies, @limit, & &1.id)

        json(conn, %{replies: Enum.map(items, &reply_json/1), next_cursor: next_cursor})
    end
  end

  # ---------------------------------------------------------------------------
  # GET /api/v1/users/:username/reactions
  # ---------------------------------------------------------------------------

  def reactions(conn, %{"username" => username} = params) do
    case Accounts.get_user_by_username(username) do
      nil -> conn |> put_status(:not_found) |> json(%{error: "User not found"})
      user ->
        cursor_id = decode_id_cursor(params["cursor"])

        query =
          from(r in Reaction,
            where: r.user_id == ^user.id and not is_nil(r.post_id),
            join: p in Post, on: r.post_id == p.id and p.hidden == false and p.pending_approval == false,
            join: s in Space, on: p.space_id == s.id and s.visibility == "public",
            order_by: [desc: r.inserted_at, desc: r.id],
            limit: ^(@limit + 1),
            select: %{id: r.id, emoji: r.emoji, reacted_at: r.inserted_at, post_id: p.id}
          )

        query = if cursor_id, do: where(query, [r], r.id < ^cursor_id), else: query
        rows  = Repo.all(query)

        {rows, next_cursor} = paginate(rows, @limit, & &1.id)

        post_ids   = Enum.map(rows, & &1.post_id)
        posts      = from(p in Post, where: p.id in ^post_ids, preload: [:space, :user]) |> Repo.all()
        posts_by_id = Map.new(posts, & {&1.id, &1})

        results =
          rows
          |> Enum.map(fn row -> Map.put(row, :post, posts_by_id[row.post_id]) end)
          |> Enum.reject(& is_nil(&1.post))
          |> Enum.map(fn row -> %{emoji: row.emoji, reacted_at: row.reacted_at, post: post_json(row.post)} end)

        json(conn, %{reactions: results, next_cursor: next_cursor})
    end
  end

  # ---------------------------------------------------------------------------
  # GET /api/v1/users/:username/uploads
  # ---------------------------------------------------------------------------

  def uploads(conn, %{"username" => username} = params) do
    case Accounts.get_user_by_username(username) do
      nil -> conn |> put_status(:not_found) |> json(%{error: "User not found"})
      profile_user ->
        media_public = Admin.get_setting("posting")["media_public"] == true
        current_user = conn.assigns[:current_user]
        is_owner     = current_user && current_user.id == profile_user.id
        is_admin     = current_user && current_user.role == "admin"

        if not media_public and not is_owner and not is_admin do
          conn |> put_status(:forbidden) |> json(%{error: "Media is private"})
        else
          cursor_id = decode_id_cursor(params["cursor"])

          query =
            from(u in Upload,
              where: u.user_id == ^profile_user.id and u.upload_type == "post_image",
              order_by: [desc: u.inserted_at, desc: u.id],
              limit: ^(@limit + 1)
            )

          query = if cursor_id, do: where(query, [u], u.id < ^cursor_id), else: query
          uploads = Repo.all(query)

          {items, next_cursor} = paginate(uploads, @limit, & &1.id)

          json(conn, %{uploads: Enum.map(items, &upload_json/1), next_cursor: next_cursor})
        end
    end
  end

  # ---------------------------------------------------------------------------
  # GET /api/v1/users/:username/mentions
  # ---------------------------------------------------------------------------

  def mentions(conn, %{"username" => username} = params) do
    case Accounts.get_user_by_username(username) do
      nil -> conn |> put_status(:not_found) |> json(%{error: "User not found"})
      _user ->
        cursor_id = decode_id_cursor(params["cursor"])
        pattern   = "@#{username}"

        posts =
          from(p in Post,
            join: s in Space, on: p.space_id == s.id and s.visibility == "public",
            where: p.hidden == false and p.pending_approval == false,
            where: ilike(p.body, ^"%#{pattern}%"),
            order_by: [desc: p.inserted_at, desc: p.id],
            limit: ^(@limit + 1),
            preload: [:user, :space]
          )
          |> then(fn q -> if cursor_id, do: where(q, [p], p.id < ^cursor_id), else: q end)
          |> Repo.all()

        replies =
          from(r in Reply,
            join: p in Post, on: r.post_id == p.id and p.hidden == false,
            join: s in Space, on: p.space_id == s.id and s.visibility == "public",
            where: r.hidden == false and r.pending_approval == false,
            where: ilike(r.body, ^"%#{pattern}%"),
            order_by: [desc: r.inserted_at, desc: r.id],
            limit: ^(@limit + 1),
            preload: [:user, post: :space]
          )
          |> then(fn q -> if cursor_id, do: where(q, [r], r.id < ^cursor_id), else: q end)
          |> Repo.all()

        merged =
          (Enum.map(posts,   fn p -> %{type: "post",  item: p, ts: p.inserted_at} end) ++
           Enum.map(replies, fn r -> %{type: "reply", item: r, ts: r.inserted_at} end))
          |> Enum.sort_by(& &1.ts, {:desc, NaiveDateTime})
          |> Enum.take(@limit + 1)

        {items, next_cursor} = paginate(merged, @limit, fn m -> m.item.id end)

        results = Enum.map(items, fn
          %{type: "post",  item: p} -> %{type: "post",  post:  post_json(p)}
          %{type: "reply", item: r} -> %{type: "reply", reply: reply_json(r)}
        end)

        json(conn, %{mentions: results, next_cursor: next_cursor})
    end
  end

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------

  defp paginate(items, limit, id_fn) do
    if length(items) > limit do
      page = Enum.take(items, limit)
      last = List.last(page)
      cur  = last |> id_fn.() |> Integer.to_string() |> Base.url_encode64(padding: false)
      {page, cur}
    else
      {items, nil}
    end
  end

  defp decode_id_cursor(nil), do: nil
  defp decode_id_cursor(cursor) do
    with {:ok, bin} <- Base.url_decode64(cursor, padding: false),
         {id, _}    <- Integer.parse(bin) do
      id
    else
      _ -> nil
    end
  end

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
end
