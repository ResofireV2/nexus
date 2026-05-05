defmodule Nexus.Moderation.Report do
  use Ecto.Schema
  import Ecto.Changeset

  @reasons ~w(spam harassment misinformation off_topic other)
  @statuses ~w(pending reviewed dismissed actioned)

  schema "reports" do
    field :reason,      :string
    field :notes,       :string
    field :status,      :string, default: "pending"
    field :reviewed_at, :utc_datetime

    belongs_to :reporter, Nexus.Accounts.User
    belongs_to :reviewer, Nexus.Accounts.User
    belongs_to :post,     Nexus.Forum.Post
    belongs_to :reply,    Nexus.Forum.Reply
    belongs_to :user,     Nexus.Accounts.User, foreign_key: :user_id

    timestamps(type: :utc_datetime)
  end

  def changeset(report, attrs) do
    report
    |> cast(attrs, [:reason, :notes, :reporter_id, :post_id, :reply_id, :user_id])
    |> validate_required([:reason, :reporter_id])
    |> validate_inclusion(:reason, @reasons)
    |> validate_target()
  end

  def review_changeset(report, attrs) do
    report
    |> cast(attrs, [:status, :reviewer_id])
    |> validate_required([:status, :reviewer_id])
    |> validate_inclusion(:status, @statuses)
    |> put_change(:reviewed_at, DateTime.utc_now() |> DateTime.truncate(:second))
  end

  defp validate_target(changeset) do
    post_id  = get_field(changeset, :post_id)
    reply_id = get_field(changeset, :reply_id)
    user_id  = get_field(changeset, :user_id)

    targets = [post_id, reply_id, user_id] |> Enum.count(&(not is_nil(&1)))

    if targets == 1 do
      changeset
    else
      add_error(changeset, :base, "must target exactly one post, reply, or user")
    end
  end
end
