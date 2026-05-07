defmodule Nexus.Forum.PostSave do
  use Ecto.Schema
  import Ecto.Changeset

  schema "post_saves" do
    field :inserted_at, :utc_datetime

    belongs_to :user,  Nexus.Accounts.User
    belongs_to :post,  Nexus.Forum.Post
    belongs_to :reply, Nexus.Forum.Reply
  end

  def changeset(save, attrs) do
    save
    |> cast(attrs, [:user_id, :post_id, :reply_id, :inserted_at])
    |> validate_required([:user_id, :inserted_at])
    |> foreign_key_constraint(:user_id)
    |> foreign_key_constraint(:post_id)
    |> foreign_key_constraint(:reply_id)
  end
end
