defmodule Nexus.Accounts.PushSubscription do
  use Ecto.Schema
  import Ecto.Changeset

  schema "push_subscriptions" do
    field :endpoint,         :string
    field :p256dh,           :string
    field :auth,             :string
    field :vapid_public_key, :string
    field :last_used_at,     :utc_datetime

    belongs_to :user, Nexus.Accounts.User

    timestamps(type: :utc_datetime)
  end

  def changeset(sub, attrs) do
    sub
    |> cast(attrs, [:user_id, :endpoint, :p256dh, :auth, :vapid_public_key])
    |> validate_required([:user_id, :endpoint, :p256dh, :auth])
  end
end
