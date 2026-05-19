defmodule NexusWeb.FeedChannel do
  use NexusWeb, :channel

  alias Nexus.Presence

  @impl true
  def join("feed:global", _payload, socket) do
    send(self(), {:after_join, "feed:global"})
    {:ok, socket}
  end

  def join("feed:space:" <> space_slug, _payload, socket) do
    send(self(), {:after_join, "feed:space:#{space_slug}"})
    {:ok, socket}
  end

  def join(_topic, _payload, _socket) do
    {:error, %{reason: "Unknown feed topic"}}
  end

  @impl true
  def handle_info({:after_join, "feed:global"}, socket) do
    Phoenix.PubSub.subscribe(Nexus.PubSub, "feed:global")
    # Track this connection in Presence so the online count is accurate.
    # Unauthenticated guests get a guest key; authenticated users are keyed
    # by user_id so multiple tabs count as one person.
    key = case socket.assigns[:current_user_id] do
      nil -> "guest:#{inspect(self())}"
      id  -> "user:#{id}"
    end
    {:ok, _} = Presence.track(socket, key, %{online_at: System.system_time(:second)})
    {:noreply, socket}
  end

  def handle_info({:after_join, topic}, socket) do
    Phoenix.PubSub.subscribe(Nexus.PubSub, topic)
    {:noreply, socket}
  end

  @doc """
  Broadcast a new post to all subscribers of the relevant feed topics.
  Called from PostController after successful post creation.
  """
  def broadcast_new_post(post) do
    payload = %{
      id: post.id,
      title: post.title,
      type: post.type,
      reply_count: 0,
      reaction_count: 0,
      inserted_at: post.inserted_at,
      space: %{
        id: post.space.id,
        name: post.space.name,
        slug: post.space.slug,
        color: post.space.color
      },
      tags: Enum.map(post.tags, fn t -> %{id: t.id, name: t.name, slug: t.slug, color: t.color} end),
      user: %{
        id: post.user.id,
        username: post.user.username,
        avatar_url: post.user.avatar_url,
        avatar_color: post.user.avatar_color
      }
    }

    Phoenix.PubSub.broadcast(Nexus.PubSub, "feed:global", {:new_post, payload})

    if post.space do
      Phoenix.PubSub.broadcast(
        Nexus.PubSub,
        "feed:space:#{post.space.slug}",
        {:new_post, payload}
      )
    end
  end

  @impl true
  def handle_info({:new_post, payload}, socket) do
    push(socket, "new_post", payload)
    {:noreply, socket}
  end

  def handle_info({:link_preview_ready, payload}, socket) do
    push(socket, "link_preview_ready", payload)
    {:noreply, socket}
  end

  # Phoenix Presence broadcasts presence_diff events via PubSub.
  # Forward them to the client so the online count stays accurate.
  @impl true
  def handle_out("presence_diff", payload, socket) do
    push(socket, "presence_diff", payload)
    {:noreply, socket}
  end
end
