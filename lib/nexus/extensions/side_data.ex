defmodule Nexus.Extensions.SideData do
  @moduledoc """
  Dispatches compose attachments to the extensions that declared them.

  ## Compose attachment flow (piece 4)

  When a user submits a post or reply with attachments, the controller
  calls `persist_attachments/3`:

      SideData.persist_attachments("post", post.id, params["attachments"])

  For each attachment, this module:

    1. Looks up the owning extension by `{entity, kind}` in the registry.
    2. If found AND the extension implements `persist_attachment/3`,
       calls it inside a Task — same pattern as hook dispatch.
    3. If not found (unknown kind, extension disabled, or just not
       declared by anyone), logs a warning and skips.

  ## Best-effort semantics

  Per the piece-4 design decision, attachment persistence is best-effort:
  the parent post/reply is already committed when this is called, and we
  don't roll it back if an attachment fails. Failures log but don't block.

  Rationale: one buggy extension's persist_attachment crashing shouldn't
  prevent a user's post from being created. The extension can validate
  attachment data BEFORE submission (in its modal) if it needs strong
  guarantees. By the time the API receives the request, the data has
  already passed whatever client-side validation the extension chose to
  implement; failures here are server-side bugs (DB connectivity, etc.),
  not user errors.

  ## Why a fresh Task per attachment, not a single Task wrapping all

  Each attachment runs in its own Task so a slow extension can't block
  others. This contrasts with hook dispatch (piece 2.5) where handlers
  for the SAME event run sequentially to honor priority. Attachments have
  no priority concept — they're independent writes to independent
  extensions' tables, so parallelism is fine.

  ## Size limit

  Per-attachment payload is capped at 10KB to prevent compose requests
  from ballooning. Attachments exceeding the cap are rejected with a
  log warning. Extensions that need larger payloads should upload them
  separately (e.g. to their own /api/v1/ext/<slug>/uploads endpoint)
  and attach only a reference id here.
  """

  require Logger

  alias Nexus.Extensions.Registry

  # 10KB per attachment. Encoded JSON estimate.
  @max_attachment_bytes 10_240

  @doc """
  Dispatches a list of attachments to their owning extensions.

  Returns `:ok` regardless of individual attachment outcomes — this is
  the best-effort contract. Per-attachment failures are logged.

  Each attachment should be a map with string keys "kind" and "data".
  Anything else logs a warning and is skipped.
  """
  def persist_attachments(entity, entity_id, attachments)
      when is_binary(entity) and is_list(attachments) do
    for attachment <- attachments do
      dispatch_one(entity, entity_id, attachment)
    end

    :ok
  end

  def persist_attachments(_entity, _entity_id, _attachments), do: :ok

  defp dispatch_one(entity, entity_id, %{"kind" => kind, "data" => data} = attachment)
       when is_binary(kind) do
    cond do
      not is_map(data) ->
        Logger.warning("SideData: attachment data must be an object, " <>
                       "got kind=#{inspect(kind)} data=#{inspect(data)}")

      byte_size_of(attachment) > @max_attachment_bytes ->
        Logger.warning("SideData: attachment exceeds #{@max_attachment_bytes} " <>
                       "byte cap (got #{byte_size_of(attachment)}), kind=#{inspect(kind)}")

      true ->
        case Registry.side_data_owner_for(entity, kind) do
          nil ->
            Logger.warning("SideData: no extension declares side_data " <>
                           "{entity: #{inspect(entity)}, kind: #{inspect(kind)}} — " <>
                           "attachment dropped")

          slug ->
            persist_via_extension(slug, entity, entity_id, attachment)
        end
    end
  end

  defp dispatch_one(_entity, _entity_id, attachment) do
    Logger.warning("SideData: attachment must be %{\"kind\" => string, " <>
                   "\"data\" => map}, got: #{inspect(attachment)}")
  end

  defp persist_via_extension(slug, entity, entity_id, attachment) do
    module = Registry.get_module(slug)

    cond do
      is_nil(module) ->
        Logger.warning("SideData: extension #{slug} owns side_data for " <>
                       "#{entity}/#{attachment["kind"]} but its module is not " <>
                       "loaded — attachment dropped")

      not Registry.enabled?(slug) ->
        Logger.info("SideData: extension #{slug} is disabled — " <>
                    "#{entity}/#{attachment["kind"]} attachment dropped")

      not function_exported?(module, :persist_attachment, 3) ->
        Logger.warning("SideData: extension #{slug} declared side_data for " <>
                       "#{entity}/#{attachment["kind"]} but does not export " <>
                       "persist_attachment/3 — attachment dropped")

      true ->
        Task.start(fn ->
          try do
            module.persist_attachment(entity, entity_id, attachment)
          rescue
            e ->
              Logger.error("SideData: #{slug}.persist_attachment/3 raised for " <>
                           "#{entity}/#{attachment["kind"]}: #{inspect(e)}")
          end
        end)
    end
  end

  # Rough size estimate — JSON-encode the attachment and check byte_size.
  # We don't strictly need exact JSON byte count; the cap is a soft
  # backstop against runaway payloads, not a precise quota.
  defp byte_size_of(attachment) do
    case Jason.encode(attachment) do
      {:ok, encoded} -> byte_size(encoded)
      _              -> 0
    end
  end
end
