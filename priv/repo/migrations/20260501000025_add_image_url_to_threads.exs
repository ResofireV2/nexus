defmodule Nexus.Repo.Migrations.AddImageUrlToThreads do
  use Ecto.Migration

  def change do
    alter table(:message_threads) do
      add :image_url, :string
    end
  end
end
