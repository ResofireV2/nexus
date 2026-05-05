defmodule Nexus.Forum.Reaction do
  use Ecto.Schema
  import Ecto.Changeset

  schema "reactions" do
    field :emoji,    :string

    belongs_to :user,  Nexus.Accounts.User
    belongs_to :post,  Nexus.Forum.Post
    belongs_to :reply, Nexus.Forum.Reply

    timestamps(type: :utc_datetime)
  end

  def changeset(reaction, attrs) do
    reaction
    |> cast(attrs, [:emoji, :user_id, :post_id, :reply_id])
    |> validate_required([:emoji, :user_id])
    |> validate_length(:emoji, min: 1, max: 10)
    |> validate_target()
  end

  defp validate_target(changeset) do
    post_id  = get_field(changeset, :post_id)
    reply_id = get_field(changeset, :reply_id)

    cond do
      is_nil(post_id) and is_nil(reply_id) ->
        add_error(changeset, :base, "must belong to a post or reply")
      not is_nil(post_id) and not is_nil(reply_id) ->
        add_error(changeset, :base, "cannot belong to both a post and a reply")
      true ->
        changeset
    end
  end
end
