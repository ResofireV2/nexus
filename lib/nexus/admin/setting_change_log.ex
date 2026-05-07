defmodule Nexus.Admin.SettingChangeLog do
  use Ecto.Schema
  import Ecto.Changeset

  schema "setting_change_logs" do
    field :section,    :string
    field :old_value,  :map, default: %{}
    field :new_value,  :map, default: %{}
    field :inserted_at, :utc_datetime

    belongs_to :admin, Nexus.Accounts.User
  end

  def changeset(log, attrs) do
    log
    |> cast(attrs, [:section, :old_value, :new_value, :admin_id, :inserted_at])
    |> validate_required([:section, :new_value, :inserted_at])
  end
end
