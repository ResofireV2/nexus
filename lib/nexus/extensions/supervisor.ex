defmodule Nexus.Extensions.ExtensionSupervisor do
  @moduledoc """
  Dynamic supervisor that owns all running extension child processes.

  Each extension that declares child_specs/0 gets its processes started
  under a dedicated sub-supervisor named after its slug. If an extension's
  processes crash, only that extension's supervisor restarts them — Nexus
  and other extensions are unaffected.

  The tree looks like:

      Nexus.Extensions.ExtensionSupervisor (DynamicSupervisor)
      ├── Supervisor for "gamepedia"
      │   ├── Gamepedia.Cache
      │   └── Gamepedia.Scheduler
      └── Supervisor for "another-extension"
          └── AnotherExtension.Worker
  """

  use DynamicSupervisor

  require Logger

  def start_link(init_arg) do
    DynamicSupervisor.start_link(__MODULE__, init_arg, name: __MODULE__)
  end

  @impl true
  def init(_init_arg) do
    DynamicSupervisor.init(strategy: :one_for_one)
  end

  @doc """
  Starts all child processes declared by an extension under a dedicated
  sub-supervisor. Idempotent — if already running, stops and restarts.
  """
  def start_extension(slug, module) do
    # Stop any existing supervisor for this slug first (handles updates)
    stop_extension(slug)

    specs = safe_child_specs(module)
    if specs == [] do
      :ok
    else
      child_spec = %{
        id:    {__MODULE__, slug},
        start: {Supervisor, :start_link, [specs, [strategy: :one_for_one, name: extension_name(slug)]]},
        type:  :supervisor,
      }

      case DynamicSupervisor.start_child(__MODULE__, child_spec) do
        {:ok, _pid} ->
          Logger.info("ExtensionSupervisor: started #{length(specs)} child(ren) for #{slug}")
          :ok

        {:error, reason} ->
          Logger.error("ExtensionSupervisor: failed to start #{slug}: #{inspect(reason)}")
          {:error, reason}
      end
    end
  end

  @doc """
  Stops all child processes for an extension. Called on disable or uninstall.
  """
  def stop_extension(slug) do
    name = extension_name(slug)
    case Process.whereis(name) do
      nil ->
        :ok

      pid ->
        DynamicSupervisor.terminate_child(__MODULE__, pid)
        Logger.info("ExtensionSupervisor: stopped #{slug}")
        :ok
    end
  end

  @doc """
  Returns whether an extension's supervisor is currently running.
  """
  def running?(slug) do
    Process.whereis(extension_name(slug)) != nil
  end

  defp extension_name(slug) do
    String.to_atom("nexus_ext_sup_#{slug}")
  end

  defp safe_child_specs(module) do
    if function_exported?(module, :child_specs, 0) do
      try do
        module.child_specs()
      rescue
        e ->
          Logger.error("ExtensionSupervisor: child_specs/0 raised for #{module}: #{inspect(e)}")
          []
      end
    else
      []
    end
  end
end
