defmodule Nexus.Workers.FanOutAnnouncement do
  @moduledoc """
  Oban worker that fans out announcement notifications to all active users
  in batches, avoiding the thundering-herd problem of enqueuing thousands
  of jobs synchronously inside a controller request.

  Enqueued once when a post is pinned. Processes users in pages of 200,
  re-enqueueing itself with the next cursor until all users are notified.
  """

  use Oban.Worker,
    queue: :default,
    max_attempts: 3

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Accounts.User

  @batch_size 200

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"post_id" => post_id, "actor_id" => actor_id} = args}) do
    after_id = Map.get(args, "after_id", 0)

    user_ids =
      Repo.all(
        from u in User,
          where: u.id != ^actor_id and u.status == "active" and u.id > ^after_id and
                 # Skip users who have disabled announcement web notifications
                 (fragment("(preferences->'notifications'->'announcement'->>'web')::boolean IS DISTINCT FROM false")),
          order_by: [asc: u.id],
          select: u.id,
          limit: @batch_size
      )

    Enum.each(user_ids, fn user_id ->
      %{attrs: %{
        type:     "announcement",
        user_id:  user_id,
        actor_id: actor_id,
        post_id:  post_id
      }}
      |> Nexus.Workers.DeliverNotification.new()
      |> Oban.insert()
    end)

    if length(user_ids) == @batch_size do
      # More users remain — enqueue next batch
      %{"post_id" => post_id, "actor_id" => actor_id, "after_id" => List.last(user_ids)}
      |> __MODULE__.new()
      |> Oban.insert()
    end

    :ok
  end
end
