defmodule Nexus.Extensions.ManifestSchema do
  @moduledoc """
  Validates extension `manifest.json` documents against the manifest_version 2
  schema.

  An extension's manifest is the canonical declaration of what the extension
  contributes to Nexus — hooks it handles, slots it fills, routes it owns,
  admin and explore entries it adds, right sidebar widgets it provides,
  toolbar buttons it registers, digest sections it produces, capabilities it
  claims, and so on.

  This module is the single source of truth for what a valid manifest looks
  like. The install flow, the loader, the admin UI, and any tooling that
  inspects extensions all flow through `validate/1`.

  ## Strictness

  The validator is strict about structure and identifiers it can verify
  against the running Nexus instance:

    * Unknown hook event names → hard error (typo, will silently never fire).
    * Unknown slot names → hard error (typo, will silently never render).
    * Malformed routes/widgets/buttons → hard error.

  It is permissive about forward-compatible declarations Nexus can't yet
  resolve:

    * Unknown capability strings → warning (capabilities are declared in
      piece 7 but only enforced in a later piece; rejecting unknown ones
      would block early adopters from declaring future capabilities).
    * Unknown side_data entity types → warning (same reasoning).

  Warnings are returned alongside the normalized manifest on success so
  the caller can decide whether to surface them. Errors halt validation.

  ## Return shape

      {:ok, normalized_manifest, warnings}
      {:error, errors}

  Where `errors` and `warnings` are lists of human-readable strings.

  Errors are accumulated; the validator reports as many problems as it can
  in one pass rather than bailing on the first.

  ## Manifest schema (manifest_version 2)

  See the published JSON Schema document at `/manifest_schema.json` for the
  authoritative definition. This module's `validate/1` produces identical
  accept/reject behaviour.
  """

  # ---------------------------------------------------------------------------
  # Authoritative whitelists
  # ---------------------------------------------------------------------------

  # Mirror of Nexus.Extensions.@hook_events. Kept here as a literal so this
  # module has no compile-time dependency on the context module — keeps the
  # validator usable from any phase of the install pipeline.
  @known_hook_events ~w(
    post_created
    post_updated
    post_deleted
    reply_created
    reply_deleted
    reaction_added
    reaction_removed
    report_created
    report_resolved
    user_registered
    user_login
  )

  # Mirror of Nexus.Extensions.@ui_slots. Must stay in sync with that list
  # and with Nexus.Extensions.SlotContracts. See @ui_slots in extensions.ex
  # for the canonical list and the contract-update procedure.
  @known_slots ~w(
    post_footer
    profile_sidebar
  )

  # Mirror of CORE_PAGES in assets/js/admin/AdminLayout.jsx. Used to validate
  # right-widget `scope: { corePages: [...] }` references.
  @known_core_pages ~w(
    feed post profile members leaderboard badges search
    notifications messages saved drafts
  )

  # Entity types extensions can attach side-data to. When adding a new
  # entity type, also ensure a `<entity>_deleted` hook event exists so
  # extensions can subscribe to clean up their linked rows when the
  # entity is removed.
  @known_side_data_entities ~w(post reply user)

  @supported_manifest_versions [2]

  @slug_regex ~r/^[a-z0-9-]+$/
  @semver_regex ~r/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z\-.]+)?$/

  def known_hook_events,         do: @known_hook_events
  def known_slots,               do: @known_slots
  def known_core_pages,          do: @known_core_pages
  def known_side_data_entities,  do: @known_side_data_entities
  def supported_manifest_versions, do: @supported_manifest_versions

  # ---------------------------------------------------------------------------
  # Public API
  # ---------------------------------------------------------------------------

  @doc """
  Validates a parsed manifest map.

  Accepts a map with string keys (as produced by `Jason.decode/1` on a
  manifest.json document). Returns `{:ok, normalized, warnings}` if the
  manifest is structurally valid, or `{:error, errors}` if not.

  The `normalized` manifest has all optional fields filled with their
  defaults so downstream code never needs to do `manifest["foo"] || default`.
  """
  @spec validate(map()) :: {:ok, map(), [String.t()]} | {:error, [String.t()]}
  def validate(manifest) when is_map(manifest) do
    acc = %{errors: [], warnings: [], normalized: %{}}

    acc
    |> check_manifest_version(manifest)
    |> check_identity(manifest)
    |> check_metadata(manifest)
    |> check_module_and_bundle(manifest)
    |> check_settings(manifest)
    |> check_capabilities(manifest)
    |> check_side_data(manifest)
    |> check_hooks(manifest)
    |> check_slots(manifest)
    |> check_routes(manifest)
    |> check_admin_panel(manifest)
    |> check_explore(manifest)
    |> check_digest_sections(manifest)
    |> check_right_widgets(manifest)
    |> check_toolbar_buttons(manifest)
    |> check_profile_tabs(manifest)
    |> check_notification_types(manifest)
    |> check_permissions(manifest)
    |> finalize()
  end

  def validate(other) do
    {:error, ["manifest must be a JSON object, got: #{inspect(other)}"]}
  end

  # ---------------------------------------------------------------------------
  # Field-by-field checks
  #
  # Each check_X function takes the accumulator + raw manifest, validates the
  # relevant field(s), and returns an updated accumulator. Errors are pushed
  # onto :errors; warnings onto :warnings; the cleaned value (with defaults
  # applied) onto :normalized under the same key.
  # ---------------------------------------------------------------------------

  defp check_manifest_version(acc, m) do
    case m["manifest_version"] do
      v when v in @supported_manifest_versions ->
        put_norm(acc, "manifest_version", v)

      nil ->
        err(acc, "manifest_version is required (supported: #{inspect(@supported_manifest_versions)})")

      other ->
        err(acc, "manifest_version must be one of #{inspect(@supported_manifest_versions)}, got: #{inspect(other)}")
    end
  end

  defp check_identity(acc, m) do
    acc
    |> require_string(m, "name")
    |> require_string(m, "slug")
    |> validate_slug(m)
    |> require_string(m, "version")
    |> validate_semver(m, "version")
  end

  defp check_metadata(acc, m) do
    acc
    |> optional_string(m, "description")
    |> optional_string(m, "author")
    |> optional_url(m, "homepage")
    |> optional_url(m, "repository")
    |> optional_string(m, "license")
    |> optional_url(m, "logo_url")
    |> optional_url(m, "banner_url")
    |> optional_string_array(m, "tags")
    |> optional_string(m, "compatible_with")
  end

  defp check_module_and_bundle(acc, m) do
    acc =
      case m["module"] do
        nil ->
          err(acc, "module is required (the Elixir module name implementing Nexus.Extensions.Behaviour, e.g. \"Gamepedia\")")

        v when is_binary(v) ->
          if Regex.match?(~r/^[A-Z][A-Za-z0-9_.]*$/, v) do
            put_norm(acc, "module", v)
          else
            err(acc, "module must be a valid Elixir module name, got: #{inspect(v)}")
          end

        other ->
          err(acc, "module must be a string, got: #{inspect(other)}")
      end

    acc =
      case m["js_bundle"] do
        nil ->
          put_norm(acc, "js_bundle", nil)

        v when is_binary(v) ->
          cond do
            String.starts_with?(v, "/") ->
              err(acc, "js_bundle must be a relative path inside priv/static/, not absolute (got: #{inspect(v)})")

            String.contains?(v, "..") ->
              err(acc, "js_bundle must not contain '..' path traversal (got: #{inspect(v)})")

            true ->
              put_norm(acc, "js_bundle", v)
          end

        other ->
          err(acc, "js_bundle must be a string or null, got: #{inspect(other)}")
      end

    acc
  end

  defp check_settings(acc, m) do
    acc
    |> put_norm("settings_schema", m["settings_schema"] || %{})
    |> put_norm("settings_tabs",   m["settings_tabs"]   || [])
  end

  defp check_capabilities(acc, m) do
    case m["capabilities"] do
      nil ->
        put_norm(acc, "capabilities", [])

      list when is_list(list) ->
        case Enum.find(list, &(not is_binary(&1))) do
          nil ->
            # All strings. Unknown capability names are warnings (declare-now,
            # enforce-later per the design).
            put_norm(acc, "capabilities", list)

          bad ->
            err(acc, "capabilities entries must be strings, got: #{inspect(bad)}")
        end

      other ->
        err(acc, "capabilities must be a list of strings, got: #{inspect(other)}")
    end
  end

  # side_data declares which entities this extension attaches data to and
  # under what "kind" names. Each entry is an object:
  #
  #   {"entity": "post",  "kind": "game_link"}
  #   {"entity": "reply", "kind": "music_clip"}
  #
  # Entity must be one of the known side-data entities (post, reply, user).
  # Kind is a free-form string — extensions should namespace their own kinds
  # to avoid collisions, but the host doesn't enforce naming conventions.
  #
  # Why structured: piece 4's compose attachment flow needs to know
  # {entity, kind} → owning extension to dispatch attachments correctly.
  # The bare-string form used pre-piece-4 carried no ownership info and
  # couldn't support the dispatch lookup.
  defp check_side_data(acc, m) do
    case m["side_data"] do
      nil ->
        put_norm(acc, "side_data", [])

      list when is_list(list) ->
        {good, errors} =
          list
          |> Enum.with_index()
          |> Enum.reduce({[], []}, fn {entry, idx}, {ag, ae} ->
            case validate_side_data_entry(entry, idx) do
              {:ok, normalized}  -> {[normalized | ag], ae}
              {:error, messages} -> {ag, messages ++ ae}
            end
          end)

        acc = put_norm(acc, "side_data", Enum.reverse(good))
        Enum.reduce(errors, acc, &err(&2, &1))

      other ->
        err(acc, "side_data must be a list, got: #{inspect(other)}")
    end
  end

  defp validate_side_data_entry(entry, idx) when is_map(entry) do
    entity = entry["entity"]
    kind   = entry["kind"]

    errors =
      [
        if(is_binary(entity) and entity in @known_side_data_entities,
          do: nil,
          else: "side_data[#{idx}].entity is required and must be one of: " <>
                Enum.join(@known_side_data_entities, ", ") <>
                ". Got: #{inspect(entity)}"),
        if(is_binary(kind) and kind != "",
          do: nil,
          else: "side_data[#{idx}].kind is required (non-empty string)")
      ]
      |> Enum.reject(&is_nil/1)

    if errors == [] do
      {:ok, %{"entity" => entity, "kind" => kind}}
    else
      {:error, errors}
    end
  end

  defp validate_side_data_entry(other, idx),
    do: {:error, ["side_data[#{idx}] must be an object with entity and kind " <>
                  "fields, got: #{inspect(other)}"]}

  # hooks declarations may take either form:
  #
  #   "post_created"                                  — bare string, back-compat
  #   %{"event" => "post_created"}                    — object without priority
  #   %{"event" => "post_created", "priority" => 10}  — object with priority
  #
  # All three normalize to the object form with explicit priority. Default
  # priority is 50. Lower priorities run first at dispatch time (matches
  # right_widgets, toolbar_buttons, profile_tabs conventions).
  #
  # We accept the bare string form for back-compat with manifests authored
  # before piece 2.5. New manifests should use the object form when they
  # care about ordering; the string form is fine for hooks where execution
  # order doesn't matter.
  defp check_hooks(acc, m) do
    case m["hooks"] do
      nil ->
        put_norm(acc, "hooks", [])

      list when is_list(list) ->
        {good, errors} =
          list
          |> Enum.with_index()
          |> Enum.reduce({[], []}, fn {entry, idx}, {ag, ae} ->
            case validate_hook_entry(entry, idx) do
              {:ok, normalized}  -> {[normalized | ag], ae}
              {:error, messages} -> {ag, messages ++ ae}
            end
          end)

        acc = put_norm(acc, "hooks", Enum.reverse(good))
        Enum.reduce(errors, acc, &err(&2, &1))

      other ->
        err(acc, "hooks must be a list, got: #{inspect(other)}")
    end
  end

  defp validate_hook_entry(entry, idx) when is_binary(entry) do
    # Bare string form — back-compat. Validate event name, normalize to
    # object with default priority.
    if entry in @known_hook_events do
      {:ok, %{"event" => entry, "priority" => 50}}
    else
      {:error,
       ["hooks[#{idx}] #{inspect(entry)} is not a known hook event. " <>
        "Known events: #{Enum.join(@known_hook_events, ", ")}"]}
    end
  end

  defp validate_hook_entry(entry, idx) when is_map(entry) do
    event    = entry["event"]
    priority = entry["priority"]

    errors =
      [
        if(is_binary(event) and event in @known_hook_events,
          do: nil,
          else: "hooks[#{idx}].event is required and must be one of: " <>
                Enum.join(@known_hook_events, ", ") <>
                ". Got: #{inspect(event)}"),
        if(is_nil(priority) or is_number(priority),
          do: nil,
          else: "hooks[#{idx}].priority must be a number if present, got: #{inspect(priority)}")
      ]
      |> Enum.reject(&is_nil/1)

    if errors == [] do
      {:ok, %{"event" => event, "priority" => priority || 50}}
    else
      {:error, errors}
    end
  end

  defp validate_hook_entry(other, idx),
    do: {:error, ["hooks[#{idx}] must be a string or object, got: #{inspect(other)}"]}

  defp check_slots(acc, m) do
    case m["slots"] do
      nil ->
        put_norm(acc, "slots", [])

      list when is_list(list) ->
        {good, bad} =
          Enum.split_with(list, fn s ->
            is_binary(s) and s in @known_slots
          end)

        acc = put_norm(acc, "slots", good)

        Enum.reduce(bad, acc, fn entry, a ->
          cond do
            not is_binary(entry) ->
              err(a, "slots entries must be strings, got: #{inspect(entry)}")

            true ->
              err(a, "slots entry #{inspect(entry)} is not a known UI slot. Known slots: #{Enum.join(@known_slots, ", ")}")
          end
        end)

      other ->
        err(acc, "slots must be a list of strings, got: #{inspect(other)}")
    end
  end

  defp check_routes(acc, m) do
    case m["routes"] do
      nil ->
        put_norm(acc, "routes", [])

      list when is_list(list) ->
        {good, errors} =
          list
          |> Enum.with_index()
          |> Enum.reduce({[], []}, fn {entry, idx}, {acc_good, acc_err} ->
            case validate_route_entry(entry, idx) do
              {:ok, normalized}  -> {[normalized | acc_good], acc_err}
              {:error, messages} -> {acc_good, messages ++ acc_err}
            end
          end)

        acc = put_norm(acc, "routes", Enum.reverse(good))
        Enum.reduce(errors, acc, &err(&2, &1))

      other ->
        err(acc, "routes must be a list of objects, got: #{inspect(other)}")
    end
  end

  defp validate_route_entry(entry, idx) when is_map(entry) do
    case entry["path"] do
      nil ->
        {:error, ["routes[#{idx}].path is required"]}

      p when is_binary(p) ->
        errors =
          cond do
            not String.starts_with?(p, "/") ->
              ["routes[#{idx}].path must start with '/' (got: #{inspect(p)})"]

            String.starts_with?(p, "/ext/") ->
              ["routes[#{idx}].path must not include /ext/ — Nexus prefixes it automatically (got: #{inspect(p)})"]

            true ->
              []
          end

        if errors == [] do
          title =
            case entry["title"] do
              nil -> nil
              t when is_binary(t) -> t
              _ -> nil
            end

          {:ok, %{"path" => p, "title" => title}}
        else
          {:error, errors}
        end

      other ->
        {:error, ["routes[#{idx}].path must be a string, got: #{inspect(other)}"]}
    end
  end

  defp validate_route_entry(other, idx) do
    {:error, ["routes[#{idx}] must be an object with a 'path' field, got: #{inspect(other)}"]}
  end

  defp check_admin_panel(acc, m) do
    case m["admin_panel"] do
      nil ->
        put_norm(acc, "admin_panel", nil)

      %{} = obj ->
        case validate_label_icon_pair(obj, "admin_panel") do
          {:ok, normalized}  -> put_norm(acc, "admin_panel", normalized)
          {:error, messages} -> Enum.reduce(messages, acc, &err(&2, &1))
        end

      other ->
        err(acc, "admin_panel must be an object or null, got: #{inspect(other)}")
    end
  end

  defp check_explore(acc, m) do
    case m["explore"] do
      nil ->
        put_norm(acc, "explore", nil)

      %{} = obj ->
        case validate_label_icon_pair(obj, "explore") do
          {:ok, normalized} ->
            # explore additionally supports an optional `path` field (defaults
            # to "/" — Nexus prefixes /ext/<slug> automatically)
            path =
              case obj["path"] do
                nil -> "/"
                p when is_binary(p) and binary_part(p, 0, 1) == "/" -> p
                _ -> "/"
              end

            put_norm(acc, "explore", Map.put(normalized, "path", path))

          {:error, messages} ->
            Enum.reduce(messages, acc, &err(&2, &1))
        end

      other ->
        err(acc, "explore must be an object or null, got: #{inspect(other)}")
    end
  end

  defp validate_label_icon_pair(obj, field) do
    label = obj["label"]
    icon  = obj["icon"]

    errors =
      [
        if(is_binary(label), do: nil, else: "#{field}.label must be a string"),
        if(is_binary(icon),  do: nil, else: "#{field}.icon must be a string")
      ]
      |> Enum.reject(&is_nil/1)

    if errors == [] do
      {:ok, %{"label" => label, "icon" => icon}}
    else
      {:error, errors}
    end
  end

  defp check_digest_sections(acc, m) do
    case m["digest_sections"] do
      nil ->
        put_norm(acc, "digest_sections", [])

      list when is_list(list) ->
        {good, errors} =
          list
          |> Enum.with_index()
          |> Enum.reduce({[], []}, fn {entry, idx}, {ag, ae} ->
            case validate_digest_section_entry(entry, idx) do
              {:ok, normalized}  -> {[normalized | ag], ae}
              {:error, messages} -> {ag, messages ++ ae}
            end
          end)

        acc = put_norm(acc, "digest_sections", Enum.reverse(good))
        Enum.reduce(errors, acc, &err(&2, &1))

      other ->
        err(acc, "digest_sections must be a list, got: #{inspect(other)}")
    end
  end

  defp validate_digest_section_entry(entry, idx) when is_map(entry) do
    key = entry["key"]
    label = entry["label"]
    icon = entry["icon"]
    enabled_default = entry["enabled_by_default"]

    errors =
      [
        if(is_binary(key)   and key   != "", do: nil, else: "digest_sections[#{idx}].key is required (string)"),
        if(is_binary(label) and label != "", do: nil, else: "digest_sections[#{idx}].label is required (string)"),
        if(is_nil(icon) or is_binary(icon),  do: nil, else: "digest_sections[#{idx}].icon must be a string if present"),
        if(is_nil(enabled_default) or is_boolean(enabled_default),
           do: nil,
           else: "digest_sections[#{idx}].enabled_by_default must be a boolean if present")
      ]
      |> Enum.reject(&is_nil/1)

    if errors == [] do
      {:ok,
       %{
         "key"                => key,
         "label"              => label,
         "icon"               => icon,
         "enabled_by_default" => enabled_default || false
       }}
    else
      {:error, errors}
    end
  end

  defp validate_digest_section_entry(other, idx),
    do: {:error, ["digest_sections[#{idx}] must be an object, got: #{inspect(other)}"]}

  defp check_right_widgets(acc, m) do
    case m["right_widgets"] do
      nil ->
        put_norm(acc, "right_widgets", [])

      list when is_list(list) ->
        {good, errors} =
          list
          |> Enum.with_index()
          |> Enum.reduce({[], []}, fn {entry, idx}, {ag, ae} ->
            case validate_right_widget_entry(entry, idx) do
              {:ok, normalized}  -> {[normalized | ag], ae}
              {:error, messages} -> {ag, messages ++ ae}
            end
          end)

        acc = put_norm(acc, "right_widgets", Enum.reverse(good))
        Enum.reduce(errors, acc, &err(&2, &1))

      other ->
        err(acc, "right_widgets must be a list, got: #{inspect(other)}")
    end
  end

  defp validate_right_widget_entry(entry, idx) when is_map(entry) do
    id       = entry["id"]
    label    = entry["label"]
    scope    = entry["scope"]
    priority = entry["priority"]

    base_errors =
      [
        if(is_binary(id)    and id    != "", do: nil, else: "right_widgets[#{idx}].id is required (string)"),
        if(is_binary(label) and label != "", do: nil, else: "right_widgets[#{idx}].label is required (string)"),
        if(is_nil(priority) or is_number(priority), do: nil, else: "right_widgets[#{idx}].priority must be a number if present")
      ]
      |> Enum.reject(&is_nil/1)

    {scope_errors, normalized_scope} = validate_widget_scope(scope, "right_widgets[#{idx}]")

    errors = base_errors ++ scope_errors

    if errors == [] do
      {:ok,
       %{
         "id"       => id,
         "label"    => label,
         "scope"    => normalized_scope,
         "priority" => priority || 50
       }}
    else
      {:error, errors}
    end
  end

  defp validate_right_widget_entry(other, idx),
    do: {:error, ["right_widgets[#{idx}] must be an object, got: #{inspect(other)}"]}

  # Scope grammar mirrors the JS-side registerRightWidget contract:
  #   "extension" (default), "global",
  #   {"path": "/x"} | {"path": ["/x", "/y"]},
  #   {"corePages": ["profile"]}
  defp validate_widget_scope(nil, _ctx), do: {[], "extension"}
  defp validate_widget_scope("extension", _ctx), do: {[], "extension"}
  defp validate_widget_scope("global", _ctx), do: {[], "global"}

  defp validate_widget_scope(%{"path" => p}, ctx) when is_binary(p) do
    cond do
      not String.starts_with?(p, "/") ->
        {["#{ctx}.scope.path must start with '/' (got: #{inspect(p)})"], nil}

      String.starts_with?(p, "/ext/") ->
        {["#{ctx}.scope.path must not include /ext/ — Nexus prefixes it automatically (got: #{inspect(p)})"], nil}

      true ->
        {[], %{"path" => [p]}}
    end
  end

  defp validate_widget_scope(%{"path" => paths}, ctx) when is_list(paths) do
    errors =
      paths
      |> Enum.with_index()
      |> Enum.flat_map(fn {p, i} ->
        cond do
          not is_binary(p) ->
            ["#{ctx}.scope.path[#{i}] must be a string, got: #{inspect(p)}"]

          not String.starts_with?(p, "/") ->
            ["#{ctx}.scope.path[#{i}] must start with '/' (got: #{inspect(p)})"]

          String.starts_with?(p, "/ext/") ->
            ["#{ctx}.scope.path[#{i}] must not include /ext/ — Nexus prefixes it automatically (got: #{inspect(p)})"]

          true ->
            []
        end
      end)

    if errors == [] do
      {[], %{"path" => paths}}
    else
      {errors, nil}
    end
  end

  defp validate_widget_scope(%{"corePages" => pages}, ctx) when is_list(pages) do
    {good, errors} =
      pages
      |> Enum.with_index()
      |> Enum.reduce({[], []}, fn {p, i}, {g, e} ->
        cond do
          not is_binary(p) ->
            {g, ["#{ctx}.scope.corePages[#{i}] must be a string, got: #{inspect(p)}" | e]}

          p not in @known_core_pages ->
            {g,
             ["#{ctx}.scope.corePages[#{i}] is not a known core page #{inspect(p)}. Known: #{Enum.join(@known_core_pages, ", ")}"
              | e]}

          true ->
            {[p | g], e}
        end
      end)

    if errors == [] do
      {[], %{"corePages" => Enum.reverse(good)}}
    else
      {Enum.reverse(errors), nil}
    end
  end

  defp validate_widget_scope(other, ctx) do
    {["#{ctx}.scope must be \"extension\", \"global\", {\"path\": ...}, or {\"corePages\": [...]}, got: #{inspect(other)}"], nil}
  end

  defp check_toolbar_buttons(acc, m) do
    case m["toolbar_buttons"] do
      nil ->
        put_norm(acc, "toolbar_buttons", [])

      list when is_list(list) ->
        {good, errors} =
          list
          |> Enum.with_index()
          |> Enum.reduce({[], []}, fn {entry, idx}, {ag, ae} ->
            case validate_toolbar_button_entry(entry, idx) do
              {:ok, normalized}  -> {[normalized | ag], ae}
              {:error, messages} -> {ag, messages ++ ae}
            end
          end)

        acc = put_norm(acc, "toolbar_buttons", Enum.reverse(good))
        Enum.reduce(errors, acc, &err(&2, &1))

      other ->
        err(acc, "toolbar_buttons must be a list, got: #{inspect(other)}")
    end
  end

  defp validate_toolbar_button_entry(entry, idx) when is_map(entry) do
    id       = entry["id"]
    icon     = entry["icon"]
    tip      = entry["tip"]
    scope    = entry["scope"]
    priority = entry["priority"]

    scope_ok = scope in [nil, "both", "posts", "replies"]

    errors =
      [
        if(is_binary(id)   and id   != "", do: nil, else: "toolbar_buttons[#{idx}].id is required (string)"),
        if(is_binary(icon) and icon != "", do: nil, else: "toolbar_buttons[#{idx}].icon is required (string, full Font Awesome class)"),
        if(is_binary(tip)  and tip  != "", do: nil, else: "toolbar_buttons[#{idx}].tip is required (string)"),
        if(scope_ok, do: nil, else: "toolbar_buttons[#{idx}].scope must be \"both\", \"posts\", or \"replies\", got: #{inspect(scope)}"),
        if(is_nil(priority) or is_number(priority), do: nil, else: "toolbar_buttons[#{idx}].priority must be a number if present")
      ]
      |> Enum.reject(&is_nil/1)

    if errors == [] do
      {:ok,
       %{
         "id"       => id,
         "icon"     => icon,
         "tip"      => tip,
         "scope"    => scope || "both",
         "priority" => priority || 50
       }}
    else
      {:error, errors}
    end
  end

  defp validate_toolbar_button_entry(other, idx),
    do: {:error, ["toolbar_buttons[#{idx}] must be an object, got: #{inspect(other)}"]}

  # ---------------------------------------------------------------------------
  # profile_tabs validation
  #
  # Profile tabs are a first-class surface: each extension-contributed tab on
  # /profile/:username pages has its own manifest entry with declared id,
  # label, optional icon, visibility, and priority. This replaces the older
  # pattern where tabs were registered as slot components with static
  # properties for metadata (Component.tabId, Component.tabLabel).
  #
  # Visibility values:
  #   - "always" (default)  — visible to all viewers of the profile
  #   - "own_only"          — visible only when the viewer is the profile owner
  #
  # Visibility is a UX hint only — it gates the tab BUTTON, not whether the
  # tab's component is fetched if directly addressed. Extensions whose tabs
  # need real access control must enforce it server-side.
  # ---------------------------------------------------------------------------

  defp check_profile_tabs(acc, m) do
    case m["profile_tabs"] do
      nil ->
        put_norm(acc, "profile_tabs", [])

      list when is_list(list) ->
        {good, errors} =
          list
          |> Enum.with_index()
          |> Enum.reduce({[], []}, fn {entry, idx}, {ag, ae} ->
            case validate_profile_tab_entry(entry, idx) do
              {:ok, normalized}  -> {[normalized | ag], ae}
              {:error, messages} -> {ag, messages ++ ae}
            end
          end)

        acc = put_norm(acc, "profile_tabs", Enum.reverse(good))
        Enum.reduce(errors, acc, &err(&2, &1))

      other ->
        err(acc, "profile_tabs must be a list, got: #{inspect(other)}")
    end
  end

  defp validate_profile_tab_entry(entry, idx) when is_map(entry) do
    id         = entry["id"]
    label      = entry["label"]
    icon       = entry["icon"]
    visibility = entry["visibility"]
    priority   = entry["priority"]

    visibility_ok = visibility in [nil, "always", "own_only"]

    errors =
      [
        if(is_binary(id)    and id    != "",  do: nil, else: "profile_tabs[#{idx}].id is required (string)"),
        if(is_binary(label) and label != "",  do: nil, else: "profile_tabs[#{idx}].label is required (string)"),
        if(is_nil(icon) or (is_binary(icon) and icon != ""), do: nil, else: "profile_tabs[#{idx}].icon must be a non-empty string if present"),
        if(visibility_ok, do: nil, else: "profile_tabs[#{idx}].visibility must be \"always\" or \"own_only\", got: #{inspect(visibility)}"),
        if(is_nil(priority) or is_number(priority), do: nil, else: "profile_tabs[#{idx}].priority must be a number if present")
      ]
      |> Enum.reject(&is_nil/1)

    if errors == [] do
      {:ok,
       %{
         "id"         => id,
         "label"      => label,
         "icon"       => icon,
         "visibility" => visibility || "always",
         "priority"   => priority   || 50
       }}
    else
      {:error, errors}
    end
  end

  defp validate_profile_tab_entry(other, idx),
    do: {:error, ["profile_tabs[#{idx}] must be an object, got: #{inspect(other)}"]}

  # ---------------------------------------------------------------------------
  # Notification type declarations (piece 7)
  #
  # Extensions declare notification types here. Each entry tells the host:
  #   - what key the extension will send (data["ext_type"] in notify_extension/3)
  #   - how to render it in the preferences UI (label, description, icon)
  #   - which channels make sense for it (web, email, push)
  #   - what user-preference defaults to apply on first install
  #   - optionally, what fields the payload data is expected to contain
  #
  # The host uses these declarations to:
  #   - render extra rows in the user-facing notification preferences page
  #     (grouped per-extension via a header)
  #   - validate notification data payloads at send time
  #   - surface declared-vs-registered in the admin runtime panel
  # ---------------------------------------------------------------------------

  @valid_notification_channels ~w(web email push)
  @notif_key_regex ~r/^[a-z][a-z0-9_]*$/

  defp check_notification_types(acc, m) do
    case m["notification_types"] do
      nil ->
        put_norm(acc, "notification_types", [])

      list when is_list(list) ->
        {good, errors} =
          list
          |> Enum.with_index()
          |> Enum.reduce({[], []}, fn {entry, idx}, {ag, ae} ->
            case validate_notification_type_entry(entry, idx) do
              {:ok, normalized}  -> {[normalized | ag], ae}
              {:error, messages} -> {ag, messages ++ ae}
            end
          end)

        acc = put_norm(acc, "notification_types", Enum.reverse(good))
        Enum.reduce(errors, acc, &err(&2, &1))

      other ->
        err(acc, "notification_types must be a list, got: #{inspect(other)}")
    end
  end

  defp validate_notification_type_entry(entry, idx) when is_map(entry) do
    key            = entry["key"]
    label          = entry["label"]
    description    = entry["description"]
    icon           = entry["icon"]
    channels       = entry["channels"]
    default_prefs  = entry["default_preferences"] || %{}
    payload_schema = entry["payload_schema"]

    key_ok =
      is_binary(key) and key != "" and Regex.match?(@notif_key_regex, key) and
        String.length(key) <= 64

    label_ok       = is_binary(label) and label != "" and String.length(label) <= 64
    description_ok = is_binary(description) and description != "" and String.length(description) <= 200
    icon_ok        = is_nil(icon) or (is_binary(icon) and icon != "")

    channels_ok =
      is_list(channels) and channels != [] and
        Enum.all?(channels, &(&1 in @valid_notification_channels))

    default_prefs_ok =
      is_map(default_prefs) and
        Enum.all?(default_prefs, fn {k, v} ->
          k in @valid_notification_channels and is_boolean(v)
        end)

    payload_schema_ok =
      is_nil(payload_schema) or
        (is_map(payload_schema) and Enum.all?(payload_schema, fn {k, v} ->
          is_binary(k) and is_binary(v)
        end))

    errors =
      [
        if(key_ok, do: nil,
          else: "notification_types[#{idx}].key is required, must match #{inspect(@notif_key_regex.source)}, max 64 chars (got: #{inspect(key)})"),
        if(label_ok, do: nil,
          else: "notification_types[#{idx}].label is required (string, max 64 chars)"),
        if(description_ok, do: nil,
          else: "notification_types[#{idx}].description is required (string, max 200 chars)"),
        if(icon_ok, do: nil,
          else: "notification_types[#{idx}].icon must be a non-empty string if present"),
        if(channels_ok, do: nil,
          else: "notification_types[#{idx}].channels is required, must be a non-empty list with values from #{inspect(@valid_notification_channels)}"),
        if(default_prefs_ok, do: nil,
          else: "notification_types[#{idx}].default_preferences must be a map with channel keys and boolean values"),
        if(payload_schema_ok, do: nil,
          else: "notification_types[#{idx}].payload_schema must be a map of string field name → string description if present")
      ]
      |> Enum.reject(&is_nil/1)

    if errors == [] do
      # Validate default_prefs only mention declared channels. Anything
      # declared for a channel not in `channels` is silently dropped at
      # normalization time — user-friendly behavior, since the channel
      # not being supported is the higher-level constraint.
      normalized_default_prefs =
        @valid_notification_channels
        |> Enum.reduce(%{}, fn ch, acc ->
          cond do
            ch in channels and Map.has_key?(default_prefs, ch) ->
              Map.put(acc, ch, default_prefs[ch])
            ch in channels ->
              # Default: web on, others off
              Map.put(acc, ch, ch == "web")
            true ->
              acc
          end
        end)

      {:ok,
       %{
         "key"                 => key,
         "label"               => label,
         "description"         => description,
         "icon"                => icon || "fa-bell",
         "channels"            => channels,
         "default_preferences" => normalized_default_prefs,
         "payload_schema"      => payload_schema
       }}
    else
      {:error, errors}
    end
  end

  defp validate_notification_type_entry(other, idx),
    do: {:error, ["notification_types[#{idx}] must be an object, got: #{inspect(other)}"]}

  # ---------------------------------------------------------------------------
  # Field validation primitives
  # ---------------------------------------------------------------------------

  defp require_string(acc, m, field) do
    case m[field] do
      v when is_binary(v) and v != "" -> put_norm(acc, field, v)
      nil -> err(acc, "#{field} is required (string)")
      other -> err(acc, "#{field} must be a non-empty string, got: #{inspect(other)}")
    end
  end

  defp optional_string(acc, m, field) do
    case m[field] do
      nil -> put_norm(acc, field, nil)
      v when is_binary(v) -> put_norm(acc, field, v)
      other -> err(acc, "#{field} must be a string if present, got: #{inspect(other)}")
    end
  end

  defp optional_url(acc, m, field) do
    case m[field] do
      nil ->
        put_norm(acc, field, nil)

      v when is_binary(v) ->
        if String.starts_with?(v, ["http://", "https://"]) or String.starts_with?(v, "/") do
          put_norm(acc, field, v)
        else
          err(acc, "#{field} must be a URL starting with http://, https://, or / (got: #{inspect(v)})")
        end

      other ->
        err(acc, "#{field} must be a string if present, got: #{inspect(other)}")
    end
  end

  defp optional_string_array(acc, m, field) do
    case m[field] do
      nil ->
        put_norm(acc, field, [])

      list when is_list(list) ->
        case Enum.find(list, &(not is_binary(&1))) do
          nil -> put_norm(acc, field, list)
          bad -> err(acc, "#{field} entries must be strings, got: #{inspect(bad)}")
        end

      other ->
        err(acc, "#{field} must be a list of strings, got: #{inspect(other)}")
    end
  end

  defp validate_slug(acc, m) do
    case m["slug"] do
      v when is_binary(v) ->
        if Regex.match?(@slug_regex, v) do
          acc
        else
          err(acc, "slug must match #{inspect(Regex.source(@slug_regex))} (lowercase letters, digits, hyphens), got: #{inspect(v)}")
        end

      _ ->
        # missing/non-string already reported by require_string
        acc
    end
  end

  defp validate_semver(acc, m, field) do
    case m[field] do
      v when is_binary(v) ->
        if Regex.match?(@semver_regex, v) do
          acc
        else
          err(acc, "#{field} must be a semver string like \"1.0.0\" or \"2.3.4-beta.1\", got: #{inspect(v)}")
        end

      _ ->
        acc
    end
  end

  # ---------------------------------------------------------------------------
  # Accumulator helpers
  # ---------------------------------------------------------------------------

  defp put_norm(acc, key, value) do
    %{acc | normalized: Map.put(acc.normalized, key, value)}
  end

  defp err(acc, msg) do
    %{acc | errors: [msg | acc.errors]}
  end

  # permissions declares permission gates the extension enforces, surfaced on
  # the Permissions admin page. Each entry is an object:
  #
  #   { "key": "can_view_gallery", "label": "Can view the gallery", "default": "everyone" }
  #
  # key must be a slug-format string. label must be a non-empty string.
  # default must be one of the four permission levels.
  @valid_permission_levels ~w(everyone member moderator admin)

  defp check_permissions(acc, m) do
    case m["permissions"] do
      nil ->
        put_norm(acc, "permissions", [])

      list when is_list(list) ->
        {good, errors} =
          list
          |> Enum.with_index()
          |> Enum.reduce({[], []}, fn {entry, idx}, {ag, ae} ->
            case validate_permission_entry(entry, idx) do
              {:ok, normalized}  -> {[normalized | ag], ae}
              {:error, messages} -> {ag, messages ++ ae}
            end
          end)

        acc = put_norm(acc, "permissions", Enum.reverse(good))
        Enum.reduce(errors, acc, &err(&2, &1))

      other ->
        err(acc, "permissions must be a list, got: #{inspect(other)}")
    end
  end

  defp validate_permission_entry(entry, idx) when is_map(entry) do
    key     = entry["key"]
    label   = entry["label"]
    default = entry["default"]

    key_ok =
      is_binary(key) and key != "" and
        Regex.match?(~r/^[a-z0-9_]+$/, key) and
        String.length(key) <= 64

    label_ok   = is_binary(label) and label != "" and String.length(label) <= 120
    default_ok = is_nil(default) or default in @valid_permission_levels

    cond do
      not key_ok ->
        {:error, ["permissions[#{idx}]: key must be a lowercase alphanumeric/underscore string (max 64 chars), got: #{inspect(key)}"]}

      not label_ok ->
        {:error, ["permissions[#{idx}]: label must be a non-empty string (max 120 chars), got: #{inspect(label)}"]}

      not default_ok ->
        {:error, ["permissions[#{idx}]: default must be one of #{inspect(@valid_permission_levels)}, got: #{inspect(default)}"]}

      true ->
        {:ok, %{
          "key"     => key,
          "label"   => label,
          "default" => default || "member"
        }}
    end
  end

  defp validate_permission_entry(other, idx) do
    {:error, ["permissions[#{idx}]: each entry must be an object, got: #{inspect(other)}"]}
  end

  defp finalize(%{errors: [], normalized: norm, warnings: warnings}) do
    {:ok, norm, Enum.reverse(warnings)}
  end

  defp finalize(%{errors: errors}) do
    {:error, Enum.reverse(errors)}
  end
end
