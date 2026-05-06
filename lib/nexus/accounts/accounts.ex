defmodule Nexus.Accounts do
  @moduledoc """
  The Accounts context. Handles user registration, authentication,
  magic links, OAuth, and token management.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Accounts.{User, RefreshToken}
  alias Nexus.Auth.JWT

  # ---------------------------------------------------------------------------
  # User lookup
  # ---------------------------------------------------------------------------

  def get_user(id), do: Repo.get(User, id)

  def get_user!(id), do: Repo.get!(User, id)

  def list_users_public do
    User
    |> where([u], u.status != "banned")
    |> order_by([u], [asc: u.username])
    |> Repo.all()
  end

  def search_users(q) do
    pattern = "%#{q}%"
    User
    |> where([u], ilike(u.username, ^pattern) and u.status != "banned")
    |> order_by([u], [asc: u.username])
    |> limit(50)
    |> Repo.all()
  end

  def get_user_by_email(email) do
    Repo.get_by(User, email: String.downcase(email))
  end

  def get_user_by_username(username) do
    Repo.get_by(User, username: username)
  end

  # ---------------------------------------------------------------------------
  # Registration
  # ---------------------------------------------------------------------------

  def register_user(attrs) do
    %User{}
    |> User.registration_changeset(attrs)
    |> maybe_set_first_admin()
    |> Repo.insert()
  end

  defp maybe_set_first_admin(changeset) do
    if Repo.aggregate(User, :count) == 0 do
      Ecto.Changeset.put_change(changeset, :role, "admin")
    else
      changeset
    end
  end

  # ---------------------------------------------------------------------------
  # Email/password login — accepts email or username
  # ---------------------------------------------------------------------------

  def authenticate_user(login, password) do
    user = if String.contains?(login, "@") do
      get_user_by_email(login)
    else
      get_user_by_username(login)
    end
    check_password(user, password)
  end

  defp check_password(nil, _password) do
    Bcrypt.no_user_verify()
    {:error, :invalid_credentials}
  end

  defp check_password(%User{password_hash: nil}, _password) do
    {:error, :no_password}
  end

  defp check_password(user, password) do
    if Bcrypt.verify_pass(password, user.password_hash) do
      if user.status == "banned" do
        {:error, :banned}
      else
        {:ok, user}
      end
    else
      {:error, :invalid_credentials}
    end
  end

  # ---------------------------------------------------------------------------
  # Token issuance
  # ---------------------------------------------------------------------------

  def issue_tokens(user, opts \\ []) do
    with {:ok, access_token} <- JWT.generate_access_token(user),
         {:ok, refresh_token} <- create_refresh_token(user, opts) do
      {:ok, %{access_token: access_token, refresh_token: refresh_token.token_hash}}
    end
  end

  def refresh_access_token(raw_token) do
    token_hash = hash_token(raw_token)

    case Repo.get_by(RefreshToken, token_hash: token_hash) do
      nil ->
        {:error, :invalid_token}

      token ->
        if RefreshToken.valid?(token) do
          user = get_user!(token.user_id)
          JWT.generate_access_token(user)
        else
          {:error, :token_expired}
        end
    end
  end

  def revoke_refresh_token(raw_token) do
    token_hash = hash_token(raw_token)

    case Repo.get_by(RefreshToken, token_hash: token_hash) do
      nil -> {:error, :not_found}
      token ->
        token
        |> RefreshToken.revoke_changeset()
        |> Repo.update()
    end
  end

  def revoke_all_user_tokens(user_id) do
    from(t in RefreshToken, where: t.user_id == ^user_id and is_nil(t.revoked_at))
    |> Repo.update_all(set: [revoked_at: DateTime.utc_now() |> DateTime.truncate(:second)])
  end

  defp create_refresh_token(user, opts) do
    raw_token = generate_raw_token()
    expires_at = DateTime.utc_now() |> DateTime.add(30 * 24 * 60 * 60, :second) |> DateTime.truncate(:second)

    %RefreshToken{}
    |> RefreshToken.changeset(%{
      user_id: user.id,
      token_hash: hash_token(raw_token),
      expires_at: expires_at,
      user_agent: Keyword.get(opts, :user_agent),
      ip_address: Keyword.get(opts, :ip_address)
    })
    |> Repo.insert()
    |> case do
      {:ok, token} -> {:ok, %{token | token_hash: raw_token}}
      error -> error
    end
  end

  defp generate_raw_token, do: :crypto.strong_rand_bytes(32) |> Base.url_encode64(padding: false)
  defp hash_token(token), do: :crypto.hash(:sha256, token) |> Base.encode16(case: :lower)

  # ---------------------------------------------------------------------------
  # Magic links
  # ---------------------------------------------------------------------------

  def send_magic_link(email) do
    case get_user_by_email(email) do
      nil ->
        # Don't reveal whether email exists
        {:ok, :sent}

      user ->
        token = generate_raw_token()

        user
        |> User.magic_token_changeset(token)
        |> Repo.update!()

        Nexus.Mailer.send_magic_link(user, token)
        {:ok, :sent}
    end
  end

  def authenticate_magic_link(token) do
    fifteen_minutes_ago = DateTime.utc_now() |> DateTime.add(-15 * 60, :second)

    user =
      Repo.one(
        from u in User,
          where: u.magic_token == ^token,
          where: u.magic_token_sent_at > ^fifteen_minutes_ago
      )

    case user do
      nil ->
        {:error, :invalid_or_expired}

      user ->
        user
        |> Ecto.Changeset.change(magic_token: nil, magic_token_sent_at: nil, email_verified: true)
        |> Repo.update!()

        {:ok, user}
    end
  end

  # ---------------------------------------------------------------------------
  # Email verification
  # ---------------------------------------------------------------------------

  def send_verification_email(user) do
    token = generate_raw_token()

    user
    |> User.magic_token_changeset(token)
    |> Repo.update!()

    Nexus.Mailer.send_verification_email(user, token)
    {:ok, :sent}
  end

  def verify_email(token) do
    user = Repo.get_by(User, email_verify_token: token)

    case user do
      nil -> {:error, :invalid_token}
      user ->
        user
        |> User.verify_email_changeset()
        |> Repo.update()
    end
  end

  # ---------------------------------------------------------------------------
  # OAuth
  # ---------------------------------------------------------------------------

  def find_or_create_oauth_user(provider, uid, attrs) do
    case Repo.get_by(User, oauth_provider: provider, oauth_uid: uid) do
      %User{} = user ->
        {:ok, user}

      nil ->
        attrs
        |> Map.merge(%{oauth_provider: provider, oauth_uid: uid})
        |> ensure_unique_username()
        |> then(&User.oauth_changeset(%User{}, &1))
        |> maybe_set_first_admin()
        |> Repo.insert()
    end
  end

  defp ensure_unique_username(attrs) do
    base = attrs[:username] || attrs["username"] || "user"
    base = base |> String.downcase() |> String.replace(~r/[^a-z0-9_]/, "_")

    username =
      if Repo.get_by(User, username: base) do
        "#{base}_#{:rand.uniform(9999)}"
      else
        base
      end

    Map.put(attrs, :username, username)
  end

  # ---------------------------------------------------------------------------
  # User management
  # ---------------------------------------------------------------------------

  def update_profile(user, attrs) do
    user
    |> User.profile_changeset(attrs)
    |> Repo.update()
  end

  def change_password(user, current_password, new_password) do
    case check_password(user, current_password) do
      {:ok, _} ->
        user
        |> User.password_changeset(%{password: new_password})
        |> Repo.update()
      {:error, _} ->
        {:error, :invalid_current_password}
    end
  end

  def update_preferences(user, attrs) do
    user
    |> User.preferences_changeset(attrs)
    |> Repo.update()
  end

  def update_role(user, role) do
    user
    |> User.role_changeset(%{role: role})
    |> Repo.update()
  end

  def update_status(user, status, opts \\ []) do
    attrs = %{
      status: status,
      status_until: Keyword.get(opts, :until),
      status_reason: Keyword.get(opts, :reason)
    }

    user
    |> User.status_changeset(attrs)
    |> Repo.update()
  end

  def update_avatar(user, avatar_url) do
    user
    |> Ecto.Changeset.cast(%{avatar_url: avatar_url}, [:avatar_url])
    |> Repo.update()
  end

  def update_cover(user, cover_url) do
    user
    |> Ecto.Changeset.cast(%{cover_url: cover_url}, [:cover_url])
    |> Repo.update()
  end
end
