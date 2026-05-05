defmodule NexusWeb.ErrorHTML do
  use NexusWeb, :html

  def render("404.html", _assigns) do
    "Not found"
  end

  def render("500.html", _assigns) do
    "Internal server error"
  end
end
