defmodule Nexus.Accounts do
  @moduledoc """
  The Accounts context. Handles user registration, authentication,
  magic links, OAuth, and token management.
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Accounts.{User, RefreshToken, PushSubscription}
  alias Nexus.Auth.JWT

  # ---------------------------------------------------------------------------
  # User lookup
  # ---------------------------------------------------------------------------

  def get_user(id), do: Repo.get(User, id)

  def get_user!(id), do: Repo.get!(User, id)

  def list_users_public(sort \\ "newest") do
    import Ecto.Query
    alias Nexus.Activity.UserDailyStat

    base =
      from u in User,
      left_join: s in UserDailyStat, on: s.user_id == u.id,
      where: u.status != "banned",
      group_by: u.id,
      select: %{
        id:                  u.id,
        username:            u.username,
        role:                u.role,
        bio:                 u.bio,
        avatar_url:          u.avatar_url,
        avatar_color:        u.avatar_color,
        cover_url:           u.cover_url,
        inserted_at:         u.inserted_at,
        status:              u.status,
        post_count:          coalesce(sum(s.posts_count), 0),
        reply_count:         coalesce(sum(s.replies_count), 0),
        reactions_received:  coalesce(sum(s.reactions_received), 0)
      }

    ordered = case sort do
      "oldest"         -> order_by(base, [u], [asc:  u.inserted_at])
      "most_posts"     -> order_by(base, [u, s], [desc: coalesce(sum(s.posts_count), 0),     asc: u.username])
      "most_replies"   -> order_by(base, [u, s], [desc: coalesce(sum(s.replies_count), 0),   asc: u.username])
      "most_reactions" -> order_by(base, [u, s], [desc: coalesce(sum(s.reactions_received), 0), asc: u.username])
      _                -> order_by(base, [u], [desc: u.inserted_at])
    end

    Repo.all(ordered)
  end

  def search_users(q, sort \\ "newest") do
    import Ecto.Query
    alias Nexus.Activity.UserDailyStat
    pattern = "%#{q}%"

    base =
      from u in User,
      left_join: s in UserDailyStat, on: s.user_id == u.id,
      where: u.status != "banned" and ilike(u.username, ^pattern),
      group_by: u.id,
      limit: 50,
      select: %{
        id:                 u.id,
        username:           u.username,
        role:               u.role,
        bio:                u.bio,
        avatar_url:         u.avatar_url,
        cover_url:          u.cover_url,
        inserted_at:        u.inserted_at,
        status:             u.status,
        post_count:         coalesce(sum(s.posts_count), 0),
        reply_count:        coalesce(sum(s.replies_count), 0),
        reactions_received: coalesce(sum(s.reactions_received), 0)
      }

    ordered = case sort do
      "oldest"         -> order_by(base, [u], [asc:  u.inserted_at])
      "most_posts"     -> order_by(base, [u, s], [desc: coalesce(sum(s.posts_count), 0),     asc: u.username])
      "most_replies"   -> order_by(base, [u, s], [desc: coalesce(sum(s.replies_count), 0),   asc: u.username])
      "most_reactions" -> order_by(base, [u, s], [desc: coalesce(sum(s.reactions_received), 0), asc: u.username])
      _                -> order_by(base, [u], [desc: u.inserted_at])
    end

    Repo.all(ordered)
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

  @avatar_colors ~w(#a78bfa #f472b6 #34d399 #60a5fa #fbbf24 #f87171 #ec4899 #10b981 #fb923c #38bdf8 #a3e635 #e879f9)

  def register_user(attrs) do
    # Pick a color based on total user count so consecutive users differ
    count = Repo.aggregate(User, :count)
    color = Enum.at(@avatar_colors, rem(count, length(@avatar_colors)))

    %User{}
    |> User.registration_changeset(attrs)
    |> Ecto.Changeset.put_change(:avatar_color, color)
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

          # remember_me may not exist if the migration hasn't run yet —
          # use Map.get with a safe fallback so we never crash on a missing column.
          remember_me = Map.get(token, :remember_me, true) || true

          # Rotate: revoke old token, issue a new one
          Repo.update!(RefreshToken.revoke_changeset(token))
          {:ok, new_refresh} = create_refresh_token(user, [remember_me: remember_me])

          {:ok, access_token} = JWT.generate_access_token(user)
          {:ok, %{access_token: access_token, refresh_token: new_refresh.token_hash, remember_me: remember_me}}
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

  # ── Push subscriptions ──────────────────────────────────────────────────────

  @max_subscriptions_per_user 20

  def add_push_subscription(user_id, endpoint, p256dh, auth, vapid_public_key) do
    # Return existing subscription silently if same endpoint re-registers
    case Repo.get_by(PushSubscription, endpoint: endpoint) do
      %PushSubscription{} = existing ->
        {:ok, existing}

      nil ->
        # Enforce per-user limit — drop oldest if over limit
        count = Repo.aggregate(from(s in PushSubscription, where: s.user_id == ^user_id), :count)

        if count >= @max_subscriptions_per_user do
          oldest =
            Repo.all(
              from s in PushSubscription,
                where: s.user_id == ^user_id,
                order_by: [asc: s.inserted_at],
                limit: ^(count - @max_subscriptions_per_user + 1)
            )
          Enum.each(oldest, &Repo.delete/1)
        end

        %PushSubscription{}
        |> PushSubscription.changeset(%{
          user_id:          user_id,
          endpoint:         endpoint,
          p256dh:           p256dh,
          auth:             auth,
          vapid_public_key: vapid_public_key
        })
        |> Repo.insert()
    end
  end

  def remove_push_subscription(endpoint) do
    case Repo.get_by(PushSubscription, endpoint: endpoint) do
      nil -> :ok
      sub -> Repo.delete(sub)
    end
  end

  def get_push_subscriptions(user_id) do
    Repo.all(from s in PushSubscription, where: s.user_id == ^user_id)
  end

  def has_push_subscription?(user_id) do
    Repo.exists?(from s in PushSubscription, where: s.user_id == ^user_id)
  end

  def clear_push_subscription_by_endpoint(endpoint) do
    Repo.delete_all(from s in PushSubscription, where: s.endpoint == ^endpoint)
  end

  def revoke_all_user_tokens(user_id) do
    from(t in RefreshToken, where: t.user_id == ^user_id and is_nil(t.revoked_at))
    |> Repo.update_all(set: [revoked_at: DateTime.utc_now() |> DateTime.truncate(:second)])
  end

  @doc "List all active (non-revoked, non-expired) sessions for a user."
  def list_user_sessions(user_id) do
    now = DateTime.utc_now()
    Repo.all(
      from t in RefreshToken,
        where: t.user_id == ^user_id
          and is_nil(t.revoked_at)
          and t.expires_at > ^now,
        order_by: [desc: t.inserted_at]
    )
  end

  @doc "Revoke a single session by id, scoped to the user so they cannot revoke others'."
  def revoke_session(user_id, token_id) do
    case Repo.get_by(RefreshToken, id: token_id, user_id: user_id) do
      nil   -> {:error, :not_found}
      token ->
        token |> RefreshToken.revoke_changeset() |> Repo.update()
    end
  end

  @doc "Revoke all sessions for a user except the one with the given token hash."
  def revoke_other_sessions(user_id, current_token_hash) do
    from(t in RefreshToken,
      where: t.user_id == ^user_id
        and is_nil(t.revoked_at)
        and t.token_hash != ^current_token_hash
    )
    |> Repo.update_all(set: [revoked_at: DateTime.utc_now() |> DateTime.truncate(:second)])
  end

  defp create_refresh_token(user, opts) do
    raw_token   = generate_raw_token()
    remember_me = Keyword.get(opts, :remember_me, true)
    # Persistent sessions: 30 days. Session-only: 24 hours.
    ttl_seconds = if remember_me, do: 30 * 24 * 60 * 60, else: 24 * 60 * 60
    expires_at  = DateTime.utc_now() |> DateTime.add(ttl_seconds, :second) |> DateTime.truncate(:second)

    %RefreshToken{}
    |> RefreshToken.changeset(%{
      user_id:     user.id,
      token_hash:  hash_token(raw_token),
      expires_at:  expires_at,
      user_agent:  Keyword.get(opts, :user_agent),
      ip_address:  Keyword.get(opts, :ip_address),
      remember_me: remember_me
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
        raw_token = generate_raw_token()

        user
        |> User.magic_token_changeset(hash_token(raw_token))
        |> Repo.update!()

        Nexus.Mailer.send_magic_link(user, raw_token)
        {:ok, :sent}
    end
  end

  def authenticate_magic_link(token) do
    token_hash          = hash_token(token)
    fifteen_minutes_ago = DateTime.utc_now() |> DateTime.add(-15 * 60, :second)

    user =
      Repo.one(
        from u in User,
          where: u.magic_token == ^token_hash,
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

  # ---------------------------------------------------------------------------
  # Admin user management
  # ---------------------------------------------------------------------------

  def admin_verify_email(user_id) do
    case Repo.get(User, user_id) do
      nil  -> {:error, :not_found}
      user ->
        user
        |> Ecto.Changeset.change(email_verified: true, email_verify_token: nil)
        |> Repo.update()
    end
  end

  def admin_create_user(attrs) do
    # skip_verification: true means email_verified is set to true immediately
    skip = Map.get(attrs, "skip_verification", false)
    changeset =
      %User{}
      |> User.registration_changeset(attrs)
      |> (fn cs -> if skip, do: Ecto.Changeset.put_change(cs, :email_verified, true), else: cs end).()
    Repo.insert(changeset)
  end

  def send_verification_email(user) do
    raw_token = generate_raw_token()

    user
    |> User.email_verify_token_changeset(hash_token(raw_token))
    |> Repo.update!()

    Nexus.Mailer.send_verification_email(user, raw_token)
    {:ok, :sent}
  end

  def verify_email(token) do
    token_hash = hash_token(token)
    user = Repo.get_by(User, email_verify_token: token_hash)

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

    # Retry loop handles the race condition where two concurrent OAuth
    # registrations pick the same username between check and insert.
    username = find_unique_username(base, 0)

    Map.put(attrs, :username, username)
  end

  defp find_unique_username(base, attempt) when attempt < 10 do
    candidate = if attempt == 0, do: base, else: "#{base}_#{:rand.uniform(9999)}"
    if Repo.get_by(User, username: candidate) do
      find_unique_username(base, attempt + 1)
    else
      candidate
    end
  end
  defp find_unique_username(base, _attempt) do
    # Fallback after 10 attempts — use a timestamp suffix which is effectively unique
    "#{base}_#{System.system_time(:millisecond)}"
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
