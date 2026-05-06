defmodule NexusWeb.PostChannel do
  use NexusWeb, :channel

  alias Nexus.{Forum, Accounts, Presence}

  @impl true
  def join("post:" <> post_id, _payload, socket) do
    post_id = String.to_integer(post_id)

    case Forum.get_post(post_id) do
      nil ->
        {:error, %{reason: "Post not found"}}

      post ->
        send(self(), :after_join)
        socket = assign(socket, :post_id, post.id)
        {:ok, %{post_id: post.id, title: post.title}, socket}
    end
  end

  @impl true
  def handle_info(:after_join, socket) do
    # Subscribe to PubSub so HTTP-submitted replies reach this channel process
    Phoenix.PubSub.subscribe(Nexus.PubSub, "post_viewers:#{socket.assigns.post_id}")

    user_id = socket.assigns[:current_user_id]

    if user_id do
      user = Accounts.get_user(user_id)

      {:ok, _} = Presence.track(socket, "user:#{user_id}", %{
        user_id: user_id,
        username: user && user.username,
        online_at: System.system_time(:millisecond)
      })
    end

    push(socket, "presence_state", Presence.list(socket))
    {:noreply, socket}
  end

  def handle_info({:new_reply, payload}, socket) do
    push(socket, "new_reply", payload)
    {:noreply, socket}
  end

  # Client sends "new_reply" with %{"body" => "..."}
  @impl true
  def handle_in("new_reply", %{"body" => body}, socket) do
    user_id = socket.assigns[:current_user_id]

    if is_nil(user_id) do
      {:reply, {:error, %{reason: "Authentication required"}}, socket}
    else
      user = Accounts.get_user(user_id)
      post = Forum.get_post(socket.assigns.post_id)

      case Forum.create_reply(post, %{"body" => body}, user) do
        {:ok, reply} ->
          payload = reply_payload(reply)
          broadcast!(socket, "new_reply", payload)
          {:reply, {:ok, payload}, socket}

        {:error, changeset} ->
          {:reply, {:error, %{errors: format_errors(changeset)}}, socket}
      end
    end
  end

  def handle_in("typing_start", _payload, socket) do
    user_id = socket.assigns[:current_user_id]
    if user_id, do: broadcast_from!(socket, "typing_start", %{user_id: user_id})
    {:noreply, socket}
  end

  def handle_in("typing_stop", _payload, socket) do
    user_id = socket.assigns[:current_user_id]
    if user_id, do: broadcast_from!(socket, "typing_stop", %{user_id: user_id})
    {:noreply, socket}
  end

  # Client sends "react" with %{"emoji" => "👍", "post_id" => 1}
  def handle_in("react", %{"emoji" => emoji} = payload, socket) do
    user_id = socket.assigns[:current_user_id]

    if is_nil(user_id) do
      {:reply, {:error, %{reason: "Authentication required"}}, socket}
    else
      attrs = %{
        "emoji"    => emoji,
        "post_id"  => payload["post_id"],
        "reply_id" => payload["reply_id"]
      }

      case Forum.add_reaction(user_id, attrs) do
        {:ok, reaction} ->
          broadcast!(socket, "reaction_added", %{
            emoji:    reaction.emoji,
            post_id:  reaction.post_id,
            reply_id: reaction.reply_id,
            user_id:  user_id
          })
          {:reply, :ok, socket}

        {:error, _} ->
          {:reply, {:error, %{reason: "Could not add reaction"}}, socket}
      end
    end
  end

  defp reply_payload(reply) do
    %{
      id: reply.id,
      body: reply.body,
      body_format: reply.body_format,
      post_id: reply.post_id,
      inserted_at: reply.inserted_at,
      user: %{
        id: reply.user.id,
        username: reply.user.username,
        avatar_url: reply.user.avatar_url
      }
    }
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", to_string(v)) end)
    end)
  end
end
