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

  # POST /api/v1/admin/digest/test
  # Sends a test digest to the current admin user using the current settings.
  def send_test(conn, %{"frequency" => frequency}) do
    user   = conn.assigns.current_user
    digest = Digest.build(frequency)
    Task.start(fn -> Nexus.Mailer.send_digest_email(user, digest) end)
    json(conn, %{ok: true})
  end

  defp format_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc ->
        String.replace(acc, "%{#{k}}", to_string(v))
      end)
    end)
  end
end
