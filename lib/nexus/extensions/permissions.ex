defmodule Nexus.Extensions.Permissions do
  @moduledoc """
  Server-side helpers for checking extension-declared permission gates.

  Permission values are stored as keys in the extension's settings map,
  alongside any other extension settings. The gate supports two formats:

  ## Legacy format (plain string)

    - "everyone"   — guests and logged-in users (respects guest_browsing setting)
    - "member"     — any logged-in user regardless of role
    - "moderator"  — moderators and admins
    - "admin"      — admins only

  ## Structured format (role + optional group slugs)

    %{"role" => "member", "groups" => ["donors", "supporters"]}

  With the structured format, access is granted when EITHER the user's role
  meets the required level OR the user belongs to any of the listed groups.
  Plain string values continue to work exactly as before — no migration needed.

  ## Usage in an extension controller

      def show(conn, %{"id" => id}) do
        user = conn.assigns[:current_user]  # nil for guests

        case Nexus.Extensions.Permissions.check("gallery", "can_view_gallery", user) do
          :ok    -> # proceed
          :error -> conn |> put_status(:forbidden) |> json(%{error: "Access denied"})
        end
      end

  ## Default values

  If a permission key has never been saved by the admin, the default declared
  in the manifest is used. If no default was declared, "member" is assumed.
  """

  alias Nexus.Extensions
  alias Nexus.Permissions, as: CorePermissions

  @levels %{
    "everyone"  => 0,
    "member"    => 1,
    "moderator" => 2,
    "admin"     => 3
  }

  @doc """
  Checks whether `user` meets the permission gate configured for `key` on
  the extension identified by `slug`.

  Returns `:ok` if access is granted, `:error` if denied.

  `user` may be `nil` for unauthenticated requests.
  """
  @spec check(slug :: String.t(), key :: String.t(), user :: map() | nil) :: :ok | :error
  def check(slug, key, user) do
    gate = raw_gate(slug, key)

    if gate_passes?(gate, user), do: :ok, else: :error
  end

  @doc """
  Returns the configured permission level for a key as a string.
  Falls back to the manifest default, then to "member".

  When the saved value is a structured map, returns the `role` field only.
  This function is retained for backward compatibility with any extension code
  that reads the level string directly. For full gate evaluation including
  group membership, use `check/3`.
  """
  @spec required_level_string(slug :: String.t(), key :: String.t()) :: String.t()
  def required_level_string(slug, key) do
    case raw_gate(slug, key) do
      str when is_binary(str)         -> str
      %{"role" => role}               -> role
      _                               -> "member"
    end
  end

  # ---------------------------------------------------------------------------
  # Private
  # ---------------------------------------------------------------------------

  # Returns the raw saved gate value — either a plain string or a structured
  # map. Falls back to the manifest default, then to "member".
  defp raw_gate(slug, key) do
    case Extensions.get_extension_by_slug(slug) do
      nil -> "member"
      ext ->
        saved   = (ext.settings || %{})[key]
        default = manifest_default(ext, key)
        saved || default || "member"
    end
  end

  # Evaluates a gate value against a user.
  # Gate may be a plain string (legacy) or a structured map.
  defp gate_passes?(gate, user) when is_binary(gate) do
    required = Map.get(@levels, gate, @levels["member"])
    user_level(user) >= required
  end

  defp gate_passes?(%{"role" => role, "groups" => groups}, user) when is_list(groups) do
    required = Map.get(@levels, role, @levels["member"])
    role_passes = user_level(user) >= required
    group_passes = not Enum.empty?(groups) and group_member?(user, groups)
    role_passes or group_passes
  end

  defp gate_passes?(%{"role" => role}, user) do
    required = Map.get(@levels, role, @levels["member"])
    user_level(user) >= required
  end

  # Fallback for any unexpected format — treat as "member"
  defp gate_passes?(_gate, user) do
    user_level(user) >= @levels["member"]
  end

  defp user_level(nil) do
    # Guest — only passes "everyone", and only if guest_browsing is enabled.
    if CorePermissions.guest_browsing?(), do: 0, else: -1
  end

  defp user_level(%{role: "admin"}),      do: @levels["admin"]
  defp user_level(%{role: "moderator"}),  do: @levels["moderator"]
  defp user_level(%{role: _}),            do: @levels["member"]

  defp group_member?(nil, _slugs), do: false
  defp group_member?(user, slugs) do
    Nexus.Groups.user_in_any_group?(user, slugs)
  end

  defp manifest_default(ext, key) do
    manifest = ext.manifest || %{}
    permissions = manifest["permissions"] || []

    case Enum.find(permissions, &(&1["key"] == key)) do
      nil   -> nil
      entry -> entry["default"]
    end
  end
end
