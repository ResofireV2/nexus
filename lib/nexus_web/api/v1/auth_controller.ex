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
      ip = to_string(:inet.ntoa(conn.remote_ip))

      case Nexus.RateLimiter.check("register:#{ip}", limit: 5, window_seconds: 60) do
        {:deny, retry_after} ->
          conn
          |> put_resp_header("retry-after", to_string(retry_after))
          |> put_status(:too_many_requests)
          |> json(%{error: "Too many registration attempts. Please try again later."})
        :allow ->

      case Nexus.AntiSpam.check_registration(ip, params["email"], params["username"], params) do
        {:block, reason} ->
          conn |> put_status(:unprocessable_entity) |> json(%{error: reason})

        :allow ->
          case Accounts.register_user(params) do
            {:ok, user} ->
              # Send verification email (non-blocking — failure doesn't stop registration)
              %{"type" => "verification", "user_id" => user.id} |> Nexus.Workers.SendEmail.new() |> Oban.insert()
              {:ok, payload} = Nexus.Extensions.HookContracts.build_payload(
                "user_registered", %{user_id: user.id}
              )
              Nexus.Extensions.fire("user_registered", payload)

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
      end # rate limit
    end
  end


  # ---------------------------------------------------------------------------
  # POST /api/v1/auth/login
  # ---------------------------------------------------------------------------

  def login(conn, %{"email" => email, "password" => password} = params) do
    ip = to_string(:inet.ntoa(conn.remote_ip))

    case Nexus.RateLimiter.check("login:#{ip}", limit: 10, window_seconds: 60) do
      {:deny, retry_after} ->
        conn
        |> put_resp_header("retry-after", to_string(retry_after))
        |> put_status(:too_many_requests)
        |> json(%{error: "Too many login attempts. Please try again later."})
      :allow ->
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
                  {:ok, payload} = Nexus.Extensions.HookContracts.build_payload(
            "user_login", %{user_id: user.id}
          )
          Nexus.Extensions.fire("user_login", payload)

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
    end # rate limit
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
            {:ok, %{access_token: access_token, refresh_token: new_refresh, remember_me: remember_me}} ->
              conn
              |> put_refresh_cookie(new_refresh, remember_me)
              |> json(%{access_token: access_token})

            {:error, _} ->
              # Genuine invalid/expired token — clear the cookie
              conn
              |> delete_resp_cookie("_nexus_refresh")
              |> put_status(:unauthorized)
              |> json(%{error: "Invalid or expired refresh token"})
          end
        rescue
          e ->
            require Logger
            Logger.error("Refresh token error: #{inspect(e)}")
            # Do NOT delete the cookie on unexpected errors —
            # keep it so the user can retry after a deploy/migration
            conn
            |> put_status(:unauthorized)
            |> json(%{error: "Refresh temporarily unavailable"})
        end
    end
  end

  # ---------------------------------------------------------------------------
  # POST /api/v1/auth/magic-link
  # ---------------------------------------------------------------------------

  def magic_link_request(conn, %{"email" => email}) do
    ip = to_string(:inet.ntoa(conn.remote_ip))

    case Nexus.RateLimiter.check("magic_link:#{ip}", limit: 5, window_seconds: 60) do
      {:deny, retry_after} ->
        conn
        |> put_resp_header("retry-after", to_string(retry_after))
        |> put_status(:too_many_requests)
        |> json(%{ok: true}) # same shape — don't reveal rate limiting to avoid enumeration
      :allow ->
        Accounts.send_magic_link(email)
        # Always returns ok to avoid email enumeration
        json(conn, %{ok: true})
    end
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
      %{"type" => "verification", "user_id" => user.id} |> Nexus.Workers.SendEmail.new() |> Oban.insert()
      json(conn, %{ok: true, message: "Verification email sent"})
    end
  end

  # ---------------------------------------------------------------------------
  # GET /api/v1/auth/me
  # ---------------------------------------------------------------------------

  def me(conn, _params) do
    json(conn, %{user: user_json(conn.assigns.current_user)})
  end

  # ---------------------------------------------------------------------------
  # GET  /api/v1/auth/sessions   — list active sessions
  # DELETE /api/v1/auth/sessions/:id — terminate one session
  # DELETE /api/v1/auth/sessions     — terminate all other sessions
  # DELETE /api/v1/auth/global-logout — terminate everything including current
  # ---------------------------------------------------------------------------

  def list_sessions(conn, _params) do
    user    = conn.assigns.current_user
    current = conn.req_cookies["_nexus_refresh"]
    current_hash = if current, do: token_hash(current), else: nil

    sessions =
      try do
        Accounts.list_user_sessions(user.id)
        |> Enum.map(fn t ->
          %{
            id:          t.id,
            device:      parse_user_agent(t.user_agent),
            ip_address:  t.ip_address,
            created_at:  t.inserted_at,
            last_active: t.inserted_at,
            current:     current_hash != nil && t.token_hash == current_hash
          }
        end)
      rescue
        e ->
          require Logger
          Logger.error("list_sessions error: #{inspect(e)}")
          []
      end

    json(conn, %{sessions: sessions})
  end

  def revoke_session(conn, %{"id" => id}) do
    user = conn.assigns.current_user
    case Accounts.revoke_session(user.id, id) do
      {:ok, _}         -> json(conn, %{ok: true})
      {:error, :not_found} ->
        conn |> put_status(:not_found) |> json(%{error: "Session not found"})
    end
  end

  def revoke_other_sessions(conn, _params) do
    user    = conn.assigns.current_user
    current = conn.req_cookies["_nexus_refresh"]
    current_hash = if current, do: token_hash(current), else: ""
    Accounts.revoke_other_sessions(user.id, current_hash)
    json(conn, %{ok: true})
  end

  # Hash a raw token the same way Accounts does — SHA256 hex, lowercase.
  defp token_hash(raw), do: :crypto.hash(:sha256, raw) |> Base.encode16(case: :lower)

  def global_logout(conn, _params) do
    user = conn.assigns.current_user
    Accounts.revoke_all_user_tokens(user.id)
    conn
    |> delete_resp_cookie("_nexus_refresh")
    |> json(%{ok: true})
  end

  # Parse a user-agent string into a human-readable device label.
  # Returns e.g. "Chrome on Android", "Safari on iPhone", "Firefox on Windows"
  defp parse_user_agent(nil), do: "Unknown device"
  defp parse_user_agent(ua) do
    browser =
      cond do
        ua =~ "Edg/"                      -> "Edge"
        ua =~ "OPR/" or ua =~ "Opera"    -> "Opera"
        ua =~ "Firefox"                   -> "Firefox"
        ua =~ "Chrome" or ua =~ "CriOS"  -> "Chrome"
        ua =~ "Safari"                    -> "Safari"
        true                              -> "Browser"
      end

    os =
      cond do
        ua =~ "iPhone"                    -> "iPhone"
        ua =~ "iPad"                      -> "iPad"
        ua =~ "Android"                   -> "Android"
        ua =~ "Windows"                   -> "Windows"
        ua =~ "Macintosh" or ua =~ "Mac" -> "macOS"
        ua =~ "Linux"                     -> "Linux"
        true                              -> "device"
      end

    "#{browser} on #{os}"
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
    state = :crypto.strong_rand_bytes(16) |> Base.url_encode64(padding: false)
    url   = Nexus.Auth.OAuth.google_authorize_url(state)
    conn
    |> put_resp_cookie("_oauth_state", state,
        http_only: true,
        same_site: "Lax",
        secure: Application.get_env(:nexus, :env) == :prod,
        max_age: 600)
    |> redirect(external: url)
  end

  def oauth_google_callback(conn, %{"code" => code, "state" => state}) do
    stored_state = conn.req_cookies["_oauth_state"]

    if is_nil(stored_state) or stored_state != state do
      conn |> put_status(:bad_request) |> json(%{error: "Invalid OAuth state parameter"})
    else
      conn = delete_resp_cookie(conn, "_oauth_state")
      case Nexus.Auth.OAuth.exchange_google_code(code) do
        {:ok, profile} ->
          handle_oauth_callback(conn, "google", profile)

        {:error, reason} ->
          conn
          |> put_status(:bad_gateway)
          |> json(%{error: "Google OAuth failed: #{reason}"})
      end
    end
  end

  def oauth_google_callback(conn, _params) do
    conn |> put_status(:bad_request) |> json(%{error: "Missing code or state"})
  end

  def oauth_github(conn, _params) do
    state = :crypto.strong_rand_bytes(16) |> Base.url_encode64(padding: false)
    url   = Nexus.Auth.OAuth.github_authorize_url(state)
    conn
    |> put_resp_cookie("_oauth_state", state,
        http_only: true,
        same_site: "Lax",
        secure: Application.get_env(:nexus, :env) == :prod,
        max_age: 600)
    |> redirect(external: url)
  end

  def oauth_github_callback(conn, %{"code" => code, "state" => state}) do
    stored_state = conn.req_cookies["_oauth_state"]

    if is_nil(stored_state) or stored_state != state do
      conn |> put_status(:bad_request) |> json(%{error: "Invalid OAuth state parameter"})
    else
      conn = delete_resp_cookie(conn, "_oauth_state")
      case Nexus.Auth.OAuth.exchange_github_code(code) do
        {:ok, profile} ->
          handle_oauth_callback(conn, "github", profile)

        {:error, reason} ->
          conn
          |> put_status(:bad_gateway)
          |> json(%{error: "GitHub OAuth failed: #{reason}"})
      end
    end
  end

  def oauth_github_callback(conn, _params) do
    conn |> put_status(:bad_request) |> json(%{error: "Missing code or state"})
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
      avatar_url:   user.avatar_url,
      cover_url:    user.cover_url,
      avatar_color: user.avatar_color,
      email_verified: user.email_verified,
      inserted_at: user.inserted_at,
      preferences: user.preferences || %{},
      has_push_subscription: Nexus.Accounts.has_push_subscription?(user.id)
    }
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", if(is_binary(value), do: value, else: inspect(value)))
      end)
    end)
  end
end
