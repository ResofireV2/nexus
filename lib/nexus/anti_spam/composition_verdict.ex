defmodule Nexus.AntiSpam.CompositionVerdict do
  use Ecto.Schema
  import Ecto.Changeset

  schema "composition_verdicts" do
    field :verdict,     :string
    field :details,     :map, default: %{}
    field :report_only, :boolean, default: false

    belongs_to :post,  Nexus.Forum.Post
    belongs_to :reply, Nexus.Forum.Reply
    belongs_to :user,  Nexus.Accounts.User

    timestamps(type: :utc_datetime, updated_at: false)
  end

  def changeset(verdict, attrs) do
    verdict
    |> cast(attrs, [:post_id, :reply_id, :user_id, :verdict, :details, :report_only])
    |> validate_required([:user_id, :verdict])
  end
end
