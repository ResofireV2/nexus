defmodule NexusWeb.API.V1.ReactionController do
  use NexusWeb, :controller

  alias Nexus.Forum
  alias Nexus.Notifications

  # POST /api/v1/reactions
  # Body: { "emoji": "❤️", "post_id": 1 }  or  { "emoji": "❤️", "reply_id": 1 }
  def create(conn, params) do
    user = conn.assigns.current_user

    attrs = %{
      "emoji"    => params["emoji"],
      "post_id"  => params["post_id"],
      "reply_id" => params["reply_id"]
    }

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

        # Return updated counts and user's current reaction
        reactions = if reaction.post_id do
          Forum.list_reactions(post_id: reaction.post_id)
        else
          Forum.list_reactions(reply_id: reaction.reply_id)
        end

        conn |> put_status(:created) |> json(%{ok: true, reactions: reactions, user_reaction: reaction.emoji})

      {:error, changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
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
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", to_string(v)) end)
    end)
  end
end
