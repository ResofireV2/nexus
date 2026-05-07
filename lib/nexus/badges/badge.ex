defmodule Nexus.Badges.Badge do
  use Ecto.Schema
  import Ecto.Changeset

  @rarities   ~w(common rare epic legendary)
  @award_types ~w(auto manual)
  @trigger_types ~w(post_count reply_count reactions_received reactions_given streak_days account_age_days spaces_covered)

  schema "badges" do
    field :name,              :string
    field :description,       :string
    field :icon,              :string, default: "fa-medal"
    field :color,             :string, default: "#a78bfa"
    field :rarity,            :string, default: "common"
    field :award_type,        :string, default: "auto"
    field :trigger_type,      :string
    field :trigger_threshold, :integer
    field :is_preset,         :boolean, default: false

    has_many :user_badges, Nexus.Badges.UserBadge

    timestamps(type: :utc_datetime)
  end

  def changeset(badge, attrs) do
    badge
    |> cast(attrs, [:name, :description, :icon, :color, :rarity, :award_type,
                    :trigger_type, :trigger_threshold, :is_preset])
    |> validate_required([:name, :description, :icon, :color, :rarity, :award_type])
    |> validate_inclusion(:rarity, @rarities)
    |> validate_inclusion(:award_type, @award_types)
    |> validate_trigger()
    |> validate_format(:color, ~r/^#[0-9a-fA-F]{6}$/, message: "must be a hex color")
    |> validate_length(:name, min: 1, max: 60)
    |> validate_length(:description, min: 1, max: 300)
    |> unique_constraint(:name)
  end

  defp validate_trigger(changeset) do
    award_type = get_field(changeset, :award_type)

    case award_type do
      "auto" ->
        changeset
        |> validate_required([:trigger_type, :trigger_threshold],
             message: "is required for automatic badges")
        |> validate_inclusion(:trigger_type, @trigger_types)
        |> validate_number(:trigger_threshold, greater_than: 0)

      "manual" ->
        # Clear any trigger fields — manual badges have no criteria
        changeset
        |> put_change(:trigger_type, nil)
        |> put_change(:trigger_threshold, nil)

      _ ->
        changeset
    end
  end
end
