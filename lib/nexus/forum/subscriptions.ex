defmodule Nexus.Forum.SpaceSubscription do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key false
  schema "space_subscriptions" do
    belongs_to :user,  Nexus.Accounts.User
    belongs_to :space, Nexus.Forum.Space
    field :inserted_at, :utc_datetime
  end

  def changeset(sub, attrs) do
    sub
    |> cast(attrs, [:user_id, :space_id])
    |> validate_required([:user_id, :space_id])
    |> unique_constraint([:user_id, :space_id])
  end
end

defmodule Nexus.Forum.TagSubscription do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key false
  schema "tag_subscriptions" do
    belongs_to :user, Nexus.Accounts.User
    belongs_to :tag,  Nexus.Forum.Tag
    field :inserted_at, :utc_datetime
  end

  def changeset(sub, attrs) do
    sub
    |> cast(attrs, [:user_id, :tag_id])
    |> validate_required([:user_id, :tag_id])
    |> unique_constraint([:user_id, :tag_id])
  end
end
