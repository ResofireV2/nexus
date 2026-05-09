defmodule Nexus.Forum.PostFollow do
  use Ecto.Schema
  import Ecto.Changeset

  schema "post_follows" do
    belongs_to :user, Nexus.Accounts.User
    belongs_to :post, Nexus.Forum.Post
    timestamps(updated_at: false)
  end

  def changeset(follow, attrs) do
    follow
    |> cast(attrs, [:user_id, :post_id])
    |> validate_required([:user_id, :post_id])
    |> unique_constraint([:user_id, :post_id])
  end
end
