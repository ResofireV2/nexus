defmodule NexusWeb.API.V1.ExtensionProxyController do
  @moduledoc """
  Proxies requests to extension services transparently.

  Any request to:
    GET/POST/PUT/PATCH/DELETE /api/v1/extensions/:slug/api/*path
    GET                       /api/v1/extensions/:slug/assets/*path

  is forwarded to the extension's registered service_url with:
    - The original method, headers, and body
    - An X-Nexus-Proxy-Secret header so the extension can verify origin
    - An X-Nexus-User-Id header if the request is authenticated

  This means extensions never need to appear in the Caddyfile.
  Extension developers only need to register their service_url in the manifest.
  """

  use NexusWeb, :controller

  alias Nexus.Extensions

  # All HTTP methods for API proxy
  def api(conn, %{"slug" => slug, "path" => path_parts}) do
    proxy(conn, slug, Path.join(["api" | List.wrap(path_parts)]))
  end

  # GET only for assets
  def assets(conn, %{"slug" => slug, "path" => path_parts}) do
    proxy(conn, slug, Path.join(["assets" | List.wrap(path_parts)]))
  end

  defp proxy(conn, slug, path) do
    case Extensions.get_extension_by_slug(slug) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "Extension not found"})

      %{enabled: false} ->
        conn |> put_status(:service_unavailable) |> json(%{error: "Extension is disabled"})

      %{service_url: nil} ->
        conn |> put_status(:bad_gateway) |> json(%{error: "Extension has no service URL configured"})

      ext ->
        forward(conn, ext, path)
    end
  end

  defp forward(conn, ext, path) do
    # Build target URL — append query string if present
    query = if conn.query_string && conn.query_string != "", do: "?#{conn.query_string}", else: ""
    target_url = "#{String.trim_trailing(ext.service_url, "/")}/#{path}#{query}"

    # Read request body
    {:ok, body, conn} = Plug.Conn.read_body(conn)

    # Build headers to forward — strip hop-by-hop headers, add Nexus headers
    forward_headers =
      conn.req_headers
      |> Enum.reject(fn {k, _} -> k in ["host", "transfer-encoding", "connection", "if-none-match", "if-modified-since"] end)
      |> Enum.map(fn {k, v} -> {k, v} end)

    nexus_headers = [
      {"x-nexus-proxy-secret", ext.proxy_secret || ""},
      {"x-nexus-extension-slug", ext.slug}
    ]

    # Optionally forward authenticated user id
    nexus_headers =
      case conn.assigns[:current_user] do
        nil  -> nexus_headers
        user -> [{"x-nexus-user-id", to_string(user.id)} | nexus_headers]
      end

    all_headers = forward_headers ++ nexus_headers

    # Make the request using Req
    method = conn.method |> String.downcase() |> String.to_existing_atom()

    result =
      Req.request(
        method: method,
        url: target_url,
        headers: all_headers,
        body: body,
        receive_timeout: 30_000,
        connect_timeout: 5_000,
        redirect: false
      )

    case result do
      {:ok, %{status: status, headers: resp_headers, body: resp_body}} ->
        # Forward safe response headers back to client
        safe_headers =
          resp_headers
          |> Enum.reject(fn {k, _} -> k in ["transfer-encoding", "connection", "keep-alive"] end)

        conn =
          Enum.reduce(safe_headers, conn, fn {k, v}, acc ->
            Plug.Conn.put_resp_header(acc, k, v)
          end)
        send_resp(conn, status, resp_body)

      {:error, %{reason: reason}} ->
        conn
        |> put_status(:bad_gateway)
        |> json(%{error: "Extension service unavailable: #{inspect(reason)}"})
    end
  end


end
