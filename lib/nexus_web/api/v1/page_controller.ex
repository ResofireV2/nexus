defmodule NexusWeb.API.V1.PageController do
  use NexusWeb, :controller
  alias Nexus.Pages

  # GET /api/v1/pages/:slug — public, published only
  def show(conn, %{"slug" => slug}) do
    case Pages.get_published_page(slug) do
      nil  -> conn |> put_status(:not_found) |> json(%{error: "Page not found"})
      page -> json(conn, %{page: serialize(page)})
    end
  end

  # GET /api/v1/admin/pages — admin
  def index(conn, _params) do
    pages = Pages.list_pages()
    json(conn, %{pages: Enum.map(pages, &serialize/1)})
  end

  # POST /api/v1/admin/pages — admin
  def create(conn, %{"page" => attrs}) do
    case Pages.create_page(attrs) do
      {:ok, page}    -> conn |> put_status(:created) |> json(%{page: serialize(page)})
      {:error, cs}   -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
    end
  end

  # PATCH /api/v1/admin/pages/:id — admin
  def update(conn, %{"id" => id, "page" => attrs}) do
    case Pages.get_page(id) do
      nil  -> conn |> put_status(:not_found) |> json(%{error: "Page not found"})
      page ->
        case Pages.update_page(page, attrs) do
          {:ok, updated} -> json(conn, %{page: serialize(updated)})
          {:error, cs}   -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
        end
    end
  end

  # DELETE /api/v1/admin/pages/:id — admin
  def delete(conn, %{"id" => id}) do
    case Pages.get_page(id) do
      nil  -> conn |> put_status(:not_found) |> json(%{error: "Page not found"})
      page ->
        Pages.delete_page(page)
        json(conn, %{ok: true})
    end
  end

  defp serialize(page) do
    %{
      id:         page.id,
      slug:       page.slug,
      title:      page.title,
      body:       page.body,
      published:  page.published,
      inserted_at: page.inserted_at,
      updated_at:  page.updated_at
    }
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", to_string(value))
      end)
    end)
  end
end
