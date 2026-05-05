defmodule NexusWeb.PageController do
  use NexusWeb, :controller

  def home(conn, _params) do
    render(conn, :home, page_title: "Welcome")
  end
end
