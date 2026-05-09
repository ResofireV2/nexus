defmodule NexusWeb.API.V1.PushController do
  use NexusWeb, :controller
  require Logger

  alias Nexus.Accounts

  # POST /api/v1/push/subscribe
  # Body: { "subscription": { "endpoint": "...", "keys": { "p256dh": "...", "auth": "..." } } }
  def subscribe(conn, %{"subscription" => subscription}) do
    user = conn.assigns.current_user
    Logger.info("Push subscribe: user #{user.id} endpoint=#{String.slice(subscription["endpoint"] || "", 0, 60)}")

    case Accounts.update_preferences(user, %{push_subscription: subscription}) do
      {:ok, _} ->
        Logger.info("Push subscribe: saved successfully for user #{user.id}")
        json(conn, %{ok: true})
      {:error, err} ->
        Logger.warning("Push subscribe: failed for user #{user.id}: #{inspect(err)}")
        conn |> put_status(:unprocessable_entity) |> json(%{error: "Failed to save subscription"})
    end
  end

  # DELETE /api/v1/push/subscribe
  def unsubscribe(conn, _params) do
    user = conn.assigns.current_user
    Accounts.update_preferences(user, %{push_subscription: nil})
    json(conn, %{ok: true})
  end
end
