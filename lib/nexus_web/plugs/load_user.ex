defmodule NexusWeb.Plugs.LoadUser do
  @moduledoc """
  Reads the Authorization: Bearer <token> header, verifies the JWT,
  and assigns the current user to conn.assigns.current_user.

  Does NOT halt on missing/invalid token — allows public routes to pass through.
  Use RequireAuth after this to enforce authentication.
  """

  import Plug.Conn
  alias Nexus.Auth.JWT
  alias Nexus.Accounts

  def init(opts), do: opts

  def call(conn, _opts) do
    case get_token(conn) do
      nil ->
        assign(conn, :current_user, nil)

      token ->
        case JWT.verify_access_token(token) do
          {:ok, claims} ->
            user_id = JWT.user_id_from_claims(claims)
            user = Accounts.get_user(user_id)
            assign(conn, :current_user, user)

          {:error, _} ->
            assign(conn, :current_user, nil)
        end
    end
  end

  defp get_token(conn) do
    case get_req_header(conn, "authorization") do
      ["Bearer " <> token] -> token
      _ -> nil
    end
  end
end
