defmodule Nexus.Repo.Migrations.AddNotificationGrouping do
  use Ecto.Migration

  def change do
    alter table(:notifications) do
      # How many events are grouped into this notification row
      add :group_count,  :integer, default: 1, null: false
      # JSON array of the most recent actor user IDs (up to 3) for grouped display
      add :group_actors, {:array, :integer}, default: []
    end
  end
end
