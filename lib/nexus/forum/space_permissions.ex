defmodule Nexus.Forum.SpacePermissions do
  @moduledoc """
  Per-space permission gate evaluation.

  Each space carries a `permissions` map with four keys:

    - "view"  — who can see this space in listings and the sidebar
    - "read"  — who can read posts inside this space
    - "post"  — who can create new top-level posts in this space
    - "reply" — who can reply to existing posts in this space

  Gate values use the same structured format as the rest of the permissions
  system (Nexus.Permissions and Nexus.Extensions.Permissions):

    - A plain role string: "everyone" | "member" | "moderator" | "admin"
    - A structured map:    %{"role" => "member", "groups" => ["staff", "vip"]}

  With the structured format, access is granted when EITHER the role condition
  OR the group membership condition is met.

  Admins and moderators bypass all space permission gates unconditionally,
  consistent with the rest of the codebase.

  Guests (nil user) pass only "everyone" gates, and only when the global
  guest_browsing setting is enabled.
  """

  @role_levels %{
    "everyone"  => 0,
    "member"    => 1,
    "moderator" => 2,
    "admin"     => 3
  }

  @default_gates %{
    "view"  => %{"role" => "everyone", "groups" => []},
    "read"  => %{"role" => "everyone", "groups" => []},
    "post"  => %{"role" => "member",   "groups" => []},
    "reply" => %{"role" => "member",   "groups" => []}
  }

  @doc "Returns true if `user` can see this space in listings and the sidebar."
  @spec can_view?(space :: map(), user :: map() | nil) :: boolean()
  def can_view?(space, user), do: check(space, "view", user)

  @doc "Returns true if `user` can read posts inside this space."
  @spec can_read?(space :: map(), user :: map() | nil) :: boolean()
  def can_read?(space, user), do: check(space, "read", user)

  @doc "Returns true if `user` can create new top-level posts in this space."
  @spec can_post?(space :: map(), user :: map() | nil) :: boolean()
  def can_post?(space, user), do: check(space, "post", user)

  @doc "Returns true if `user` can reply to posts in this space."
  @spec can_reply?(space :: map(), user :: map() | nil) :: boolean()
  def can_reply?(space, user), do: check(space, "reply", user)

  # ---------------------------------------------------------------------------
  # Private
  # ---------------------------------------------------------------------------

  # Guest path: only passes "everyone" gates, and only when guest_browsing is on.
  defp check(space, gate_key, nil) do
    if Nexus.Permissions.guest_browsing?() do
      gate = gate_for(space, gate_key)
      required_role =
        case gate do
          r when is_binary(r)       -> r
          %{"role" => r}            -> r
          _                         -> "member"
        end
      required_role == "everyone"
    else
      false
    end
  end

  # Authenticated user path.
  defp check(space, gate_key, user) do
    # Admins and moderators bypass all space permission gates.
    case user.role do
      r when r in ["admin", "moderator"] ->
        true
      _ ->
        gate = gate_for(space, gate_key)
        evaluate_gate(gate, user)
    end
  end

  defp gate_for(space, key) do
    default = Map.get(@default_gates, key, %{"role" => "member", "groups" => []})
    permissions = space.permissions || %{}
    Map.get(permissions, key, default)
  end

  # Plain string gate
  defp evaluate_gate(role, user) when is_binary(role) do
    required = Map.get(@role_levels, role, @role_levels["member"])
    user_level(user) >= required
  end

  # Structured gate with role + groups list
  defp evaluate_gate(%{"role" => role, "groups" => groups}, user) when is_list(groups) do
    required     = Map.get(@role_levels, role, @role_levels["member"])
    role_passes  = user_level(user) >= required
    group_passes = not Enum.empty?(groups) and group_member?(user, groups)
    role_passes or group_passes
  end

  # Structured gate with role key only
  defp evaluate_gate(%{"role" => role}, user) do
    required = Map.get(@role_levels, role, @role_levels["member"])
    user_level(user) >= required
  end

  # Fallback for unexpected gate formats — treat as "member"
  defp evaluate_gate(_gate, user) do
    user_level(user) >= @role_levels["member"]
  end

  defp user_level(%{role: "admin"}),      do: @role_levels["admin"]
  defp user_level(%{role: "moderator"}),  do: @role_levels["moderator"]
  defp user_level(%{role: _}),            do: @role_levels["member"]

  defp group_member?(nil, _slugs), do: false
  defp group_member?(user, slugs) do
    Nexus.Groups.user_in_any_group?(user, slugs)
  end
end
