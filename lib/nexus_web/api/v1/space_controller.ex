defmodule NexusWeb.API.V1.SpaceController do
  use NexusWeb, :controller

  alias Nexus.Forum
  alias Nexus.Accounts.User

  # GET /api/v1/spaces
  def index(conn, _params) do
    spaces =
      if conn.assigns[:current_user] && User.moderator?(conn.assigns.current_user) do
        Forum.list_all_spaces()
      else
        Forum.list_spaces()
      end

    json(conn, %{spaces: Enum.map(spaces, &space_json/1)})
  end

  # GET /api/v1/spaces/:slug
  def show(conn, %{"slug" => slug}) do
    case Forum.get_space_by_slug(slug) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "Space not found"})

      space ->
        subscribed = case conn.assigns[:current_user] do
          nil -> false
          user -> Forum.subscribed_to_space?(user.id, space.id)
        end
        json(conn, %{space: Map.put(space_json(space), :subscribed, subscribed)})
    end
  end

  # POST /api/v1/spaces  (admin only)
  def create(conn, params) do
    case Forum.create_space(params, conn.assigns.current_user) do
      {:ok, space} ->
        conn |> put_status(:created) |> json(%{space: space_json(space)})

      {:error, changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
    end
  end

  # PATCH /api/v1/spaces/:slug  (admin only)
  def update(conn, %{"slug" => slug} = params) do
    case Forum.get_space_by_slug(slug) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "Space not found"})

      space ->
        case Forum.update_space(space, params) do
          {:ok, updated} -> json(conn, %{space: space_json(updated)})
          {:error, cs}   -> conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(cs)})
        end
    end
  end

  # DELETE /api/v1/spaces/:slug  (admin only)
  def delete(conn, %{"slug" => slug}) do
    case Forum.get_space_by_slug(slug) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "Space not found"})

      space ->
        {:ok, _} = Forum.delete_space(space)
        json(conn, %{ok: true})
    end
  end

  # POST /api/v1/spaces/:slug/subscribe
  def subscribe(conn, %{"slug" => slug}) do
    case Forum.get_space_by_slug(slug) do
      nil -> conn |> put_status(:not_found) |> json(%{error: "Space not found"})
      space ->
        Forum.subscribe_to_space(conn.assigns.current_user.id, space.id)
        json(conn, %{ok: true})
    end
  end

  # DELETE /api/v1/spaces/:slug/subscribe
  def unsubscribe(conn, %{"slug" => slug}) do
    case Forum.get_space_by_slug(slug) do
      nil -> conn |> put_status(:not_found) |> json(%{error: "Space not found"})
      space ->
        Forum.unsubscribe_from_space(conn.assigns.current_user.id, space.id)
        json(conn, %{ok: true})
    end
  end

  defp space_json(space) do
    %{
      id: space.id,
      name: space.name,
      slug: space.slug,
      description: space.description,
      color: space.color,
      icon: space.icon || "fa-layer-group",
      visibility: space.visibility,
      position: space.position,
      post_count: space.post_count
    }
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", if(is_binary(v), do: v, else: inspect(v))) end)
    end)
  end
end
