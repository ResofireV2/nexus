defmodule Nexus.Repo.Migrations.CreateBadges do
  use Ecto.Migration

  def change do
    create table(:badges) do
      add :name,              :string, null: false
      add :description,       :text, null: false
      add :icon,              :string, null: false, default: "fa-medal"
      add :color,             :string, null: false, default: "#a78bfa"
      add :rarity,            :string, null: false, default: "common"
      # rarity: "common" | "rare" | "epic" | "legendary"

      add :award_type,        :string, null: false, default: "auto"
      # award_type: "auto" | "manual"

      # Auto badge criteria — null for manual badges
      add :trigger_type,      :string
      # trigger_type: "post_count" | "reply_count" | "reactions_received" |
      #               "reactions_given" | "streak_days" | "account_age_days" |
      #               "spaces_covered"
      add :trigger_threshold, :integer

      add :is_preset,         :boolean, null: false, default: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:badges, [:name])
    create index(:badges, [:award_type])
    create index(:badges, [:rarity])
  end
end
