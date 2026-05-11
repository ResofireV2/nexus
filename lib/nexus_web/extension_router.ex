defmodule NexusWeb.ExtensionRouter do
  @moduledoc """
  Handles extension asset serving and API route dispatching.
  """

  import Plug.Conn
  import Phoenix.Controller, only: [json: 2]

  alias Nexus.Extensions.Registry

  # ---------------------------------------------------------------------------
  # Phoenix controller actions (called from router.ex)
  # ---------------------------------------------------------------------------

  def init(opts), do: opts

  def serve_asset_action(conn, %{"slug" => slug, "path" => path_parts}) do
    serve_asset(conn, slug, path_parts)
  end

  def api_action(conn, %{"slug" => slug, "path" => path_parts}) do
    serve_api(conn, slug, path_parts)
  end

  # Also handle when called as a Plug
  def call(%Plug.Conn{path_info: [slug | rest]} = conn, _opts) do
    if match?(["assets" | _], rest) do
      serve_asset(conn, slug, tl(rest))
    else
      serve_api(conn, slug, rest)
    end
  end

  def call(conn, _opts) do
    conn
    |> put_status(404)
    |> json(%{error: "Not found"})
    |> halt()
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
      |> put_resp_header("content-type", mime_type)
      |> put_resp_header("access-control-allow-origin", "*")
      |> put_resp_header("cache-control", "public, max-age=300")
      |> send_file(200, asset_path)
      |> halt()
    else
      conn
      |> put_resp_content_type("application/json")
      |> send_resp(404, Jason.encode!(%{error: "Asset not found"}))
      |> halt()
    end
  end

  # ---------------------------------------------------------------------------
  # API routing
  # ---------------------------------------------------------------------------

  defp serve_api(conn, slug, path_parts) do
    module = Registry.get_module(slug)

    if is_nil(module) do
      conn
      |> put_resp_content_type("application/json")
      |> send_resp(404, Jason.encode!(%{error: "Extension \"#{slug}\" not found or not loaded"}))
      |> halt()
    else
      routes = Registry.routes_for(slug)

      if routes == [] do
        conn
        |> put_resp_content_type("application/json")
        |> send_resp(404, Jason.encode!(%{error: "Extension \"#{slug}\" has no API routes"}))
        |> halt()
      else
        path = "/" <> Enum.join(path_parts, "/")
        conn = %{conn | path_info: path_parts, request_path: path}
        dispatch_to_routes(conn, routes, slug)
      end
    end
  end

  defp dispatch_to_routes(conn, [], slug) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(404, Jason.encode!(%{error: "No route matched in extension \"#{slug}\""}))
    |> halt()
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
          |> put_resp_content_type("application/json")
          |> send_resp(500, Jason.encode!(%{error: "Internal extension error"}))
          |> halt()
      end
    else
      dispatch_to_routes(conn, rest, slug)
    end
  end
end
