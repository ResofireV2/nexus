defmodule Nexus.Pages do
  @moduledoc """
  Context for static pages (privacy policy, community guidelines, etc.)
  and page widgets (named right-sidebar widget slots that group pages).
  Pages are authored in Markdown and served at /p/:slug.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Pages.Page
  alias Nexus.Pages.PageWidget

  # ---------------------------------------------------------------------------
  # Public
  # ---------------------------------------------------------------------------

  @doc "Returns a published page by slug, or nil if not found / not published."
  def get_published_page(slug) do
    Repo.get_by(Page, slug: slug, published: true)
  end

  # ---------------------------------------------------------------------------
  # Admin — Pages
  # ---------------------------------------------------------------------------

  @doc "Lists all pages ordered by most recently updated."
  def list_pages do
    Repo.all(from p in Page, order_by: [desc: p.updated_at])
  end

  @doc "Gets any page by id regardless of published status."
  def get_page(id), do: Repo.get(Page, id)

  @doc "Gets any page by slug regardless of published status."
  def get_page_by_slug(slug), do: Repo.get_by(Page, slug: slug)

  @doc "Creates a new page."
  def create_page(attrs) do
    %Page{}
    |> Page.changeset(attrs)
    |> Repo.insert()
  end

  @doc "Updates an existing page."
  def update_page(%Page{} = page, attrs) do
    page
    |> Page.changeset(attrs)
    |> Repo.update()
  end

  @doc "Deletes a page."
  def delete_page(%Page{} = page), do: Repo.delete(page)

  # ---------------------------------------------------------------------------
  # Admin — Page Widgets
  # ---------------------------------------------------------------------------

  @doc "Lists all page widgets ordered by position then name."
  def list_widgets do
    Repo.all(from w in PageWidget, order_by: [asc: w.position, asc: w.name])
  end

  @doc "Gets a widget by id."
  def get_widget(id), do: Repo.get(PageWidget, id)

  @doc "Gets a widget by name."
  def get_widget_by_name(name), do: Repo.get_by(PageWidget, name: name)

  @doc "Returns the list of pages assigned to a widget."
  def list_widget_pages(%PageWidget{} = widget) do
    Repo.all(from p in Page, where: p.widget_id == ^widget.id, order_by: [asc: p.title])
  end

  @doc "Creates a new page widget."
  def create_widget(attrs) do
    %PageWidget{}
    |> PageWidget.changeset(attrs)
    |> Repo.insert()
  end

  @doc "Updates an existing page widget."
  def update_widget(%PageWidget{} = widget, attrs) do
    widget
    |> PageWidget.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Deletes a page widget. The `on_pages` option controls what happens to
  assigned pages:
    - `:unassign` (default) — sets widget_id to nil on all assigned pages
    - `:delete` — deletes all assigned pages

  Note: the migration uses `on_delete: :nilify_all` on the FK, so if
  on_pages is `:delete` we must explicitly delete the pages first.
  """
  def delete_widget(%PageWidget{} = widget, on_pages \\ :unassign) do
    case on_pages do
      :delete ->
        Repo.delete_all(from p in Page, where: p.widget_id == ^widget.id)
        Repo.delete(widget)

      _ ->
        # nilify_all fires at the DB level when the widget row is deleted.
        Repo.delete(widget)
    end
  end

  @doc "Returns a list of published pages grouped by their widget. Widgets with no
  published pages are omitted. Each entry is {widget, [page]}."
  def list_published_by_widget do
    pages =
      Repo.all(
        from p in Page,
          join: w in PageWidget, on: p.widget_id == w.id,
          where: p.published == true,
          order_by: [asc: w.position, asc: w.name, asc: p.title],
          preload: [widget: w]
      )

    pages
    |> Enum.group_by(& &1.widget)
    |> Enum.sort_by(fn {w, _} -> {w.position, w.name} end)
  end
end
