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
end
