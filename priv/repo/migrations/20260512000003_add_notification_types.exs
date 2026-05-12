defmodule Nexus.Repo.Migrations.AddNotificationTypes do
  use Ecto.Migration

  def change do
    # Add a partial index for extension notifications for efficient querying
    # by extensions that want to count or list their own notification types.
    # The notifications table uses a string type column so no schema change
    # is needed — this migration adds supporting indexes only.
    create index(:notifications, [:type, :user_id],
      name: :notifications_type_user_idx)

    create index(:notifications, [:user_id, :type, :post_id],
      name: :notifications_grouping_idx)
  end
end
