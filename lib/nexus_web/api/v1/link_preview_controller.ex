defmodule NexusWeb.API.V1.LinkPreviewController do
  use NexusWeb, :controller

  alias Nexus.LinkPreviews

  # GET /api/v1/link_previews?url=https://...
  def show(conn, %{"url" => url}) do
    case LinkPreviews.get_by_url(url) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "Preview not yet available"})

      preview ->
        json(conn, %{preview: preview_json(preview)})
    end
  end

  defp preview_json(p) do
    %{
      url:          p.url,
      domain:       p.domain,
      title:        p.title,
      description:  p.description,
      site_name:    p.site_name,
      image_url:    served_url(p.image_path),
      favicon_url:  served_url(p.favicon_path)
    }
  end

  defp served_url(nil),  do: nil
  defp served_url(path), do: "/uploads/#{path}"
end
