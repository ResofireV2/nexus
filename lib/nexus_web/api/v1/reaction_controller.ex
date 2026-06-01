defmodule NexusWeb.API.V1.ReactionController do
  use NexusWeb, :controller

  alias Nexus.Forum
  alias Nexus.Notifications

  # GET /api/v1/posts/:id/reactions
  def show_post_reactions(conn, %{"id" => post_id}) do
    case Integer.parse(post_id) do
      {id, ""} ->
        groups = Forum.list_reactions_with_users(post_id: id)
        total  = Enum.reduce(groups, 0, fn g, acc -> acc + g.count end)
        json(conn, %{total: total, groups: groups})
      _ -> conn |> put_status(:bad_request) |> json(%{error: "Invalid id"})
    end
  end

  # GET /api/v1/replies/:id/reactions
  def show_reply_reactions(conn, %{"id" => reply_id}) do
    case Integer.parse(reply_id) do
      {id, ""} ->
        groups = Forum.list_reactions_with_users(reply_id: id)
        total  = Enum.reduce(groups, 0, fn g, acc -> acc + g.count end)
        json(conn, %{total: total, groups: groups})
      _ -> conn |> put_status(:bad_request) |> json(%{error: "Invalid id"})
    end
  end

  # POST /api/v1/reactions
  # Body: { "emoji": "❤️", "post_id": 1 }  or  { "emoji": "❤️", "reply_id": 1 }
  def create(conn, params) do
    user = conn.assigns.current_user

    attrs = %{
      "emoji"    => params["emoji"],
      "post_id"  => params["post_id"],
      "reply_id" => params["reply_id"]
    }

    # Check self-reaction permission
    target_author_id = cond do
      params["post_id"]  ->
        post = Forum.get_post(params["post_id"])
        post && post.user_id
      params["reply_id"] ->
        reply = Forum.get_reply(params["reply_id"])
        reply && reply.user_id
      true -> nil
    end

    if target_author_id == user.id && !Nexus.Permissions.allow_self_reactions?() do
      conn |> put_status(:forbidden) |> json(%{error: "You cannot react to your own posts"})
    else

    case Forum.add_reaction(user.id, attrs) do
      {:ok, reaction} ->
        Task.start(fn ->
          target = cond do
            reaction.post_id  -> Forum.get_post(reaction.post_id)
            reaction.reply_id -> Forum.get_reply(reaction.reply_id)
            true -> nil
          end
          if target, do: Nexus.Notifications.notify_reaction(target, user, params["emoji"])
        end)
        Task.start(fn ->
          {:ok, payload} = Nexus.Extensions.HookContracts.build_payload(
            "reaction_added", %{
              user_id:  user.id,
              emoji:    params["emoji"],
              post_id:  reaction.post_id,
              reply_id: reaction.reply_id
            }
          )
          Nexus.Extensions.fire("reaction_added", payload)
        end)

        # Return updated counts and user's current reaction
        reactions = if reaction.post_id do
          Forum.list_reactions(post_id: reaction.post_id)
        else
          Forum.list_reactions(reply_id: reaction.reply_id)
        end

        # Track activity stats
        Nexus.Activity.increment_stat(user.id, :reactions_given)
        # Track reactions received for the post/reply author
        Task.start(fn ->
          target = if reaction.post_id do
            Nexus.Forum.get_post(reaction.post_id)
          else
            Nexus.Forum.get_reply(reaction.reply_id)
          end
          if target && target.user_id && target.user_id != user.id do
            Nexus.Activity.increment_stat(target.user_id, :reactions_received)
            %{"user_id" => target.user_id} |> Nexus.Workers.CheckBadges.new(schedule_in: 60) |> Oban.insert()
            %{"user_id" => target.user_id} |> Nexus.Workers.UpdateScore.new() |> Oban.insert()
          end
        end)
        %{"user_id" => user.id} |> Nexus.Workers.CheckBadges.new(schedule_in: 60) |> Oban.insert()
        %{"user_id" => user.id} |> Nexus.Workers.UpdateScore.new() |> Oban.insert()

        conn |> put_status(:created) |> json(%{ok: true, reactions: reactions, user_reaction: reaction.emoji})

      {:error, changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
    end
    end
  end

  # DELETE /api/v1/reactions
  def delete(conn, params) do
    user_id = conn.assigns.current_user.id

    attrs = %{
      "emoji"    => params["emoji"],
      "post_id"  => params["post_id"],
      "reply_id" => params["reply_id"]
    }

    case Forum.remove_reaction(user_id, attrs) do
      {:ok, :removed} ->
        Task.start(fn ->
          {:ok, payload} = Nexus.Extensions.HookContracts.build_payload(
            "reaction_removed", %{
              user_id:  user_id,
              emoji:    params["emoji"],
              post_id:  params["post_id"],
              reply_id: params["reply_id"]
            }
          )
          Nexus.Extensions.fire("reaction_removed", payload)
        end)

        reactions = if params["post_id"] do
          Forum.list_reactions(post_id: params["post_id"])
        else
          Forum.list_reactions(reply_id: params["reply_id"])
        end
        json(conn, %{ok: true, reactions: reactions, user_reaction: nil})
      {:error, :not_found} ->
        conn |> put_status(:not_found) |> json(%{error: "Reaction not found"})
    end
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", if(is_binary(v), do: v, else: inspect(v))) end)
    end)
  end
end
