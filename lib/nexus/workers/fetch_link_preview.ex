defmodule Nexus.Workers.FetchLinkPreview do
  @moduledoc """
  Oban worker that fetches and caches a link preview for a given URL.

  Deduplicated by URL — if a job for the same URL is already queued or
  running, a second enqueue is a no-op. This means 50 simultaneous posts
  linking the same article only trigger one outbound HTTP request.
  """

  use Oban.Worker,
    queue: :media,
    max_attempts: 2,
    unique: [
      period:  300,
      fields:  [:args],
      keys:    [:url],
      states:  [:available, :scheduled, :executing, :retryable]
    ]

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"url" => url}}) do
    case Nexus.LinkPreviews.get_or_fetch(url) do
      {:ok, _preview} -> :ok
      {:error, _}     -> :ok
    end
  end
end
