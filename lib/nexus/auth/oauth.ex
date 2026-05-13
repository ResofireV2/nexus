defmodule Nexus.Auth.OAuth do
  @moduledoc """
  OAuth 2.0 helpers for Google and GitHub.
  Configure credentials in runtime.exs via environment variables:
    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
    GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
  """

  # ---------------------------------------------------------------------------
  # Google
  # ---------------------------------------------------------------------------

  def google_authorize_url(state) do
    config = google_config()
    params = URI.encode_query(%{
      client_id: config[:client_id],
      redirect_uri: config[:redirect_uri],
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      state: state
    })
    "https://accounts.google.com/o/oauth2/v2/auth?#{params}"
  end

  def exchange_google_code(code) do
    config = google_config()

    case Req.post("https://oauth2.googleapis.com/token", json: %{
      code: code,
      client_id: config[:client_id],
      client_secret: config[:client_secret],
      redirect_uri: config[:redirect_uri],
      grant_type: "authorization_code"
    }) do
      {:ok, %{status: 200, body: %{"access_token" => access_token}}} ->
        fetch_google_profile(access_token)

      {:ok, %{body: body}} ->
        {:error, inspect(body)}

      {:error, reason} ->
        {:error, inspect(reason)}
    end
  end

  defp fetch_google_profile(access_token) do
    case Req.get("https://www.googleapis.com/oauth2/v3/userinfo",
           headers: [{"authorization", "Bearer #{access_token}"}]) do
      {:ok, %{status: 200, body: body}} ->
        {:ok, %{
          uid: body["sub"],
          email: body["email"],
          username: body["name"] || body["email"],
          avatar_url: body["picture"]
        }}

      {:error, reason} ->
        {:error, inspect(reason)}
    end
  end

  defp google_config do
    s = (Nexus.Admin.get_setting("integrations") || %{})
    client_id     = s["google_client_id"]     || System.get_env("GOOGLE_CLIENT_ID")
    client_secret = s["google_client_secret"] || System.get_env("GOOGLE_CLIENT_SECRET")
    redirect_uri  = System.get_env("GOOGLE_REDIRECT_URI", "#{base_url()}/api/v1/auth/oauth/google/callback")
    [client_id: client_id, client_secret: client_secret, redirect_uri: redirect_uri]
  end

  # ---------------------------------------------------------------------------
  # GitHub
  # ---------------------------------------------------------------------------

  def github_authorize_url(state) do
    config = github_config()
    params = URI.encode_query(%{
      client_id: config[:client_id],
      redirect_uri: config[:redirect_uri],
      scope: "user:email",
      state: state
    })
    "https://github.com/login/oauth/authorize?#{params}"
  end

  def exchange_github_code(code) do
    config = github_config()

    case Req.post("https://github.com/login/oauth/access_token",
           json: %{
             code: code,
             client_id: config[:client_id],
             client_secret: config[:client_secret]
           },
           headers: [{"accept", "application/json"}]) do
      {:ok, %{status: 200, body: %{"access_token" => access_token}}} ->
        fetch_github_profile(access_token)

      {:ok, %{body: body}} ->
        {:error, inspect(body)}

      {:error, reason} ->
        {:error, inspect(reason)}
    end
  end

  defp fetch_github_profile(access_token) do
    headers = [{"authorization", "Bearer #{access_token}"}, {"accept", "application/json"}]

    with {:ok, %{status: 200, body: user}} <- Req.get("https://api.github.com/user", headers: headers),
         {:ok, %{status: 200, body: emails}} <- Req.get("https://api.github.com/user/emails", headers: headers) do
      primary_email =
        emails
        |> Enum.find(& &1["primary"])
        |> then(& &1["email"])

      {:ok, %{
        uid: to_string(user["id"]),
        email: primary_email || user["email"],
        username: user["login"],
        avatar_url: user["avatar_url"]
      }}
    else
      {:error, reason} -> {:error, inspect(reason)}
    end
  end

  defp github_config do
    s = (Nexus.Admin.get_setting("integrations") || %{})
    client_id     = s["github_client_id"]     || System.get_env("GITHUB_CLIENT_ID")
    client_secret = s["github_client_secret"] || System.get_env("GITHUB_CLIENT_SECRET")
    redirect_uri  = System.get_env("GITHUB_REDIRECT_URI", "#{base_url()}/api/v1/auth/oauth/github/callback")
    [client_id: client_id, client_secret: client_secret, redirect_uri: redirect_uri]
  end

  defp base_url do
    NexusWeb.Endpoint.url()
  end
end
