defmodule Nexus.Moderation.Log do
  use Ecto.Schema
  import Ecto.Changeset

  @actions ~w(ban unban mute unmute suspend unsuspend
              space_restrict space_unrestrict
              post_hide post_delete reply_hide reply_delete
              post_hold post_hold_logged post_hold_approved post_hold_rejected)

  schema "moderation_logs" do
    field :action,   :string
    field :reason,   :string
    field :duration, :integer
    field :data,     :map, default: %{}

    belongs_to :moderator,   Nexus.Accounts.User
    belongs_to :target_user, Nexus.Accounts.User
    belongs_to :post,        Nexus.Forum.Post
    belongs_to :reply,       Nexus.Forum.Reply
    belongs_to :space,       Nexus.Forum.Space

    timestamps(type: :utc_datetime)
  end

  def changeset(log, attrs) do
    log
    |> cast(attrs, [:action, :reason, :duration, :moderator_id, :target_user_id, :post_id, :reply_id, :space_id, :data])
    |> validate_required([:action, :moderator_id])
    |> validate_inclusion(:action, @actions)
  end
end
