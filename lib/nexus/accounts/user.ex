defmodule Nexus.Accounts.User do
  use Ecto.Schema
  import Ecto.Changeset

  @roles ~w(member moderator admin)
  @statuses ~w(active muted suspended banned)

  schema "users" do
    field :email,                :string
    field :username,             :string
    field :password,             :string, virtual: true
    field :password_hash,        :string
    field :role,                 :string, default: "member"

    field :email_verified,       :boolean, default: false
    field :email_verify_token,   :string
    field :email_verify_sent_at, :utc_datetime

    field :oauth_provider,       :string
    field :oauth_uid,            :string

    field :avatar_url,           :string
    field :cover_url,            :string
    field :bio,                  :string

    field :status,               :string, default: "active"
    field :status_until,         :utc_datetime
    field :status_reason,        :string

    field :preferences,          :map, default: %{}
    field :push_subscription,    :map

    field :magic_token,          :string
    field :magic_token_sent_at,  :utc_datetime

    field :reset_token,          :string
    field :reset_token_sent_at,  :utc_datetime

    has_many :posts,             Nexus.Forum.Post
    has_many :replies,           Nexus.Forum.Reply
    has_many :refresh_tokens,    Nexus.Accounts.RefreshToken
    has_many :space_subscriptions, Nexus.Forum.SpaceSubscription
    has_many :tag_subscriptions, Nexus.Forum.TagSubscription
    has_many :notifications,     Nexus.Notifications.Notification

    timestamps(type: :utc_datetime)
  end

  def registration_changeset(user, attrs) do
    user
    |> cast(attrs, [:email, :username, :password])
    |> validate_required([:email, :username, :password])
    |> validate_email()
    |> validate_username()
    |> validate_password()
    |> hash_password()
  end

  def oauth_changeset(user, attrs) do
    user
    |> cast(attrs, [:email, :username, :oauth_provider, :oauth_uid, :avatar_url])
    |> validate_required([:email, :username, :oauth_provider, :oauth_uid])
    |> validate_email()
    |> validate_username()
  end

  def profile_changeset(user, attrs) do
    user
    |> cast(attrs, [:username, :bio, :avatar_url, :cover_url])
    |> validate_username()
  end

  def password_changeset(user, attrs) do
    user
    |> cast(attrs, [:password])
    |> validate_password()
    |> hash_password()
  end

  def role_changeset(user, attrs) do
    user
    |> cast(attrs, [:role])
    |> validate_inclusion(:role, @roles)
  end

  def status_changeset(user, attrs) do
    user
    |> cast(attrs, [:status, :status_until, :status_reason])
    |> validate_inclusion(:status, @statuses)
  end

  def preferences_changeset(user, attrs) do
    user
    |> cast(attrs, [:preferences, :push_subscription])
  end

  def verify_email_changeset(user) do
    user
    |> change(email_verified: true, email_verify_token: nil)
  end

  def magic_token_changeset(user, token) do
    user
    |> change(magic_token: token, magic_token_sent_at: DateTime.utc_now() |> DateTime.truncate(:second))
  end

  defp validate_email(changeset) do
    changeset
    |> validate_required([:email])
    |> validate_format(:email, ~r/^[^\s]+@[^\s]+$/, message: "must be a valid email address")
    |> validate_length(:email, max: 160)
    |> unsafe_validate_unique(:email, Nexus.Repo)
    |> unique_constraint(:email)
  end

  defp validate_username(changeset) do
    changeset
    |> validate_required([:username])
    |> validate_length(:username, min: 3, max: 30)
    |> validate_format(:username, ~r/^[a-zA-Z0-9_]+$/, message: "only letters, numbers, and underscores")
    |> unsafe_validate_unique(:username, Nexus.Repo)
    |> unique_constraint(:username)
  end

  defp validate_password(changeset) do
    changeset
    |> validate_required([:password])
    |> validate_length(:password, min: 8, max: 72)
  end

  defp hash_password(changeset) do
    case get_change(changeset, :password) do
      nil -> changeset
      password ->
        changeset
        |> put_change(:password_hash, Bcrypt.hash_pwd_salt(password))
        |> delete_change(:password)
    end
  end

  def active?(%__MODULE__{status: "active"}), do: true
  def active?(_), do: false

  def admin?(%__MODULE__{role: "admin"}), do: true
  def admin?(_), do: false

  def moderator?(%__MODULE__{role: role}) when role in ["admin", "moderator"], do: true
  def moderator?(_), do: false
end
