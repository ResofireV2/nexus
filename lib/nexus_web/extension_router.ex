defmodule NexusWeb.ExtensionRouter do
  @moduledoc """
  Dynamic router that serves extension API routes and static assets.

  Extensions mount their routes at /ext/:slug/api/* and serve static assets
  (JS bundles, images) at /ext/:slug/assets/*.

  Unlike Phoenix's compile-time router, this router reads from the
  ExtensionRegistry at request time so routes are available immediately
  after an extension is loaded — no restart needed.

  This plug is mounted in NexusWeb.Router under the /ext scope.
  """

  @behaviour Plug

  import Plug.Conn

  alias Nexus.Extensions.Registry

  @impl Plug
  def init(opts), do: opts

  @impl Plug
  def call(%Plug.Conn{path_info: [slug | rest]} = conn, _opts) do
    cond do
      # Static assets: /ext/:slug/assets/*
      match?(["assets" | _], rest) ->
        serve_asset(conn, slug, tl(rest))

      # API routes: /ext/:slug/api/* or /ext/:slug/*
      true ->
        serve_api(conn, slug, rest)
    end
  end

  def call(conn, _opts) do
    conn
    |> put_status(404)
    |> Phoenix.Controller.json(%{error: "Not found"})
    |> halt()
  end

  # ---------------------------------------------------------------------------
  # Asset serving
  # ---------------------------------------------------------------------------

  defp serve_asset(conn, slug, path_parts) do
    filename = Path.join(path_parts)
    asset_dir = Path.join([
      Application.get_env(:nexus, :uploads_dir, "/app/uploads"),
      "extensions", slug, "assets"
    ])
    asset_path = Path.join(asset_dir, filename)

    if File.exists?(asset_path) do
      conn
      |> put_resp_header("access-control-allow-origin", "*")
      |> put_resp_header("cache-control", "public, max-age=86400")
      |> send_file(200, asset_path)
      |> halt()
    else
      conn
      |> put_status(404)
      |> Phoenix.Controller.json(%{error: "Asset not found"})
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
      |> put_status(404)
      |> Phoenix.Controller.json(%{error: "Extension \"#{slug}\" not found or not loaded"})
      |> halt()
    else
      routes = Registry.routes_for(slug)

      if routes == [] do
        conn
        |> put_status(404)
        |> Phoenix.Controller.json(%{error: "Extension \"#{slug}\" has no API routes"})
        |> halt()
      else
        # Reconstruct the path for the extension's internal router
        path = "/" <> Enum.join(path_parts, "/")
        conn = %{conn | path_info: path_parts, request_path: path}

        # Try each declared route plug in order
        dispatch_to_routes(conn, routes, slug)
      end
    end
  end

  defp dispatch_to_routes(conn, [], slug) do
    conn
    |> put_status(404)
    |> Phoenix.Controller.json(%{error: "No route matched in extension \"#{slug}\""})
    |> halt()
  end

  defp dispatch_to_routes(conn, [{prefix, plug_module, opts} | rest], slug) do
    prefix_parts = prefix
      |> String.trim_leading("/")
      |> String.split("/", trim: true)

    path_info = conn.path_info

    if List.starts_with?(path_info, prefix_parts) do
      stripped = Enum.drop(path_info, length(prefix_parts))
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
          |> Phoenix.Controller.json(%{error: "Internal extension error"})
          |> halt()
      end
    else
      dispatch_to_routes(conn, rest, slug)
    end
  end
end
