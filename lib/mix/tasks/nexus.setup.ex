defmodule Mix.Tasks.Nexus.Setup do
  use Mix.Task

  @shortdoc "Run the Nexus setup wizard in the terminal"

  @moduledoc """
  Interactive terminal setup wizard for Nexus.

  ## Usage

      mix nexus.setup

  Walks through initial configuration: site name, admin account,
  and registration settings.
  """

  def run(_args) do
    Mix.Task.run("app.start")

    if Nexus.Setup.complete?() do
      Mix.shell().info("Nexus is already set up. To reset, clear the 'setup' key in site_settings.")
      exit(:normal)
    end

    Mix.shell().info("""

    ╔══════════════════════════════════╗
    ║     Welcome to Nexus Setup       ║
    ║  Ultra fast · Ultra modern       ║
    ╚══════════════════════════════════╝

    This wizard will configure your Nexus forum.
    Press Enter to accept defaults shown in [brackets].
    """)

    # Step 1 — Site info
    Mix.shell().info("── Step 1: Site Information ──────────────────")

    site_name = prompt("Site name", "Nexus")
    site_description = prompt("Site description", "Ultra fast · Ultra lightweight · Ultra modern")

    Nexus.Admin.update_setting("general", %{
      "site_name" => site_name,
      "site_description" => site_description
    })

    Nexus.Setup.advance_step(1)
    Mix.shell().info("✓ Site info saved.")

    # Step 2 — Admin account
    Mix.shell().info("\n── Step 2: Admin Account ─────────────────────")
    Mix.shell().info("Create the first admin account.")

    email    = prompt("Admin email", nil)
    username = prompt("Admin username", nil)
    password = prompt_password("Admin password")

    case Nexus.Accounts.register_user(%{
      "email"    => email,
      "username" => username,
      "password" => password
    }) do
      {:ok, user} ->
        Nexus.Setup.advance_step(2)
        Mix.shell().info("✓ Admin account created: #{user.username} (#{user.role})")

      {:error, changeset} ->
        errors = Ecto.Changeset.traverse_errors(changeset, fn {msg, _} -> msg end)
        Mix.shell().error("Failed to create admin account: #{inspect(errors)}")
        exit(:error)
    end

    # Step 3 — Registration
    Mix.shell().info("\n── Step 3: Registration Settings ─────────────")

    open_reg = prompt_boolean("Allow public registration?", true)
    require_verify = prompt_boolean("Require email verification?", false)

    Nexus.Admin.update_setting("registration", %{
      "open" => open_reg,
      "require_email_verification" => require_verify
    })

    Nexus.Setup.mark_complete()

    Mix.shell().info("""

    ╔══════════════════════════════════╗
    ║     Setup Complete! 🎉           ║
    ╚══════════════════════════════════╝

    Your Nexus forum is ready.
    Start the server with: docker compose up
    """)
  end

  defp prompt(label, default) do
    display = if default, do: "#{label} [#{default}]: ", else: "#{label}: "
    answer  = Mix.shell().prompt(display) |> String.trim()

    if answer == "" && default do
      default
    else
      answer
    end
  end

  defp prompt_password(label) do
    IO.write("#{label}: ")
    password = IO.gets("") |> String.trim()
    password
  end

  defp prompt_boolean(label, default) do
    default_str = if default, do: "Y/n", else: "y/N"
    answer = Mix.shell().prompt("#{label} [#{default_str}]: ") |> String.trim() |> String.downcase()

    case answer do
      "y" -> true
      "n" -> false
      ""  -> default
      _   -> default
    end
  end
end
