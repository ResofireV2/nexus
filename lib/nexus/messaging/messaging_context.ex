defmodule Nexus.Messaging do
  @moduledoc """
  The Messaging context. Handles DM threads, messages, and read state.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Messaging.{Thread, ThreadMember, Message}
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
      select: %{thread_id: m.thread_id, body: m.body, user_id: m.user_id}
    )
    |> Repo.all()
    |> Map.new(fn m -> {m.thread_id, %{body: preview_text(m.body), user_id: m.user_id}} end)
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

  def mark_read(thread_id, user_id) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    from(m in ThreadMember,
      where: m.thread_id == ^thread_id and m.user_id == ^user_id
    )
    |> Repo.update_all(set: [last_read_at: now])

    {:ok, :marked}
  end

  def unread_count(user_id) do
    from(m in ThreadMember,
      where: m.user_id == ^user_id,
      join: t in Thread, on: t.id == m.thread_id,
      where: is_nil(m.last_read_at) or t.last_message_at > m.last_read_at,
      # Mirrors list_threads: a hidden thread must not drive the badge while it
      # is absent from the list, or the count points at nothing the user can see.
      where: is_nil(m.hidden_at) or t.last_message_at > m.hidden_at,
      select: count(m.thread_id)
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
