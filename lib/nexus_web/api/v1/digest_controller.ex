defmodule NexusWeb.API.V1.DigestController do
  use NexusWeb, :controller

  alias Nexus.{Admin, Digest}

  # GET /api/v1/admin/digest/settings
  def get_settings(conn, _params) do
    json(conn, %{settings: Admin.get_setting("digest") || %{}})
  end

  # PATCH /api/v1/admin/digest/settings
  def update_settings(conn, %{"value" => value}) do
    case Admin.update_setting("digest", value) do
      {:ok, _}     -> json(conn, %{ok: true})
      {:error, cs} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: format_errors(cs)})
    end
  end

  # GET /api/v1/admin/digest/sections
  def get_sections(conn, _params) do
    builtin = [
      %{id: "posts",       label: "Top posts",       icon: "fa-pen-to-square", toggleable: false},
      %{id: "leaderboard", label: "Leaderboard",     icon: "fa-trophy",        toggleable: true,  cfg_key: "include_leaderboard"},
      %{id: "badges",      label: "Badges awarded",  icon: "fa-medal",         toggleable: true,  cfg_key: "include_badges"},
      %{id: "members",     label: "New members",     icon: "fa-users",         toggleable: true,  cfg_key: "include_new_members"},
      %{id: "spaces",      label: "Trending spaces", icon: "fa-layer-group",   toggleable: true,  cfg_key: "include_trending_spaces"},
    ]

    # Read declared digest sections from each loaded extension's normalized
    # JSON manifest. The manifest is the source of truth; the legacy
    # module.digest_sections/0 callback is no longer consulted.
    ext_sections =
      Nexus.Extensions.Registry.all_declared()
      |> Enum.flat_map(fn {_slug, manifest} ->
        for section <- Map.get(manifest, "digest_sections", []) do
          %{
            id:        section["key"],
            label:     section["label"] || section["key"],
            icon:      section["icon"]  || "fa-puzzle-piece",
            toggleable: true,
            ext:       true
          }
        end
      end)

    json(conn, %{sections: builtin ++ ext_sections})
  end

  # POST /api/v1/admin/digest/test
  def send_test(conn, %{"frequency" => frequency}) do
    user   = conn.assigns.current_user
    digest = Digest.build(frequency)
    Task.start(fn -> Nexus.Mailer.send_digest_email(user, digest) end)
    json(conn, %{ok: true})
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc ->
        String.replace(acc, "%{" <> to_string(k) <> "}", if(is_binary(v), do: v, else: inspect(v)))
      end)
    end)
  end
end
