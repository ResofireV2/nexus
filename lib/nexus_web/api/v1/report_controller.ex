defmodule NexusWeb.API.V1.ReportController do
  use NexusWeb, :controller

  alias Nexus.Moderation

  # POST /api/v1/reports
  def create(conn, params) do
    attrs = Map.put(params, "reporter_id", conn.assigns.current_user.id)

    case Moderation.create_report(attrs) do
      {:ok, report} ->
        Task.start(fn -> Nexus.Extensions.fire("report_created", %{report_id: report.id}) end)
        conn |> put_status(:created) |> json(%{ok: true})

      {:error, changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
    end
  end

  # GET /api/v1/reports  (moderator+)
  def index(conn, params) do
    status = params["status"] || "pending"
    reports = Moderation.list_reports(status: status)
    json(conn, %{reports: Enum.map(reports, &report_json/1)})
  end

  # PATCH /api/v1/reports/:id  (moderator+)
  def update(conn, %{"id" => id} = params) do
    moderator = conn.assigns.current_user

    case Moderation.get_report(id) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "Report not found"})

      report ->
        case Moderation.review_report(report, moderator, params["status"]) do
          {:ok, updated} -> json(conn, %{report: report_json(updated)})
          {:error, cs}   -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
        end
    end
  end

  defp report_json(report) do
    # Derive content context from the associated post or reply
    {content_type, excerpt, post_id, post_title, space_name, content_user} =
      cond do
        report.post != nil ->
          post = report.post
          body = post.body || ""
          excerpt = body |> String.replace(~r/[#*`>\[\]!]/, "") |> String.slice(0, 280)
          {"post", excerpt, post.id, post.title, post.space && post.space.name, post.user}

        report.reply != nil ->
          reply = report.reply
          body  = reply.body || ""
          excerpt = body |> String.replace(~r/[#*`>\[\]!]/, "") |> String.slice(0, 280)
          {"reply", excerpt, report.post_id, nil, nil, reply.user}

        report.user != nil ->
          {"user", nil, nil, nil, nil, report.user}

        true ->
          {"unknown", nil, report.post_id, nil, nil, nil}
      end

    %{
      id:           report.id,
      reason:       report.reason,
      notes:        report.notes,
      status:       report.status,
      reviewed_at:  report.reviewed_at,
      reporter:     user_json(report.reporter),
      reviewer:     user_json(report.reviewer),
      post_id:      post_id,
      reply_id:     report.reply_id,
      user_id:      report.user_id,
      inserted_at:  report.inserted_at,
      # Content context — gives moderators what they need without navigating away
      content_type: content_type,
      post_title:   post_title,
      excerpt:      excerpt,
      space_name:   space_name,
      content_user: user_json(content_user)
    }
  end

  defp user_json(nil), do: nil
  defp user_json(u), do: %{id: u.id, username: u.username}

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", to_string(v)) end)
    end)
  end
end
