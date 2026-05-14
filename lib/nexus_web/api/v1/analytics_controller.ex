defmodule NexusWeb.API.V1.AnalyticsController do
  use NexusWeb, :controller

  alias Nexus.Analytics

  # GET /api/v1/admin/analytics?tab=overview&period=28d
  def index(conn, params) do
    period_atom = parse_period(params["period"])
    {from_date, to_date, prev_from, prev_to} = Analytics.date_range(period_atom)

    tab  = params["tab"] || "overview"
    data = build_tab(tab, from_date, to_date, prev_from, prev_to)

    json(conn, %{
      data:   data,
      period: %{
        from: Date.to_iso8601(from_date),
        to:   Date.to_iso8601(to_date)
      }
    })
  end

  defp build_tab("overview",    from, to, prev_from, prev_to), do: Analytics.overview(from, to, prev_from, prev_to)
  defp build_tab("content",     from, to, _prev_from, _prev_to), do: Analytics.content(from, to)
  defp build_tab("users",       from, to, _prev_from, _prev_to), do: Analytics.users(from, to)
  defp build_tab("moderation",  from, to, prev_from, prev_to), do: Analytics.moderation(from, to, prev_from, prev_to)
  defp build_tab("engagement",  from, to, prev_from, prev_to), do: Analytics.engagement(from, to, prev_from, prev_to)
  defp build_tab(_unknown,      from, to, prev_from, prev_to), do: Analytics.overview(from, to, prev_from, prev_to)

  defp parse_period("7d"),  do: :p7d
  defp parse_period("90d"), do: :p90d
  defp parse_period("1y"),  do: :p1y
  defp parse_period(_),     do: :p28d
end
