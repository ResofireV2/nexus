defmodule Nexus.Auth.JWT do
  @moduledoc """
  JWT access token generation and verification using Joken.

  Access tokens expire in 30 days, matching the remember_me refresh cookie TTL.
  This eliminates the refresh dance on cold page load that caused users to
  briefly appear logged out after being away for more than 15 minutes.
  Refresh tokens are stored server-side in the database (see RefreshToken schema).
  """

  use Joken.Config

  @access_token_ttl 30 * 24 * 60 * 60
  # 30 days in seconds

  @impl true
  def token_config do
    default_claims(skip: [:aud])
    |> add_claim("typ", fn -> "access" end, &(&1 == "access"))
  end

  @doc "Generate a signed access token for a user."
  def generate_access_token(user) do
    extra_claims = %{
      "sub" => to_string(user.id),
      "role" => user.role,
      "exp" => Joken.current_time() + @access_token_ttl
    }

    case generate_and_sign(extra_claims, signer()) do
      {:ok, token, _claims} -> {:ok, token}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc "Verify and decode an access token. Returns {:ok, claims} or {:error, reason}."
  def verify_access_token(token) do
    case verify_and_validate(token, signer()) do
      {:ok, claims} -> {:ok, claims}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc "Extract user_id from verified claims."
  def user_id_from_claims(%{"sub" => sub}), do: String.to_integer(sub)

  defp signer do
    secret = Application.fetch_env!(:nexus, :jwt_secret)
    Joken.Signer.create("HS256", secret)
  end
end
