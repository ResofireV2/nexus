defmodule Nexus.Badges.UserBadge do
  use Ecto.Schema
  import Ecto.Changeset

  schema "user_badges" do
    belongs_to :user,       Nexus.Accounts.User
    belongs_to :badge,      Nexus.Badges.Badge
    belongs_to :awarded_by, Nexus.Accounts.User

    field :awarded_at, :utc_datetime
  end

  def changeset(user_badge, attrs) do
    user_badge
    |> cast(attrs, [:user_id, :badge_id, :awarded_by_id, :awarded_at])
    |> validate_required([:user_id, :badge_id, :awarded_at])
    |> unique_constraint([:user_id, :badge_id])
    |> foreign_key_constraint(:user_id)
    |> foreign_key_constraint(:badge_id)
    |> foreign_key_constraint(:awarded_by_id)
  end
end
