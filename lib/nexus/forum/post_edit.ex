defmodule Nexus.Forum.PostEdit do
  use Ecto.Schema
  import Ecto.Changeset

  schema "post_edits" do
    belongs_to :post,  Nexus.Forum.Post
    belongs_to :reply, Nexus.Forum.Reply
    belongs_to :user,  Nexus.Accounts.User
    field :old_title, :string
    field :old_body,  :string
    # Snapshot of the post's Space and tags before the edit. Plain integers
    # rather than associations — this is a historical record, so a Space or tag
    # deleted later should not alter or remove it. Nil on reply edits and on
    # rows written before these columns existed.
    field :old_space_id, :integer
    field :old_tag_ids,  {:array, :integer}
    field :edited_at, :utc_datetime
  end

  def changeset(edit, attrs) do
    edit
    |> cast(attrs, [:post_id, :reply_id, :user_id, :old_title, :old_body,
                    :old_space_id, :old_tag_ids, :edited_at])
    |> validate_required([:user_id, :old_body, :edited_at])
  end
end
