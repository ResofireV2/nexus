defmodule Nexus.Activity.UserDailyStat do
  use Ecto.Schema
  import Ecto.Changeset

  schema "user_daily_stats" do
    field :date,               :date
    field :posts_count,        :integer, default: 0
    field :replies_count,      :integer, default: 0
    field :reactions_given,    :integer, default: 0
    field :reactions_received, :integer, default: 0
    belongs_to :user, Nexus.Accounts.User
    timestamps(type: :utc_datetime)
  end

  def changeset(stat, attrs) do
    stat
    |> cast(attrs, [:user_id, :date, :posts_count, :replies_count, :reactions_given, :reactions_received])
    |> validate_required([:user_id, :date])
  end
end
