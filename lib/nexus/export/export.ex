defmodule Nexus.Export do
  @moduledoc """
  Builds a ZIP archive containing a user's personal data export.

  Archive structure:
    nexus-export-YYYY-MM-DD/
      profile.json   — profile, account metadata
      posts.csv      — posts authored by the user (with space name)
      replies.csv    — replies authored by the user
      messages.csv   — direct/group messages sent by the user
      badges.csv     — badges awarded to the user
  """

  import Ecto.Query
  alias Nexus.Repo

  @doc """
  Builds and returns an in-memory ZIP binary for the given user.
  Returns {:ok, filename, zip_binary} or {:error, reason}.
  """
  def build(user) do
    date     = Date.utc_today() |> Date.to_iso8601()
    dir      = "nexus-export-#{date}"

    profile_json = build_profile_json(user)
    posts_csv    = build_posts_csv(user)
    replies_csv  = build_replies_csv(user)
    messages_csv = build_messages_csv(user)
    badges_csv   = build_badges_csv(user)

    entries = [
      {~c"#{dir}/profile.json", profile_json},
      {~c"#{dir}/posts.csv",    posts_csv},
      {~c"#{dir}/replies.csv",  replies_csv},
      {~c"#{dir}/messages.csv", messages_csv},
      {~c"#{dir}/badges.csv",   badges_csv},
    ]

    case :zip.create(~c"#{dir}.zip", entries, [:memory]) do
      {:ok, {_name, zip_binary}} -> {:ok, "#{dir}.zip", zip_binary}
      {:error, reason}           -> {:error, reason}
    end
  end

  # ---------------------------------------------------------------------------
  # profile.json
  # ---------------------------------------------------------------------------

  defp build_profile_json(user) do
    data = %{
      id:         user.id,
      username:   user.username,
      email:      user.email,
      bio:        user.bio,
      role:       user.role,
      joined_at:  dt(user.inserted_at),
      exported_at: DateTime.utc_now() |> DateTime.to_iso8601()
    }
    Jason.encode!(data, pretty: true)
  end

  # ---------------------------------------------------------------------------
  # posts.csv — id, title, space, created_at, body
  # ---------------------------------------------------------------------------

  defp build_posts_csv(user) do
    rows =
      Repo.all(
        from p in Nexus.Forum.Post,
          join: s in Nexus.Forum.Space, on: s.id == p.space_id,
          where: p.user_id == ^user.id,
          order_by: [asc: p.inserted_at],
          select: %{
            id:         p.id,
            title:      p.title,
            space:      s.name,
            body:       p.body,
            created_at: p.inserted_at
          }
      )

    headers = ["id", "title", "space", "created_at", "body"]
    rows_data = Enum.map(rows, fn r ->
      [r.id, r.title, r.space, dt(r.created_at), r.body]
    end)
    to_csv(headers, rows_data)
  end

  # ---------------------------------------------------------------------------
  # replies.csv — id, post_id, created_at, body
  # ---------------------------------------------------------------------------

  defp build_replies_csv(user) do
    rows =
      Repo.all(
        from r in Nexus.Forum.Reply,
          where: r.user_id == ^user.id,
          order_by: [asc: r.inserted_at],
          select: %{
            id:         r.id,
            post_id:    r.post_id,
            body:       r.body,
            created_at: r.inserted_at
          }
      )

    headers = ["id", "post_id", "created_at", "body"]
    rows_data = Enum.map(rows, fn r ->
      [r.id, r.post_id, dt(r.created_at), r.body]
    end)
    to_csv(headers, rows_data)
  end

  # ---------------------------------------------------------------------------
  # messages.csv — thread_id, thread_name, kind, sent_at, body
  # Only the user's own sent messages — never other participants' content.
  # ---------------------------------------------------------------------------

  defp build_messages_csv(user) do
    rows =
      Repo.all(
        from m in Nexus.Messaging.Message,
          join: t in Nexus.Messaging.Thread, on: t.id == m.thread_id,
          where: m.user_id == ^user.id,
          order_by: [asc: m.inserted_at],
          select: %{
            thread_id:   t.id,
            thread_name: t.name,
            kind:        t.kind,
            body:        m.body,
            sent_at:     m.inserted_at
          }
      )

    headers = ["thread_id", "thread_name", "kind", "sent_at", "body"]
    rows_data = Enum.map(rows, fn r ->
      [r.thread_id, r.thread_name || "", r.kind, dt(r.sent_at), r.body]
    end)
    to_csv(headers, rows_data)
  end

  # ---------------------------------------------------------------------------
  # badges.csv — badge, awarded_at
  # ---------------------------------------------------------------------------

  defp build_badges_csv(user) do
    rows =
      Repo.all(
        from ub in Nexus.Badges.UserBadge,
          join: b in Nexus.Badges.Badge, on: b.id == ub.badge_id,
          where: ub.user_id == ^user.id,
          order_by: [asc: ub.awarded_at],
          select: %{
            badge:      b.name,
            awarded_at: ub.awarded_at
          }
      )

    headers = ["badge", "awarded_at"]
    rows_data = Enum.map(rows, fn r ->
      [r.badge, dt(r.awarded_at)]
    end)
    to_csv(headers, rows_data)
  end

  # ---------------------------------------------------------------------------
  # CSV helpers
  # ---------------------------------------------------------------------------

  defp to_csv(headers, rows) do
    [csv_row(headers) | Enum.map(rows, &csv_row/1)]
    |> Enum.join("\r\n")
  end

  defp csv_row(fields) do
    fields
    |> Enum.map(&csv_field/1)
    |> Enum.join(",")
  end

  # RFC 4180: wrap in double-quotes if the value contains a comma, double-quote,
  # or newline. Escape existing double-quotes by doubling them.
  defp csv_field(nil),   do: ""
  defp csv_field(val) when is_integer(val), do: Integer.to_string(val)
  defp csv_field(val) do
    str = to_string(val)
    if String.contains?(str, [",", "\"", "\n", "\r"]) do
      "\"#{String.replace(str, "\"", "\"\"")}\""
    else
      str
    end
  end

  # ---------------------------------------------------------------------------
  # DateTime helpers
  # ---------------------------------------------------------------------------

  defp dt(nil),                    do: ""
  defp dt(%DateTime{} = d),        do: DateTime.to_iso8601(d)
  defp dt(%NaiveDateTime{} = d),   do: NaiveDateTime.to_iso8601(d)
end
