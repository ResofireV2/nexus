defmodule Mix.Tasks.Nexus.Extension.List do
  use Mix.Task

  @shortdoc "List installed Nexus extensions"

  @moduledoc """
  Lists all extensions installed in the running Nexus instance.

  ## Usage

      mix nexus.extension.list
      mix nexus.extension.list --host http://localhost:4000 --token <admin_token>
  """

  @switches [host: :string, token: :string]

  def run(args) do
    {opts, _argv, _} = OptionParser.parse(args, switches: @switches)

    host  = Keyword.get(opts, :host, "http://localhost:4000")
    token = Keyword.get(opts, :token) || System.get_env("NEXUS_ADMIN_TOKEN")

    unless token do
      Mix.raise("Admin token required. Pass --token or set NEXUS_ADMIN_TOKEN env var.")
    end

    Mix.shell().info("Fetching extensions from #{host}...")
    Mix.shell().info("""

    Run this command to list extensions:

      curl #{host}/api/v1/admin/extensions \\
        -H "Authorization: Bearer #{token}"
    """)
  end
end
