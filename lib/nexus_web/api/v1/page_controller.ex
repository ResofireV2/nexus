defmodule NexusWeb.API.V1.PageController do
  use NexusWeb, :controller
  alias Nexus.Pages
  alias Nexus.Pages.PageWidget

  # ---------------------------------------------------------------------------
  # Public
  # ---------------------------------------------------------------------------

  # GET /api/v1/pages/:slug — published pages only, no auth required
  def show(conn, %{"slug" => slug}) do
    case Pages.get_published_page(slug) do
      nil  -> conn |> put_status(:not_found) |> json(%{error: "Page not found"})
      page -> json(conn, %{page: serialize_page(page)})
    end
  end

  # GET /api/v1/pages/widgets — returns all widgets with their published pages
  # Used by the public sidebar to render Page Widgets.
  def widgets_public(conn, _params) do
    grouped = Pages.list_published_by_widget()
    data = Enum.map(grouped, fn {widget, pages} ->
      %{
        id:    widget.id,
        name:  widget.name,
        pages: Enum.map(pages, fn p -> %{title: p.title, slug: p.slug} end)
      }
    end)
    json(conn, %{widgets: data})
  end

  # ---------------------------------------------------------------------------
  # Admin — Pages
  # ---------------------------------------------------------------------------

  # GET /api/v1/admin/pages
  def index(conn, _params) do
    pages = Pages.list_pages()
    json(conn, %{pages: Enum.map(pages, &serialize_page/1)})
  end

  # POST /api/v1/admin/pages
  def create(conn, %{"page" => attrs}) do
    case Pages.create_page(attrs) do
      {:ok, page}  -> conn |> put_status(:created) |> json(%{page: serialize_page(page)})
      {:error, cs} -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
    end
  end

  # PATCH /api/v1/admin/pages/:id
  def update(conn, %{"id" => id, "page" => attrs}) do
    case Pages.get_page(id) do
      nil  -> conn |> put_status(:not_found) |> json(%{error: "Page not found"})
      page ->
        case Pages.update_page(page, attrs) do
          {:ok, updated} -> json(conn, %{page: serialize_page(updated)})
          {:error, cs}   -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
        end
    end
  end

  # DELETE /api/v1/admin/pages/:id
  def delete(conn, %{"id" => id}) do
    case Pages.get_page(id) do
      nil  -> conn |> put_status(:not_found) |> json(%{error: "Page not found"})
      page ->
        Pages.delete_page(page)
        json(conn, %{ok: true})
    end
  end

  # ---------------------------------------------------------------------------
  # Admin — Page Widgets
  # ---------------------------------------------------------------------------

  # GET /api/v1/admin/page-widgets
  def widget_index(conn, _params) do
    widgets = Pages.list_widgets()
    json(conn, %{widgets: Enum.map(widgets, &serialize_widget/1)})
  end

  # POST /api/v1/admin/page-widgets
  def widget_create(conn, %{"widget" => attrs}) do
    case Pages.create_widget(attrs) do
      {:ok, widget} -> conn |> put_status(:created) |> json(%{widget: serialize_widget(widget)})
      {:error, cs}  -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
    end
  end

  # PATCH /api/v1/admin/page-widgets/:id
  def widget_update(conn, %{"id" => id, "widget" => attrs}) do
    case Pages.get_widget(id) do
      nil    -> conn |> put_status(:not_found) |> json(%{error: "Widget not found"})
      widget ->
        case Pages.update_widget(widget, attrs) do
          {:ok, updated} -> json(conn, %{widget: serialize_widget(updated)})
          {:error, cs}   -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
        end
    end
  end

  # DELETE /api/v1/admin/page-widgets/:id
  # Accepts optional body: {"on_pages": "unassign"|"delete"}
  def widget_delete(conn, %{"id" => id} = params) do
    case Pages.get_widget(id) do
      nil    -> conn |> put_status(:not_found) |> json(%{error: "Widget not found"})
      widget ->
        on_pages = case params["on_pages"] do
          "delete" -> :delete
          _        -> :unassign
        end
        case Pages.delete_widget(widget, on_pages) do
          {:ok, _}     -> json(conn, %{ok: true})
          {:error, cs} -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
        end
    end
  end

  # GET /api/v1/admin/page-widgets/:id/pages
  # Returns all pages assigned to this widget (for the delete confirmation modal).
  def widget_pages(conn, %{"id" => id}) do
    case Pages.get_widget(id) do
      nil    -> conn |> put_status(:not_found) |> json(%{error: "Widget not found"})
      widget ->
        pages = Pages.list_widget_pages(widget)
        json(conn, %{pages: Enum.map(pages, &serialize_page/1)})
    end
  end

  # ---------------------------------------------------------------------------
  # Serializers
  # ---------------------------------------------------------------------------

  defp serialize_page(page) do
    %{
      id:          page.id,
      slug:        page.slug,
      title:       page.title,
      body:        page.body,
      published:   page.published,
      widget_id:   page.widget_id,
      inserted_at: page.inserted_at,
      updated_at:  page.updated_at
    }
  end

  defp serialize_widget(widget) do
    %{
      id:       widget.id,
      name:     widget.name,
      position: widget.position
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
