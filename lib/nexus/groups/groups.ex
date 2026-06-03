defmodule Nexus.Groups do
  @moduledoc """
  The Groups context.

  Manages custom admin-defined groups for permission gating and optional
  public display (badges on profiles, posts, and user card popovers).
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Groups.{Group, GroupMembership}
  alias Nexus.Accounts.User

  # ---------------------------------------------------------------------------
  # Group CRUD
  # ---------------------------------------------------------------------------

  @doc "Returns all groups ordered by insertion time."
  def list_groups do
    Group
    |> order_by([g], asc: g.inserted_at)
    |> Repo.all()
  end

  @doc "Returns all public groups (public: true)."
  def list_public_groups do
    Group
    |> where([g], g.public == true)
    |> order_by([g], asc: g.inserted_at)
    |> Repo.all()
  end

  def get_group(id), do: Repo.get(Group, id)
  def get_group!(id), do: Repo.get!(Group, id)
  def get_group_by_slug(slug), do: Repo.get_by(Group, slug: slug)

  def create_group(attrs) do
    %Group{}
    |> Group.changeset(attrs)
    |> Repo.insert()
  end

  def update_group(%Group{} = group, attrs) do
    group
    |> Group.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Deletes a group. All memberships are cascade-deleted by the DB foreign key.
  """
  def delete_group(%Group{} = group) do
    Repo.delete(group)
  end

  # ---------------------------------------------------------------------------
  # Member count helpers
  # ---------------------------------------------------------------------------

  @doc "Returns the number of members in a group."
  def member_count(group_id) do
    Repo.aggregate(
      from(m in GroupMembership, where: m.group_id == ^group_id),
      :count
    )
  end

  @doc """
  Returns a map of %{group_id => count} for all groups.
  Used to annotate the group list without N+1 queries.
  """
  def member_counts do
    Repo.all(
      from m in GroupMembership,
      group_by: m.group_id,
      select: {m.group_id, count(m.user_id)}
    )
    |> Map.new()
  end

  # ---------------------------------------------------------------------------
  # Membership queries
  # ---------------------------------------------------------------------------

  @doc "Lists all memberships for a group, preloading the user."
  def list_members(group_id) do
    GroupMembership
    |> where([m], m.group_id == ^group_id)
    |> order_by([m], desc: m.inserted_at)
    |> preload(:user)
    |> Repo.all()
  end

  @doc "Returns the group_ids a user belongs to."
  def user_group_ids(user_id) do
    Repo.all(
      from m in GroupMembership,
      where: m.user_id == ^user_id,
      select: m.group_id
    )
  end

  @doc """
  Returns the public groups a user belongs to, for badge display.
  Only returns groups where public is true.
  """
  def public_groups_for_user(user_id) do
    Repo.all(
      from m in GroupMembership,
      join: g in Group, on: g.id == m.group_id,
      where: m.user_id == ^user_id and g.public == true,
      select: g,
      order_by: [asc: g.inserted_at]
    )
  end

  @doc "Returns true if the user is a member of the given group."
  def member?(%User{id: user_id}, group_id), do: member?(user_id, group_id)
  def member?(user_id, group_id) do
    Repo.exists?(
      from m in GroupMembership,
      where: m.group_id == ^group_id and m.user_id == ^user_id
    )
  end

  # ---------------------------------------------------------------------------
  # Membership management
  # ---------------------------------------------------------------------------

  @doc """
  Adds a user to a group. Idempotent — silently succeeds if already a member.
  Returns {:ok, membership} or {:ok, :already_member} or {:error, changeset}.
  """
  def add_member(group_id, user_id) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    result =
      %GroupMembership{}
      |> GroupMembership.changeset(%{
        group_id:    group_id,
        user_id:     user_id,
        inserted_at: now
      })
      |> Repo.insert(on_conflict: :nothing, conflict_target: [:group_id, :user_id])

    case result do
      {:ok, %GroupMembership{id: nil}} -> {:ok, :already_member}
      other                            -> other
    end
  end

  @doc """
  Removes a user from a group.
  Returns {:ok, membership} or {:error, :not_found}.
  """
  def remove_member(group_id, user_id) do
    case Repo.get_by(GroupMembership, group_id: group_id, user_id: user_id) do
      nil        -> {:error, :not_found}
      membership -> Repo.delete(membership)
    end
  end

  # ---------------------------------------------------------------------------
  # Permission check
  # ---------------------------------------------------------------------------

  @doc """
  Checks whether a user is in any of the given group slugs.
  Used by the permissions system to evaluate group-based gates.

  `user` may be nil (guest) — always returns false.
  `slugs` is a list of group slug strings.
  """
  def user_in_any_group?(nil, _slugs), do: false
  def user_in_any_group?(_user, []), do: false
  def user_in_any_group?(%User{id: user_id}, slugs) do
    Repo.exists?(
      from m in GroupMembership,
      join: g in Group, on: g.id == m.group_id,
      where: m.user_id == ^user_id and g.slug in ^slugs
    )
  end
end
