defmodule Nexus.Groups.GroupMembership do
  use Ecto.Schema
  import Ecto.Changeset

  schema "group_memberships" do
    belongs_to :group, Nexus.Groups.Group
    belongs_to :user,  Nexus.Accounts.User

    field :inserted_at, :utc_datetime
  end

  def changeset(membership, attrs) do
    membership
    |> cast(attrs, [:group_id, :user_id, :inserted_at])
    |> validate_required([:group_id, :user_id, :inserted_at])
    |> unique_constraint([:group_id, :user_id])
    |> foreign_key_constraint(:group_id)
    |> foreign_key_constraint(:user_id)
  end
end
