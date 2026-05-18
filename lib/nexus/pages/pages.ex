defmodule Nexus.Pages do
  @moduledoc """
  Context for static pages (privacy policy, community guidelines, etc.).
  Pages are authored in Markdown and served at /p/:slug.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Pages.Page

  # ---------------------------------------------------------------------------
  # Public
  # ---------------------------------------------------------------------------

  @doc "Returns a published page by slug, or nil if not found / not published."
  def get_published_page(slug) do
    Repo.get_by(Page, slug: slug, published: true)
  end

  # ---------------------------------------------------------------------------
  # Admin
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
end
