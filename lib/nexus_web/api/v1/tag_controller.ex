defmodule NexusWeb.API.V1.TagController do
  use NexusWeb, :controller

  alias Nexus.Forum

  # GET /api/v1/tags
  def index(conn, _params) do
    tags = Forum.list_tags()
    json(conn, %{tags: Enum.map(tags, &tag_json/1)})
  end

  # POST /api/v1/tags  (moderator+)
  def create(conn, params) do
    case Forum.create_tag(params) do
      {:ok, tag} ->
        conn |> put_status(:created) |> json(%{tag: tag_json(tag)})

      {:error, changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
    end
  end

  # PATCH /api/v1/tags/:slug  (moderator+)
  def update(conn, %{"slug" => slug} = params) do
    case Forum.get_tag_by_slug(slug) do
      nil -> conn |> put_status(:not_found) |> json(%{error: "Tag not found"})
      tag ->
        case Forum.update_tag(tag, params) do
          {:ok, updated} -> json(conn, %{tag: tag_json(updated)})
          {:error, cs}   -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
        end
    end
  end

  # DELETE /api/v1/tags/:slug  (moderator+)
  def delete(conn, %{"slug" => slug}) do
    case Forum.get_tag_by_slug(slug) do
      nil -> conn |> put_status(:not_found) |> json(%{error: "Tag not found"})
      tag ->
        {:ok, _} = Forum.delete_tag(tag)
        json(conn, %{ok: true})
    end
  end

  # POST /api/v1/tags/:slug/subscribe
  def subscribe(conn, %{"slug" => slug}) do
    case Forum.get_tag_by_slug(slug) do
      nil -> conn |> put_status(:not_found) |> json(%{error: "Tag not found"})
      tag ->
        Forum.subscribe_to_tag(conn.assigns.current_user.id, tag.id)
        json(conn, %{ok: true})
    end
  end

  # DELETE /api/v1/tags/:slug/subscribe
  def unsubscribe(conn, %{"slug" => slug}) do
    case Forum.get_tag_by_slug(slug) do
      nil -> conn |> put_status(:not_found) |> json(%{error: "Tag not found"})
      tag ->
        Forum.unsubscribe_from_tag(conn.assigns.current_user.id, tag.id)
        json(conn, %{ok: true})
    end
  end

  defp tag_json(tag) do
    %{
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
      color: tag.color,
      post_count: tag.post_count
    }
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", to_string(v)) end)
    end)
  end
end
