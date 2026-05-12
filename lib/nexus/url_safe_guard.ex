defmodule Nexus.URLSafeGuard do
  @moduledoc """
  Validates URLs before outbound HTTP requests to prevent SSRF attacks.

  Blocks:
  - Non-HTTP/HTTPS schemes
  - Private IPv4 ranges (RFC 1918, loopback, link-local, CGNAT)
  - Private IPv6 ranges (loopback, link-local, ULA)
  - Hostnames that resolve to private IPs

  Usage:
      case Nexus.URLSafeGuard.validate(url) do
        :ok -> Req.get(url, ...)
        {:error, reason} -> {:error, reason}
      end
  """

  import Bitwise

  @private_ipv4_ranges [
    {{127, 0, 0, 0}, 8},
    {{10, 0, 0, 0}, 8},
    {{172, 16, 0, 0}, 12},
    {{192, 168, 0, 0}, 16},
    {{169, 254, 0, 0}, 16},
    {{100, 64, 0, 0}, 10},
    {{0, 0, 0, 0}, 8},
    {{255, 255, 255, 255}, 32},
    {{224, 0, 0, 0}, 4}
  ]

  def validate(url) when is_binary(url) do
    uri = URI.parse(url)

    cond do
      uri.scheme not in ["http", "https"] ->
        {:error, "URL scheme must be http or https"}

      is_nil(uri.host) or uri.host == "" ->
        {:error, "URL has no host"}

      true ->
        check_host(uri.host)
    end
  end

  def validate(_), do: {:error, "URL must be a string"}

  defp check_host(host) do
    host = String.trim(host, "[") |> String.trim("]")

    case :inet.parse_address(String.to_charlist(host)) do
      {:ok, ip} ->
        if private_ip?(ip), do: {:error, "URL resolves to a private/reserved IP address"}, else: :ok

      {:error, _} ->
        case :inet.getaddr(String.to_charlist(host), :inet) do
          {:ok, ip} ->
            if private_ip?(ip), do: {:error, "URL resolves to a private/reserved IP address"}, else: :ok

          {:error, _} ->
            case :inet.getaddr(String.to_charlist(host), :inet6) do
              {:ok, ip} ->
                if private_ip?(ip), do: {:error, "URL resolves to a private/reserved IP address"}, else: :ok
              {:error, _} ->
                :ok
            end
        end
    end
  end

  defp private_ip?({a, b, c, d}) do
    Enum.any?(@private_ipv4_ranges, fn {network, prefix} ->
      mask    = bsl(0xFFFFFFFF, 32 - prefix) &&& 0xFFFFFFFF
      ip_int  = a * 16_777_216 + b * 65_536 + c * 256 + d
      net_int = elem(network, 0) * 16_777_216 + elem(network, 1) * 65_536 +
                elem(network, 2) * 256 + elem(network, 3)
      (ip_int &&& mask) == (net_int &&& mask)
    end)
  end

  # IPv6 loopback ::1
  defp private_ip?({0, 0, 0, 0, 0, 0, 0, 1}), do: true
  # IPv6 link-local fe80::/10
  defp private_ip?({a, _, _, _, _, _, _, _}) when band(a, 0xFFC0) == 0xFE80, do: true
  # IPv6 ULA fc00::/7
  defp private_ip?({a, _, _, _, _, _, _, _}) when band(a, 0xFE00) == 0xFC00, do: true
  # IPv6 unspecified ::
  defp private_ip?({0, 0, 0, 0, 0, 0, 0, 0}), do: true
  defp private_ip?(_), do: false
end
