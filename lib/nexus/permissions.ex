defmodule Nexus.Permissions do
  @moduledoc """
  Helpers for checking forum permission settings.
  All settings are read from the admin settings store.
  """

  alias Nexus.Admin

  def registration_open? do
    Admin.get_setting("registration")["open"] != false
  end

  def require_email_verification? do
    Admin.get_setting("registration")["require_email_verification"] == true
  end

  def guest_browsing? do
    Admin.get_setting("posting")["guest_browsing"] != false
  end

  def instant_post? do
    Admin.get_setting("posting")["instant_post"] != false
  end

  def min_account_age_hours do
    Admin.get_setting("registration")["min_account_age_hours"] || 0
  end

  def max_posts_per_hour do
    Admin.get_setting("posting")["max_posts_per_hour"] || 0
  end

  def who_can_create_spaces do
    Admin.get_setting("posting")["who_can_create_spaces"] || "admin"
  end

  def who_can_upload do
    Admin.get_setting("posting")["who_can_upload"] || "member"
  end

  @doc "Check if a user account is old enough to post."
  def account_old_enough?(user) do
    min_hours = min_account_age_hours()
    if min_hours == 0 do
      true
    else
      age_hours = DateTime.diff(DateTime.utc_now(), user.inserted_at, :second) / 3600
      age_hours >= min_hours
    end
  end

  @doc "Check if a user can post (combining instant_post and account age)."
  def can_post_immediately?(user) do
    instant_post?() && account_old_enough?(user)
  end

  @doc "Check if users are allowed to react to their own posts and replies."
  def allow_self_reactions? do
    Admin.get_setting("posting")["allow_self_reactions"] != false
  end

  @doc """
  Checks whether `user` is allowed to upload post images.

  The `who_can_upload` setting supports two formats:

    - A plain role string (legacy / simple case):
        "member" | "moderator" | "admin"

    - A structured map (role + optional group slugs):
        %{"role" => "member", "groups" => ["donors", "supporters"]}

  Access is granted when EITHER condition is met:
    1. The user's role meets or exceeds the required role level, OR
    2. The user belongs to any of the listed group slugs.

  Admins and moderators always pass the role check implicitly when the
  required role is "member" (since their level is higher).
  """
  @spec can_upload?(user :: map() | nil) :: boolean()
  def can_upload?(nil), do: false
  def can_upload?(user) do
    setting = who_can_upload()
    {required_role, group_slugs} = parse_gate(setting)
    role_passes?(user, required_role) or group_passes?(user, group_slugs)
  end

  # ---------------------------------------------------------------------------
  # Private helpers shared by can_upload? and future gate helpers
  # ---------------------------------------------------------------------------

  # Parses a gate value into {required_role, [group_slugs]}.
  # Accepts both legacy plain strings and the new structured map format.
  defp parse_gate(str) when is_binary(str), do: {str, []}
  defp parse_gate(%{"role" => role, "groups" => groups}) when is_list(groups), do: {role, groups}
  defp parse_gate(%{"role" => role}), do: {role, []}
  defp parse_gate(_), do: {"member", []}

  @role_levels %{"everyone" => 0, "member" => 1, "moderator" => 2, "admin" => 3}

  defp role_passes?(%{role: "admin"},     _required),      do: true
  defp role_passes?(%{role: "moderator"}, "admin"),         do: false
  defp role_passes?(%{role: "moderator"}, _required),      do: true
  defp role_passes?(%{role: _},           required) do
    Map.get(@role_levels, required, 1) <= @role_levels["member"]
  end

  defp group_passes?(_user, []), do: false
  defp group_passes?(user, slugs) do
    Nexus.Groups.user_in_any_group?(user, slugs)
  end
end
