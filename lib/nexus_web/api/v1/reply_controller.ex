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
        pending = !Nexus.Permissions.can_post_immediately?(user) && user.role == "member"

        # Composition spam check
        composition_signals = params["compositionSignals"]
        content = params["body"] || ""
        {pending, composition_result} =
          case Nexus.AntiSpam.CompositionAnalyser.check(user, content, composition_signals) do
            {:hold, verdict, details} -> {true,  {:held, verdict, details}}
            {:log,  verdict, details} -> {pending, {:logged, verdict, details}}
            :pass                     -> {pending, :pass}
          end

        case Forum.create_reply(post, Map.put(params, "pending_approval", pending), user) do
          {:ok, reply} ->
            # Record verdict for composition holds
            case composition_result do
              {:held, verdict, details} ->
                Task.start(fn ->
                  Nexus.AntiSpam.CompositionAnalyser.record_verdict(%{
                    post_id: post.id, reply_id: reply.id, user_id: user.id,
                    verdict: verdict, details: details, report_only: false
                  })
                  Nexus.Moderation.log_spam_hold(user.id, post.id, verdict, false)
                end)
              {:logged, verdict, details} ->
                Task.start(fn ->
                  Nexus.AntiSpam.CompositionAnalyser.record_verdict(%{
                    post_id: post.id, reply_id: reply.id, user_id: user.id,
                    verdict: verdict, details: details, report_only: true
                  })
                  Nexus.Moderation.log_spam_hold(user.id, post.id, verdict, true)
                end)
              :pass -> :ok
            end

            # Piece 4: dispatch any compose attachments to their declaring
            # extensions. Fires regardless of pending state.
            Nexus.Extensions.SideData.persist_attachments(
              "reply", reply.id, params["attachments"] || []
            )

            if pending do
              conn |> put_status(:created) |> json(%{reply: reply_json(reply), pending: true, message: "Your reply is pending approval"})
            else
              Nexus.Activity.increment_stat(user.id, :replies_count)
              # Auto-follow the post if user preference is set (default: true)
              if Map.get(user.preferences || %{}, "auto_follow_replied_posts", true) != false do
                Forum.follow_post(user.id, post.id)
              end
              Task.start(fn -> Nexus.Notifications.notify_reply(post, reply, user) end)
              # Notify post followers (excluding the reply author)
              Task.start(fn ->
                follower_ids = Forum.post_follower_ids(post.id)
                Enum.each(follower_ids, fn follower_id ->
                  if follower_id != user.id do
                    Nexus.Notifications.notify_followed_post_reply(post, reply, user, follower_id)
                  end
                end)
              end)
              Task.start(fn ->
                {:ok, payload} = Nexus.Extensions.HookContracts.build_payload(
                  "reply_created", %{
                    user_id:  user.id,
                    reply_id: reply.id,
                    post_id:  post.id
                  }
                )
                Nexus.Extensions.fire("reply_created", payload)
              end)
              %{"user_id" => user.id} |> Nexus.Workers.CheckBadges.new(schedule_in: 60) |> Oban.insert()
              %{"user_id" => user.id} |> Nexus.Workers.UpdateScore.new() |> Oban.insert()
              Task.start(fn ->
                Nexus.LinkPreviews.extract_urls(reply.body)
                |> Enum.each(&Nexus.LinkPreviews.get_or_fetch/1)
              end)

              # Broadcast to every subscriber of this post's notification channel.
              # Using "post_viewers:{post_id}" as a lightweight PubSub topic that
              # PostChannel processes subscribe to on join — more reliable than
              # depending on the post: channel PubSub subscription being active.
              Phoenix.PubSub.broadcast(
                Nexus.PubSub,
                "post_viewers:#{post.id}",
                {:new_reply, reply_json(reply)}
              )

              conn |> put_status(:created) |> json(%{reply: reply_json(reply)})
            end

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
          Forum.record_reply_edit(reply, user.id)
          case Forum.update_reply(reply, params) do
            {:ok, updated} ->
              Nexus.LinkPreviews.extract_urls(updated.body)
              |> Enum.each(fn url ->
                %{"url" => url} |> Nexus.Workers.FetchLinkPreview.new() |> Oban.insert()
              end)
              json(conn, %{reply: reply_json(updated)})
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
          # Capture post_id BEFORE delete — the reply struct will still have
          # it in scope, but we want this to be unambiguous to the reader.
          parent_post_id = reply.post_id
          {:ok, _} = Forum.delete_reply(reply)

          Task.start(fn ->
            {:ok, payload} = Nexus.Extensions.HookContracts.build_payload(
              "reply_deleted", %{
                user_id:  user.id,
                reply_id: reply.id,
                post_id:  parent_post_id
              }
            )
            Nexus.Extensions.fire("reply_deleted", payload)
          end)

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
      user: user_json(reply.user),
      edit_count: Forum.reply_edit_count(reply.id)
    }
  end

  defp user_json(nil), do: nil
  defp user_json(u), do: %{id: u.id, username: u.username, avatar_url: u.avatar_url}

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", if(is_binary(v), do: v, else: inspect(v))) end)
    end)
  end

  # GET /api/v1/posts/:post_id/replies/:id/edits
  def edits(conn, %{"id" => id}) do
    edits = Forum.list_reply_edits(String.to_integer(id))
    json(conn, %{edits: Enum.map(edits, fn e ->
      %{id: e.id, old_body: e.old_body, edited_at: e.edited_at, editor: e.editor}
    end)})
  end
end
