defmodule Nexus.Repo.Migrations.AddLoadStatusToExtensions do
  use Ecto.Migration

  def change do
    alter table(:extensions) do
      # Tracks whether the extension is currently loaded into the VM and why
      # it isn't if it isn't. Values used by the loader / install flow:
      #
      #   "loaded"            — module compiled, migrations run, registered in ETS
      #   "not_loaded"        — DB row exists but loader has not run yet
      #   "no_repo"           — install URL did not resolve to a GitHub repo
      #   "no_release"        — github_repo has no published release to install from
      #   "download_failed"   — tarball could not be fetched from GitHub
      #   "compile_failed"    — extension source did not compile
      #   "migration_failed"  — migrations raised
      #   "disabled"          — admin toggled enabled=false; loader skipped on boot
      #
      # Stored as :string (not Ecto.Enum) so adding a new status code later
      # never requires a schema migration — only application code changes.
      add :load_status, :string

      # Human-readable last error attached to load_status. Long compile-error
      # output (with file paths and line numbers across many files) does not
      # fit in a :string column on PostgreSQL, so this is :text.
      add :load_error,  :text

      # When load_status was last set. Lets the admin UI show "Loaded 2h ago"
      # or "Failed 5m ago" without inferring it from updated_at, which moves
      # on every settings save and would lie about load freshness.
      add :loaded_at,   :utc_datetime
    end
  end
end
