defmodule Nexus.Extensions.Permissions do
  @moduledoc """
  Server-side helpers for checking extension-declared permission gates.

  Permission values are stored as keys in the extension's settings map,
  alongside any other extension settings. The four levels are:

    - "everyone"   — guests and logged-in users (respects guest_browsing setting)
    - "member"     — any logged-in user regardless of role
    - "moderator"  — moderators and admins
    - "admin"      — admins only

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
  Checks whether `user` meets the permission level configured for `key` on
  the extension identified by `slug`.

  Returns `:ok` if access is granted, `:error` if denied.

  `user` may be `nil` for unauthenticated requests.
  """
  @spec check(slug :: String.t(), key :: String.t(), user :: map() | nil) :: :ok | :error
  def check(slug, key, user) do
    required = required_level(slug, key)
    actual   = user_level(user)

    if actual >= required, do: :ok, else: :error
  end

  @doc """
  Returns the configured permission level for a key as a string.
  Falls back to the manifest default, then to "member".
  """
  @spec required_level_string(slug :: String.t(), key :: String.t()) :: String.t()
  def required_level_string(slug, key) do
    case Extensions.get_extension_by_slug(slug) do
      nil -> "member"
      ext ->
        saved   = (ext.settings || %{})[key]
        default = manifest_default(ext, key)
        saved || default || "member"
    end
  end

  # ---------------------------------------------------------------------------
  # Private
  # ---------------------------------------------------------------------------

  defp required_level(slug, key) do
    level_int(required_level_string(slug, key))
  end

  defp user_level(nil) do
    # Guest — only passes "everyone", and only if guest_browsing is enabled.
    if CorePermissions.guest_browsing?(), do: 0, else: -1
  end

  defp user_level(%{role: "admin"}),      do: @levels["admin"]
  defp user_level(%{role: "moderator"}),  do: @levels["moderator"]
  defp user_level(%{role: _}),            do: @levels["member"]

  defp level_int(str), do: Map.get(@levels, str, @levels["member"])

  defp manifest_default(ext, key) do
    manifest = ext.manifest || %{}
    permissions = manifest["permissions"] || []

    case Enum.find(permissions, &(&1["key"] == key)) do
      nil   -> nil
      entry -> entry["default"]
    end
  end
end
