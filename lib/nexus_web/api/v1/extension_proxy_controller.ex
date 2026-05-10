defmodule NexusWeb.API.V1.ExtensionProxyController do
  @moduledoc """
  Proxies requests to extension services transparently.

  Any request to:
    GET/POST/PUT/PATCH/DELETE /api/v1/extensions/:slug/api/*path
    GET                       /api/v1/extensions/:slug/assets/*path

  is forwarded to the extension's registered service_url.
  Uses :hackney directly for full raw binary control over the response.
  """

  use NexusWeb, :controller
  alias Nexus.Extensions

  def api(conn, %{"slug" => slug, "path" => path_parts}) do
    proxy(conn, slug, Path.join(["api" | List.wrap(path_parts)]))
  end

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
    query = if conn.query_string && conn.query_string != "", do: "?#{conn.query_string}", else: ""
    target_url = "#{String.trim_trailing(ext.service_url, "/")}/#{path}#{query}"

    {:ok, body, conn} = Plug.Conn.read_body(conn)

    method = conn.method |> String.downcase() |> String.to_atom()

    # Strip hop-by-hop and conditional cache headers
    forward_headers =
      conn.req_headers
      |> Enum.reject(fn {k, _} ->
        k in ["host", "transfer-encoding", "connection",
              "if-none-match", "if-modified-since", "if-match",
              "if-unmodified-since", "if-range"]
      end)

    nexus_headers = [
      {"x-nexus-proxy-secret", ext.proxy_secret || ""},
      {"x-nexus-extension-slug", ext.slug}
    ]

    nexus_headers =
      case conn.assigns[:current_user] do
        nil  -> nexus_headers
        user -> [{"x-nexus-user-id", to_string(user.id)} | nexus_headers]
      end

    all_headers = forward_headers ++ nexus_headers

    # Use hackney directly — gives us raw binary response with no decoding
    case :hackney.request(method, target_url, all_headers, body, [:with_body]) do
      {:ok, status, resp_headers, resp_body} ->
        safe_headers =
          resp_headers
          |> Enum.reject(fn {k, _} ->
            String.downcase(k) in ["transfer-encoding", "connection",
                                   "keep-alive", "content-encoding"]
          end)
          |> Enum.filter(fn {_k, v} ->
            is_binary(v) && !String.contains?(v, ["\r", "\n"])
          end)

        conn =
          Enum.reduce(safe_headers, conn, fn {k, v}, acc ->
            Plug.Conn.put_resp_header(acc, String.downcase(k), v)
          end)

        resp_body = if is_binary(resp_body), do: resp_body, else: ""
        send_resp(conn, status, resp_body)

      {:error, reason} ->
        conn
        |> put_status(:bad_gateway)
        |> json(%{error: "Extension service unavailable: #{inspect(reason)}"})
    end
  end
end
