defmodule Nexus.Leaderboard.UserScore do
  use Ecto.Schema
  import Ecto.Changeset

  schema "user_scores" do
    field :score_all,   :integer, default: 0
    field :score_month, :integer, default: 0
    field :score_week,  :integer, default: 0
    field :updated_at,  :utc_datetime

    belongs_to :user, Nexus.Accounts.User
  end

  def changeset(score, attrs) do
    score
    |> cast(attrs, [:user_id, :score_all, :score_month, :score_week, :updated_at])
    |> validate_required([:user_id, :updated_at])
    |> unique_constraint(:user_id)
    |> foreign_key_constraint(:user_id)
  end
end
