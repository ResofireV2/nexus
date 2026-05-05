defmodule Nexus.Extensions do
  @moduledoc """
  The Extensions context. Manages installed extensions, hooks, and slots.

  Extensions are Elixir modules that implement the Nexus.Extensions.Extension behaviour.
  They register themselves via the extension registry and can:
    - Subscribe to hooks (events fired by core)
    - Inject components into UI slots
    - Register custom content blocks
  """

  import Ecto.Query
  alias Nexus.Repo
  alias Nexus.Extensions.{Extension, Hook, Slot}

  # ---------------------------------------------------------------------------
  # Well-known hook events
  # ---------------------------------------------------------------------------

  @hook_events ~w(
    post_created
    post_updated
    post_deleted
    reply_created
    user_registered
    user_login
    reaction_added
    report_created
  )

  def hook_events, do: @hook_events

  # ---------------------------------------------------------------------------
  # Well-known UI slots
  # ---------------------------------------------------------------------------

  @ui_slots ~w(
    feed_top
    feed_bottom
    feed_sidebar
    post_header
    post_footer
    post_sidebar
    reply_footer
    profile_header
    profile_sidebar
    nav_top
    nav_bottom
    admin_sidebar
  )

  def ui_slots, do: @ui_slots

  # ---------------------------------------------------------------------------
  # Extension CRUD
  # ---------------------------------------------------------------------------

  def list_extensions do
    Extension
    |> order_by([e], [asc: e.name])
    |> preload([:hooks, :slots])
    |> Repo.all()
  end

  def get_extension(id), do: Repo.get(Extension, id) |> Repo.preload([:hooks, :slots])

  def get_extension_by_slug(slug), do: Repo.get_by(Extension, slug: slug) |> Repo.preload([:hooks, :slots])

  def install_extension(attrs) do
    %Extension{}
    |> Extension.changeset(attrs)
    |> Repo.insert()
  end

  def uninstall_extension(%Extension{} = ext) do
    Repo.delete(ext)
  end

  def toggle_extension(%Extension{} = ext) do
    ext
    |> Extension.toggle_changeset()
    |> Repo.update()
  end

  def update_extension_settings(%Extension{} = ext, settings) do
    ext
    |> Extension.settings_changeset(settings)
    |> Repo.update()
  end

  # ---------------------------------------------------------------------------
  # Hook system
  # ---------------------------------------------------------------------------

  @doc """
  Fire a hook event. All enabled extensions subscribed to this event
  will have their handler called with the payload.
  """
  def fire(event, payload \\ %{}) when event in @hook_events do
    hooks =
      from(h in Hook,
        join: e in Extension, on: h.extension_id == e.id,
        where: h.event == ^event and h.enabled == true and e.enabled == true,
        order_by: [asc: h.priority],
        preload: :extension
      )
      |> Repo.all()

    for hook <- hooks do
      Task.start(fn ->
        try do
          module = String.to_existing_atom(hook.handler)
          apply(module, :handle, [event, payload, hook.extension])
        rescue
          e -> require Logger; Logger.warning("Extension hook error: #{inspect(e)}")
        end
      end)
    end

    :ok
  end

  def fire(_event, _payload), do: :ok

  # ---------------------------------------------------------------------------
  # Slot system
  # ---------------------------------------------------------------------------

  @doc """
  Get all enabled components registered for a UI slot,
  ordered by priority. Used by the frontend layout engine.
  """
  def slots_for(slot_name) when slot_name in @ui_slots do
    from(s in Slot,
      join: e in Extension, on: s.extension_id == e.id,
      where: s.slot == ^slot_name and s.enabled == true and e.enabled == true,
      order_by: [asc: s.priority],
      select: %{
        id: s.id,
        slot: s.slot,
        component: s.component,
        priority: s.priority,
        extension_slug: e.slug
      }
    )
    |> Repo.all()
  end

  def slots_for(_), do: []

  @doc """
  Get all slot assignments across all slots.
  Used by the admin panel to show what extensions are doing.
  """
  def all_slot_assignments do
    from(s in Slot,
      join: e in Extension, on: s.extension_id == e.id,
      where: e.enabled == true,
      order_by: [asc: s.slot, asc: s.priority],
      select: %{
        slot: s.slot,
        component: s.component,
        priority: s.priority,
        extension_name: e.name,
        extension_slug: e.slug
      }
    )
    |> Repo.all()
    |> Enum.group_by(& &1.slot)
  end

  # ---------------------------------------------------------------------------
  # Hook registration helpers (called during extension install)
  # ---------------------------------------------------------------------------

  def register_hook(extension_id, event, handler, priority \\ 50) do
    %Hook{}
    |> Hook.changeset(%{
      extension_id: extension_id,
      event: event,
      handler: handler,
      priority: priority
    })
    |> Repo.insert()
  end

  def register_slot(extension_id, slot, component, priority \\ 50) do
    %Slot{}
    |> Slot.changeset(%{
      extension_id: extension_id,
      slot: slot,
      component: component,
      priority: priority
    })
    |> Repo.insert()
  end
end
