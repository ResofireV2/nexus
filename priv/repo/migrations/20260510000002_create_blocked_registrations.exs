defmodule Nexus.Repo.Migrations.CreateBlockedRegistrations do
  use Ecto.Migration

  def change do
    create table(:blocked_registrations) do
      add :ip,       :string
      add :email,    :string
      add :username, :string
      add :reason,   :string,  null: false  # "sfs" | "honeypot"
      add :sfs_data, :map                   # raw SFS API response, nil for honeypot blocks

      timestamps(type: :utc_datetime)
    end

    create index(:blocked_registrations, [:email])
    create index(:blocked_registrations, [:ip])
    create index(:blocked_registrations, [:inserted_at])
  end
end
