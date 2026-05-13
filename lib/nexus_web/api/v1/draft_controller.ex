defmodule NexusWeb.API.V1.DraftController do
  use NexusWeb, :controller

  alias Nexus.Drafts

  # GET /api/v1/drafts
  def index(conn, _params) do
    user   = conn.assigns.current_user
    drafts = Drafts.list_drafts(user.id)
    json(conn, %{drafts: Enum.map(drafts, &draft_json/1)})
  end

  # GET /api/v1/drafts/count
  def count(conn, _params) do
    user  = conn.assigns.current_user
    count = Drafts.count_drafts(user.id)
    json(conn, %{count: count})
  end

  # POST /api/v1/drafts
  def create(conn, params) do
    user  = conn.assigns.current_user
    attrs = %{
      "type"      => params["type"]      || "post",
      "title"     => params["title"],
      "body"      => params["body"]      || "",
      "post_type" => params["post_type"] || "discussion",
      "space_id"  => params["space_id"],
      "post_id"   => params["post_id"],
      "tag_ids"   => params["tag_ids"]   || [],
    }

    case Drafts.create_draft(user.id, attrs) do
      {:ok, draft} ->
        json(conn, %{ok: true, draft: %{id: draft.id, updated_at: draft.updated_at}})
      {:error, :limit_reached} ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "Draft limit reached (50 max)"})
      {:error, changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: format_errors(changeset)})
    end
  end

  # PATCH /api/v1/drafts/:id
  def update(conn, %{"id" => id} = params) do
    user = conn.assigns.current_user

    case Drafts.get_draft(id, user.id) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "Draft not found"})

      draft ->
        attrs = params
        |> Map.take(~w(title body post_type space_id post_id tag_ids))
        |> Map.reject(fn {_, v} -> is_nil(v) end)

        case Drafts.update_draft(draft, attrs) do
          {:ok, updated} ->
            json(conn, %{ok: true, draft: %{id: updated.id, updated_at: updated.updated_at}})
          {:error, changeset} ->
            conn |> put_status(:unprocessable_entity) |> json(%{error: format_errors(changeset)})
        end
    end
  end

  # DELETE /api/v1/drafts/:id
  def delete(conn, %{"id" => id}) do
    user = conn.assigns.current_user

    case Drafts.get_draft(id, user.id) do
      nil   -> conn |> put_status(:not_found) |> json(%{error: "Draft not found"})
      draft ->
        Drafts.delete_draft(draft)
        json(conn, %{ok: true})
    end
  end

  # DELETE /api/v1/drafts (delete all)
  def delete_all(conn, _params) do
    user = conn.assigns.current_user
    Drafts.delete_all_drafts(user.id)
    json(conn, %{ok: true})
  end

  # ── Helpers ──────────────────────────────────────────────────────────────────

  defp draft_json(d) do
    %{
      id:          d.id,
      type:        d.type,
      title:       d.title,
      body:        d.body,
      post_type:   d.post_type,
      space_id:    d.space_id,
      post_id:     d.post_id,
      tag_ids:     d.tag_ids || [],
      updated_at:  d.updated_at,
      inserted_at: d.inserted_at,
      space: d.space_name && %{
        name:  d.space_name,
        slug:  d.space_slug,
        color: d.space_color,
      },
      post: d.post_title && %{
        id:    d.post_id,
        title: d.post_title,
      },
    }
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", if(is_binary(value), do: value, else: inspect(value)))
      end)
    end)
    |> Enum.map(fn {k, v} -> "#{k}: #{Enum.join(v, ", ")}" end)
    |> Enum.join("; ")
  end
end
