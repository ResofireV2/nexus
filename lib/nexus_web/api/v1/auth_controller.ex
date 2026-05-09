defmodule NexusWeb.API.V1.AuthController do
  use NexusWeb, :controller

  alias Nexus.Accounts

  # ---------------------------------------------------------------------------
  # POST /api/v1/auth/register
  # ---------------------------------------------------------------------------

  def register(conn, params) do
    unless Nexus.Permissions.registration_open?() do
      conn |> put_status(:forbidden) |> json(%{error: "Registration is currently closed"}) |> halt()
    else
    case Accounts.register_user(params) do
      {:ok, user} ->
        # Send verification email (non-blocking — failure doesn't stop registration)
        Task.start(fn -> Accounts.send_verification_email(user) end)
        Task.start(fn -> Nexus.Extensions.fire("user_registered", %{user_id: user.id}) end)

        opts = [
          user_agent: get_req_header(conn, "user-agent") |> List.first(),
          ip_address: to_string(:inet.ntoa(conn.remote_ip))
        ]

        case Accounts.issue_tokens(user, opts) do
          {:ok, tokens} ->
            conn
            |> put_refresh_cookie(tokens.refresh_token)
            |> put_status(:created)
            |> json(%{
              access_token: tokens.access_token,
              user: user_json(user)
            })

          {:error, _} ->
            conn
            |> put_status(:internal_server_error)
            |> json(%{error: "Registration succeeded but token issuance failed"})
        end

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
    end
  end

  # ---------------------------------------------------------------------------
  # POST /api/v1/auth/login
  # ---------------------------------------------------------------------------

  def login(conn, %{"email" => email, "password" => password} = params) do
    remember_me = Map.get(params, "remember_me", true)

    case Accounts.authenticate_user(email, password) do
      {:ok, user} ->
        opts = [
          user_agent: get_req_header(conn, "user-agent") |> List.first(),
          ip_address: to_string(:inet.ntoa(conn.remote_ip))
        ]

        {:ok, tokens} = Accounts.issue_tokens(user, opts)

        %{"user_id" => user.id} |> Nexus.Workers.CheckBadges.new(schedule_in: 60) |> Oban.insert()
        %{"user_id" => user.id} |> Nexus.Workers.UpdateScore.new(schedule_in: 60) |> Oban.insert()
        Task.start(fn -> Nexus.Extensions.fire("user_login", %{user_id: user.id}) end)

        conn
        |> put_refresh_cookie(tokens.refresh_token, remember_me)
        |> json(%{
          access_token: tokens.access_token,
          user: user_json(user)
        })

      {:error, :invalid_credentials} ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "Invalid email or password"})

      {:error, :banned} ->
        conn
        |> put_status(:forbidden)
        |> json(%{error: "This account has been banned"})

      {:error, :no_password} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: "This account uses OAuth — please sign in with Google or GitHub"})
    end
  end

  def login(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: "email and password are required"})
  end

  # ---------------------------------------------------------------------------
  # POST /api/v1/auth/logout
  # ---------------------------------------------------------------------------

  def logout(conn, _params) do
    raw_token = conn.req_cookies["_nexus_refresh"]

    if raw_token do
      Accounts.revoke_refresh_token(raw_token)
    end

    conn
    |> delete_resp_cookie("_nexus_refresh")
    |> json(%{ok: true})
  end

  # ---------------------------------------------------------------------------
  # POST /api/v1/auth/refresh
  # ---------------------------------------------------------------------------

  def refresh(conn, _params) do
    raw_token = conn.req_cookies["_nexus_refresh"]

    cond do
      is_nil(raw_token) or raw_token == "" ->
        conn |> put_status(:unauthorized) |> json(%{error: "No refresh token"})

      true ->
        try do
          case Accounts.refresh_access_token(raw_token) do
            {:ok, access_token} ->
              json(conn, %{access_token: access_token})

            {:error, _} ->
              conn
              |> delete_resp_cookie("_nexus_refresh")
              |> put_status(:unauthorized)
              |> json(%{error: "Invalid or expired refresh token"})
          end
        rescue
          _ ->
            conn
            |> delete_resp_cookie("_nexus_refresh")
            |> put_status(:unauthorized)
            |> json(%{error: "Invalid refresh token"})
        end
    end
  end

  # ---------------------------------------------------------------------------
  # POST /api/v1/auth/magic-link
  # ---------------------------------------------------------------------------

  def magic_link_request(conn, %{"email" => email}) do
    Accounts.send_magic_link(email)
    # Always returns ok to avoid email enumeration
    json(conn, %{ok: true})
  end

  # ---------------------------------------------------------------------------
  # GET /api/v1/auth/magic?token=...
  # ---------------------------------------------------------------------------

  def magic_link_verify(conn, %{"token" => token}) do
    case Accounts.authenticate_magic_link(token) do
      {:ok, user} ->
        opts = [
          user_agent: get_req_header(conn, "user-agent") |> List.first(),
          ip_address: to_string(:inet.ntoa(conn.remote_ip))
        ]

        {:ok, tokens} = Accounts.issue_tokens(user, opts)

        conn
        |> put_refresh_cookie(tokens.refresh_token)
        |> json(%{
          access_token: tokens.access_token,
          user: user_json(user)
        })

      {:error, :invalid_or_expired} ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "Invalid or expired magic link"})
    end
  end

  # ---------------------------------------------------------------------------
  # GET /api/v1/auth/verify-email?token=...
  # ---------------------------------------------------------------------------

  def verify_email(conn, %{"token" => token}) do
    case Accounts.verify_email(token) do
      {:ok, _user} -> json(conn, %{ok: true})
      {:error, _}  ->
        conn
        |> put_status(:bad_request)
        |> json(%{error: "Invalid verification token"})
    end
  end

  # ---------------------------------------------------------------------------
  # POST /api/v1/auth/resend-verification
  # ---------------------------------------------------------------------------

  def resend_verification(conn, _params) do
    user = conn.assigns.current_user
    if user.email_verified do
      json(conn, %{ok: true, message: "Email already verified"})
    else
      Task.start(fn -> Accounts.send_verification_email(user) end)
      json(conn, %{ok: true, message: "Verification email sent"})
    end
  end

  # ---------------------------------------------------------------------------
  # GET /api/v1/auth/me
  # ---------------------------------------------------------------------------

  def me(conn, _params) do
    json(conn, %{user: user_json(conn.assigns.current_user)})
  end

  def update_me(conn, params) do
    user = conn.assigns.current_user

    cond do
      # Handle password change
      params["current_password"] && params["new_password"] ->
        case Accounts.change_password(user, params["current_password"], params["new_password"]) do
          {:ok, _} -> json(conn, %{ok: true, message: "Password updated"})
          {:error, :invalid_current_password} ->
            conn |> put_status(:unprocessable_entity) |> json(%{error: "Current password is incorrect"})
          {:error, changeset} ->
            conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
        end

      # Handle preferences update
      params["preferences"] ->
        merged = Map.merge(user.preferences || %{}, params["preferences"])
        case Accounts.update_preferences(user, %{preferences: merged}) do
          {:ok, updated} -> json(conn, %{user: user_json(updated)})
          {:error, changeset} ->
            conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
        end

      # Handle profile update
      true ->
        case Accounts.update_profile(user, params) do
          {:ok, updated} ->
            json(conn, %{user: user_json(updated)})
          {:error, changeset} ->
            conn |> put_status(:unprocessable_entity) |> json(%{errors: format_errors(changeset)})
        end
    end
  end

  # ---------------------------------------------------------------------------
  # OAuth — Google
  # ---------------------------------------------------------------------------

  def oauth_google(conn, _params) do
    # Stage 3 stub — full OAuth in next iteration
    # Redirect to Google with client_id, redirect_uri, scope
    url = Nexus.Auth.OAuth.google_authorize_url()
    redirect(conn, external: url)
  end

  def oauth_google_callback(conn, %{"code" => code}) do
    case Nexus.Auth.OAuth.exchange_google_code(code) do
      {:ok, profile} ->
        handle_oauth_callback(conn, "google", profile)

      {:error, reason} ->
        conn
        |> put_status(:bad_gateway)
        |> json(%{error: "Google OAuth failed: #{reason}"})
    end
  end

  def oauth_github(conn, _params) do
    url = Nexus.Auth.OAuth.github_authorize_url()
    redirect(conn, external: url)
  end

  def oauth_github_callback(conn, %{"code" => code}) do
    case Nexus.Auth.OAuth.exchange_github_code(code) do
      {:ok, profile} ->
        handle_oauth_callback(conn, "github", profile)

      {:error, reason} ->
        conn
        |> put_status(:bad_gateway)
        |> json(%{error: "GitHub OAuth failed: #{reason}"})
    end
  end

  defp handle_oauth_callback(conn, provider, profile) do
    case Accounts.find_or_create_oauth_user(provider, profile.uid, profile) do
      {:ok, user} ->
        opts = [
          user_agent: get_req_header(conn, "user-agent") |> List.first(),
          ip_address: to_string(:inet.ntoa(conn.remote_ip))
        ]

        {:ok, tokens} = Accounts.issue_tokens(user, opts)

        conn
        |> put_refresh_cookie(tokens.refresh_token)
        |> json(%{
          access_token: tokens.access_token,
          user: user_json(user)
        })

      {:error, changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(changeset)})
    end
  end

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------

  defp put_refresh_cookie(conn, token, remember_me \\ true) do
    opts = [
      http_only: true,
      same_site: "Lax",
      secure: Application.get_env(:nexus, :env) == :prod
    ]
    # Only set max_age (persistent) if remember_me is true
    # Without max_age the cookie is session-only and clears when browser closes
    opts = if remember_me, do: Keyword.put(opts, :max_age, 30 * 24 * 60 * 60), else: opts
    put_resp_cookie(conn, "_nexus_refresh", token, opts)
  end

  defp user_json(user) do
    %{
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      bio: user.bio,
      avatar_url: user.avatar_url,
      cover_url: user.cover_url,
      email_verified: user.email_verified,
      inserted_at: user.inserted_at,
      preferences: user.preferences || %{},
      has_push_subscription: not is_nil(user.push_subscription)
    }
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", to_string(value))
      end)
    end)
  end
end
