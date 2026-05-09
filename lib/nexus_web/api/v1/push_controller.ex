defmodule NexusWeb.API.V1.PushController do
  use NexusWeb, :controller
  require Logger

  alias Nexus.Accounts

  # POST /api/v1/push/subscribe
  def subscribe(conn, %{"subscription" => subscription}) do
    user     = conn.assigns.current_user
    endpoint = subscription["endpoint"]
    p256dh   = get_in(subscription, ["keys", "p256dh"])
    auth     = get_in(subscription, ["keys", "auth"])

    Logger.info("Push subscribe: user #{user.id} endpoint=#{String.slice(endpoint || "", 0, 60)}")

    cond do
      is_nil(endpoint) ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "Missing endpoint"})

      is_nil(p256dh) or is_nil(auth) ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "Missing keys"})

      true ->
        pwa = Nexus.Admin.get_setting("pwa")
        vapid_public = pwa["vapid_public"]

        case Accounts.add_push_subscription(user.id, endpoint, p256dh, auth, vapid_public) do
          {:ok, _sub} ->
            Logger.info("Push subscribe: saved for user #{user.id}")
            json(conn, %{ok: true})

          {:error, err} ->
            Logger.warning("Push subscribe: failed for user #{user.id}: #{inspect(err)}")
            conn |> put_status(:unprocessable_entity) |> json(%{error: "Failed to save subscription"})
        end
    end
  end

  # DELETE /api/v1/push/subscribe
  def unsubscribe(conn, params) do
    endpoint = params["endpoint"] || get_in(params, ["subscription", "endpoint"])
    if endpoint, do: Accounts.remove_push_subscription(endpoint)
    json(conn, %{ok: true})
  end
end
