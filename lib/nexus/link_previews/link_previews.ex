defmodule Nexus.LinkPreviews do
  @moduledoc """
  Manages link preview cards — fetches, parses, and caches OG/meta data
  for bare URLs posted in forum content.

  Each unique URL is fetched exactly once. Results are stored permanently
  with self-hosted images so cards remain accurate even if source sites
  change or disappear.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.LinkPreviews.LinkPreview

  # URLs matching these patterns already have rich dedicated embeds
  # and should never be unfurled as generic link preview cards.
  @skip_patterns [
    ~r/(?:youtube\.com\/(?:watch|embed|shorts)|youtu\.be\/)/i,
    ~r/vimeo\.com\/(?:video\/)?[0-9]+/i,
    ~r/(?:twitter\.com|x\.com)\/[^/]+\/status/i,
    ~r/open\.spotify\.com\/(?:track|album|playlist|episode)\//i,
    ~r/\.(mp4|webm|ogg|mov|mp3|wav|flac|m4a)(\?.*)?$/i,
    ~r/\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i
  ]

  @max_urls_per_body 3
  @fetch_timeout_ms  5_000
  @max_image_width   1200
  @max_image_bytes   5_242_880

  # ---------------------------------------------------------------------------
  # Public API
  # ---------------------------------------------------------------------------

  @doc """
  Returns an existing preview for the URL, or nil if not yet fetched.
  The actual fetch happens in a background Oban job.
  """
  def get_by_url(url) do
    Repo.one(from p in LinkPreview, where: p.url == ^url)
  end

  @doc """
  Checks the DB first; if no record exists, fetches and stores the preview
  synchronously. Called from the Oban worker.
  """
  def get_or_fetch(url) do
    case get_by_url(url) do
      %LinkPreview{} = existing -> {:ok, existing}
      nil -> fetch_and_store(url)
    end
  end

  @doc """
  Scans a post/reply body for bare URLs eligible for unfurling.
  Returns up to @max_urls_per_body qualifying URLs.
  """
  def extract_urls(nil), do: []
  def extract_urls(body) do
    ~r/(?<![(\[!])(https?:\/\/[^\s<>")\]]+)/
    |> Regex.scan(body, capture: :first)
    |> List.flatten()
    |> Enum.uniq()
    |> Enum.reject(&skip?/1)
    |> Enum.take(@max_urls_per_body)
  end

  # ---------------------------------------------------------------------------
  # Fetch pipeline
  # ---------------------------------------------------------------------------

  def fetch_and_store(url) do
    domain = extract_domain(url)

    case fetch_html(url) do
      {:ok, html} ->
        parsed  = parse_meta(html, url, domain)
        image_path   = maybe_download_image(parsed.image_url, "linkpreviews")
        favicon_path = maybe_download_favicon(parsed.favicon_url, domain)

        attrs = %{
          url:          url,
          domain:       domain,
          title:        parsed.title,
          description:  parsed.description,
          site_name:    parsed.site_name,
          image_path:   image_path,
          favicon_path: favicon_path,
          fetched_at:   NaiveDateTime.utc_now() |> NaiveDateTime.truncate(:second)
        }

        insert_preview(attrs)

      {:error, _reason} ->
        # Store a minimal stub so we never retry a dead/slow URL
        attrs = %{
          url:        url,
          domain:     domain,
          title:      domain,
          fetched_at: NaiveDateTime.utc_now() |> NaiveDateTime.truncate(:second)
        }

        insert_preview(attrs)
    end
  end

  # ---------------------------------------------------------------------------
  # HTTP fetch
  # ---------------------------------------------------------------------------

  defp fetch_html(url) do
    headers = [
      {"User-Agent", "Mozilla/5.0 (compatible; NexusBot/1.0; +https://nexus.app)"},
      {"Accept", "text/html,application/xhtml+xml"},
      {"Accept-Language", "en-US,en;q=0.9"}
    ]

    case Req.get(url, headers: headers, receive_timeout: @fetch_timeout_ms,
                      max_redirects: 5, decode_body: false) do
      {:ok, %{status: status, body: body, headers: resp_headers}}
          when status in 200..299 ->
        content_type = get_content_type(resp_headers)
        if String.contains?(content_type, "html") do
          {:ok, body}
        else
          {:error, :not_html}
        end

      {:ok, %{status: status}} ->
        {:error, {:http_error, status}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp get_content_type(headers) when is_map(headers) do
    Map.get(headers, "content-type", "") |> List.wrap() |> List.first() || ""
  end
  defp get_content_type(headers) when is_list(headers) do
    headers
    |> Enum.find_value("", fn
      {"content-type", v} -> v
      _ -> nil
    end)
  end

  # ---------------------------------------------------------------------------
  # HTML parsing
  # ---------------------------------------------------------------------------

  defp parse_meta(html, url, domain) do
    {:ok, doc} = Floki.parse_document(html)

    %{
      title:       extract_title(doc, domain),
      description: extract_description(doc),
      site_name:   extract_site_name(doc, domain),
      image_url:   extract_image_url(doc, url),
      favicon_url: extract_favicon_url(doc, url)
    }
  end

  defp extract_title(doc, fallback) do
    og    = meta_content(doc, "og:title")
    tw    = meta_content(doc, "twitter:title")
    title = Floki.find(doc, "title") |> Floki.text() |> clean()
    h1    = Floki.find(doc, "h1") |> List.first() |> then(&if(&1, do: Floki.text(&1), else: nil)) |> clean()

    og || tw || title || h1 || fallback
  end

  defp extract_description(doc) do
    og   = meta_content(doc, "og:description")
    tw   = meta_content(doc, "twitter:description")
    meta = Floki.find(doc, "meta[name=\"description\"]")
           |> Floki.attribute("content")
           |> List.first()
           |> clean()

    # First substantive paragraph as last resort
    first_p = Floki.find(doc, "p")
              |> Enum.find_value(fn p ->
                text = Floki.text(p) |> clean()
                if text && String.length(text) > 50, do: text
              end)

    og || tw || meta || first_p
  end

  defp extract_site_name(doc, fallback) do
    og      = meta_content(doc, "og:site_name")
    app     = Floki.find(doc, "meta[name=\"application-name\"]")
              |> Floki.attribute("content")
              |> List.first()
              |> clean()

    og || app || fallback
  end

  defp extract_image_url(doc, base_url) do
    og = meta_content(doc, "og:image")
    tw = meta_content(doc, "twitter:image")
    link_src = Floki.find(doc, "link[rel=\"image_src\"]")
               |> Floki.attribute("href")
               |> List.first()

    # First <img> wider than 200px as last resort
    first_img = Floki.find(doc, "img")
                |> Enum.find_value(fn img ->
                  src = img |> Floki.attribute("src") |> List.first()
                  w   = img |> Floki.attribute("width") |> List.first()
                  if src && w && parse_int(w) > 200, do: src
                end)

    candidate = og || tw || link_src || first_img
    if candidate, do: absolute_url(candidate, base_url), else: nil
  end

  defp extract_favicon_url(doc, base_url) do
    declared = Floki.find(doc, "link[rel~=\"icon\"]")
               |> Enum.sort_by(fn el ->
                 # Prefer PNG/SVG declared favicons over .ico
                 href = el |> Floki.attribute("href") |> List.first() || ""
                 if String.ends_with?(href, ".ico"), do: 1, else: 0
               end)
               |> List.first()
               |> then(&if(&1, do: &1 |> Floki.attribute("href") |> List.first(), else: nil))

    url = if declared do
      absolute_url(declared, base_url)
    else
      # Fallback: try /favicon.ico at root
      uri = URI.parse(base_url)
      "#{uri.scheme}://#{uri.host}/favicon.ico"
    end

    url
  end

  # ---------------------------------------------------------------------------
  # Image / favicon download
  # ---------------------------------------------------------------------------

  defp maybe_download_image(nil, _dir), do: nil
  defp maybe_download_image(image_url, dir) do
    case Req.get(image_url, receive_timeout: @fetch_timeout_ms,
                            max_redirects: 3, decode_body: false) do
      {:ok, %{status: s, body: body, headers: headers}} when s in 200..299 ->
        ct = get_content_type(headers)
        if String.starts_with?(ct, "image/") and byte_size(body) <= @max_image_bytes do
          ext  = ext_for_content_type(ct)
          name = "#{Ecto.UUID.generate()}#{ext}"
          rel  = "#{dir}/#{name}"
          abs  = full_path(rel)

          File.mkdir_p!(Path.dirname(abs))

          with :ok <- File.write(abs, body),
               {:ok, img}     <- Image.open(abs),
               {:ok, img}     <- autorotate(img),
               {w, _h, _}     <- Image.shape(img),
               {:ok, resized} <- maybe_resize(img, w),
               webp_rel       <- "webp/#{dir}/#{Path.rootname(name)}.webp",
               abs_webp       <- full_path(webp_rel),
               :ok            <- File.mkdir_p!(Path.dirname(abs_webp)),
               {:ok, _}       <- Image.write(resized, abs_webp, quality: 85, suffix: ".webp") do
            webp_rel
          else
            _ -> nil
          end
        else
          nil
        end

      _ -> nil
    end
  end

  defp maybe_download_favicon(nil, _domain), do: nil
  defp maybe_download_favicon(favicon_url, _domain) do
    case Req.get(favicon_url, receive_timeout: 3_000, max_redirects: 2, decode_body: false) do
      {:ok, %{status: s, body: body, headers: headers}} when s in 200..299 ->
        ct = get_content_type(headers)
        if String.starts_with?(ct, "image/") do
          ext  = ext_for_content_type(ct)
          name = "#{Ecto.UUID.generate()}#{ext}"
          rel  = "linkpreviews/favicons/#{name}"
          abs  = full_path(rel)
          File.mkdir_p!(Path.dirname(abs))
          case File.write(abs, body) do
            :ok -> rel
            _   -> nil
          end
        else
          nil
        end

      _ -> nil
    end
  end

  # ---------------------------------------------------------------------------
  # DB insert (handles race conditions gracefully)
  # ---------------------------------------------------------------------------

  defp insert_preview(attrs) do
    case %LinkPreview{} |> LinkPreview.changeset(attrs) |> Repo.insert() do
      {:ok, preview} ->
        {:ok, preview}

      {:error, %Ecto.Changeset{errors: errors}} ->
        if Keyword.has_key?(errors, :url) do
          # Concurrent insert — another job beat us to it; return the existing row
          {:ok, Repo.one!(from p in LinkPreview, where: p.url == ^attrs.url)}
        else
          {:error, :insert_failed}
        end
    end
  end

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------

  defp skip?(url), do: Enum.any?(@skip_patterns, &Regex.match?(&1, url))

  defp extract_domain(url) do
    case URI.parse(url) do
      %URI{host: host} when is_binary(host) ->
        host |> String.replace_prefix("www.", "")
      _ ->
        url
    end
  end

  defp meta_content(doc, property) do
    (Floki.find(doc, "meta[property=\"#{property}\"]") ++
     Floki.find(doc, "meta[name=\"#{property}\"]"))
    |> Floki.attribute("content")
    |> List.first()
    |> clean()
  end

  defp clean(nil), do: nil
  defp clean(str) do
    str = String.trim(str)
    if str == "", do: nil, else: str
  end

  defp absolute_url(url, base) when is_binary(url) do
    cond do
      String.starts_with?(url, "http") -> url
      String.starts_with?(url, "//")   ->
        %URI{scheme: scheme} = URI.parse(base)
        "#{scheme}:#{url}"
      String.starts_with?(url, "/")    ->
        %URI{scheme: s, host: h} = URI.parse(base)
        "#{s}://#{h}#{url}"
      true ->
        base_dir = base |> URI.parse() |> Map.put(:query, nil) |> Map.put(:fragment, nil)
                   |> to_string() |> String.replace(~r/[^/]+$/, "")
        "#{base_dir}#{url}"
    end
  end
  defp absolute_url(nil, _), do: nil

  defp parse_int(s) do
    case Integer.parse(to_string(s)) do
      {n, _} -> n
      :error -> 0
    end
  end

  defp maybe_resize(image, w) when w > @max_image_width do
    Image.resize(image, @max_image_width / w)
  end
  defp maybe_resize(image, _w), do: {:ok, image}

  defp autorotate(image) do
    case Image.autorotate(image) do
      {:ok, {rotated, _}} -> {:ok, rotated}
      _                   -> {:ok, image}
    end
  end

  defp static_dir do
    case Application.get_env(:nexus, :uploads_dir) do
      nil ->
        if Application.get_env(:nexus, :env) == :prod do
          "/app/uploads"
        else
          Path.join([:code.priv_dir(:nexus), "static", "uploads"])
        end
      dir -> dir
    end
  end

  defp full_path(rel), do: Path.join(static_dir(), rel)

  defp ext_for_content_type("image/jpeg"),               do: ".jpg"
  defp ext_for_content_type("image/png"),                do: ".png"
  defp ext_for_content_type("image/gif"),                do: ".gif"
  defp ext_for_content_type("image/webp"),               do: ".webp"
  defp ext_for_content_type("image/svg+xml"),            do: ".svg"
  defp ext_for_content_type("image/x-icon"),             do: ".ico"
  defp ext_for_content_type("image/vnd.microsoft.icon"), do: ".ico"
  defp ext_for_content_type(_),                          do: ".jpg"
end
