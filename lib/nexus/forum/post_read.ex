defmodule Nexus.Forum.PostRead do
  use Ecto.Schema
  import Ecto.Changeset

  schema "post_reads" do
    field :reply_count, :integer, default: 0
    belongs_to :user,       Nexus.Accounts.User
    belongs_to :post,       Nexus.Forum.Post
    belongs_to :last_reply, Nexus.Forum.Reply
    timestamps()
  end

  def changeset(read, attrs) do
    read
    |> cast(attrs, [:user_id, :post_id, :last_reply_id, :reply_count])
    |> validate_required([:user_id, :post_id])
  end
end
