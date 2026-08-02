defmodule Nexus.Messaging do
  @moduledoc """
  The Messaging context. Handles DM threads, messages, and read state.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Messaging.{Thread, ThreadMember, Message, UserBlock}
  alias Nexus.Accounts.User
  alias Nexus.Accounts

  # ---------------------------------------------------------------------------
  # Threads
  # ---------------------------------------------------------------------------

  def list_threads(user_id) do
    from(t in Thread,
      join: m in ThreadMember, on: m.thread_id == t.id and m.user_id == ^user_id,
      # A thread this member has hidden stays out of the list until something
      # newer arrives. Comparing against last_message_at means a new message
      # unhides it with no extra write.
      where: is_nil(m.hidden_at) or t.last_message_at > m.hidden_at,
      order_by: [desc_nulls_last: t.last_message_at, desc: t.inserted_at],
      preload: [members: :user]
    )
    |> Repo.all()
  end

  @doc """
  Hides a thread for one member. Used instead of deletion for direct threads,
  where the conversation belongs to both people and one should not be able to
  destroy the other's copy.
  """
  def hide_thread_for_user(thread_id, user_id) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    {count, _} =
      from(m in ThreadMember,
        where: m.thread_id == ^thread_id and m.user_id == ^user_id
      )
      |> Repo.update_all(set: [hidden_at: now])

    if count > 0, do: {:ok, :hidden}, else: {:error, :not_found}
  end


  def get_thread(id), do: Repo.get(Thread, id) |> Repo.preload(members: :user)

  @preview_max_length 90

  @doc """
  Unread message count per thread for one user, as `%{thread_id => count}`.

  Counts actual messages, not "is there anything new". The previous per-thread
  figure was derived by comparing `last_message_at` against `last_read_at` and
  could only ever be 1 or 0, so a thread with forty unread messages reported 1.

  Threads with nothing unread are absent from the map rather than present with
  a zero, so callers should default to 0.

  Excluded from the count:
  - the user's own messages, which are never unread to them
  - anything at or before `hidden_at`, matching what `list_messages/2` returns
    for a thread the user has deleted for themselves
  """
  def unread_counts_for_threads(_user_id, []), do: %{}

  def unread_counts_for_threads(user_id, thread_ids) do
    from(m in Message,
      join: tm in ThreadMember,
      on: tm.thread_id == m.thread_id and tm.user_id == ^user_id,
      where: m.thread_id in ^thread_ids,
      where: is_nil(m.deleted_at),
      where: m.user_id != ^user_id,
      where: is_nil(tm.last_read_at) or m.inserted_at > tm.last_read_at,
      where: is_nil(tm.hidden_at) or m.inserted_at > tm.hidden_at,
      group_by: m.thread_id,
      select: {m.thread_id, count(m.id)}
    )
    |> Repo.all()
    |> Map.new()
  end

  @doc """
  Most recent message for each of the given thread ids, as
  `%{thread_id => %{body: preview, user_id: id}}`.

  One query for the whole list rather than a preload per thread: `DISTINCT ON`
  with a matching leading ORDER BY gives Postgres the newest row per thread
  directly. Threads with no messages are simply absent from the map.

  The body is reduced to a plain-text preview here rather than in the client so
  every consumer gets the same treatment and no markdown reaches a single-line
  row.
  """
  def last_messages_for_threads([]), do: %{}

  def last_messages_for_threads(thread_ids) do
    from(m in Message,
      where: m.thread_id in ^thread_ids,
      distinct: m.thread_id,
      order_by: [asc: m.thread_id, desc: m.inserted_at, desc: m.id],
      select: %{thread_id: m.thread_id, body: m.body, user_id: m.user_id, deleted_at: m.deleted_at}
    )
    |> Repo.all()
    |> Map.new(fn m ->
      # A deleted message stays the most recent one, so the row would otherwise
      # show an empty preview. Deleted messages are not skipped in favour of the
      # one before — the conversation genuinely ended with a withdrawal.
      body = if m.deleted_at, do: "Message deleted", else: preview_text(m.body)
      {m.thread_id, %{body: body, user_id: m.user_id, deleted: !is_nil(m.deleted_at)}}
    end)
  end

  @doc """
  Collapses a message body to a single line of plain text for list previews.

  Image-only messages are the case worth special handling: the composer sends
  them as `[![image](thumb)](full)`, which would otherwise render as a row of
  raw markdown. Those become a short label instead.
  """
  def preview_text(nil), do: ""

  def preview_text(body) do
    text =
      body
      # Linked image — the composer's image format. Must run before the plain
      # image and link rules, which would each match half of it.
      |> String.replace(~r/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/, " ")
      # Bare image
      |> String.replace(~r/!\[[^\]]*\]\([^)]*\)/, " ")
      # Link — keep the visible text, drop the target
      |> String.replace(~r/\[([^\]]*)\]\([^)]*\)/, "\\1")
      # Inline markdown punctuation
      |> String.replace(~r/[*_`~>#]/, "")
      |> String.replace(~r/\s+/, " ")
      |> String.trim()

    cond do
      text != "" -> truncate(text, @preview_max_length)
      # Nothing left after stripping means the message was only an image.
      Regex.match?(~r/!\[/, body) -> "Photo"
      true -> ""
    end
  end

  defp truncate(text, max) do
    if String.length(text) > max do
      String.slice(text, 0, max) |> String.trim_trailing() |> Kernel.<>("…")
    else
      text
    end
  end

  def get_thread_for_user(thread_id, user_id) do
    result =
      from(t in Thread,
        join: m in ThreadMember, on: m.thread_id == t.id and m.user_id == ^user_id,
        where: t.id == ^thread_id,
        preload: [members: :user]
      )
      |> Repo.one()

    case result do
      nil -> {:error, :not_found}
      thread -> {:ok, thread}
    end
  end

  def find_direct_thread(user_id_a, user_id_b) do
    # Find an existing direct thread between exactly these two users
    from(t in Thread,
      where: t.kind == "direct",
      join: m1 in ThreadMember, on: m1.thread_id == t.id and m1.user_id == ^user_id_a,
      join: m2 in ThreadMember, on: m2.thread_id == t.id and m2.user_id == ^user_id_b,
      join: mc in ThreadMember, on: mc.thread_id == t.id,
      group_by: t.id,
      having: count(mc.user_id) == 2
    )
    |> Repo.one()
  end

  def create_direct_thread(user_id, target_user_id) do
    # Return existing thread if one exists
    case find_direct_thread(user_id, target_user_id) do
      %Thread{} = thread ->
        {:ok, Repo.preload(thread, members: :user)}

      nil ->
        Repo.transaction(fn ->
          thread =
            %Thread{}
            |> Thread.changeset(%{kind: "direct"})
            |> Repo.insert!()

          now = DateTime.utc_now() |> DateTime.truncate(:second)

          for uid <- [user_id, target_user_id] do
            %ThreadMember{}
            |> ThreadMember.changeset(%{thread_id: thread.id, user_id: uid})
            |> Ecto.Changeset.put_change(:inserted_at, now)
            |> Repo.insert!()
          end

          Repo.preload(thread, members: :user)
        end)
    end
  end

  def create_group_thread(creator_id, attrs, member_ids) do
    Repo.transaction(fn ->
      thread =
        %Thread{}
        |> Thread.changeset(Map.merge(attrs, %{"kind" => "group", "creator_id" => creator_id}))
        |> Repo.insert!()

      now = DateTime.utc_now() |> DateTime.truncate(:second)
      all_members = Enum.uniq([creator_id | member_ids])

      for uid <- all_members do
        %ThreadMember{}
        |> ThreadMember.changeset(%{thread_id: thread.id, user_id: uid})
        |> Ecto.Changeset.put_change(:inserted_at, now)
        |> Repo.insert!()
      end

      Repo.preload(thread, members: :user)
    end)
  end

  def update_thread(thread, attrs) do
    thread
    |> Thread.changeset(attrs)
    |> Repo.update()
  end

  def delete_thread(%Thread{} = thread) do
    Repo.delete(thread)
  end

  def add_member(thread_id, user_id) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    %ThreadMember{}
    |> ThreadMember.changeset(%{thread_id: thread_id, user_id: user_id})
    |> Ecto.Changeset.put_change(:inserted_at, now)
    |> Repo.insert(on_conflict: :nothing)
  end

  def remove_member(thread_id, user_id) do
    Repo.delete_all(
      from m in ThreadMember,
        where: m.thread_id == ^thread_id and m.user_id == ^user_id
    )
    {:ok, :removed}
  end

  def mute_thread(thread_id, user_id, muted) do
    case Repo.get_by(ThreadMember, thread_id: thread_id, user_id: user_id) do
      nil    -> {:error, :not_member}
      member ->
        member
        |> ThreadMember.mute_changeset(muted)
        |> Repo.update()
    end
  end

  # ---------------------------------------------------------------------------
  # Messages
  # ---------------------------------------------------------------------------

  @page_size 50

  def list_messages(thread_id, opts \\ []) do
    cursor = Keyword.get(opts, :cursor)
    # Messages at or before the caller's hidden_at are not returned. Without
    # this a thread that reappears after being deleted would bring back the
    # history the member had cleared.
    since  = Keyword.get(opts, :since)
    limit  = @page_size

    query =
      from m in Message,
        where: m.thread_id == ^thread_id,
        order_by: [desc: m.inserted_at, desc: m.id],
        limit: ^(limit + 1),
        preload: [:user]

    query = if since, do: where(query, [m], m.inserted_at > ^since), else: query

    query =
      if cursor do
        case decode_cursor(cursor) do
          {:ok, %{"id" => id, "inserted_at" => ts}} ->
            dt = DateTime.from_unix!(ts)
            where(query, [m], m.inserted_at < ^dt or (m.inserted_at == ^dt and m.id < ^id))
          _ -> query
        end
      else
        query
      end

    messages = Repo.all(query)

    {messages, next_cursor} =
      if length(messages) > limit do
        items = Enum.take(messages, limit)
        last  = List.last(items)
        cursor = %{"id" => last.id, "inserted_at" => DateTime.to_unix(last.inserted_at)}
                 |> Jason.encode!()
                 |> Base.url_encode64(padding: false)
        {items, cursor}
      else
        {messages, nil}
      end

    # Return in chronological order for display
    %{messages: Enum.reverse(messages), next_cursor: next_cursor}
  end

  def send_message(thread, user_id, attrs) do
    result =
      %Message{}
      |> Message.changeset(Map.merge(attrs, %{"user_id" => user_id, "thread_id" => thread.id}))
      |> Repo.insert()

    case result do
      {:ok, message} ->
        now = DateTime.utc_now() |> DateTime.truncate(:second)

        from(t in Thread, where: t.id == ^thread.id)
        |> Repo.update_all(set: [last_message_at: now])

        # Mark the thread as read for the sender so it doesn't appear unread to them
        from(m in ThreadMember, where: m.thread_id == ^thread.id and m.user_id == ^user_id)
        |> Repo.update_all(set: [last_read_at: now])

        message = Repo.preload(message, :user)

        # Queue a notification for every other member. Oban rather than
        # Task.start: an unsupervised task links nothing and logs nothing, so a
        # failure here delivered the message while the recipient's notification
        # and push disappeared silently. A group thread also spawned one bare
        # task per member on every message.
        #
        # Recipients who muted the thread are skipped at queue time rather than
        # inside the job — no point creating work that will be discarded.
        thread_with_members = Repo.preload(thread, :members)

        thread_with_members.members
        |> Enum.reject(&(&1.user_id == user_id or &1.muted))
        |> Enum.each(fn member ->
          Nexus.Notifications.enqueue_dm_notification(%{
            user_id: member.user_id,
            actor_id: user_id,
            thread_id: thread.id
          })
        end)

        {:ok, message}

      error -> error
    end
  end

  # ── Blocking ────────────────────────────────────────────────────────────────

  @doc """
  Blocks a user from direct messages.

  Refuses outright when the target is a moderator or admin rather than
  recording a block that would have no effect. A silent no-op would leave the
  member believing they were protected when they were not.

  Also hides any existing conversation for the blocker, reusing the per-member
  hide from thread deletion — the thread survives for the other party but stops
  cluttering the blocker's list.
  """
  def block_user(%User{} = blocker, %User{} = target) do
    cond do
      blocker.id == target.id ->
        {:error, :cannot_block_self}

      User.moderator?(target) ->
        {:error, :cannot_block_staff}

      true ->
        result =
          %UserBlock{}
          |> UserBlock.changeset(%{blocker_id: blocker.id, blocked_id: target.id})
          # Re-blocking someone is success, not a constraint error.
          |> Repo.insert(on_conflict: :nothing)

        case result do
          {:ok, _} ->
            if thread = find_direct_thread(blocker.id, target.id) do
              hide_thread_for_user(thread.id, blocker.id)
            end

            :ok

          {:error, changeset} ->
            {:error, changeset}
        end
    end
  end

  def unblock_user(blocker_id, blocked_id) do
    from(b in UserBlock, where: b.blocker_id == ^blocker_id and b.blocked_id == ^blocked_id)
    |> Repo.delete_all()

    :ok
  end

  @doc """
  True when a block is in force between two users, in either direction.

  The staff exemption is asymmetric, and deliberately so. It exists to stop a
  member cutting themselves off from moderation contact, which is about the
  *blocked* party being staff — not either party. So:

    - a member blocking a moderator has no effect (and is refused outright at
      creation by block_user/2; this clause covers the stale case where someone
      was blocked before being promoted)
    - a moderator blocking a member *is* enforced, in both directions. Staff
      choosing not to correspond with someone is their prerogative, and that
      member can still reach any other moderator.

  Checking the blocked party's role here rather than in Elixir keeps it a single
  query and means a promotion or demotion takes effect immediately.
  """
  def blocked_between?(%User{} = a, %User{} = b), do: block_in_force?(a.id, b.id)

  def blocked_between?(a_id, b_id) when is_integer(a_id) and is_integer(b_id),
    do: block_in_force?(a_id, b_id)

  defp block_in_force?(a_id, b_id) do
    Repo.exists?(
      from bl in UserBlock,
        join: u in User,
        on: u.id == bl.blocked_id,
        where:
          ((bl.blocker_id == ^a_id and bl.blocked_id == ^b_id) or
             (bl.blocker_id == ^b_id and bl.blocked_id == ^a_id)) and
            u.role not in ["admin", "moderator"]
    )
  end

  @doc "Blocked users with their profile, for the settings list."
  def list_blocked(user_id) do
    from(b in UserBlock,
      where: b.blocker_id == ^user_id,
      join: u in User, on: u.id == b.blocked_id,
      order_by: [asc: u.username],
      select: %{id: u.id, username: u.username, avatar_url: u.avatar_url, blocked_at: b.inserted_at}
    )
    |> Repo.all()
  end

  @doc """
  Soft-deletes a message. Author only.

  Moderators are deliberately not permitted: they cannot read DMs, and granting
  delete would imply a read capability that does not exist.

  There is no time limit. The usual reason for one is preserving evidence for
  moderation, which does not apply — reports target posts, replies and users,
  never messages, so there is nothing here for a window to protect. The
  placeholder left behind keeps the deletion visible either way.

  The body is cleared rather than kept, so a deleted message leaves no content
  in the database.
  """
  def delete_message(message_id, user_id) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    query =
      from(m in Message,
        where: m.id == ^message_id and m.user_id == ^user_id and is_nil(m.deleted_at)
      )

    case Repo.update_all(query, set: [body: "", deleted_at: now]) do
      {1, _} ->
        case Repo.get(Message, message_id) |> Repo.preload(:user) do
          nil     -> {:error, :not_found}
          message -> {:ok, message}
        end

      {0, _} ->
        # Either it does not exist, belongs to someone else, or was already
        # deleted. All three are "nothing to do" from the caller's side, and
        # collapsing them avoids revealing whether a given id exists.
        {:error, :not_found}
    end
  end

  def mark_read(thread_id, user_id) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    from(m in ThreadMember,
      where: m.thread_id == ^thread_id and m.user_id == ^user_id
    )
    |> Repo.update_all(set: [last_read_at: now])

    {:ok, :marked}
  end

  @doc """
  Total unread messages across every thread — the number behind the Messages
  badge in the sidebar.

  Counts messages rather than threads. It previously counted threads containing
  anything unread, which contradicted the per-thread figures now shown on each
  row: two threads showing 5 each would have produced a badge of 2.

  The same exclusions apply as `unread_counts_for_threads/2` — own messages, and
  anything at or before a hide.
  """
  def unread_count(user_id) do
    from(m in Message,
      join: tm in ThreadMember,
      on: tm.thread_id == m.thread_id and tm.user_id == ^user_id,
      where: is_nil(m.deleted_at),
      where: m.user_id != ^user_id,
      where: is_nil(tm.last_read_at) or m.inserted_at > tm.last_read_at,
      where: is_nil(tm.hidden_at) or m.inserted_at > tm.hidden_at,
      select: count(m.id)
    )
    |> Repo.one() || 0
  end

  defp decode_cursor(cursor) do
    with {:ok, json} <- Base.url_decode64(cursor, padding: false),
         {:ok, data} <- Jason.decode(json) do
      {:ok, data}
    else
      _ -> {:error, :invalid}
    end
  end
end
