defmodule Nexus.Messaging.UserBlock do
  @moduledoc """
  One member blocking another from direct messages.

  Stored one-directionally so the blocker's list of blocked users is
  answerable, but enforced in both directions: while a block exists neither
  party can message the other. A one-way block would leave the blocker able to
  message someone who cannot reply, and would leave the blocked user holding a
  thread that silently swallows their messages.
  """
  use Ecto.Schema
  import Ecto.Changeset

  schema "user_blocks" do
    belongs_to :blocker, Nexus.Accounts.User
    belongs_to :blocked, Nexus.Accounts.User

    timestamps(type: :utc_datetime, updated_at: false)
  end

  def changeset(block, attrs) do
    block
    |> cast(attrs, [:blocker_id, :blocked_id])
    |> validate_required([:blocker_id, :blocked_id])
    |> unique_constraint([:blocker_id, :blocked_id])
  end
end
