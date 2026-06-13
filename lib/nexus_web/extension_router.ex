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
    # Live disable applies to asset serving too. A disabled
    # extension's JS bundle and static files should 404 so clients can't
    # load them after a refresh while disabled.
    if not Registry.enabled?(slug) do
      conn
      |> put_status(404)
      |> put_resp_header("content-type", "application/json")
      |> send_resp(404, Jason.encode!(%{error: "Extension \"#{slug}\" is disabled"}))
    else
    filename  = Path.join(path_parts)
    asset_dir = Path.join([
      Application.get_env(:nexus, :uploads_dir, "/app/uploads"),
      "extensions", slug, "assets"
    ])
    asset_path = Path.join(asset_dir, filename)

    # Reject any path that escapes the extension's asset directory.
    # Path.join does not resolve ".." segments — only Path.expand does —
    # so we must expand both paths before comparing.
    expanded_path = Path.expand(asset_path)
    expanded_dir  = Path.expand(asset_dir)

    unless String.starts_with?(expanded_path, expanded_dir <> "/") do
      conn
      |> put_status(400)
      |> put_resp_header("content-type", "application/json")
      |> send_resp(400, Jason.encode!(%{error: "Invalid asset path"}))
    else

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
    end # path traversal guard
    end # enabled guard (piece 5)
  end

  # ---------------------------------------------------------------------------
  # API routing
  # ---------------------------------------------------------------------------

  defp serve_api(conn, slug, path_parts) do
    module = Registry.get_module(slug)

    cond do
      is_nil(module) ->
        conn
        |> put_status(404)
        |> json(%{error: "Extension \"#{slug}\" not found or not loaded"})

      not Registry.enabled?(slug) ->
        # Live disable. Extension is loaded but currently disabled —
        # 404 the same as if it weren't installed. Admin can re-enable it
        # from the runtime panel.
        conn
        |> put_status(404)
        |> json(%{error: "Extension \"#{slug}\" is disabled"})

      true ->
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
          stack = __STACKTRACE__
          formatted = Exception.format(:error, e, stack)
          require Logger
          Logger.error(
            "ExtensionRouter: #{plug_module} raised on #{conn.method} #{conn.request_path} " <>
            "(slug=#{slug})\n#{formatted}"
          )

          # In dev, return the exception message and a short stack so authors
          # can diagnose without tailing server logs. Gated on a config key
          # set in dev.exs so prod stays generic.
          if Application.get_env(:nexus, :show_extension_errors, false) do
            conn
            |> put_status(500)
            |> json(%{
              error:        "Internal extension error",
              exception:    Exception.message(e),
              extension:    slug,
              plug:         inspect(plug_module),
              method:       conn.method,
              request_path: conn.request_path,
              # Top 8 frames is enough to locate the source; longer stacks
              # rarely add information and bloat the response.
              stacktrace:   stack |> Enum.take(8) |> Enum.map(&Exception.format_stacktrace_entry/1)
            })
          else
            conn
            |> put_status(500)
            |> json(%{error: "Internal extension error"})
          end
      end
    else
      dispatch_to_routes(conn, rest, slug)
    end
  end
end
