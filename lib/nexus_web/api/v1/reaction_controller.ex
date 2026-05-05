defmodule NexusWeb.API.V1.ReactionController do
  use NexusWeb, :controller

  alias Nexus.Forum
  alias Nexus.Notifications

  # POST /api/v1/reactions
  # Body: { "emoji": "👍", "post_id": 1 }  or  { "emoji": "👍", "reply_id": 1 }
  def create(conn, params) do
    user = conn.assigns.current_user

    attrs = %{
      "emoji"    => params["emoji"],
      "post_id"  => params["post_id"],
      "reply_id" => params["reply_id"]
    }

    case Forum.add_reaction(user.id, attrs) do
      {:ok, reaction} ->
        # Fire notification asynchronously
        Task.start(fn ->
          target = cond do
            reaction.post_id  -> Forum.get_post(reaction.post_id)
            reaction.reply_id -> Forum.get_reply(reaction.reply_id)
            true -> nil
          end
          if target, do: Nexus.Notifications.notify_reaction(target, user, params["emoji"])
        end)
        conn |> put_status(:created) |> json(%{ok: true})

      {:error, changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
    end
  end

  # DELETE /api/v1/reactions
  # Body: { "emoji": "👍", "post_id": 1 }
  def delete(conn, params) do
    user_id = conn.assigns.current_user.id

    attrs = %{
      "emoji"    => params["emoji"],
      "post_id"  => params["post_id"],
      "reply_id" => params["reply_id"]
    }

    case Forum.remove_reaction(user_id, attrs) do
      {:ok, :removed} -> json(conn, %{ok: true})
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
