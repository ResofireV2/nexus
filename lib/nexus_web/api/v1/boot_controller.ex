defmodule NexusWeb.API.V1.BootController do
  use NexusWeb, :controller

  alias NexusWeb.API.V1.{SpaceController, TagController, AdminController, PageController}

  # GET /api/v1/boot
  #
  # Consolidated startup payload. The SPA previously fired four separate GETs on
  # boot — /spaces, /tags, /branding and /pages/widgets/public (the last one
  # sequenced after /branding) — which is up to two round-trips of latency
  # before the shell is fully populated. This returns all four sections in a
  # single response.
  #
  # Each section is produced by the exact payload builder from its own
  # controller, so the shapes are byte-for-byte identical to the standalone
  # endpoints (which still exist and are used for later refreshes) and there is
  # no risk of the two drifting. Runs under the same :api pipeline, so
  # conn.assigns.current_user is populated identically — the spaces/tags
  # sections stay correctly personalized (permission filtering, tag
  # subscriptions).
  def index(conn, _params) do
    user = conn.assigns[:current_user]

    payload =
      user
      |> SpaceController.spaces_payload()
      |> Map.merge(TagController.tags_payload(user))
      |> Map.merge(AdminController.branding_payload())
      |> Map.merge(PageController.widgets_payload())

    conn
    |> put_resp_header("cache-control", "no-store")
    |> json(payload)
  end
end
