defmodule Mix.Tasks.Nexus.Extension.Install do
  use Mix.Task

  @shortdoc "Install a Nexus extension from a local path"

  @moduledoc """
  Installs a Nexus extension into the running instance via the API.

  ## Usage

      mix nexus.extension.install ./extensions/my-extension
      mix nexus.extension.install ./extensions/my-extension --host http://localhost:4000 --token <admin_token>

  ## Options

    * `--host` - Nexus instance URL (default: http://localhost:4000)
    * `--token` - Admin JWT token for authentication
  """

  @switches [host: :string, token: :string]

  def run(args) do
    {opts, argv, _} = OptionParser.parse(args, switches: @switches)

    path =
      case argv do
        [path | _] -> path
        [] -> Mix.raise("Extension path is required.")
      end

    host  = Keyword.get(opts, :host, "http://localhost:4000")
    token = Keyword.get(opts, :token) || System.get_env("NEXUS_ADMIN_TOKEN")

    unless token do
      Mix.raise("Admin token required. Pass --token or set NEXUS_ADMIN_TOKEN env var.")
    end

    manifest_path = Path.join(path, "manifest.json")

    unless File.exists?(manifest_path) do
      Mix.raise("No manifest.json found in #{path}. Is this a valid Nexus extension?")
    end

    manifest = manifest_path |> File.read!() |> Jason.decode!()

    Mix.shell().info("Installing extension #{manifest["name"]} v#{manifest["version"]}...")

    # In a full implementation this would POST to the API
    # For now we output the curl command for the user
    Mix.shell().info("""

    Run this command to install:

      curl -X POST #{host}/api/v1/admin/extensions \\
        -H "Authorization: Bearer #{token}" \\
        -H "Content-Type: application/json" \\
        -d '#{Jason.encode!(manifest)}'
    """)
  end
end
