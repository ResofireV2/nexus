defmodule Nexus.Repo.Migrations.DropProxyWebhookColumnsAndExtensionTables do
  use Ecto.Migration

  # Cleanup of the legacy out-of-VM extension model. After this migration,
  # the extensions table no longer carries fields used by the deleted
  # ExtensionProxyController / webhook delivery path, and the unused
  # extension_hooks / extension_slots tables are gone.
  #
  # Hook and slot registrations are now derived from the loaded module at
  # runtime (handle_event/3 export, manifest/0 :slots key) and stored in
  # the ETS-backed Nexus.Extensions.Registry. The DB tables were vestiges
  # of the old webhook-based registration model and contributed nothing
  # to dispatch.

  def up do
    alter table(:extensions) do
      remove :webhook_url
      remove :service_url
      remove :proxy_secret
    end

    # Tables drop their own indexes when the table is dropped, so we don't
    # have to drop the indexes explicitly first.
    drop table(:extension_slots)
    drop table(:extension_hooks)
  end

  def down do
    create table(:extension_hooks) do
      add :extension_id, references(:extensions, on_delete: :delete_all), null: false
      add :event,        :string, null: false
      add :handler,      :string, null: false
      add :priority,     :integer, null: false, default: 50
      add :enabled,      :boolean, null: false, default: true

      timestamps(type: :utc_datetime)
    end

    create index(:extension_hooks, [:event])
    create index(:extension_hooks, [:extension_id])

    create table(:extension_slots) do
      add :extension_id, references(:extensions, on_delete: :delete_all), null: false
      add :slot,         :string, null: false
      add :component,    :string, null: false
      add :priority,     :integer, null: false, default: 50
      add :enabled,      :boolean, null: false, default: true

      timestamps(type: :utc_datetime)
    end

    create index(:extension_slots, [:slot])
    create index(:extension_slots, [:extension_id])

    alter table(:extensions) do
      add :webhook_url,  :string
      add :service_url,  :string
      add :proxy_secret, :string
    end
  end
end
