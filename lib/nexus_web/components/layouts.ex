defmodule NexusWeb.Layouts do
  use Phoenix.Component

  import Phoenix.Controller, only: [get_csrf_token: 0]
  use Gettext, backend: NexusWeb.Gettext

  use Phoenix.VerifiedRoutes,
    endpoint: NexusWeb.Endpoint,
    router: NexusWeb.Router,
    statics: NexusWeb.static_paths()

  embed_templates "layouts/*"
end
