defmodule Nexus.Accounts.RefreshToken do
  use Ecto.Schema
  import Ecto.Changeset

  schema "refresh_tokens" do
    field :token_hash,  :string
    field :expires_at,  :naive_datetime
    field :revoked_at,  :naive_datetime
    field :user_agent,  :string
    field :ip_address,  :string
    field :remember_me, :boolean, default: true

    belongs_to :user, Nexus.Accounts.User

    timestamps(type: :naive_datetime)
  end

  def changeset(token, attrs) do
    token
    |> cast(attrs, [:user_id, :token_hash, :expires_at, :user_agent, :ip_address, :remember_me])
    |> validate_required([:user_id, :token_hash, :expires_at])
    |> unique_constraint(:token_hash)
  end

  def revoke_changeset(token) do
    change(token, revoked_at: NaiveDateTime.utc_now() |> NaiveDateTime.truncate(:second))
  end

  def valid?(%__MODULE__{revoked_at: nil, expires_at: expires_at}) do
    NaiveDateTime.compare(expires_at, NaiveDateTime.utc_now()) == :gt
  end
  def valid?(_), do: false
end
