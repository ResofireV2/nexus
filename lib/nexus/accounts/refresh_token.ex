defmodule Nexus.Accounts.RefreshToken do
  use Ecto.Schema
  import Ecto.Changeset

  schema "refresh_tokens" do
    field :token_hash, :string
    field :expires_at, :utc_datetime
    field :revoked_at, :utc_datetime
    field :user_agent, :string
    field :ip_address, :string

    belongs_to :user, Nexus.Accounts.User

    timestamps(type: :utc_datetime)
  end

  def changeset(token, attrs) do
    token
    |> cast(attrs, [:user_id, :token_hash, :expires_at, :user_agent, :ip_address])
    |> validate_required([:user_id, :token_hash, :expires_at])
    |> unique_constraint(:token_hash)
  end

  def revoke_changeset(token) do
    change(token, revoked_at: DateTime.utc_now() |> DateTime.truncate(:second))
  end

  def valid?(%__MODULE__{revoked_at: nil, expires_at: expires_at}) do
    DateTime.compare(expires_at, DateTime.utc_now()) == :gt
  end
  def valid?(_), do: false
end
