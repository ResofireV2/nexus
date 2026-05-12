defmodule Nexus.Drafts.Draft do
  use Ecto.Schema
  import Ecto.Changeset

  schema "drafts" do
    field :type,      :string, default: "post"
    field :title,     :string
    field :body,      :string, default: ""
    field :post_type, :string, default: "discussion"
    field :tag_ids,   {:array, :integer}, default: []

    belongs_to :user,  Nexus.Accounts.User
    belongs_to :space, Nexus.Forum.Space
    belongs_to :post,  Nexus.Forum.Post   # reply drafts only

    timestamps(type: :utc_datetime)
  end

  def changeset(draft, attrs) do
    draft
    |> cast(attrs, [:user_id, :type, :title, :body, :post_type, :space_id, :post_id, :tag_ids])
    |> validate_required([:user_id, :type])
    |> validate_inclusion(:type, ~w(post reply))
    |> validate_inclusion(:post_type, ~w(discussion announcement question))
    |> validate_length(:title, max: 255)
    |> validate_length(:body, max: 100_000)
    |> foreign_key_constraint(:user_id)
    |> foreign_key_constraint(:space_id)
    |> foreign_key_constraint(:post_id)
  end
end
