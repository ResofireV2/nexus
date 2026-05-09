defmodule NexusWeb.FeedChannel do
  use NexusWeb, :channel

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
end
