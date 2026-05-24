defmodule Nexus.Repo.Migrations.AddExtensionFieldsToUploads do
  use Ecto.Migration

  def change do
    alter table(:uploads) do
      add :extension_slug,      :string
      add :extension_record_id, :string
    end

    create index(:uploads, [:extension_slug])
    create index(:uploads, [:extension_slug, :extension_record_id])
  end
end
