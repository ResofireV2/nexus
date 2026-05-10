defmodule Nexus.AntiSpam.BlockedRegistration do
  use Ecto.Schema
  import Ecto.Changeset

  schema "blocked_registrations" do
    field :ip,       :string
    field :email,    :string
    field :username, :string
    field :reason,   :string
    field :sfs_data, :map

    timestamps(type: :utc_datetime)
  end

  def changeset(struct, attrs) do
    struct
    |> cast(attrs, [:ip, :email, :username, :reason, :sfs_data])
    |> validate_required([:reason])
    |> validate_inclusion(:reason, ["sfs", "honeypot"])
  end
end
