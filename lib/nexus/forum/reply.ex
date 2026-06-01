defmodule Nexus.Forum.Reply do
  use Ecto.Schema
  import Ecto.Changeset

  schema "replies" do
    field :body,          :string
    field :body_format,   :string, default: "markdown"
    field :reaction_count, :integer, default: 0
    field :hidden,           :boolean, default: false
    field :hidden_at,        :utc_datetime
    field :pending_approval, :boolean, default: false
    field :edit_count,    :integer, default: 0
    field :search_vector, :string, load_in_query: false  # tsvector — managed by DB trigger

    belongs_to :user,      Nexus.Accounts.User
    belongs_to :post,      Nexus.Forum.Post
    belongs_to :hidden_by, Nexus.Accounts.User

    has_many :reactions,   Nexus.Forum.Reaction

    timestamps(type: :utc_datetime)
  end

  def changeset(reply, attrs) do
    reply
    |> cast(attrs, [:body, :body_format, :post_id, :user_id, :pending_approval])
    |> validate_required([:body, :post_id])
    |> validate_length(:body, min: 1, max: 50_000)
    |> validate_inclusion(:body_format, ~w(markdown rich))
    |> foreign_key_constraint(:post_id)
  end

  def hide_changeset(reply, moderator_id) do
    reply
    |> change(hidden: true, hidden_at: DateTime.utc_now() |> DateTime.truncate(:second), hidden_by_id: moderator_id)
  end
end
