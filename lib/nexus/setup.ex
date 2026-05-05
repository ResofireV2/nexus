defmodule Nexus.Setup do
  @moduledoc """
  Handles the initial setup wizard state.
  """

  alias Nexus.Admin

  def complete? do
    settings = Admin.get_setting("setup")
    Map.get(settings, "complete", false)
  end

  def current_step do
    settings = Admin.get_setting("setup")
    Map.get(settings, "step", 0)
  end

  def mark_complete do
    Admin.update_setting("setup", %{"complete" => true, "step" => 3})
  end

  def advance_step(step) do
    Admin.update_setting("setup", %{"step" => step})
  end
end
