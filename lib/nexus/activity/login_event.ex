defmodule Nexus.Activity.LoginEvent do
  use Ecto.Schema
  import Ecto.Changeset

  schema "login_events" do
    field :ip_address, :string
    field :user_agent, :string
    belongs_to :user, Nexus.Accounts.User
    timestamps(type: :utc_datetime, updated_at: false)
  end

  def changeset(event, attrs) do
    event
    |> cast(attrs, [:user_id, :ip_address, :user_agent])
    |> validate_required([:user_id])
  end
end
