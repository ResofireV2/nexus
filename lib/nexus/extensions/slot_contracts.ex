defmodule Nexus.Extensions.SlotContracts do
  @moduledoc """
  Declared contracts for every UI slot the host renders.

  A slot's contract describes:

    * `name`        — the slot identifier (e.g. "post_footer").
    * `description` — where and when the slot renders. Surfaced in the admin
                      runtime panel and (eventually) generated extension docs.
    * `props`       — the named, typed props that components in this slot
                      receive. Documented in plain English here; the JS
                      pipeline (`propsForSlot` in `nexus.jsx`) is the
                      runtime authority that actually resolves and passes
                      these.

  ## Why this exists

  Before piece 1, slot prop signatures were undocumented React render-site
  conventions. Extension authors had no way to know what their slotted
  component would receive; the host could pass anything in scope and call
  it "the slot's props." This module makes the contract explicit and
  one-source-of-truth.

  ## How props are resolved at runtime

  The JS side has a `propsForSlot(slot, context)` helper that returns
  exactly the props described here, derived from the current React render
  context. Slot components receive ONLY these props — there's no implicit
  spread of additional values. This is the "hard cutoff" we agreed to: if
  you want it in a slot's props, declare it here AND wire it in
  `propsForSlot`.

  ## Adding a new slot

  Adding `feed_top` (for example) is a 4-step process:

  1. Add the entry to `@contracts` below.
  2. Add `"feed_top"` to `@ui_slots` in `Nexus.Extensions`.
  3. Add `"feed_top"` to `@known_slots` in `Nexus.Extensions.ManifestSchema`.
  4. In the host React code, call `getSlot("feed_top")` at the render site
     and call `propsForSlot("feed_top", ctx)` to build the props bag.

  All four steps are required. The Elixir side handles validation
  (extensions can't declare unknown slots); the JS side handles the
  actual prop pipeline. If you only do steps 1–3, extensions can register
  but nothing renders. If you only do step 4, manifest validation will
  reject the slot.
  """

  # Each contract is a simple map. We don't use a struct because the data
  # is essentially configuration and will be serialized to JSON for the
  # admin endpoint that surfaces it.
  #
  # `props` describes the prop bag the slotted component receives. Keys
  # are atom names; values are short plain-English descriptions of the
  # value's type and possible states (e.g. nil for logged-out users).
  @contracts [
    %{
      name:        "post_footer",
      description: "Rendered at the bottom of the post body on /post/:id pages. " <>
                   "Stacks components vertically below the post content and " <>
                   "above any reply thread. One render per post; not rendered " <>
                   "on the home feed.",
      props: %{
        post_id: "Integer id of the post being viewed (posts use a bigserial " <>
                 "primary key, not a UUID). Always present."
      }
    },
    %{
      name:        "profile_sidebar",
      description: "Rendered in the left rail of a user's profile page at " <>
                   "/profile/:username, above the profile's main content. " <>
                   "Visible on all profile pages including the viewer's own.",
      props: %{
        username:     "Display username of the profile being viewed (string).",
        current_user: "User object for the currently-logged-in viewer, or nil " <>
                      "when the visitor is logged out. Extensions should " <>
                      "handle the nil case explicitly."
      }
    },
    %{
      name:        "compose_attachments",
      description: "Rendered below the post body on the /compose page, above " <>
                   "the footer bar. Allows extensions to display and manage " <>
                   "items they have attached to the in-flight post. One render " <>
                   "per registered extension component; all stacked vertically. " <>
                   "Not rendered on the reply composer.",
      props: %{
        attachments:    "Array of all current compose attachments. Each entry " <>
                        "is %{kind: string, data: map}. Extensions should " <>
                        "filter to their own kind(s) and ignore the rest.",
        setAttachments: "Function — call with an updater fn or new array to " <>
                        "mutate the attachment list. Use this to remove an " <>
                        "attachment the user wants to discard before posting. " <>
                        "Signature: setAttachments(prev => newArray). " <>
                        "Note the camelCase: this slot's setter is passed as " <>
                        "`setAttachments`, unlike `post_id` / `current_user` " <>
                        "on the other slots. `propsForSlot` in nexus.jsx is " <>
                        "the runtime authority."
      }
    }
  ]

  @doc """
  Returns the full list of slot contracts.

  Used by the admin endpoint that exposes slot metadata to the runtime
  panel and by anywhere else that needs to enumerate available slots.
  """
  def all, do: @contracts

  @doc """
  Returns the contract for a specific slot name, or nil if no such
  contract exists.

  Example:

      iex> Nexus.Extensions.SlotContracts.get("post_footer")
      %{name: "post_footer", description: "...", props: %{post_id: "..."}}

      iex> Nexus.Extensions.SlotContracts.get("nonexistent")
      nil
  """
  def get(name) when is_binary(name) do
    Enum.find(@contracts, fn c -> c.name == name end)
  end

  @doc """
  Returns just the slot names. Equivalent to Nexus.Extensions.ui_slots/0
  and Nexus.Extensions.ManifestSchema.known_slots/0; convenience for
  callers that only need names. These three sources must stay in sync.
  """
  def names, do: Enum.map(@contracts, & &1.name)
end
