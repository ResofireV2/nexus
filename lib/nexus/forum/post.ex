defmodule Nexus.Forum.Post do
  use Ecto.Schema
  import Ecto.Changeset

  schema "posts" do
    field :title,         :string
    field :body,          :string
    field :body_format,   :string, default: "markdown"
    field :type,          :string, default: "discussion"
    field :reply_count,   :integer, default: 0
    field :reaction_count, :integer, default: 0
    field :pinned,           :boolean, default: false
    field :locked,           :boolean, default: false
    field :hidden,           :boolean, default: false
    field :hidden_at,        :utc_datetime
    field :pending_approval, :boolean, default: false
    field :last_reply_at, :utc_datetime
    field :search_vector, :string, load_in_query: false  # tsvector — managed by DB trigger

    belongs_to :user,          Nexus.Accounts.User
    belongs_to :space,         Nexus.Forum.Space
    belongs_to :hidden_by,     Nexus.Accounts.User
    belongs_to :accepted_reply, Nexus.Forum.Reply, foreign_key: :accepted_reply_id

    has_many :replies,     Nexus.Forum.Reply
    has_many :reactions,   Nexus.Forum.Reaction
    many_to_many :tags,    Nexus.Forum.Tag, join_through: "post_tags", on_replace: :delete

    timestamps(type: :utc_datetime)
  end

  def changeset(post, attrs) do
    post
    |> cast(attrs, [:title, :body, :body_format, :type, :space_id, :user_id, :pending_approval])
    |> validate_required([:title, :body, :space_id])
    |> validate_length(:title, min: 3, max: 255)
    |> validate_length(:body, min: 1, max: 100_000)
    |> validate_inclusion(:body_format, ~w(markdown rich))
    |> validate_inclusion(:type, ~w(discussion announcement question))
    |> foreign_key_constraint(:space_id)
  end

  def hide_changeset(post, moderator_id) do
    post
    |> change(hidden: true, hidden_at: DateTime.utc_now() |> DateTime.truncate(:second), hidden_by_id: moderator_id)
  end

  def pin_changeset(post, pinned) do
    change(post, pinned: pinned)
  end

  def lock_changeset(post, locked) do
    change(post, locked: locked)
  end
end
