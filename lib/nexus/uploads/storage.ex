defmodule Nexus.Uploads.Storage do
  @moduledoc """
  Storage adapter for user-uploaded files.

  Supports two backends, selected at runtime based on admin settings:

  ## Local (default)
  Files are written to `/app/uploads/` (prod) or `priv/static/uploads/` (dev),
  served by Plug.Static. URLs are relative: `/uploads/posts/abc123.webp`.

  ## S3 / Cloudflare R2
  Files are PUT to an S3-compatible bucket using ExAws. URLs are the bucket's
  public CDN base URL + the relative path.

  Configuration is read from admin settings (key: "uploads") under these keys:
    - s3_enabled       — boolean, must be true to activate
    - s3_bucket        — bucket name
    - s3_region        — region string, e.g. "auto" for R2, "us-east-1" for AWS
    - s3_access_key_id
    - s3_secret_access_key
    - s3_endpoint      — custom endpoint host for R2/S3-compatible, e.g.
                         "abc123.r2.cloudflarestorage.com". Omit for real AWS S3.
    - s3_public_url    — public base URL for serving files, e.g.
                         "https://cdn.example.com" or
                         "https://pub-abc123.r2.dev". Must not end with /.

  Environment variables (R2_BUCKET, R2_ACCESS_KEY_ID, etc.) set in runtime.exs
  are used as fallback when admin settings are absent, so existing env-var-based
  configurations continue to work without any changes.
  """

  require Logger

  # ---------------------------------------------------------------------------
  # Public API
  # ---------------------------------------------------------------------------

  @doc """
  Store a file. `tmp_path` is the local path of the file to upload (e.g. the
  Plug.Upload temp path, or a locally written processed file). `rel_path` is
  the relative path under which the file will be stored (e.g. "posts/abc.webp").

  Returns {:ok, rel_path} on success — the same rel_path that was passed in.
  The caller uses rel_path for DB storage; URLs are resolved separately via
  public_url/1.
  """
  @spec store_file(String.t(), String.t()) :: {:ok, String.t()} | {:error, String.t()}
  def store_file(tmp_path, rel_path) do
    if s3_enabled?() do
      store_s3(tmp_path, rel_path)
    else
      store_local(tmp_path, rel_path)
    end
  end

  @doc """
  Returns the public URL for a stored relative path.
  Returns nil when rel_path is nil.
  """
  @spec public_url(String.t() | nil) :: String.t() | nil
  def public_url(nil), do: nil
  def public_url(rel_path) do
    if s3_enabled?() do
      base = s3_public_url()
      "#{base}/#{rel_path}"
    else
      "/uploads/#{rel_path}"
    end
  end

  @doc """
  Delete a stored file by its relative path. Best-effort — logs on failure but
  does not raise. Called from Uploads.delete/1.
  """
  @spec delete_file(String.t() | nil) :: :ok
  def delete_file(nil), do: :ok
  def delete_file(rel_path) do
    if s3_enabled?() do
      delete_s3(rel_path)
    else
      delete_local(rel_path)
    end
  end

  @doc """
  Returns the absolute local filesystem path for a relative upload path.
  Used during the image processing pipeline (the file must be on local disk
  before we can read its size or process it, even when S3 is the final target).
  """
  @spec local_path(String.t()) :: String.t()
  def local_path(rel_path), do: Path.join(local_base(), rel_path)

  @doc "Returns true if S3/R2 storage is configured and enabled."
  @spec s3_enabled?() :: boolean()
  def s3_enabled? do
    cfg = uploads_cfg()
    cfg["s3_enabled"] == true and
      not_empty(cfg["s3_bucket"]) and
      not_empty(cfg["s3_access_key_id"]) and
      not_empty(cfg["s3_secret_access_key"])
  end

  # ---------------------------------------------------------------------------
  # Private — S3 backend
  # ---------------------------------------------------------------------------

  defp store_s3(tmp_path, rel_path) do
    cfg     = s3_config()
    bucket  = cfg[:bucket]
    body    = File.read!(tmp_path)
    content_type = content_type_for(rel_path)

    op = ExAws.S3.put_object(bucket, rel_path, body,
      content_type: content_type,
      acl: :public_read
    )

    case ExAws.request(op, ex_aws_opts(cfg)) do
      {:ok, _} ->
        # Delete the local copy — the file now lives in the bucket.
        # The local file was only needed for image processing; keeping it
        # would defeat the purpose of using object storage.
        File.rm(tmp_path)
        {:ok, rel_path}

      {:error, reason} ->
        Logger.error("Storage: S3 PUT failed for #{rel_path}: #{inspect(reason)}")
        {:error, "Failed to upload to object storage: #{inspect(reason)}"}
    end
  end

  defp delete_s3(rel_path) do
    cfg    = s3_config()
    bucket = cfg[:bucket]
    op     = ExAws.S3.delete_object(bucket, rel_path)

    case ExAws.request(op, ex_aws_opts(cfg)) do
      {:ok, _}    -> :ok
      {:error, r} ->
        Logger.warning("Storage: S3 DELETE failed for #{rel_path}: #{inspect(r)}")
        :ok
    end
  end

  # Builds the keyword list passed as config overrides to ExAws.request/2.
  defp ex_aws_opts(cfg) do
    opts = [
      access_key_id:     cfg[:access_key_id],
      secret_access_key: cfg[:secret_access_key],
      region:            cfg[:region] || "us-east-1"
    ]
    # Only set :host when a custom endpoint is provided (R2, MinIO, etc.).
    # For real AWS S3, omitting :host lets ExAws derive it from the region.
    if cfg[:endpoint] && cfg[:endpoint] != "" do
      opts ++ [host: cfg[:endpoint], scheme: "https"]
    else
      opts
    end
  end

  # Reads the merged config: admin settings first, env vars as fallback.
  defp s3_config do
    cfg = uploads_cfg()
    [
      bucket:            cfg["s3_bucket"]            || System.get_env("R2_BUCKET"),
      region:            cfg["s3_region"]            || System.get_env("R2_REGION") || "auto",
      access_key_id:     cfg["s3_access_key_id"]     || System.get_env("R2_ACCESS_KEY_ID"),
      secret_access_key: cfg["s3_secret_access_key"] || System.get_env("R2_SECRET_ACCESS_KEY"),
      endpoint:          cfg["s3_endpoint"]           || System.get_env("R2_ENDPOINT"),
      public_url:        cfg["s3_public_url"]         || System.get_env("R2_PUBLIC_URL")
    ]
  end

  defp s3_public_url do
    cfg = s3_config()
    url = cfg[:public_url] || ""
    String.trim_trailing(url, "/")
  end

  # ---------------------------------------------------------------------------
  # Private — local backend
  # ---------------------------------------------------------------------------

  defp store_local(tmp_path, rel_path) do
    abs_path = local_path(rel_path)
    File.mkdir_p!(Path.dirname(abs_path))
    case File.cp(tmp_path, abs_path) do
      :ok  -> {:ok, rel_path}
      err  -> err
    end
  end

  defp delete_local(rel_path) do
    abs_path = local_path(rel_path)
    File.rm(abs_path)
    :ok
  rescue
    _ -> :ok
  end

  defp local_base do
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

  # ---------------------------------------------------------------------------
  # Private — helpers
  # ---------------------------------------------------------------------------

  defp uploads_cfg, do: Nexus.Admin.get_setting("uploads") || %{}

  defp not_empty(nil),  do: false
  defp not_empty(""),   do: false
  defp not_empty(_),    do: true

  defp content_type_for(rel_path) do
    case Path.extname(rel_path) |> String.downcase() do
      ".jpg"  -> "image/jpeg"
      ".jpeg" -> "image/jpeg"
      ".png"  -> "image/png"
      ".gif"  -> "image/gif"
      ".webp" -> "image/webp"
      ".svg"  -> "image/svg+xml"
      ".ico"  -> "image/x-icon"
      _       -> "application/octet-stream"
    end
  end
end
