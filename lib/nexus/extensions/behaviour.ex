defmodule Nexus.Extensions.Behaviour do
  @moduledoc """
  Behaviour that all Nexus extensions must implement.

  ## Example extension

      defmodule MyExtension do
        @behaviour Nexus.Extensions.Behaviour

        @impl true
        def manifest do
          %{
            name: "My Extension",
            slug: "my-extension",
            version: "1.0.0",
            description: "Does something cool",
            author: "Your Name",
            hooks: [
              %{event: "post_created", handler: "MyExtension.Hooks.PostCreated", priority: 50}
            ],
            slots: [
              %{slot: "feed_sidebar", component: "my-extension/sidebar", priority: 50}
            ]
          }
        end

        @impl true
        def handle(event, payload, extension) do
          # Handle hook events
          :ok
        end

        @impl true
        def settings_schema do
          # Return a map describing configurable settings
          %{
            "api_key" => %{type: "string", label: "API Key", required: true}
          }
        end
      end
  """

  @callback manifest() :: map()
  @callback handle(event :: String.t(), payload :: map(), extension :: map()) :: :ok | {:error, term()}
  @callback settings_schema() :: map()

  @optional_callbacks [settings_schema: 0]
end
