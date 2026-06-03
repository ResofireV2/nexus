defmodule NexusWeb.API.V1.GroupController do
  use NexusWeb, :controller

  alias Nexus.Groups
  alias Nexus.Accounts

  # ---------------------------------------------------------------------------
  # Admin — Group CRUD
  # ---------------------------------------------------------------------------

  # GET /api/v1/admin/groups
  def index(conn, _params) do
    groups = Groups.list_groups()
    counts = Groups.member_counts()

    json(conn, %{
      groups: Enum.map(groups, fn g ->
        group_json(g) |> Map.put(:member_count, Map.get(counts, g.id, 0))
      end)
    })
  end

  # POST /api/v1/admin/groups
  def create(conn, params) do
    attrs = Map.take(params, [
      "name", "slug", "description",
      "public",
      "badge_label", "badge_color", "badge_icon",
      "show_on_profile", "show_on_posts", "show_on_popover"
    ])

    case Groups.create_group(attrs) do
      {:ok, group} ->
        conn |> put_status(:created) |> json(%{group: group_json(group)})

      {:error, changeset} ->
        conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
    end
  end

  # PATCH /api/v1/admin/groups/:id
  def update(conn, %{"id" => id} = params) do
    case Groups.get_group(id) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "Group not found"})

      group ->
        attrs = Map.take(params, [
          "name", "slug", "description",
          "public",
          "badge_label", "badge_color", "badge_icon",
          "show_on_profile", "show_on_posts", "show_on_popover"
        ])

        case Groups.update_group(group, attrs) do
          {:ok, updated}     -> json(conn, %{group: group_json(updated)})
          {:error, changeset} ->
            conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
        end
    end
  end

  # DELETE /api/v1/admin/groups/:id
  def delete(conn, %{"id" => id}) do
    case Groups.get_group(id) do
      nil   -> conn |> put_status(:not_found) |> json(%{error: "Group not found"})
      group ->
        {:ok, _} = Groups.delete_group(group)
        json(conn, %{ok: true})
    end
  end

  # ---------------------------------------------------------------------------
  # Admin — Member management
  # ---------------------------------------------------------------------------

  # GET /api/v1/admin/groups/:id/members
  def members(conn, %{"id" => id}) do
    case Groups.get_group(id) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "Group not found"})

      _group ->
        memberships = Groups.list_members(id)
        json(conn, %{
          members: Enum.map(memberships, fn m ->
            %{
              user_id:    m.user.id,
              username:   m.user.username,
              avatar_url: m.user.avatar_url,
              avatar_color: m.user.avatar_color,
              added_at:   m.inserted_at
            }
          end)
        })
    end
  end

  # POST /api/v1/admin/groups/:id/members
  # Body: { "username": "..." }
  def add_member(conn, %{"id" => id, "username" => username}) do
    with group when not is_nil(group) <- Groups.get_group(id),
         user  when not is_nil(user)  <- Accounts.get_user_by_username(username) do
      case Groups.add_member(group.id, user.id) do
        {:ok, :already_member} ->
          conn |> put_status(:conflict) |> json(%{error: "User is already a member of this group"})

        {:ok, _membership} ->
          json(conn, %{ok: true})

        {:error, changeset} ->
          conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
      end
    else
      nil -> conn |> put_status(:not_found) |> json(%{error: "Group or user not found"})
    end
  end

  # DELETE /api/v1/admin/groups/:id/members/:user_id
  def remove_member(conn, %{"id" => id, "user_id" => user_id}) do
    case Groups.remove_member(to_integer(id), to_integer(user_id)) do
      {:ok, _}             -> json(conn, %{ok: true})
      {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "Membership not found"})
    end
  end

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------

  defp group_json(g) do
    %{
      id:             g.id,
      name:           g.name,
      slug:           g.slug,
      description:    g.description,
      public:         g.public,
      badge_label:    g.badge_label,
      badge_color:    g.badge_color,
      badge_icon:     g.badge_icon,
      show_on_profile: g.show_on_profile,
      show_on_posts:   g.show_on_posts,
      show_on_popover: g.show_on_popover,
      inserted_at:    g.inserted_at,
      updated_at:     g.updated_at
    }
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc ->
        String.replace(acc, "%{#{k}}", if(is_binary(v), do: v, else: inspect(v)))
      end)
    end)
  end

  defp to_integer(v) when is_integer(v), do: v
  defp to_integer(v) when is_binary(v) do
    case Integer.parse(v) do
      {n, _} -> n
      :error -> nil
    end
  end
  defp to_integer(_), do: nil
end
