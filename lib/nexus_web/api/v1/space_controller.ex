defmodule NexusWeb.API.V1.SpaceController do
  use NexusWeb, :controller

  alias Nexus.Forum
  alias Nexus.Accounts.User

  # POST /api/v1/admin/spaces/reorder  (admin only)
  # Accepts {order: [id, id, id, ...]} and updates the position column on each
  # space so that list_spaces/0 returns them in the correct order everywhere —
  # not just the sidebar which reads from the layout settings.
  def reorder(conn, %{"order" => ids}) when is_list(ids) do
    Forum.reorder_spaces(ids)
    json(conn, %{ok: true})
  end

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
    attrs = build_attrs(params)
    case Forum.create_space(attrs, conn.assigns.current_user) do
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
        attrs = build_attrs(params)
        case Forum.update_space(space, attrs) do
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
      id:          space.id,
      name:        space.name,
      slug:        space.slug,
      description: space.description,
      color:       space.color,
      icon:        space.icon || "fa-layer-group",
      visibility:  space.visibility,
      position:    space.position,
      post_count:  space.post_count,
      parent_id:   space.parent_id
    }
  end

  # Normalise params before passing to the changeset. Converts a JSON-decoded
  # parent_id (may arrive as a string, integer, or nil) to an integer or nil.
  # When a parent_id is set and no colour is explicitly provided, inherit the
  # parent space's colour so sub-spaces always display correctly.
  defp build_attrs(params) do
    parent_id =
      case params["parent_id"] do
        nil  -> nil
        ""   -> nil
        v when is_integer(v) -> v
        v when is_binary(v)  ->
          case Integer.parse(v) do
            {n, _} -> n
            :error -> nil
          end
      end

    params = Map.put(params, "parent_id", parent_id)

    # Inherit parent colour when creating/updating a sub-space that has no
    # explicit colour set. This stores the colour directly on the sub-space so
    # it displays correctly everywhere without runtime fallback logic.
    if parent_id && (is_nil(params["color"]) || params["color"] == "") do
      case Forum.get_space(parent_id) do
        %{color: parent_color} when is_binary(parent_color) and parent_color != "" ->
          Map.put(params, "color", parent_color)
        _ ->
          params
      end
    else
      params
    end
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", if(is_binary(v), do: v, else: inspect(v))) end)
    end)
  end
end
