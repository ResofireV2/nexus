defmodule NexusWeb.ErrorJSON do
  def render("404.json", _assigns) do
    %{errors: %{detail: "Not Found"}}
  end

  def render("500.json", _assigns) do
    %{errors: %{detail: "Internal Server Error"}}
  end

  # Any other status Phoenix renders an error for: 400 for a malformed id or
  # bad JSON, 413 for an oversized body, and so on. Without this clause the
  # error page itself raised, and the client got a bare 500 instead.
  def render(template, _assigns) do
    %{errors: %{detail: Phoenix.Controller.status_message_from_template(template)}}
  end
end
