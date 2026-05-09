defmodule Nexus.Forum.PostEdit do
  use Ecto.Schema
  import Ecto.Changeset

  schema "post_edits" do
    belongs_to :post,  Nexus.Forum.Post
    belongs_to :reply, Nexus.Forum.Reply
    belongs_to :user,  Nexus.Accounts.User
    field :old_title, :string
    field :old_body,  :string
    field :edited_at, :utc_datetime
  end

  def changeset(edit, attrs) do
    edit
    |> cast(attrs, [:post_id, :reply_id, :user_id, :old_title, :old_body, :edited_at])
    |> validate_required([:user_id, :old_body, :edited_at])
  end
end
