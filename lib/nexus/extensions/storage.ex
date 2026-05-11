defmodule Nexus.Extensions.Storage do
  @moduledoc """
  Standardised file storage for extensions.

  All extension files are stored under `/app/uploads/extensions/:slug/` and
  served via Nexus's existing Plug.Static infrastructure at
  `/uploads/extensions/:slug/filename`.

  Extensions should never construct paths manually — always use this module
  so that storage location can be changed in one place.

  ## Usage

      # Get the absolute filesystem path to write a file
      path = Nexus.Extensions.Storage.path("gamepedia", "screenshots/abc123.webp")
      File.write!(path, binary_data)

      # Get the public URL to serve the file to browsers
      url = Nexus.Extensions.Storage.url("gamepedia", "screenshots/abc123.webp")
      # => "/uploads/extensions/gamepedia/screenshots/abc123.webp"

      # Ensure a subdirectory exists before writing
      :ok = Nexus.Extensions.Storage.ensure_dir("gamepedia", "screenshots")
  """

  @base_dir Application.compile_env(:nexus, :uploads_dir, "/app/uploads")
  @url_base "/uploads/extensions"

  @doc """
  Returns the absolute filesystem path for a file belonging to an extension.
  The file does not need to exist yet.
  """
  @spec path(slug :: String.t(), relative_path :: String.t()) :: String.t()
  def path(slug, relative_path) do
    Path.join([base_dir(), "extensions", slug, relative_path])
  end

  @doc """
  Returns the public URL for a file belonging to an extension.
  """
  @spec url(slug :: String.t(), relative_path :: String.t()) :: String.t()
  def url(slug, relative_path) do
    "#{@url_base}/#{slug}/#{relative_path}"
  end

  @doc """
  Ensures a subdirectory exists for an extension. Creates intermediate
  directories as needed. Returns :ok or {:error, reason}.
  """
  @spec ensure_dir(slug :: String.t(), subdir :: String.t()) :: :ok | {:error, term()}
  def ensure_dir(slug, subdir \\ "") do
    dir = if subdir == "" do
      Path.join([base_dir(), "extensions", slug])
    else
      Path.join([base_dir(), "extensions", slug, subdir])
    end
    File.mkdir_p(dir)
  end

  @doc """
  Lists all files belonging to an extension, relative to its storage root.
  """
  @spec list_files(slug :: String.t()) :: [String.t()]
  def list_files(slug) do
    root = Path.join([base_dir(), "extensions", slug])
    case File.ls(root) do
      {:ok, files} -> files
      {:error, _}  -> []
    end
  end

  @doc """
  Deletes all files for an extension. Called during uninstall.
  """
  @spec delete_all(slug :: String.t()) :: :ok
  def delete_all(slug) do
    dir = Path.join([base_dir(), "extensions", slug])
    File.rm_rf(dir)
    :ok
  end

  defp base_dir do
    Application.get_env(:nexus, :uploads_dir, @base_dir)
  end
end
