defmodule NexusWeb.PageController do
  use NexusWeb, :controller

  def home(conn, _params) do
    # Force HTML format explicitly — the SPA catch-all must always serve the
    # HTML shell regardless of how the request's Accept header is negotiated.
    # Without this, a service worker fetch() or certain browser behaviours can
    # result in Phoenix resolving the format as JSON and rendering a 404 error.
    conn
    |> put_format("html")
    |> render(:home, page_title: "Welcome")
  end
end
