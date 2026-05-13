defmodule NexusWeb.API.V1.SetupController do
  use NexusWeb, :controller

  alias Nexus.{Setup, Admin, Accounts}

  # GET /api/v1/setup/status
  def status(conn, _params) do
    json(conn, %{
      complete: Setup.complete?(),
      step: Setup.current_step()
    })
  end

  # POST /api/v1/setup/step/1 — site info
  def step_one(conn, params) do
    if Setup.complete?() do
      conn |> put_status(:forbidden) |> json(%{error: "Setup already complete"})
    else
      site_name        = params["site_name"] || "Nexus"
      site_description = params["site_description"] || ""

      Admin.update_setting("general", %{
        "site_name"        => site_name,
        "site_description" => site_description
      })

      Setup.advance_step(1)
      json(conn, %{ok: true, step: 1})
    end
  end

  # POST /api/v1/setup/step/2 — create admin account
  def step_two(conn, params) do
    if Setup.complete?() do
      conn |> put_status(:forbidden) |> json(%{error: "Setup already complete"})
    else
      case Accounts.register_user(params) do
        {:ok, user} ->
          Setup.advance_step(2)
          json(conn, %{ok: true, step: 2, user: %{id: user.id, username: user.username, role: user.role}})

        {:error, changeset} ->
          conn
          |> put_status(:unprocessable_entity)
          |> json(%{errors: format_errors(changeset)})
      end
    end
  end

  # POST /api/v1/setup/step/3 — registration settings and finish
  def step_three(conn, params) do
    if Setup.complete?() do
      conn |> put_status(:forbidden) |> json(%{error: "Setup already complete"})
    else
      Admin.update_setting("registration", %{
        "open"                       => Map.get(params, "open_registration", true),
        "require_email_verification" => Map.get(params, "require_email_verification", false)
      })

      Setup.mark_complete()
      json(conn, %{ok: true, complete: true})
    end
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", if(is_binary(v), do: v, else: inspect(v))) end)
    end)
  end
end
