defmodule Nexus.Notifications.Notification do
  use Ecto.Schema
  import Ecto.Changeset

  @types ~w(reply mention reaction dm announcement badge followed_post extension)

  schema "notifications" do
    field :type,         :string
    field :read,         :boolean, default: false
    field :read_at,      :utc_datetime
    field :data,         :map, default: %{}
    field :group_count,  :integer, default: 1
    field :group_actors, {:array, :integer}, default: []

    belongs_to :user,    Nexus.Accounts.User
    belongs_to :actor,   Nexus.Accounts.User
    belongs_to :post,    Nexus.Forum.Post
    belongs_to :reply,   Nexus.Forum.Reply
    belongs_to :message, Nexus.Messaging.Message

    timestamps(type: :utc_datetime)
  end

  def changeset(notification, attrs) do
    notification
    |> cast(attrs, [:type, :user_id, :actor_id, :post_id, :reply_id, :message_id, :data, :group_count, :group_actors])
    |> validate_required([:type, :user_id])
    |> validate_inclusion(:type, @types)
  end

  def mark_read_changeset(notification) do
    notification
    |> change(read: true, read_at: DateTime.utc_now() |> DateTime.truncate(:second))
  end
end
