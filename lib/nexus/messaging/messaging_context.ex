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
      order_by: [desc_nulls_last: t.last_message_at, desc: t.inserted_at],
      preload: [members: :user]
    )
    |> Repo.all()
  end

  def get_thread(id), do: Repo.get(Thread, id) |> Repo.preload(members: :user)

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
    limit  = @page_size

    query =
      from m in Message,
        where: m.thread_id == ^thread_id,
        order_by: [desc: m.inserted_at, desc: m.id],
        limit: ^(limit + 1),
        preload: [:user]

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

        message = Repo.preload(message, :user)

        # Notify all other members in real-time
        thread_with_members = Repo.preload(thread, :members)
        sender = message.user
        Enum.each(thread_with_members.members, fn member ->
          if member.user_id != user_id do
            Task.start(fn ->
              Nexus.Notifications.enqueue_dm_notification(%{
                user_id: member.user_id,
                actor_id: user_id,
                actor: sender,
                thread_id: thread.id
              })
            end)
          end
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
