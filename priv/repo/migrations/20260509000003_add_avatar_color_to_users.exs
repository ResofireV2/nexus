defmodule Nexus.Repo.Migrations.AddAvatarColorToUsers do
  use Ecto.Migration

  def up do
    alter table(:users) do
      add :avatar_color, :string
    end

    flush()

    repo().query!("""
      UPDATE users
      SET avatar_color = CASE (id % 12)
        WHEN 0  THEN '#a78bfa'
        WHEN 1  THEN '#f472b6'
        WHEN 2  THEN '#34d399'
        WHEN 3  THEN '#60a5fa'
        WHEN 4  THEN '#fbbf24'
        WHEN 5  THEN '#f87171'
        WHEN 6  THEN '#ec4899'
        WHEN 7  THEN '#10b981'
        WHEN 8  THEN '#fb923c'
        WHEN 9  THEN '#38bdf8'
        WHEN 10 THEN '#a3e635'
        WHEN 11 THEN '#e879f9'
      END
      WHERE avatar_color IS NULL
    """)
  end

  def down do
    alter table(:users) do
      remove :avatar_color
    end
  end
end
