defmodule Nexus.Messaging.Thread do
  use Ecto.Schema
  import Ecto.Changeset

  schema "message_threads" do
    field :kind,           :string, default: "direct"
    field :name,           :string
    field :emoji,          :string
    field :image_url,      :string
    field :last_message_at, :utc_datetime

    has_many :members,  Nexus.Messaging.ThreadMember
    has_many :messages, Nexus.Messaging.Message

    timestamps(type: :utc_datetime)
  end

  def changeset(thread, attrs) do
    thread
    |> cast(attrs, [:kind, :name, :emoji, :image_url])
    |> validate_inclusion(:kind, ~w(direct group))
    |> validate_group_fields()
  end

  defp validate_group_fields(changeset) do
    case get_field(changeset, :kind) do
      "group" ->
        changeset
        |> validate_length(:name, min: 1, max: 50)
      _ ->
        changeset
    end
  end
end

defmodule Nexus.Messaging.ThreadMember do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key false
  schema "message_thread_members" do
    belongs_to :thread, Nexus.Messaging.Thread
    belongs_to :user,   Nexus.Accounts.User
    field :muted,        :boolean, default: false
    field :last_read_at, :utc_datetime
    field :inserted_at,  :utc_datetime
  end

  def changeset(member, attrs) do
    member
    |> cast(attrs, [:thread_id, :user_id, :muted, :last_read_at])
    |> validate_required([:thread_id, :user_id])
    |> unique_constraint([:thread_id, :user_id])
  end

  def mute_changeset(member, muted) do
    change(member, muted: muted)
  end
end

defmodule Nexus.Messaging.Message do
  use Ecto.Schema
  import Ecto.Changeset

  schema "messages" do
    field :body,        :string
    field :body_format, :string, default: "markdown"
    field :read_at,     :utc_datetime

    belongs_to :thread, Nexus.Messaging.Thread
    belongs_to :user,   Nexus.Accounts.User

    timestamps(type: :utc_datetime)
  end

  def changeset(message, attrs) do
    message
    |> cast(attrs, [:body, :body_format, :thread_id, :user_id])
    |> validate_required([:body, :thread_id, :user_id])
    |> validate_length(:body, min: 1, max: 10_000)
    |> validate_inclusion(:body_format, ~w(markdown rich))
  end
end
