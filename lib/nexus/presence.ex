defmodule Nexus.Presence do
  @moduledoc """
  Phoenix Presence for tracking online users per post and globally.
  """
  use Phoenix.Presence,
    otp_app: :nexus,
    pubsub_server: Nexus.PubSub
end
