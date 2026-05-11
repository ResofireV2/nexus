defmodule NexusWeb.ExtensionRouter do
  @moduledoc """
  Handles extension asset serving and API route dispatching.
  """

  use Phoenix.Controller, formats: [:html, :json]

  import Plug.Conn

  alias Nexus.Extensions.Registry

  # ---------------------------------------------------------------------------
  # Phoenix controller actions (called from router.ex)
  # ---------------------------------------------------------------------------

  def serve_asset_action(conn, %{"slug" => slug, "path" => path_parts}) do
    serve_asset(conn, slug, path_parts)
  end

  def api_action(conn, %{"slug" => slug, "path" => path_parts}) do
    serve_api(conn, slug, path_parts)
  end

  # ---------------------------------------------------------------------------
  # Asset serving
  # ---------------------------------------------------------------------------

  defp serve_asset(conn, slug, path_parts) do
    filename  = Path.join(path_parts)
    asset_dir = Path.join([
      Application.get_env(:nexus, :uploads_dir, "/app/uploads"),
      "extensions", slug, "assets"
    ])
    asset_path = Path.join(asset_dir, filename)

    if File.exists?(asset_path) do
      mime_type = case Path.extname(filename) do
        ".js"   -> "application/javascript"
        ".css"  -> "text/css"
        ".webp" -> "image/webp"
        ".png"  -> "image/png"
        ".jpg"  -> "image/jpeg"
        ".jpeg" -> "image/jpeg"
        ".svg"  -> "image/svg+xml"
        ".json" -> "application/json"
        _       -> "application/octet-stream"
      end

      conn
      |> delete_resp_header("content-type")
      |> put_resp_header("content-type", mime_type)
      |> put_resp_header("access-control-allow-origin", "*")
      |> put_resp_header("cache-control", "public, max-age=300")
      |> send_file(200, asset_path)
    else
      conn
      |> put_status(404)
      |> put_resp_header("content-type", "application/json")
      |> send_resp(404, Jason.encode!(%{error: "Asset not found: #{filename}"}))
    end
  end

  # ---------------------------------------------------------------------------
  # API routing
  # ---------------------------------------------------------------------------

  defp serve_api(conn, slug, path_parts) do
    # If the request accepts HTML it's a browser navigation — hard refresh or
    # direct link (e.g. from a digest email). Delegate to PageController.home
    # via an internal forward so the full browser pipeline (session, layout,
    # CSRF headers) runs correctly and the SPA shell is served.
    accept = get_req_header(conn, "accept") |> List.first("")
    if String.contains?(accept, "text/html") do
      NexusWeb.PageController.call(conn, NexusWeb.PageController.init(:home))
    else
      module = Registry.get_module(slug)

      if is_nil(module) do
        conn
        |> put_status(404)
        |> json(%{error: "Extension \"#{slug}\" not found or not loaded"})
      else
        routes = Registry.routes_for(slug)

        if routes == [] do
          conn
          |> put_status(404)
          |> json(%{error: "Extension \"#{slug}\" has no API routes"})
        else
          path = "/" <> Enum.join(path_parts, "/")
          conn = %{conn | path_info: path_parts, request_path: path}
          dispatch_to_routes(conn, routes, slug)
        end
      end
    end
  end

  defp dispatch_to_routes(conn, [], slug) do
    conn
    |> put_status(404)
    |> json(%{error: "No route matched in extension \"#{slug}\""})
  end

  defp dispatch_to_routes(conn, [{prefix, plug_module, opts} | rest], slug) do
    prefix_parts = prefix
      |> String.trim_leading("/")
      |> String.split("/", trim: true)

    if List.starts_with?(conn.path_info, prefix_parts) do
      stripped = Enum.drop(conn.path_info, length(prefix_parts))
      conn = %{conn | path_info: stripped}

      try do
        plug_opts = plug_module.init(opts)
        plug_module.call(conn, plug_opts)
      rescue
        e ->
          require Logger
          Logger.error("ExtensionRouter: #{plug_module} raised: #{inspect(e)}")
          conn
          |> put_status(500)
          |> json(%{error: "Internal extension error"})
      end
    else
      dispatch_to_routes(conn, rest, slug)
    end
  end
end
