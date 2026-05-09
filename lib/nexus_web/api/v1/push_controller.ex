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

  # GET /api/v1/push/subscriptions
  # Returns all push subscriptions for the current user
  def list_subscriptions(conn, _params) do
    user = conn.assigns.current_user
    subs = Nexus.Accounts.get_push_subscriptions(user.id)

    json(conn, %{subscriptions: Enum.map(subs, fn s ->
      %{
        id:          s.id,
        endpoint:    s.endpoint,
        inserted_at: s.inserted_at,
        last_used_at: s.last_used_at
      }
    end)})
  end

  # DELETE /api/v1/push/subscriptions/:id
  # Revoke a specific subscription by ID (must belong to current user)
  def revoke_subscription(conn, %{"id" => id}) do
    user = conn.assigns.current_user
    import Ecto.Query

    case Nexus.Repo.one(
      from s in Nexus.Accounts.PushSubscription,
        where: s.id == ^id and s.user_id == ^user.id
    ) do
      nil -> conn |> put_status(:not_found) |> json(%{error: "Not found"})
      sub ->
        Nexus.Repo.delete(sub)
        json(conn, %{ok: true})
    end
  end
