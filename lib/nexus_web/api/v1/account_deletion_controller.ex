defmodule NexusWeb.API.V1.AccountDeletionController do
  use NexusWeb, :controller
  alias Nexus.Accounts

  # POST /api/v1/auth/schedule-deletion
  def schedule(conn, _params) do
    user = conn.assigns.current_user

    case Accounts.schedule_deletion(user) do
      {:ok, updated} ->
        json(conn, %{
          ok: true,
          deletion_scheduled_at: updated.deletion_scheduled_at
        })

      {:error, _} ->
        conn
        |> put_status(:internal_server_error)
        |> json(%{error: "Failed to schedule deletion"})
    end
  end

  # DELETE /api/v1/auth/schedule-deletion
  def cancel(conn, _params) do
    user = conn.assigns.current_user

    unless user.status == "pending_deletion" do
      conn |> put_status(:bad_request) |> json(%{error: "No pending deletion"})
    else
      case Accounts.cancel_deletion(user) do
        {:ok, _}     -> json(conn, %{ok: true})
        {:error, _}  ->
          conn
          |> put_status(:internal_server_error)
          |> json(%{error: "Failed to cancel deletion"})
      end
    end
  end

  # GET /api/v1/auth/export
  def export(conn, _params) do
    user = conn.assigns.current_user
    data = Accounts.export_user_data(user)
    json(conn, %{export: data})
  end
end
