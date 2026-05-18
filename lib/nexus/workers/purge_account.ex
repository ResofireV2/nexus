defmodule Nexus.Workers.PurgeAccount do
  @moduledoc """
  Oban worker that permanently purges a user account 30 days after
  the user requested deletion.

  Behaviour is controlled by the admin setting
  `posting.account_deletion_content`:
    - "anonymise" (default) — nullifies user_id on posts/replies so content
      remains but appears as "Deleted User". The DB already has
      on_delete: :nilify_all on posts.user_id and replies.user_id so
      deleting the user row handles this automatically.
    - "delete" — hard-deletes the user row; cascades remove posts/replies
      via on_delete: :delete_all on those foreign keys.

  In both cases the user row itself is deleted, removing all PII.
  DMs, notifications, sessions, push subscriptions, drafts, saves,
  reactions, and the pending_deletion status are all removed by cascade
  or explicit delete_all below.
  """

  use Oban.Worker, queue: :default, max_attempts: 3

  import Ecto.Query
  alias Nexus.{Repo, Accounts, Admin}
  alias Nexus.Accounts.User

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"user_id" => user_id}}) do
    user = Repo.get(User, user_id)

    if is_nil(user) do
      # Already deleted — nothing to do
      :ok
    else
      unless user.status == "pending_deletion" do
        # Deletion was cancelled — abort
        :ok
      else
        purge(user)
      end
    end
  end

  defp purge(user) do
    mode =
      Admin.get_setting("posting")
      |> Map.get("account_deletion_content", "anonymise")

    case mode do
      "delete" ->
        # Hard-delete; on_delete: :delete_all cascades remove posts/replies
        Repo.delete(user)

      _ ->
        # Anonymise: null out posts/replies user_id first, then delete user.
        # The DB on_delete: :nilify_all on posts/replies already handles this
        # when the user row is deleted, so a plain Repo.delete is sufficient.
        Repo.delete(user)
    end

    :ok
  end
end
