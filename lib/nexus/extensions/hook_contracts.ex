defmodule Nexus.Extensions.HookContracts do
  @moduledoc """
  Declared contracts for every hook event Nexus fires.

  Each contract describes:

    * `event`       — the event name (e.g. "post_created").
    * `description` — when this event fires, in plain English.
    * `payload`     — the payload schema: each key maps to a short
                      description of the value's type and possible states.

  ## Why this exists

  Before piece 2, extensions calling `handle_event/3` had to guess or read
  source code to know what was in the `payload` argument. Different events
  carried different ad-hoc shapes; some events lacked the actor's user_id
  entirely, forcing handlers to re-fetch from the DB. This module makes
  the contract explicit and the payload pipeline strict.

  ## How payloads are built at runtime

  Fire sites do NOT construct payload maps inline. Instead they call
  `build_payload(event, ctx)`, which picks declared fields out of a
  context map. Anything else the fire site has in scope stays out of the
  payload, period.

  Then `fire/2` validates the built payload against the contract before
  dispatching to extension handlers. This is defence in depth — even if a
  caller bypasses `build_payload`, a malformed payload won't reach
  handlers.

  ## Serializability

  Payload values are JSON-serializable scalars only: string, number,
  boolean, nil, list, or map-of-same. No raw Ecto structs, no PIDs, no
  atoms-as-values, no `DateTime` (use ISO 8601 strings if you need them).

  This is enforced by `validate_payload/2`. The rule exists so hook
  dispatch can move to a real async queue (Oban, etc.) without changing
  the contract — payloads must always survive a JSON round-trip.

  ## Actor user_id is required on every event

  Every event carries `user_id` — the user who DID the thing (the post
  creator, the editor, the reporter, etc.). The only nuance is `user_*`
  events where the actor IS the subject; there `user_id` IS the subject's
  id, and that's documented per-event.

  ## Adding a new event

  1. Add the entry to `@contracts` below.
  2. Add `"event_name"` to `@hook_events` in `Nexus.Extensions`.
  3. Add `"event_name"` to `@known_hook_events` in
     `Nexus.Extensions.ManifestSchema`.
  4. Wire up the actual fire site by calling `Nexus.Extensions.fire/2`
     with a context map containing the declared fields.

  All four are required. Skipping step 2 makes `fire/2` reject the event
  (it raises on unknown events — see "Strict dispatch" below). Skipping
  steps 3 means extensions can't declare the event in their manifest.

  ## Strict dispatch

  `Nexus.Extensions.fire/2` is strict: unknown event names raise, not
  silently no-op. This prevents typos at fire sites from silently
  dropping events (a footgun in the pre-piece-2 system). Tests covering
  fire sites are the safety net; production code calling `fire/2` with
  a literal string is checked at first invocation.
  """

  # Each contract is a map keyed by event name. Stored as a module attribute
  # for compile-time lookup (events list, payload schemas) and serialized
  # via `all/0` for runtime introspection.
  #
  # `payload` field descriptions are plain English — the runtime authority
  # for what's IN the payload is `build_payload/2` below. These two MUST
  # stay in sync: a declared field with no builder mapping produces nil
  # values; a builder mapping for an undeclared field produces an
  # unexpected payload key.
  @contracts %{
    "post_created" => %{
      event:       "post_created",
      description: "Fires when a user creates a new top-level post. Does not " <>
                   "fire for replies (see reply_created). Fires AFTER the post " <>
                   "is persisted but before downstream effects (notifications, " <>
                   "feed broadcasts) — order is not guaranteed.",
      payload: %{
        user_id: "ID of the user who created the post (string UUID).",
        post_id: "ID of the newly-created post (string UUID)."
      }
    },

    "post_updated" => %{
      event:       "post_updated",
      description: "Fires when a post is edited. The `user_id` is the EDITOR, " <>
                   "which may differ from the post's original author (moderators " <>
                   "can edit other users' posts).",
      payload: %{
        user_id: "ID of the user who edited the post (string UUID).",
        post_id: "ID of the post that was edited (string UUID)."
      }
    },

    "post_deleted" => %{
      event:       "post_deleted",
      description: "Fires when a post is deleted. The `user_id` is the DELETER, " <>
                   "which may differ from the post's original author (moderators " <>
                   "can delete other users' posts). The post no longer exists in " <>
                   "the database when this fires — handlers must rely on the id " <>
                   "and any data they previously cached.",
      payload: %{
        user_id: "ID of the user who deleted the post (string UUID).",
        post_id: "ID of the deleted post (string UUID)."
      }
    },

    "reply_created" => %{
      event:       "reply_created",
      description: "Fires when a user posts a reply to an existing post. The " <>
                   "`post_id` is the parent post being replied to.",
      payload: %{
        user_id:  "ID of the user who created the reply (string UUID).",
        reply_id: "ID of the newly-created reply (string UUID).",
        post_id:  "ID of the parent post the reply belongs to (string UUID)."
      }
    },

    "reaction_added" => %{
      event:       "reaction_added",
      description: "Fires when a user adds a reaction to a post or reply. " <>
                   "Exactly one of `post_id` and `reply_id` is non-nil — the " <>
                   "other identifies a reply that the reaction is on.",
      payload: %{
        user_id:  "ID of the user who added the reaction (string UUID).",
        emoji:    "The emoji or reaction name as a string (e.g. \"👍\" or " <>
                  "\"thumbs_up\").",
        post_id:  "ID of the post the reaction is on, or nil if the reaction " <>
                  "is on a reply (string UUID or nil).",
        reply_id: "ID of the reply the reaction is on, or nil if the reaction " <>
                  "is on a post (string UUID or nil)."
      }
    },

    "reaction_removed" => %{
      event:       "reaction_removed",
      description: "Fires when a user removes their own reaction from a post " <>
                   "or reply. Mirror of reaction_added — exactly one of " <>
                   "`post_id` and `reply_id` is non-nil.",
      payload: %{
        user_id:  "ID of the user who removed their reaction (string UUID).",
        emoji:    "The emoji or reaction name that was removed (string).",
        post_id:  "ID of the post the reaction was on, or nil if the reaction " <>
                  "was on a reply (string UUID or nil).",
        reply_id: "ID of the reply the reaction was on, or nil if the reaction " <>
                  "was on a post (string UUID or nil)."
      }
    },

    "report_created" => %{
      event:       "report_created",
      description: "Fires when a user submits a report. The `user_id` is the " <>
                   "REPORTER, not the user being reported.",
      payload: %{
        user_id:   "ID of the user who submitted the report (string UUID).",
        report_id: "ID of the newly-created report (string UUID)."
      }
    },

    "report_resolved" => %{
      event:       "report_resolved",
      description: "Fires when a moderator transitions a report out of the " <>
                   "pending state. The `user_id` is the MODERATOR who resolved " <>
                   "the report; `status` is the new status (\"reviewed\", " <>
                   "\"dismissed\", or \"actioned\"). Does not fire on pending → " <>
                   "pending (no-op transitions).",
      payload: %{
        user_id:   "ID of the moderator who resolved the report (string UUID).",
        report_id: "ID of the resolved report (string UUID).",
        status:    "New status string: \"reviewed\", \"dismissed\", or \"actioned\"."
      }
    },

    "user_registered" => %{
      event:       "user_registered",
      description: "Fires when a new user account is created. Here the `user_id` " <>
                   "IS the new user — there's no separate actor.",
      payload: %{
        user_id: "ID of the newly-registered user (string UUID)."
      }
    },

    "user_login" => %{
      event:       "user_login",
      description: "Fires when a user successfully logs in (interactive sessions, " <>
                   "not token refreshes). Here the `user_id` IS the user logging " <>
                   "in — there's no separate actor.",
      payload: %{
        user_id: "ID of the user who logged in (string UUID)."
      }
    }
  }

  # ---------------------------------------------------------------------------
  # Public API
  # ---------------------------------------------------------------------------

  @doc """
  Returns the full list of hook contracts as a list, suitable for JSON
  serialization in admin endpoints.
  """
  def all do
    @contracts
    |> Map.values()
    |> Enum.sort_by(& &1.event)
  end

  @doc """
  Returns the contract for a specific event, or nil if no such event exists.
  """
  def get(event) when is_binary(event), do: Map.get(@contracts, event)

  @doc """
  Returns just the event names. Equivalent to Nexus.Extensions.hook_events/0
  and Nexus.Extensions.ManifestSchema.known_hook_events/0 — these three
  sources MUST stay in sync.
  """
  def events do
    @contracts
    |> Map.keys()
    |> Enum.sort()
  end

  @doc """
  Builds the payload for an event from a context map.

  Each event's contract declares which fields its payload contains; this
  function picks those fields out of `ctx` and returns ONLY them. Anything
  else in `ctx` is ignored. This is the hard cutoff: extension handlers
  receive only declared fields.

  Returns `{:ok, payload}` on success, `{:error, reason}` if the event
  isn't known.

  ## Example

      iex> ctx = %{user_id: "u-1", post_id: "p-1", side_effect_ref: pid}
      iex> Nexus.Extensions.HookContracts.build_payload("post_created", ctx)
      {:ok, %{user_id: "u-1", post_id: "p-1"}}

  Note how `side_effect_ref` from `ctx` doesn't appear in the result —
  it's not a declared field for `post_created`.
  """
  def build_payload(event, ctx) when is_binary(event) and is_map(ctx) do
    case Map.get(@contracts, event) do
      nil ->
        {:error, "Unknown hook event: #{event}"}

      contract ->
        payload =
          contract.payload
          |> Map.keys()
          |> Enum.into(%{}, fn key ->
            # Accept both atom and string keys in ctx for caller convenience.
            value = Map.get(ctx, key) || Map.get(ctx, to_string(key))
            {key, value}
          end)

        {:ok, payload}
    end
  end

  @doc """
  Validates that a payload conforms to its event's contract.

  Checks:
    * Event is known.
    * Payload contains exactly the declared keys (no extras, no missing).
    * Every value is JSON-serializable (string, number, boolean, nil,
      list, or map-of-same). No structs, no PIDs, no atoms-as-values,
      no DateTime.

  Returns `:ok` on success, `{:error, reason}` otherwise.

  Called by `Nexus.Extensions.fire/2` before dispatching to handlers.
  This is defence in depth — even if a caller constructed the payload
  manually instead of using `build_payload/2`, malformed payloads can't
  reach extension handlers.
  """
  def validate_payload(event, payload) when is_binary(event) and is_map(payload) do
    case Map.get(@contracts, event) do
      nil ->
        {:error, "Unknown hook event: #{event}"}

      contract ->
        declared_keys = contract.payload |> Map.keys() |> MapSet.new()
        actual_keys   = payload |> Map.keys() |> MapSet.new()

        missing = MapSet.difference(declared_keys, actual_keys) |> MapSet.to_list()
        extra   = MapSet.difference(actual_keys, declared_keys) |> MapSet.to_list()

        cond do
          missing != [] ->
            {:error,
             "Payload for #{event} missing required keys: #{inspect(missing)}"}

          extra != [] ->
            {:error,
             "Payload for #{event} contains undeclared keys: #{inspect(extra)}"}

          true ->
            # All keys present and accounted for. Now check serializability.
            case find_non_serializable(payload) do
              nil ->
                :ok
              {key, value} ->
                {:error,
                 "Payload for #{event} field #{inspect(key)} contains " <>
                 "non-JSON-serializable value: #{inspect(value)}. Payloads " <>
                 "must be strings, numbers, booleans, nil, lists, or maps."}
            end
        end
    end
  end

  def validate_payload(_event, other),
    do: {:error, "Payload must be a map, got: #{inspect(other)}"}

  # ---------------------------------------------------------------------------
  # Private — serializability check
  #
  # Walks the payload looking for any value that wouldn't survive a JSON
  # round-trip. Returns nil if everything is fine, or {key, value}
  # identifying the first offender. The key reported is always a top-level
  # payload key, even when the offender is nested inside a list or map —
  # this gives callers a usable hint without exposing the full path.
  # ---------------------------------------------------------------------------

  defp find_non_serializable(payload) when is_map(payload) do
    Enum.find_value(payload, fn {k, v} ->
      if json_safe?(v), do: nil, else: {k, v}
    end)
  end

  # A value is JSON-safe if it's directly serializable to a JSON scalar,
  # or it's a list/map of JSON-safe values. Structs (including DateTime,
  # NaiveDateTime, and any Ecto schema) are explicitly NOT safe — payloads
  # must use explicit string/number representations.
  defp json_safe?(nil),                  do: true
  defp json_safe?(v) when is_binary(v),  do: true
  defp json_safe?(v) when is_number(v),  do: true
  defp json_safe?(v) when is_boolean(v), do: true
  defp json_safe?(%_{}),                 do: false  # any struct → reject
  defp json_safe?(v) when is_map(v) do
    Enum.all?(v, fn {k, val} ->
      (is_binary(k) or is_atom(k)) and json_safe?(val)
    end)
  end
  defp json_safe?(v) when is_list(v), do: Enum.all?(v, &json_safe?/1)
  defp json_safe?(_),                 do: false
end
