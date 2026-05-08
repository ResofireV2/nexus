defmodule Nexus.Repo.Migrations.AddRememberMeToRefreshTokens do
  use Ecto.Migration

  def change do
    alter table(:refresh_tokens) do
      add :remember_me, :boolean, default: true, null: false
    end
  end
end
