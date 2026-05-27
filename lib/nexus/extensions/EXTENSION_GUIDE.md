# Nexus Extension Development Guide

This is the authoritative reference for building Nexus extensions. It documents every contract surface — every manifest field, every Elixir callback, every JavaScript registration API, every payload — that an extension author interacts with. You should not need to read Nexus's source code to ship a working extension; this guide carries everything.

The example threaded through every section is the **Foundation Smoke Test** — a real, working extension that exercises every surface in a single install. By the end of the guide, you'll have seen its complete manifest, its complete Elixir module, and its complete JavaScript bundle, with every piece explained where it appears.

---

## 1. What an extension is

A Nexus extension is a GitHub repository containing four things:

- A `manifest.json` declaring what the extension contributes.
- An Elixir module implementing the server-side parts.
- An optional JavaScript bundle implementing the browser-side parts.
- A README.

When an admin installs your extension, Nexus fetches the latest release tarball, compiles your Elixir source into the running BEAM VM, runs any migrations through Nexus's own Repo, starts any background processes you declared under Nexus's supervisor, and registers your hooks, routes, slots, and other surfaces in an in-memory ETS registry. Your JavaScript bundle is copied to a path Nexus serves and is loaded as a `<script>` tag before React mounts, so your `register*` calls are present from the first render.

This is the **in-VM model**: one database, one supervision tree, one deployment, one OTP version. There is no separate service to deploy, no webhook delivery, no Docker networking, no inter-service authentication. Event hooks are direct function calls into your loaded module. Page routes you register live at `/ext/<your-slug>/...` and are served by Nexus's SPA shell, with your JavaScript bundle resolving them client-side. API requests from your bundle go to `/ext/<your-slug>/api/...` and route through Nexus's plug pipeline directly to plugs you exported.

What this gets you, as an extension author:

- **No version skew.** Your code compiles against the exact Elixir/OTP version Nexus is running.
- **Shared dependency tree.** Anything Nexus depends on — `Ecto`, `Req`, `Jason`, `Oban`, `Image`, `Phoenix.PubSub` — is available to your extension without declaration.
- **Shared database.** Use `Nexus.Repo` directly. Define your own tables; reference Nexus's by name when needed.
- **One artifact, one version.** Your manifest, source, and JS bundle ship together in a single GitHub release tarball.

What it asks of you in return:

- **Trust.** Your compiled code runs with the same privileges as Nexus itself. An admin installing your extension is granting that trust.
- **Discipline about isolation.** Crashes in your supervised processes don't affect Nexus, but a buggy `handle_event/3` running synchronously inside Nexus's dispatch task can hold up other extensions subscribed to the same event. Push heavy work to Oban jobs.
- **Manifest discipline.** The manifest is the contract. Every surface you contribute — every hook, slot, route, widget, toolbar button, profile tab, digest section — must be declared there before its implementation will be wired up. The next section gets you to a scaffolded extension; sections 4–7 walk through the manifest field by field.

If you've built extensions for older Nexus revisions and remember webhook URLs, service URLs, proxy secrets, or `manifest.json` containing only identity fields — none of that exists anymore. Everything is in-VM, everything is declared in the manifest.

---

## 2. Quick start

Scaffold a new extension:

```bash
mix nexus.extension.new foundation_smoke_test \
  --author "Your Name" \
  --description "Exercises every surface of the Nexus extension foundation"
cd extensions/foundation-smoke-test
```

The scaffold task produces a directory containing a complete `manifest.json` (with every field present and empty), a minimal Elixir module that `use`s the extension behaviour, a JavaScript bundle stub with examples of every register call, a `mix.exs`, and a README. You can install this immediately — it loads as a no-op extension that declares nothing — and then grow it field by field.

To install:

```bash
# Local development: install from a directory on the same filesystem
mix nexus.extension.install ./extensions/foundation-smoke-test
```

Or, from the running Nexus admin UI: **Admin → Forum Settings → Extensions → Install from URL**, and paste a GitHub repo URL. Nexus reads `manifest.json` at the repo root, finds the latest GitHub release, downloads its tarball, and runs the install pipeline. The pipeline is covered in detail in §10; for now, all you need to know is that a successful install ends with a green "loaded" badge on the extension's row in the admin extensions list.

### Schema validation in your editor

Add the manifest schema reference to the top of your `manifest.json`:

```json
{
  "$schema": "https://YOUR-NEXUS-HOST/manifest_schema.json",
  "manifest_version": 2,
  ...
}
```

Any editor with JSON Schema support — VS Code, JetBrains IDEs, Helix, Zed — will then validate your manifest as you type, autocomplete field names, and explain what each field accepts. Replace `YOUR-NEXUS-HOST` with the host of any Nexus instance; the schema is served at `/manifest_schema.json` on every instance and is identical across them.

If you skip the `$schema` line, the install pipeline will still validate your manifest at install time and reject anything malformed. The `$schema` line just moves that feedback into your editor, where it's a lot cheaper.

---

## 3. Project layout

After scaffolding, your extension directory looks like this:

```
foundation-smoke-test/
├── manifest.json                          # The contract
├── mix.exs                                # Elixir project file
├── lib/
│   └── foundation_smoke_test.ex           # Elixir module
├── priv/
│   └── static/
│       ├── foundation-smoke-test.js       # JS bundle
│       ├── logo.webp                      # 200×200 extension icon (optional)
│       └── banner.webp                    # 800×400 hero image (optional)
└── README.md
```

Each file has one job:

**`manifest.json`** — the canonical declaration of what your extension contributes. Identity, metadata, settings, every surface. Nexus reads this once at install time, validates it against the schema, normalizes it, and stores the normalized form in the extensions table. Every downstream consumer — the loader, the registry, the admin UI, the digest builder, the notification system, your own JS bundle's validation — reads from this stored copy. This file is the spine of everything that follows.

**`lib/<underscored_slug>.ex`** — your extension's main Elixir module. It must `use Nexus.Extensions.Behaviour`, which gives you no-op defaults for every callback. You override only the callbacks corresponding to surfaces you declared in the manifest. If your manifest declares `hooks: ["post_created"]`, you implement `handle_event/3`. If it declares `digest_sections`, you implement `handle_digest_section/3`. The loader cross-checks these at install time and refuses to load an extension whose module doesn't export callbacks for surfaces the manifest declared.

The filename uses the slug with hyphens replaced by underscores (Elixir convention): `foundation_smoke_test.ex` for slug `foundation-smoke-test`. The module name is the one you declared in `manifest.json` under the `module` field — for the smoke test, that's `FoundationSmokeTest`. The loader uses this exact name to find your module among the compiled outputs.

**`priv/static/<slug>.js`** — your browser-side bundle. A plain, self-contained JavaScript file (no build step required, though you can use one if you want). When loaded, it calls `window.NexusExtensions.registerSlot(...)`, `registerRoute(...)`, `registerRightWidget(...)`, etc., to wire up frontend surfaces declared in your manifest. Each `register*` call cross-checks itself against your manifest at runtime and logs a console warning if you register something the manifest didn't declare. If your extension has no frontend (server-only — webhook receiver, background scraper, etc.), omit the `js_bundle` field from your manifest and delete this file.

Other files under `priv/static/` are copied to your extension's served asset directory at install time. By convention, place a `logo.webp` (200×200 px, square) and `banner.webp` (800×400 px, wide hero) here for use on the admin extension card and the public store listing. They're served at `/ext/<slug>/assets/logo.webp` and `/ext/<slug>/assets/banner.webp` respectively. You can also put any other static files (images, fonts, JSON data, additional JS modules) here and reference them with `/ext/<slug>/assets/<filename>`.

**`mix.exs`** — a standard Elixir project file. The scaffold generates one with no dependencies and `app: :<underscored_slug>`. You won't usually touch this; the loader doesn't run `mix deps.get` (your extension shares Nexus's dependency tree), but a valid `mix.exs` is still useful for local testing.

**`README.md`** — placeholder content from the scaffold. Replace with your own. Nexus's store and admin panel link to your repo, so this is the first thing people see.

### Where files end up after install

When Nexus installs your extension, files move:

| Source path in your repo                         | Where it ends up on the Nexus host                          |
|--------------------------------------------------|-------------------------------------------------------------|
| `manifest.json`                                  | Stored in the `extensions.manifest` DB column (normalized)  |
| `lib/**/*.ex`                                    | Compiled into the BEAM VM, no on-disk artifact preserved    |
| `priv/static/<slug>.js`                          | `/app/uploads/extensions/<slug>/assets/<slug>.js`           |
| `priv/static/logo.webp` (and other static files) | `/app/uploads/extensions/<slug>/assets/<filename>`          |

Files in `/app/uploads/extensions/<slug>/assets/` are served at `/ext/<slug>/assets/<filename>` by Nexus's static file handler. The path inside `/app/uploads/` is the canonical filesystem location, but **your extension code should never construct these paths manually** — use the `Nexus.Extensions.Storage` helpers (covered in §8.11) for any files you create at runtime.

Now that you know the layout, the rest of the guide walks the manifest field by field (§4–§7), then the Elixir side callback by callback (§8), then the JavaScript side register call by register call (§9). The lifecycle and admin panel (§10–§11) and reference appendices (§12) come after.

---

## 4. The manifest — overview and identity

Sections 4 through 7 cover every field your `manifest.json` can contain. The manifest is structured into four conceptual groups, which the next four sections follow:

| Section | Group               | Fields                                                                          |
|---------|---------------------|---------------------------------------------------------------------------------|
| §4      | Identity & metadata | `manifest_version`, `name`, `slug`, `version`, `module`, plus descriptive fields |
| §5      | Settings            | `settings_schema`, `settings_tabs`                                              |
| §6      | Backend surfaces    | `hooks`, `digest_sections`, `side_data`, `notification_types`, `capabilities`, `permissions` |
| §7      | Frontend surfaces   | `slots`, `routes`, `admin_panel`, `explore`, `right_widgets`, `toolbar_buttons`, `profile_tabs` |

Every field is optional except `manifest_version`, `name`, `slug`, `version`, and `module`. A minimal valid manifest declares these five fields and nothing else; the extension installs as a no-op shell, ready to grow.

The validator runs at install time. Errors halt the install with a specific message naming the field and the violated constraint. Warnings (for forward-compatible declarations Nexus can't yet resolve, like an unknown `capabilities` string) are logged and surfaced in the admin runtime panel but don't block the install. The full error/warning behavior is covered in §10.

### 4.1 `manifest_version`

```json
"manifest_version": 2
```

Required. The schema version this manifest conforms to. The current version is `2`. Future schema changes will bump this number; the validator rejects unknown versions, so this acts as a sanity check that the extension targets a Nexus revision compatible with its manifest shape.

There is no `1`. Earlier Nexus revisions had an unversioned, looser manifest format with different fields (`webhook_url`, `service_url`, etc.); `manifest_version: 2` is the first explicitly versioned format and is the only one accepted today.

### 4.2 `name`, `slug`, `version`

```json
"name":    "Foundation Smoke Test",
"slug":    "foundation-smoke-test",
"version": "1.7.0"
```

All three are required.

- **`name`** is the human-readable display name. It appears on the extension card, in admin lists, as the title in the admin panel, and anywhere else Nexus surfaces your extension to humans. Any non-empty string works; aim for short and recognizable.

- **`slug`** is the machine-readable identifier. Must match `^[a-z0-9-]+$` (lowercase letters, digits, hyphens) and be globally unique across all extensions on a Nexus instance. Used as the URL prefix (`/ext/<slug>/...`), the asset directory name, the key in every internal lookup, and the namespace for toolbar button identities. Renaming after install means a full uninstall and reinstall — choose carefully.

- **`version`** is a semver string. The schema accepts the standard semver grammar — `1.0.0`, `2.3.4-beta.1`, `1.0.0+build.42`. Nexus's update flow compares this against the latest GitHub release tag to decide whether an update is available; the tag is the source of truth for the *installed* version, but `manifest.version` is what gets shown on the extension card and in the admin list when no GitHub release has been published yet. For published extensions, keep them in sync.

### 4.3 `module`

```json
"module": "FoundationSmokeTest"
```

Required. The Elixir module name (as a string) that implements `Nexus.Extensions.Behaviour`. Must start with an uppercase letter and contain only letters, digits, underscores, and dots — i.e., a valid Elixir module name.

The loader uses this name to find your root module after compilation. If the module doesn't exist in your compiled source, or exists but doesn't `use Nexus.Extensions.Behaviour`, the install fails with `manifest_invalid`. Convention is the CamelCase form of your name: `FoundationSmokeTest` for `Foundation Smoke Test`. The scaffold generates matching names automatically; if you later rename the module in your source, update this field too.

### 4.4 Metadata fields

```json
"description":     "Exercises every surface of the Nexus extension foundation in one install.",
"author":          "Nexus Foundation Team",
"homepage":        "https://github.com/example/foundation-smoke-test",
"repository":      "https://github.com/example/foundation-smoke-test",
"license":         "MIT",
"tags":            ["test", "diagnostic"],
"logo_url":        "/ext/foundation-smoke-test/assets/logo.webp",
"banner_url":      "/ext/foundation-smoke-test/assets/banner.webp",
"compatible_with": "^1.0"
```

All optional. None affect runtime behavior — they're shown on the extension card, the store listing, and the admin detail page.

| Field             | What it is                                                                                  |
|-------------------|---------------------------------------------------------------------------------------------|
| `description`     | One-sentence summary. Truncated past ~200 chars in card views.                              |
| `author`          | Free-form. GitHub username by convention; links to your profile in store listings.          |
| `homepage`        | Canonical URL — usually the GitHub repo. Must start with `http://`, `https://`, or `/`.      |
| `repository`      | Explicit GitHub URL. Use if `homepage` points somewhere else and you still want release polling. |
| `license`         | Free-form. SPDX identifiers (`MIT`, `Apache-2.0`) recommended; no validation performed.     |
| `tags`            | 1–4 short strings shown as pills. No central registry — e.g. `games`, `integrations`, `moderation`. |
| `logo_url`        | Square icon. 200×200 px PNG or WebP. Rendered at 48×48 with rounded corners.                |
| `banner_url`      | Wide hero. 800×400 px PNG/WebP/JPEG. Rendered as a 120 px tall band with `object-fit: cover`. |
| `compatible_with` | Semver range — `"^1.0"`, `">=1.2.0 <2.0.0"`. Currently informational; may be enforced later. |

For `logo_url` and `banner_url`, ship the images at `priv/static/logo.webp` and `priv/static/banner.webp` and reference them by their served path:

```
/ext/<slug>/assets/logo.webp
/ext/<slug>/assets/banner.webp
```

This keeps the manifest portable across hosts.

### 4.5 `js_bundle`

```json
"js_bundle": "foundation-smoke-test.js"
```

Optional. The filename of your JavaScript bundle, relative to your `priv/static/` directory. If present, Nexus copies the file from `priv/static/<js_bundle>` to `/app/uploads/extensions/<slug>/assets/<js_bundle>` at install time and serves it from `/ext/<slug>/assets/<js_bundle>`. The bundle is auto-injected into every page in Nexus as a `<script>` tag in the HTML head, before React mounts.

The path must be relative and must not contain `..` segments — the validator rejects absolute paths and path traversal. Conventionally the filename matches your slug: `foundation-smoke-test.js` for slug `foundation-smoke-test`.

Omit this field if your extension has no frontend (server-only — webhook receivers, background scrapers, integration bridges). When `js_bundle` is null, Nexus simply skips bundle injection; the extension's Elixir-side callbacks and registered routes still work.

### 4.6 Schema reference (`$schema`)

```json
"$schema": "https://YOUR-NEXUS-HOST/manifest_schema.json"
```

Optional, but recommended. The JSON Schema URL for editor validation. Nexus serves the schema at `/manifest_schema.json` on every instance, identical across versions of Nexus speaking the same `manifest_version`. The validator ignores this field — it's purely for your editor's benefit.

---

## 5. The manifest — settings

Settings are configuration values an admin sets per-installation. They're stored in the `extensions.settings` JSON column, passed to every callback that needs them (`handle_event/3`, `handle_digest_section/3`, lifecycle hooks), and rendered as form fields in the admin panel under **Admin → Extensions → \<your extension> → Settings**.

#### Settings UI: pick one

Before going further: Nexus offers two ways to render settings in the admin, and you should generally pick exactly one.

- **Default — declare `settings_schema` only.** The host generates the form automatically from your schema. Don't register an admin panel for settings alone. This is the right answer for most extensions.
- **Custom UI — register an admin panel (§7.3) and omit `settings_schema`.** Your panel owns the entire settings UI and saves to `PATCH /admin/extensions/<slug>/settings` itself. The host renders no fallback form.
- **Advanced — declare both.** Use this only when your registered panel shows something *other than* a settings form (status displays, documentation, custom controls) and you want the host's auto-rendered form for the actual settings fields. The host renders the fallback whenever `settings_schema` has any keys, regardless of whether you registered a panel. **Watch out:** if both your panel and the fallback render the same fields, the form appears twice. See §11.2.

The smoke test takes the advanced path — its registered admin panel renders explanatory text about what the field does, and the host's auto-rendered fallback below it renders the actual toggle for `enable_debug_log`.

The smoke test declares one setting that toggles verbose logging in its hook handler:

```json
"settings_schema": {
  "enable_debug_log": {
    "type":        "boolean",
    "label":       "Verbose handler logging",
    "default":     false,
    "description": "When true, the post_created handler logs to the server console on every hook fire."
  }
}
```

That single field appears in the admin settings page as a toggle switch labeled "Verbose handler logging" with the description text underneath. The admin's choice persists in `ext.settings["enable_debug_log"]` and is passed to every `handle_event/3` call so the handler can branch on it. We'll see that in §8.3.

### 5.1 `settings_schema`

The schema is a map from field key to field definition. Each field definition is itself a map with at minimum a `type`, and any of the optional attributes below.

```json
"settings_schema": {
  "<field_key>": {
    "type":        "<type>",
    "label":       "<human label>",
    "default":     <type-appropriate default>,
    "description": "<optional helper text>",
    "secret":      <true|false>,
    "required":    <true|false>,
    "placeholder": "<input placeholder>",
    "options":     [...]
  }
}
```

The field key (the map key, e.g. `"enable_debug_log"`) is what you'll read from the `settings` map in your Elixir callbacks. It should be a valid Elixir map key — by convention, lowercase with underscores.

Supported types:

| Type      | Form control                  | Stored as     | Notes                                                       |
|-----------|-------------------------------|---------------|-------------------------------------------------------------|
| `string`  | Single-line text input        | string        | Most common type. Use `placeholder` for example values.     |
| `text`    | Multi-line textarea           | string        | For longer values: prompts, descriptions, blocks of config. |
| `boolean` | Toggle switch                 | true/false    | The `default` should be a boolean literal, not a string.    |
| `number`  | Numeric input                 | number        | Both integers and floats; no built-in range constraints.    |
| `select`  | Dropdown                      | string        | Requires `options` — see below.                             |
| `color`   | Hex color input + color picker | string       | Stored as `#RRGGBB` hex strings.                            |

Common attributes:

| Attribute      | Purpose                                                                                    |
|----------------|--------------------------------------------------------------------------------------------|
| `label`        | Form label. Defaults to the field key (underscores converted to spaces).                   |
| `default`      | Initial value. Type-appropriate literal — booleans without defaults default to `false`.    |
| `description`  | Helper text under the form control.                                                        |
| `secret`       | Render as masked password input. Value stored plaintext in DB — masking is UI-only.        |
| `required`     | Block save while empty. Use sparingly; required fields without defaults make first-install awkward. |
| `placeholder`  | Placeholder text for empty inputs.                                                          |
| `options`      | Required for `select`, ignored for others. Array of `{value, label}` objects:               |

```json
"log_level": {
  "type":    "select",
  "label":   "Log level",
  "default": "info",
  "options": [
    {"value": "debug", "label": "Debug (verbose)"},
    {"value": "info",  "label": "Info"},
    {"value": "warn",  "label": "Warnings only"},
    {"value": "error", "label": "Errors only"}
  ]
}
```

When the admin saves the form, the resulting settings map is merged into `ext.settings`. Existing keys not in the form are preserved.

**One namespace caveat:** the keys you declare in `settings_schema` share storage with keys declared in `permissions` (§6.6) — both write to the same `ext.settings` JSON column. Don't reuse a key across the two. If you declare a `settings_schema` field `dark_mode` and a permission `dark_mode`, the admin's Permissions page and the extension's settings form will overwrite each other. The convention `can_<verb>_<noun>` for permissions (`can_view_gallery`, `can_upload_image`) is a reliable way to keep the two namespaces distinct.

### 5.2 `settings_tabs`

For extensions with many settings, you can group fields into tabs:

```json
"settings_schema": {
  "api_key":           {"type": "string",  "label": "API Key",         "secret": true},
  "api_endpoint":      {"type": "string",  "label": "API endpoint"},
  "retry_count":       {"type": "number",  "label": "Retry attempts",  "default": 3},
  "feature_x_enabled": {"type": "boolean", "label": "Enable feature X"},
  "feature_x_mode":    {"type": "select",  "label": "Feature X mode",  "options": [...]}
},
"settings_tabs": [
  {
    "key":    "credentials",
    "label":  "Credentials",
    "icon":   "fa-key",
    "fields": ["api_key", "api_endpoint"]
  },
  {
    "key":    "behavior",
    "label":  "Behavior",
    "icon":   "fa-gear",
    "fields": ["retry_count", "feature_x_enabled", "feature_x_mode"]
  }
]
```

Each tab is an object with:

- **`key`** — a unique identifier used as the tab's URL fragment. Must be a non-empty string.
- **`label`** — the tab title displayed in the admin UI.
- **`icon`** — optional Font Awesome icon class (short form: `fa-key`, not `fa-solid fa-key`). Shown next to the tab label.
- **`fields`** — an array of field keys from `settings_schema` that belong to this tab. Each field appears in exactly one tab.

If `settings_tabs` is omitted or empty, all fields from `settings_schema` render on a single untabbed page.

Fields listed in a tab but not present in `settings_schema` are silently dropped. Fields present in `settings_schema` but not listed in any tab — when tabs are declared — render in an implicit "Other" tab at the end.


---

## 6. The manifest — backend surfaces

These fields declare what your extension contributes server-side: which events it subscribes to, which digest sections it produces, which composer attachments it owns, which notifications it sends, which capabilities it claims, and which permission gates it enforces. Each has a matching Elixir callback or helper you use in §8.

### 6.1 `hooks`

Hooks are the events Nexus fires when forum activity happens. Your extension declares which it cares about, and Nexus calls your `handle_event/3` callback for each one.

The smoke test subscribes to one event:

```json
"hooks": [
  {"event": "post_created", "priority": 50}
]
```

Each entry is either a bare string (`"post_created"`) or an object with `event` and optional `priority` (default 50). Bare strings exist for back-compat with manifests authored before priority support landed; new manifests should use the object form when ordering matters and the string form is fine when it doesn't.

**Priority** controls ordering among handlers subscribed to the same event. Lower numbers run first. Handlers run sequentially in priority order, so a handler at priority 10 finishes before a handler at priority 50 starts — meaning the later handler can observe side effects (DB writes, settings changes) the earlier one performed. Default is 50; reserve lower values for handlers that genuinely need to run before others.

The schema rejects unknown event names at install time. The current event list:

| Event              | Fires when                                                                       |
|--------------------|----------------------------------------------------------------------------------|
| `post_created`     | A user creates a top-level post.                                                 |
| `post_updated`     | A post is edited (by author or moderator).                                       |
| `post_deleted`     | A post is deleted (by author or moderator).                                      |
| `reply_created`    | A user replies to a post.                                                        |
| `reply_deleted`    | A reply is deleted.                                                              |
| `reaction_added`   | A user adds a reaction to a post or reply.                                       |
| `reaction_removed` | A user removes their own reaction.                                               |
| `report_created`   | A user submits a moderation report.                                              |
| `report_resolved`  | A moderator transitions a report out of the pending state.                       |
| `user_registered`  | A new user account is created.                                                   |
| `user_login`       | A user logs in (interactive session, not token refresh).                         |

Full payload reference for each event is in §8.3 and Appendix A. Two rules worth knowing now: every payload includes a `user_id` (the actor — the user who *did* the thing), and every payload is plain JSON-serializable values (strings, numbers, booleans, nil, lists, maps). No structs, no `DateTime`, no PIDs.

The loader cross-checks `hooks` against your module at install time: if the manifest declares any hook, your module must export `handle_event/3`, or the install fails with `manifest_invalid`.

### 6.2 `digest_sections`

Digest sections are blocks of content your extension contributes to scheduled digest emails. An admin can enable per-section delivery in **Admin → Digest**, and Nexus calls your `handle_digest_section/3` callback when building the email.

The smoke test declares two sections — one to exercise the structured-data path, one to exercise the pre-rendered HTML escape hatch:

```json
"digest_sections": [
  {
    "key":                "smoke_structured",
    "label":              "Smoke Structured",
    "icon":               "fa-flask",
    "enabled_by_default": true
  },
  {
    "key":                "smoke_rendered",
    "label":              "Smoke Rendered HTML",
    "icon":               "fa-flask-vial",
    "enabled_by_default": false
  }
]
```

Each entry:

| Field                | Purpose                                                                          |
|----------------------|----------------------------------------------------------------------------------|
| `key`                | Required. The key Nexus passes to your callback to identify which section to build. Must be unique within your extension. |
| `label`              | Required. Human-readable name shown in **Admin → Digest** alongside the toggle.  |
| `icon`               | Optional. Font Awesome class (short form, e.g. `fa-flask`). Shown next to the label. |
| `enabled_by_default` | Optional, defaults to `false`. Whether the section is on for fresh installs.     |

The implementation contract — what your `handle_digest_section/3` callback must return, the available layouts (`list`, `leaderboard`, `stat_bars`, `pill_grid`, `card`), the item shape — is covered in §8.8.

![A Nexus digest email containing the smoke test's structured section (list layout) and its pre-rendered HTML section. Built-in sections — leaderboard, new members — render alongside in the same visual idiom.](images/digest-sections.png)

If the manifest declares any section, your module must export `handle_digest_section/3`, or the install fails.

### 6.3 `side_data`

Side-data declares that your extension can persist attachments alongside posts or replies. When a user submits a post or reply with attachments in the composer, Nexus dispatches each attachment to the extension that declared its `{entity, kind}` pair.

The smoke test owns two pairs — one for posts, one for replies:

```json
"side_data": [
  {"entity": "post",  "kind": "smoke_note"},
  {"entity": "reply", "kind": "smoke_reply_note"}
]
```

Each entry:

| Field    | Purpose                                                                              |
|----------|--------------------------------------------------------------------------------------|
| `entity` | Required. The entity type your data attaches to: `post`, `reply`, or `user`.          |
| `kind`   | Required. A free-form string naming the attachment kind. Namespace it to avoid collisions with other extensions. |

Only one extension can own a given `{entity, kind}` pair; if two extensions declare the same pair, the most-recently-loaded one wins (and the conflict surfaces in the admin runtime panel). Namespacing your `kind` with your slug (`gamepedia_game_link`, not `game_link`) avoids this.

The full flow — composer toolbar button calls `attach({kind, data})`, Nexus routes to your `persist_attachment/3` callback, you persist the attachment into your own tables — is covered in §8.9 (Elixir side) and §9.7 (the `attach` context in `registerToolbarButton`).

For cleanup on entity deletion, subscribe to the matching `<entity>_deleted` hook event. `post_deleted` and `reply_deleted` exist; there is no `user_deleted` event today, so user-attached side-data has no automatic cleanup path. If you attach to users, plan a periodic cleanup job rather than relying on a hook.

### 6.4 `notification_types`

Notification types declare the categories of notification your extension can send. Declaring them:

- Validates payloads at send time (missing required fields are rejected).
- Surfaces a per-extension section in the user-facing notification preferences page.
- Lets users opt in/out per channel (web, email, push).

The smoke test declares one notification type:

```json
"notification_types": [
  {
    "key":         "smoke_notif",
    "label":       "Smoke test event",
    "description": "Fires when you create a post, as a foundation smoke check.",
    "icon":        "fa-flask",
    "channels":    ["web", "email"],
    "default_preferences": {
      "web":   true,
      "email": false
    },
    "payload_schema": {
      "post_id": "ID of the post that triggered the smoke notification"
    }
  }
]
```

Each entry:

| Field                  | Required | Purpose                                                                        |
|------------------------|----------|--------------------------------------------------------------------------------|
| `key`                  | yes      | The type identifier you'll pass to `notify_extension/3`. Must match `^[a-z][a-z0-9_]*$`, max 64 chars. |
| `label`                | yes      | Shown in the user's notification preferences page.                             |
| `description`          | yes      | Helper text under the label in preferences. Max 200 chars.                     |
| `icon`                 | no       | Font Awesome class. Defaults to `fa-bell`.                                     |
| `channels`             | yes      | Non-empty list from `["web", "email", "push"]`. Which channels make sense for this type. |
| `default_preferences`  | no       | Map of channel → boolean. Defaults: `web` on, others off.                      |
| `payload_schema`       | no       | Map of `field_name → description`. Declared fields are required at send time.  |

If a notification type omits a channel from its `channels` list, the preferences UI shows `—` for that channel and the user can't opt in. If `payload_schema` declares a field and your send call doesn't provide it, the send is rejected with a validation error.

How to actually fire a notification — from Elixir (`Nexus.Notifications.notify_extension/3`) or from your JS bundle (the `POST /api/v1/notifications/extension` endpoint) — is covered in §8 and §9.

### 6.5 `capabilities`

Capabilities are forward-compatible declarations of privileged operations your extension performs. Currently declarative-only — the schema accepts any list of strings, and unknown values produce warnings (not errors) in the admin runtime panel. Future Nexus revisions may enforce capability checks; declaring them now is forward-compatible.

```json
"capabilities": []
```

The smoke test declares an empty list. There's no current registry of capability strings; the field exists so extensions and Nexus can evolve toward explicit capability gating without a breaking manifest change.

### 6.6 `permissions`

Permissions declare access tiers your extension enforces — "who can view this page", "who can create a record", "who can manage settings". Each declared permission appears on the admin's Permissions page as a row with a dropdown letting the admin pick one of four tiers. Your Elixir code then checks the admin's choice at runtime using `Nexus.Extensions.Permissions.check/3` (see §8.13).

A hypothetical gallery extension might declare:

```json
"permissions": [
  {"key": "can_view_gallery",   "label": "Can view the gallery",   "default": "everyone"},
  {"key": "can_upload_image",   "label": "Can upload an image",    "default": "member"},
  {"key": "can_manage_gallery", "label": "Can manage the gallery", "default": "moderator"}
]
```

Each entry is an object:

| Field     | Required | Purpose                                                                              |
|-----------|----------|--------------------------------------------------------------------------------------|
| `key`     | yes      | Slug-format string (`^[a-z0-9_]+$`, max 64 chars). Used as the lookup key in `Permissions.check/3` and as the storage key in the extension's settings map. |
| `label`   | yes      | Human-readable label shown to the admin on the Permissions page. Max 120 chars.      |
| `default` | no       | One of `"everyone"`, `"member"`, `"moderator"`, `"admin"`. Defaults to `"member"` if omitted. |

#### The four tiers

| Tier        | Who passes the check                                                                          |
|-------------|-----------------------------------------------------------------------------------------------|
| `everyone`  | Guests and logged-in users alike — **but only if the admin's site-wide guest browsing is enabled**. With guest browsing off, even `everyone` requires a logged-in user. |
| `member`    | Any logged-in user, regardless of role.                                                       |
| `moderator` | Moderators and admins.                                                                         |
| `admin`     | Admins only.                                                                                   |

Tiers are strictly nested — `admin` is more restrictive than `moderator`, `moderator` more restrictive than `member`, `member` more restrictive than `everyone`.

#### Where the value is stored

When an admin picks a tier on the Permissions page, the value is saved to the extension's settings JSON column under the same `key`. So if you declare `can_view_gallery`, the saved value lives at `ext.settings["can_view_gallery"]`. This has one implication worth flagging:

**Permission keys share the namespace with `settings_schema` keys.** Don't declare a `settings_schema` field with the same `key` as a permission — the admin's Permissions page and the extension's settings form would both target the same storage slot and overwrite each other. Pick distinct names. The convention `can_<verb>_<noun>` (`can_view_gallery`, `can_upload_image`) is good — it's unlikely to collide with a settings key, and it reads naturally in code.

#### What the admin sees

Declared permissions appear in **Admin → Permissions** under an "Extension permissions" section, grouped by extension. Each permission renders as a row with the label, a dropdown showing the four tiers, and the admin's currently-saved value (or your `default` if nothing's saved yet). The page's Save Changes button commits all extension permission changes alongside the core permission settings.

If you change permission defaults in a later release of your extension, the admin's existing saved value is preserved — the default is only used on first install or for permissions where no value has been saved yet.

#### Disabled extensions

Permission rows for disabled extensions don't render in the admin UI. Calls to `Permissions.check/3` against a disabled extension fall back to the saved value (if any) or the manifest default — but since dispatch is already filtered for disabled extensions, those checks are typically unreachable in practice.


---

## 7. The manifest — frontend surfaces

These fields declare what your extension contributes browser-side: UI slots it fills, page routes it owns, the admin panel it provides, navigation items, sidebar widgets, composer toolbar buttons, and profile tabs. Each has a matching JavaScript registration in §9.

The pattern in every case: the manifest declares the contract (what surfaces exist, what their identifiers are, where they appear), and the JS bundle implements the contract (the actual React component or click handler). At register time, every `register*` call cross-checks itself against the manifest and warns if you register something the manifest didn't declare.

### 7.1 `slots`

Slots are positional render points in Nexus's UI where your extension can contribute a component. The host renders all components registered for a given slot in priority order.

The smoke test fills one slot — a component below the post body on `/post/:id` pages:

```json
"slots": ["post_footer"]
```

Each entry is a slot name string. The schema rejects unknown slot names. The current slot list:

| Slot              | Where it renders                                                            | Props received                                                          |
|-------------------|-----------------------------------------------------------------------------|-------------------------------------------------------------------------|
| `post_footer`     | Below the post body on `/post/:id` pages, above the reply thread.            | `{ post_id }`                                                            |
| `profile_sidebar` | Left rail of `/profile/:username` pages, above the profile's main content.   | `{ username, current_user }` (current_user is `null` for logged-out viewers) |

Components receive **only** the props declared for their slot. There is no implicit spread of host state — anything not in the props table above is unavailable, by design. If you need additional data, fetch it from your own API by post_id or username.

The implementation (the actual `registerSlot` call) is in §9.2. The full slot list with detailed render conditions and prop descriptions is in Appendix B.

### 7.2 `routes`

Routes are full-page extension routes mounted under `/ext/<slug>/...`. When a user navigates to a registered route, Nexus serves its SPA shell and your JS bundle's matching component renders the page.

The smoke test declares one route at the extension's root:

```json
"routes": [
  {"path": "/", "title": "Home"}
]
```

Each entry:

| Field   | Required | Purpose                                                                          |
|---------|----------|----------------------------------------------------------------------------------|
| `path`  | yes      | Route path **relative** to your extension's namespace. Must start with `/`. Nexus prefixes `/ext/<slug>` automatically. |
| `title` | no       | Page title shown in the back-header when this route is active.                   |

Path conventions:

- `"/"` → mounts at `/ext/<slug>` (your extension's root)
- `"/browse"` → mounts at `/ext/<slug>/browse`
- `"/users/:username"` → mounts at `/ext/<slug>/users/:username` with `username` available as a route param

Do **not** include `/ext/` in the path — the validator rejects this. The path is relative to your namespace; Nexus handles the prefix.

The manifest declares the path; the JS bundle's `registerRoute` call binds the path to a component (§9.3). The two must match: declaring a path the bundle doesn't register produces a 404; registering a path the manifest doesn't declare logs a warning in the admin runtime panel.

![The smoke test's home page at /ext/foundation-smoke-test. The route's title appears in the topbar, the registered component renders in the content area, and the smoke test's right widget mounts in the sidebar (its declared scope is "extension", so it appears on every /ext/foundation-smoke-test/* page).](images/extension-home-page.png)

### 7.3 `admin_panel`

An admin panel is a custom page added to the admin sidebar under "Installed extensions". Clicking it renders your component in the admin content area.

**Before declaring this:** if your only reason for an admin panel is settings, declare `settings_schema` instead and let the host auto-render the form (§5). Use an admin panel for content the host can't render — status displays, custom controls, action buttons, embedded views.

The smoke test declares one:

```json
"admin_panel": {
  "label": "Foundation Smoke Test",
  "icon":  "fa-flask"
}
```

| Field   | Required | Purpose                                                          |
|---------|----------|------------------------------------------------------------------|
| `label` | yes      | Shown in the admin sidebar.                                      |
| `icon`  | yes      | Font Awesome class (short form, e.g. `fa-flask`).                |

The manifest declares the surface exists. The component is registered separately in your JS bundle (§9.4).

![The smoke test's admin panel, reached from the "Installed extensions" section of the admin sidebar. The label and icon declared in the manifest become the sidebar entry; the registered component renders below the identity strip. The smoke test's panel renders explanatory text about what enable_debug_log does — the toggle itself is rendered below the divider by the host's auto-generated fallback form, from the manifest's settings_schema (§5).](images/admin-panel.png)

#### Use a template, not a custom component

Nexus provides two ready-made admin panel templates at `window.NexusExtensionTemplates`. **Template use is strongly recommended.** They handle the topbar Save Changes button, dirty-state tracking, settings persistence, and tab chrome for you. Writing a fully custom component is supported but means re-implementing all of that, and getting any of it wrong produces broken UX (settings that don't save, Save buttons that don't enable, lost work).

The two templates:

| Template               | What it is                                                                             |
|------------------------|----------------------------------------------------------------------------------------|
| `SimpleSettingsPanel`  | Flat settings form. Renders your `settings_schema` fields with one Save button (topbar). |
| `TabbedPanel`          | Tab chrome only. Each tab renders whatever JSX you supply — drop a `SimpleSettingsPanel` inside a tab for settings, or render arbitrary custom content for everything else. |

For extensions with only settings, `SimpleSettingsPanel` is the right answer. For extensions that mix settings with custom views (status displays, action buttons, log viewers), use `TabbedPanel` with `SimpleSettingsPanel` inside the settings tabs and custom JSX inside the others.

#### The topbar Save Changes button

The admin layout includes a Save Changes button in the topbar that's the canonical save flow for every admin panel — Nexus's own as well as extension panels. When you use `SimpleSettingsPanel`, the button is wired automatically:

- Mounting a `SimpleSettingsPanel` registers its save function with the topbar.
- Changing any field marks the form dirty, enabling the button.
- Clicking the button saves to `PATCH /admin/extensions/<slug>/settings`.
- Unmounting clears the registration.

Tabs containing only custom content (no `SimpleSettingsPanel`) leave the Save button disabled, which is correct — there's nothing dirty.

![The topbar Save Changes button in its clean state: greyed-out because no form is dirty.](images/save-button-clean.png)
![The same button in its dirty state, lit purple after a field changed.](images/save-button-dirty.png)

If you write a fully custom panel, you can integrate manually:

```javascript
// Set this to your save function when your form is mounted and ready
window._nexusAdminSaveFn = async () => {
  await fetch(`/admin/extensions/${slug}/settings`, { ... });
  return true;
};

// Call this when a field changes to enable the Save button
window._nexusAdminSetDirty?.();
```

Clear `_nexusAdminSaveFn` on unmount. Most extensions never need this — the templates handle it.

The complete `registerAdminPanel` API and full template examples are in §9.4.

### 7.4 `explore`

The Explore section in Nexus's left sidebar is the main navigation surface. Declaring `explore` adds a single entry there pointing at one of your extension's routes.

The smoke test adds itself to Explore:

```json
"explore": {
  "label": "Foundation Smoke Test",
  "icon":  "fa-flask",
  "path":  "/"
}
```

| Field   | Required | Purpose                                                                          |
|---------|----------|----------------------------------------------------------------------------------|
| `label` | yes      | Shown in the Explore section.                                                    |
| `icon`  | yes      | Font Awesome class (short form).                                                  |
| `path`  | no       | Path within your extension. Defaults to `"/"`. Nexus prefixes `/ext/<slug>` automatically. |

The target path must correspond to a route you registered in §7.2 (and implemented in §9.3); clicking the item navigates the SPA to `/ext/<slug><path>`.

Each extension declares at most one Explore entry in the manifest. For multiple navigation points, register additional ones from your JS bundle; see §9.5 for the JS API, which supports `id`, `priority`, and `authOnly`.

![The Explore section of the left sidebar, with the smoke test's entry sitting beneath the built-in items. The label, icon, and active-state styling all come from the single explore declaration.](images/explore-entry.png)


### 7.5 `right_widgets`

Right widgets are panels in the right sidebar. Your extension declares one or more widgets, scoped to where they should appear (your extension's pages only, globally, specific paths, or specific core pages).

The smoke test declares one widget shown on its own pages:

```json
"right_widgets": [
  {
    "id":       "smoke-status",
    "label":    "Smoke Status",
    "scope":    "extension",
    "priority": 50
  }
]
```

Each entry:

| Field      | Required | Purpose                                                                          |
|------------|----------|----------------------------------------------------------------------------------|
| `id`       | yes      | Unique widget id. Convention: prefix with your slug (`smoke-status`, not `status`). |
| `label`    | yes      | Shown in the admin layout drag-to-reorder list, not on the widget itself.        |
| `scope`    | no       | Where the widget appears. Defaults to `"extension"`. See scope grammar below.    |
| `priority` | no       | Lower numbers render higher up. Default 50.                                       |

The component itself — the actual React node rendered into the widget — is registered separately in your JS bundle (§9.6).

![A close-up of the smoke test's right widget rendered in the right sidebar. The widget sits alongside built-in widgets (Online Now, Live Activity, stats) and is visually indistinguishable from them — extension widgets don't get special chrome.](images/right-widget.png)

#### Scope grammar

`scope` accepts four forms:

| Form                          | Renders on                                                    |
|-------------------------------|---------------------------------------------------------------|
| `"extension"` (default)       | Every `/ext/<your-slug>/*` page.                              |
| `"global"`                    | Every page in Nexus.                                          |
| `{"path": "/x"}`              | A specific path under your extension: `/ext/<slug>/x`.        |
| `{"path": ["/x", "/y"]}`      | Multiple specific paths under your extension.                 |
| `{"corePages": [...]}`        | Listed Nexus core pages (see table below).                    |

Paths in `scope.path` are **relative** to your extension's namespace. Do not include `/ext/` — the validator rejects this.

Core page names accepted in `scope.corePages`:

`feed`, `post`, `profile`, `members`, `leaderboard`, `badges`, `search`, `notifications`, `messages`, `saved`, `drafts`

A widget scoped to `{"corePages": ["profile"]}` appears on every `/profile/:username` page. A widget scoped to `"global"` appears everywhere. Choose the narrowest scope that fits — global widgets compete for sidebar real estate with every other extension.

#### Admin override

Admins can reorder and hide your widget per-page in **Admin → Layout → Right sidebar**. Your `priority` is the default order; the admin's saved layout overrides it. This is by design — your extension declares intent, the admin makes the final call.

![Admin → Layout → Right sidebar drag-to-reorder list. The smoke test's "Smoke Status" widget appears alongside built-in widgets like Online Members and Live Activity. The "extension" pill identifies which entries are extension-contributed; admins can disable or reorder them like any other widget.](images/admin-layout-right-sidebar.png)

### 7.6 `toolbar_buttons`

Toolbar buttons appear in the post and reply composer toolbars. They're how an extension extends the composer — to attach data (via the `attach()` flow, §6.3), open a modal, insert text, or trigger any custom action.

The smoke test declares two: one for a simple click handler, one for the attach flow:

```json
"toolbar_buttons": [
  {
    "id":    "smoke-button",
    "icon":  "fa-solid fa-flask",
    "tip":   "Smoke test toolbar button",
    "scope": "both"
  },
  {
    "id":       "smoke-attach-note",
    "icon":     "fa-solid fa-note-sticky",
    "tip":      "Attach a smoke note",
    "scope":    "both",
    "priority": 60
  }
]
```

Each entry:

| Field      | Required | Purpose                                                                                     |
|------------|----------|---------------------------------------------------------------------------------------------|
| `id`       | yes      | Unique within your extension. Used to form the internal type `ext:<slug>:<id>`.              |
| `icon`     | yes      | **Full** Font Awesome class with style prefix — `"fa-solid fa-flask"`, not `"fa-flask"`.    |
| `tip`      | yes      | Tooltip text shown on hover. Display-only — change it freely without breaking saved layouts.|
| `scope`    | no       | `"both"` (default), `"posts"` (post composer only), `"replies"` (reply composer only).      |
| `priority` | no       | Lower numbers render earlier among extension buttons. Built-in buttons always come first. Default 50. |

**Icon form differs from other surfaces.** `admin_panel.icon`, `explore.icon`, and `profile_tabs[].icon` all take the short form (`"fa-flask"`). Toolbar buttons take the **full** form (`"fa-solid fa-flask"`). Mixing them up renders as plain text.

![The post composer with the smoke test's two toolbar buttons (flask icon and sticky-note icon) rendered to the right of the built-in formatting buttons.](images/post-composer.png)
![The reply composer with the same two buttons. Both have `scope: "both"` so they appear in both composers; declaring `scope: "posts"` or `scope: "replies"` would gate this behavior.](images/reply-composer.png)

#### Identity is stable

The internal button identity is `ext:<slug>:<id>`. This is what the admin's layout config references when reordering or hiding buttons. Renaming `tip` doesn't break the saved layout; renaming `id` does. Choose `id` carefully at first; treat `tip` as freely editable.

Two extensions cannot collide on identity because the slug namespaces it. Two buttons within the same extension can't share an `id`.

#### Admin override

Admins can reorder and hide your button independently per composer in **Admin → Layout → Post toolbar / Reply toolbar**.

![Admin → Layout → Post toolbar drag list, with both smoke test buttons visible. The admin can drag to reorder, toggle to hide, or remove each button. The reply toolbar is configured independently from the post toolbar in the same admin section.](images/admin-layout-post-toolbar.png)

The `onClick` handler and the `attach()` context for composer-attachment buttons are covered in §9.7.

### 7.7 `profile_tabs`

Profile tabs appear on `/profile/:username` pages, alongside Nexus's built-in tabs (Posts, Replies, etc.). Each extension can declare one or more tabs, with optional visibility filtering for "only when viewing your own profile."

The smoke test declares two — one always-visible, one own-profile-only:

```json
"profile_tabs": [
  {"id": "smoke-tab",     "label": "Smoke",        "icon": "fa-flask",      "visibility": "always"},
  {"id": "smoke-ownonly", "label": "Smoke (mine)", "icon": "fa-flask-vial", "visibility": "own_only"}
]
```

Each entry:

| Field        | Required | Purpose                                                                                          |
|--------------|----------|--------------------------------------------------------------------------------------------------|
| `id`         | yes      | Unique within your extension. Must match the `id` you pass to `registerProfileTab` in §9.8.       |
| `label`      | yes      | Shown in the tab bar.                                                                            |
| `icon`       | no       | Font Awesome class (short form, e.g. `fa-flask`).                                                |
| `visibility` | no       | `"always"` (default) or `"own_only"` — see below.                                                |
| `priority`   | no       | Lower numbers render earlier. Default 50.                                                         |

#### Visibility is a UX hint, not access control

`visibility: "own_only"` hides the tab **button** when the viewer is not the profile owner. The tab's component is not unmounted — it's just not navigable to from the UI.

![StryGuardian viewing their own profile. Both smoke tabs appear in the tab bar: "Smoke" (always-visible) and "Smoke (mine)" (own_only). The own_only tab's content explicitly notes the username/current_user match.](images/profile-tab-own.png)
![StryGuardian viewing Henry's profile. Only the always-visible "Smoke" tab appears — the own_only tab is filtered out because the viewer is not the profile owner. The component still receives both username and current_user as props.](images/profile-tab-other.png)

This is a **UX hint, not access control.** A determined visitor can directly address the tab's underlying content (via the URL, browser back-button, or any other route into your component). If your tab displays content that must not be visible to other users, your component must enforce that itself, server-side. The `current_user` prop your component receives (§9.8) lets you compare against the profile owner's username and render accordingly.

The component for each declared tab is registered separately in §9.8. The manifest declares the tab's metadata (label, icon, visibility, priority); the JS bundle binds the component.


---

## 8. Implementation: Elixir module

Your extension's Elixir module implements the server-side behaviour the manifest declared. Every callback in this section is optional — you only override the ones whose corresponding manifest field is non-empty.

The smoke test's complete module is shown progressively through §8.3–§8.9 as each callback is introduced.

### 8.1 `use Nexus.Extensions.Behaviour`

Every extension module starts with the same line:

```elixir
defmodule FoundationSmokeTest do
  use Nexus.Extensions.Behaviour

  # callbacks go here
end
```

`use Nexus.Extensions.Behaviour` does three things:

- Declares the module as implementing `Nexus.Extensions.Behaviour`.
- Supplies no-op defaults for every callback so the module compiles even with zero overrides.
- Marks all callbacks as `defoverridable` so you can override them with `@impl true` clauses.

A module that does nothing but `use` the behaviour is a valid (no-op) extension. As you declare surfaces in the manifest, override the matching callback below.

### 8.2 Reading settings

Every callback that takes a `settings` argument receives the extension's settings map — the values configured by the admin under **Admin → Extensions → \<your extension>**. The map's keys are strings (matching the keys in your `settings_schema`); values are whatever type the field defined.

```elixir
def handle_event("post_created", payload, settings) do
  if settings["enable_debug_log"] do
    Logger.info("smoke test: post #{payload["user_id"]} created post #{payload["post_id"]}")
  end
  :ok
end
```

A few rules worth knowing:

- **Keys are strings, not atoms.** Reading `settings[:enable_debug_log]` returns nil; use `settings["enable_debug_log"]`.
- **Missing keys are nil.** The settings map only contains keys the admin has saved. Use `Map.get(settings, "key", default)` if the field's `default` matters at read time.
- **Settings are read fresh per callback.** Each hook fire passes the current settings map; you don't need to cache or invalidate.

If you need the settings outside a callback (a background worker, an Oban job), call `Nexus.Extensions.get_extension_by_slug("your-slug").settings`. The map is the same.

### 8.3 `handle_event/3` — hook payloads

When Nexus fires a hook event, it calls `handle_event/3` on every loaded extension that declared the event in its manifest's `hooks` field. The callback runs in a supervised Task — return value is ignored, crashes are caught and logged.

```elixir
@callback handle_event(event :: String.t(), payload :: map(), settings :: map()) :: any()
```

The smoke test handles one event:

```elixir
defmodule FoundationSmokeTest do
  use Nexus.Extensions.Behaviour

  require Logger

  @impl true
  def handle_event("post_created", %{"user_id" => user_id, "post_id" => post_id}, settings) do
    if settings["enable_debug_log"] do
      Logger.info("[foundation-smoke-test] post_created fired: user=#{user_id} post=#{post_id}")
    end
    :ok
  end

  # Catch-all — required when the manifest declares hooks. Undeclared events
  # never reach here in practice (the registry only dispatches declared events),
  # but a catch-all makes the module compile cleanly.
  def handle_event(_event, _payload, _settings), do: :ok
end
```

#### Payload shape per event

Every payload key holds a JSON-serializable value — string, number, boolean, nil, list, or map. No structs, no `DateTime`, no PIDs. Every payload has a `user_id` — the **actor** (the user who performed the action), not necessarily the affected user.

| Event              | Payload keys                            | Notes                                                                                  |
|--------------------|-----------------------------------------|----------------------------------------------------------------------------------------|
| `post_created`     | `user_id`, `post_id`                    | Actor is the post creator.                                                              |
| `post_updated`     | `user_id`, `post_id`                    | Actor is the **editor** — may differ from the post's original author (moderators).      |
| `post_deleted`     | `user_id`, `post_id`                    | Actor is the **deleter**. The post no longer exists in the DB when this fires.          |
| `reply_created`    | `user_id`, `reply_id`, `post_id`        | `post_id` is the parent post being replied to.                                          |
| `reply_deleted`    | `user_id`, `reply_id`, `post_id`        | Actor is the deleter. Side-data extensions: clean up linked rows here.                  |
| `reaction_added`   | `user_id`, `emoji`, `post_id`, `reply_id` | Exactly one of `post_id`/`reply_id` is non-nil. `emoji` is a string (`"👍"` or name).   |
| `reaction_removed` | `user_id`, `emoji`, `post_id`, `reply_id` | Mirror of `reaction_added`.                                                             |
| `report_created`   | `user_id`, `report_id`                  | Actor is the reporter, not the user being reported.                                     |
| `report_resolved`  | `user_id`, `report_id`, `status`        | Actor is the moderator. `status` is `"reviewed"`, `"dismissed"`, or `"actioned"`.       |
| `user_registered`  | `user_id`                               | Here `user_id` IS the new user — no separate actor.                                     |
| `user_login`       | `user_id`                               | Here `user_id` IS the user logging in.                                                  |

A handler that doesn't pattern-match the payload's expected shape will fall through to the catch-all and silently no-op. Pattern-match explicitly on the keys you need.

#### Dispatch semantics

A few things to know about how hooks dispatch:

- **Async to the caller.** Hooks fire and return immediately. The user's POST that created the post doesn't wait for your handler.
- **Sequential among handlers.** All handlers for the same event run sequentially in priority order (lower priority first). A slow handler delays every later handler.
- **Crash-isolated.** Each handler runs inside a try/rescue. A crashing handler logs the error; the loop continues to the next handler.
- **Disabled extensions are filtered.** If an admin disables your extension, your handlers stop firing immediately — no restart needed.

**Performance note.** Because dispatch is sequential, a handler doing expensive work (HTTP calls, large DB queries) delays every later handler subscribed to the same event. For anything beyond a few milliseconds of work, enqueue an Oban job from the handler and return quickly. See §8.7.

### 8.4 Lifecycle: `on_install/1`, `on_update/2`, `on_uninstall/0`

The three lifecycle callbacks fire at the extension's three lifecycle moments. All optional; default to no-ops.

These callbacks are **discrete-event** callbacks, not boot-time callbacks. None of them runs when Nexus restarts — `on_install/1` runs only the first time the extension is installed, `on_update/2` only when the admin clicks Update, `on_uninstall/0` only at uninstall. For work that must run on every boot, use `child_specs/0` (§8.7). See §10.5 for the full picture of what runs when.

```elixir
@impl true
def on_install(settings) do
  # First install. Migrations have already run.
  # Use for seeding initial data, setting up external resources, etc.
  :ok
end

@impl true
def on_update(from_version, to_version) do
  # Update to a new version. New migrations have already run.
  # Use for data migrations between versions, cache invalidation, etc.
  :ok
end

@impl true
def on_uninstall do
  # Pre-uninstall, before migrations are rolled back.
  # Use for cleanup: deleting external files, revoking tokens, etc.
  :ok
end
```

#### `on_install/1`

Called once when your extension is first installed, **after** migrations have run. Receives the current settings map (typically the defaults from `settings_schema` on a fresh install).

Return values:

| Return value      | Effect                                                                       |
|-------------------|------------------------------------------------------------------------------|
| `:ok`             | Install succeeds, `load_status` becomes `"loaded"`.                          |
| `{:ok, _}`        | Same as `:ok`. The discarded value is for your own debugging.                |
| `{:error, reason}`| Install completes but `load_status` becomes `"install_failed"` with the reason as the error message. The extension is loaded — migrations ran, the registry is populated — but flagged as having a broken init. |
| Anything else     | Same as `{:error, ...}` with a generic message.                               |
| Raising an exception | Same as `{:error, ...}` with the exception message.                       |

#### `on_update/2`

Called when the extension is updated to a new version (admin pushes the **Update** button in the admin extensions list). Runs **after** the new tarball is downloaded, compiled, and any new migrations have run.

Receives the old and new version strings (from `installed_version` and the new release tag, both stripped of leading `v`). Runs in a background Task — the admin's request returns immediately after the new code is loaded.

Returns `:ok` or `{:ok, _}` on success; anything else (including raising) sets `load_status` to `"update_failed"` with the error message.

#### `on_uninstall/0`

Called once when the admin uninstalls your extension, **before** migrations are rolled back and **before** the module is unloaded from the VM. This is your last chance to:

- Delete files outside `/app/uploads/extensions/<slug>/` (that directory is cleaned up automatically — see §8.11).
- Revoke API tokens you issued to external services.
- Notify external systems that the extension is going away.

If `on_uninstall/0` raises, the error is captured as a warning and surfaced to the admin in the uninstall response — but the uninstall **continues**. Cleanup failures don't block removal.

After `on_uninstall/0` returns:

- Pending Oban jobs in your module namespace (e.g. `FoundationSmokeTest.Workers.*`) are cancelled (see §8.7).
- Migrations roll back in reverse order.
- Your module is unloaded from the VM.
- The `/app/uploads/extensions/<slug>/` directory is deleted.
- The DB row is removed.

Jobs that are *already executing* when uninstall runs are not cancelled — they complete against the still-loaded module.

### 8.5 `migrations/0`

Returns a list of Ecto migration modules to run at install time (and roll back at uninstall time). Each module must implement `Ecto.Migration`.

```elixir
@impl true
def migrations do
  [
    FoundationSmokeTest.Migrations.V20260601000001CreateSmokeNotes,
    FoundationSmokeTest.Migrations.V20260601000002AddIndexes,
  ]
end
```

Define each migration in your `lib/` tree like normal Ecto migrations:

```elixir
defmodule FoundationSmokeTest.Migrations.V20260601000001CreateSmokeNotes do
  use Ecto.Migration

  def change do
    create table(:foundation_smoke_test_notes) do
      add :post_id, :string, null: false
      add :text,    :text,   null: false
      timestamps(type: :utc_datetime)
    end

    create index(:foundation_smoke_test_notes, [:post_id])
  end
end
```

#### Naming conventions

- **Module names** must end with `V<digits>...` at the last segment. The loader extracts the digits as the migration's version integer. Modules that don't match the pattern get a hashed integer version, which works but isn't ordered against other migrations — don't rely on the fallback.
- **Table names** should be prefixed with your slug (with hyphens converted to underscores) to avoid collisions with other extensions and Nexus core. `foundation_smoke_test_notes`, not `notes`.

#### Picking version integers

The version integer extracted from your module name is written to Postgres's `schema_migrations` table — the **same** table Nexus core and every other installed extension write to. There is no per-extension namespace. This has one critical consequence:

**If your version integer matches one already in `schema_migrations`, Ecto silently skips your migration.** The install reports success, but your tables are never created. A later migration that depends on those tables will then fail with `undefined_table` — confusingly distant from the actual cause.

To stay safe:

- **Use the YYYYMMDDhhmmss format** (`V20260601000001`, `V20260601000002`, etc.) — the same convention Phoenix's `mix ecto.gen.migration` uses and that Nexus core uses internally. The example above does this.
- **Pick a date that postdates every Nexus core migration.** At the time of writing, Nexus core's most recent migration is `20260521000002`. Your version integers should be larger. If you're starting fresh today, today's date or later is a safe pick.
- **Don't reuse YYYYMMDD values Nexus core has used.** Skim `priv/repo/migrations/` in your local Nexus checkout to see the dates already taken. The risk window is narrow but the failure mode is hard to diagnose.
- **Avoid short forms like `V001`, `V002`.** They're valid per the regex but vulnerable to colliding with literally any other extension that uses the same convention, since version `1` is a popular pick.

Nexus does not currently namespace `schema_migrations` per extension. This is a known limitation of the shared-database design — keep your version integers in their own date range and you'll be fine.

#### Replay on boot

Your `migrations/0` list runs in full on every Nexus restart, not just at install time. This is safe because Ecto's `schema_migrations` table tracks applied versions and silently skips already-applied ones — but it's worth knowing the contract:

- Migrations that succeeded previously will no-op on every subsequent boot.
- New migrations you add (in a release the host eventually downloads) will run on the boot that first sees them.
- The silent-skip behavior is the same mechanism described above, so the version-collision rules apply on every boot too.

See §10.5 for the full picture of what the loader pipeline does on each restart.

#### Rollback

On uninstall, migrations roll back in reverse order. Each migration must implement `change/0` (for reversible operations) or both `up/0` and `down/0` (for non-reversible operations).

If a rollback fails, the error is logged but uninstall continues — the DB row and registry entries are cleaned up regardless. If you need the DB tables back, manually drop them.

### 8.6 `routes/0` — Elixir plug routes

This callback returns **Elixir plug routes** — distinct from the manifest's `routes` field, which declares **SPA page paths** for your JS bundle. The two share a name but serve different purposes:

| Surface              | Lives in        | Resolved by              | Used for                                                          |
|----------------------|-----------------|--------------------------|-------------------------------------------------------------------|
| `manifest.routes`    | manifest.json   | JS bundle in the browser | Full-page routes (`/ext/<slug>/...`) — see §7.2 and §9.3.          |
| `routes/0` callback  | your Elixir module | Nexus's ExtensionRouter | API endpoints called by your bundle (`/ext/<slug>/api/...`).      |

The `routes/0` callback returns `[{path_prefix, plug_module, opts}]` tuples:

```elixir
@impl true
def routes do
  [
    {"/api", FoundationSmokeTest.ApiRouter, []},
  ]
end
```

When a request hits `/ext/foundation-smoke-test/api/some/path`, Nexus's ExtensionRouter:

1. Looks up your extension by slug.
2. Strips `/ext/foundation-smoke-test` from the path.
3. Finds the route with the longest matching prefix (`/api` here).
4. Strips the prefix.
5. Forwards the remaining path (`/some/path`) to your plug.

Your plug receives a standard `Plug.Conn`. `conn.assigns.current_user` is set if the request has a valid JWT (otherwise nil) — extension API routes do not enforce authentication automatically. Enforce it yourself if needed:

```elixir
defmodule FoundationSmokeTest.ApiRouter do
  use Plug.Router

  plug :match
  plug :dispatch

  get "/status" do
    case conn.assigns.current_user do
      nil  -> send_resp(conn, 401, ~s({"error":"login required"}))
      user -> send_resp(conn, 200, Jason.encode!(%{ok: true, user_id: user.id}))
    end
  end

  match _ do
    send_resp(conn, 404, ~s({"error":"not found"}))
  end
end
```

For gating beyond "logged in or not" — checking moderator, admin, or admin-configured tiers — declare `permissions` in your manifest (§6.6) and use `Nexus.Extensions.Permissions.check/3` (§8.13). The check function returns `:ok` or `:error` and resolves the tier against whatever the admin saved on the Permissions page.

#### Reply contract

Return a `Plug.Conn` from each handler. If your plug raises, ExtensionRouter catches the exception, logs it, and returns HTTP 500 with `{"error":"Internal extension error"}` (or a detailed stack trace in dev — see §11).

For Plug.Router conventions, JSON encoding, routing patterns, and other Plug-level mechanics, see the [Plug documentation](https://hexdocs.pm/plug/Plug.Router.html). Nexus follows Plug's standard contracts; nothing extension-specific changes them.

### 8.7 `child_specs/0` and background workers

Long-running processes — GenServers, schedulers, cache servers — should be supervised. The `child_specs/0` callback returns child specs that Nexus starts under a dedicated sub-supervisor for your extension.

```elixir
@impl true
def child_specs do
  [
    {FoundationSmokeTest.Cache, []},
    {FoundationSmokeTest.Scheduler, interval: :timer.minutes(5)},
  ]
end
```

Each child runs under a supervisor named `nexus_ext_sup_<slug>`. If a child crashes, only your extension's supervisor restarts it — Nexus and other extensions are unaffected. If your extension is disabled, all its child processes are stopped (and restarted on re-enable).

#### Oban jobs and the namespace rule

For background jobs (deferred work, scheduled work, retries), use Oban. Nexus runs Oban; you can enqueue jobs from any callback:

```elixir
defmodule FoundationSmokeTest.Workers.FetchSomething do
  use Oban.Worker, queue: :extensions

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"post_id" => post_id}}) do
    # do work
    :ok
  end
end

# Enqueue from a hook handler:
def handle_event("post_created", %{"post_id" => post_id}, _settings) do
  %{post_id: post_id}
  |> FoundationSmokeTest.Workers.FetchSomething.new()
  |> Oban.insert()
  :ok
end
```

**Worker modules must be nested under your extension's root module namespace.** For the smoke test, that means `FoundationSmokeTest.Workers.FetchSomething` or `FoundationSmokeTest.SomethingWorker`, but not `MyWorkers.FetchSomething`.

The reason is uninstall cleanup. When your extension is uninstalled, Nexus deletes pending Oban jobs whose `worker` column starts with your module's name. Workers outside the namespace **survive uninstall** and crash on next execution against the no-longer-loaded module. Only `available`, `scheduled`, and `retryable` jobs are cancelled; jobs already executing run to completion.

Use the dedicated `:extensions` queue for your jobs. Nexus configures this queue with concurrency 10 and reserves it for extension use — `default`, `mailers`, `media`, and `webhooks` are Nexus's own queues and shouldn't be used by extensions.

For Oban worker authoring (queues, retries, scheduling, telemetry), see the [Oban documentation](https://hexdocs.pm/oban/Oban.html).


### 8.8 `handle_digest_section/3` — digest content

When Nexus builds a digest email, it calls `handle_digest_section/3` once per section your manifest declared. Your callback returns the section's content as a structured map; the mailer renders it into HTML matching the email's visual design.

```elixir
@impl true
def handle_digest_section("smoke_structured", period, _settings) do
  %{
    title:  "Smoke Test — #{period.period_label}",
    layout: "list",
    items:  [
      %{label: "Item one",   sublabel: "First test item",  value: "42"},
      %{label: "Item two",   sublabel: "Second test item", value: "17"},
      %{label: "Item three", sublabel: "Third test item",  value: "8"}
    ],
    cta: %{label: "See all results", url: "/ext/foundation-smoke-test"}
  }
end

def handle_digest_section("smoke_rendered", _period, _settings) do
  %{
    "_rendered_html" => "<p>Custom HTML for the rendered section.</p>"
  }
end

# Catch-all clause — required when the manifest declares digest_sections.
def handle_digest_section(_key, _period, _settings), do: %{items: []}
```

#### Arguments

| Argument      | Type     | Contents                                                                              |
|---------------|----------|---------------------------------------------------------------------------------------|
| `section_key` | string   | The `key` you declared for this section in the manifest's `digest_sections`.          |
| `period`      | map      | `%{from: DateTime.t(), to: DateTime.t(), frequency: "daily" \| "weekly" \| "monthly", period_label: String.t()}` |
| `settings`    | map      | Your extension's current settings (string keys, see §8.2).                            |

`period.period_label` is a human-readable phrase — `"today"`, `"this week"`, `"this month"`. Use it in section titles. `period.from` and `period.to` are `DateTime` structs you can pass to Ecto queries.

#### Return shape — structured data path

Return a map with these keys:

| Key      | Required | Purpose                                                                                  |
|----------|----------|------------------------------------------------------------------------------------------|
| `title`  | yes      | Section header text shown in the digest.                                                  |
| `layout` | no       | One of `"list"`, `"leaderboard"`, `"stat_bars"`, `"pill_grid"`, `"card"`. Defaults to `"list"`. |
| `items`  | yes      | List of item maps (see per-layout shapes below). **Empty list means the section is silently dropped.** |
| `cta`    | no       | `%{label: String.t(), url: String.t()}` — a small footer link rendered below the items.   |

Atom keys and string keys both work; the dispatcher deep-stringifies the result before passing it to the mailer.

#### The five layouts

| Layout        | Renders                                                  | Best for                                                  |
|---------------|----------------------------------------------------------|-----------------------------------------------------------|
| `list`        | Ranked list with index column, badge, sublabel, value.   | Top items, recent activity, anything ordered.             |
| `leaderboard` | Top entries with medal icons and right-aligned values.    | Scores, rankings, contests.                                |
| `stat_bars`   | Horizontal bar chart, bars scaled to the highest value.   | Counts, totals, comparisons.                               |
| `pill_grid`   | Wrapping colored pills.                                   | Tags, categories, genres.                                  |
| `card`        | Thumbnail + label/sublabel/value rows.                    | Anything image-heavy (game covers, book covers, videos).   |

If you return a `layout` Nexus doesn't recognize, the mailer falls back to `"list"`. If you omit `layout`, you get `"list"`.

#### Item shape

All layouts read these item fields (each optional except `label`):

| Field         | Purpose                                                                            |
|---------------|------------------------------------------------------------------------------------|
| `label`       | Item title. Required.                                                              |
| `sublabel`    | Smaller text under the label.                                                      |
| `value`       | Right-aligned value text. Used as the bar value in `stat_bars` and the score in `leaderboard`. |
| `url`         | Makes the label a clickable link.                                                  |
| `badge`       | Small pill text next to the label.                                                  |
| `badge_color` | Hex color for the badge background and pill color in `pill_grid`. Defaults to the email's accent color. |
| `label_color` | Hex color override for the label text. Defaults to the email's standard label color. |
| `avatar`      | Avatar reference (URL string or user-shaped map). Used in `list` layout for member-style rows. |
| `image_url`   | Thumbnail URL for `card` layout. Renders as a 64×64 image; absent images render as a placeholder square. |

Fields irrelevant to a layout are ignored — passing `image_url` to a `pill_grid` layout has no effect.

#### Return shape — pre-rendered HTML path

For sections that need a custom layout the structured shape can't express (image-heavy summaries, chart visualisations, anything bespoke), return `%{"_rendered_html" => html_string}` and Nexus will inject the HTML verbatim. Use the `branding` argument (next section) for colors so your custom HTML matches the email's theme.

#### Branding — optional 4-arity form

For deeper integration with the email's theme, you can implement `handle_digest_section/4`:

```elixir
def handle_digest_section("smoke_structured", period, settings, branding) do
  # branding.accent is the digest's accent color hex string
  %{
    title:  "Smoke Test",
    layout: "list",
    items:  build_items(period),
    cta:    %{label: "View all", url: "/ext/foundation-smoke-test"}
  }
end
```

`branding` is a map with the digest's color palette — `branding.accent` is the most useful key, holding the digest's accent color (used for badges, CTAs, value text). Nexus's dispatcher prefers the 4-arity form when both are exported; otherwise it falls back to the 3-arity form with no branding info.

#### Empty sections

If your callback returns `%{items: []}` (or `%{"items" => []}`), the section is silently dropped from the digest. The header doesn't render. This is the right behaviour when there's nothing to report for the period — don't render an empty "No items" section.

If your callback raises, the error is logged and the section is dropped. The digest continues.

### 8.9 `persist_attachment/3` and `list_side_data/2`

These callbacks handle composer attachments — data your extension's toolbar button (§7.6, §9.7) attached to an in-flight post or reply via the `attach()` flow.

The smoke test owns two attachment kinds — one for posts, one for replies:

```elixir
@impl true
def persist_attachment("post", post_id, %{"kind" => "smoke_note", "data" => %{"text" => text}}) do
  %FoundationSmokeTest.PostNote{}
  |> FoundationSmokeTest.PostNote.changeset(%{post_id: post_id, text: text})
  |> Nexus.Repo.insert()
  :ok
end

def persist_attachment("reply", reply_id, %{"kind" => "smoke_reply_note", "data" => %{"text" => text}}) do
  %FoundationSmokeTest.ReplyNote{}
  |> FoundationSmokeTest.ReplyNote.changeset(%{reply_id: reply_id, text: text})
  |> Nexus.Repo.insert()
  :ok
end

# Catch-all — required when the manifest declares side_data.
def persist_attachment(_entity, _entity_id, _attachment), do: :ok
```

#### Arguments

| Argument     | Type   | Contents                                                                |
|--------------|--------|-------------------------------------------------------------------------|
| `entity`     | string | `"post"`, `"reply"`, or `"user"` — matching the entity declared in your `side_data` manifest entry. |
| `entity_id`  | string | The ID of the just-created post, reply, or user.                         |
| `attachment` | map    | `%{"kind" => kind, "data" => data_map}` — `kind` matches your manifest declaration; `data` is whatever the toolbar button's `attach()` call passed. |

#### Dispatch and failure semantics

- **Async to the caller.** The user's POST that created the post does not wait for `persist_attachment/3`. The post is already committed when this runs.
- **Best-effort.** If your callback raises, the error is logged and dropped. The post remains.
- **Per-attachment Task.** Each attachment runs in its own supervised Task — a slow attachment doesn't block others.
- **10 KB cap per attachment.** Attachments above 10 KB (JSON-encoded size) are rejected before reaching your callback. For larger payloads, upload them separately to your own `/ext/<slug>/api/` endpoint and pass only a reference id through `attach()`.
- **Disabled extensions are skipped.** Just like hook dispatch.

Pattern-match on the kind explicitly. The `attachment` map is whatever your bundle's `attach({kind, data})` call passed in §9.7 — there is no host-side schema for `data`, so you own the contract end-to-end.

#### Cleanup on entity deletion

When the parent post or reply is deleted, Nexus does not automatically remove the linked rows your callback inserted. Subscribe to the matching deletion event in your `manifest.hooks` and clean up explicitly:

```elixir
@impl true
def handle_event("post_deleted", %{"post_id" => post_id}, _settings) do
  from(n in FoundationSmokeTest.PostNote, where: n.post_id == ^post_id)
  |> Nexus.Repo.delete_all()
  :ok
end
```

The deletion event fires after the entity has been removed from the DB, so the post row is gone — only your linked row references remain to clean up.

There is no `user_deleted` hook event today. Extensions attaching to users have no automatic cleanup signal and should schedule periodic cleanup against orphaned `user_id` references.

#### `list_side_data/2` — currently unused

The behaviour declares an optional `list_side_data/2` callback intended to expose attached data via a host aggregator endpoint. **The host does not currently call this callback.** It is forward-compatible scaffolding for a future aggregator.

For now, expose attached data through your own `/ext/<slug>/api/` endpoints — that path is the canonical way for your JS bundle to read its own data, and it's more flexible than a uniform aggregator anyway (you control the shape, the pagination, the auth gating).

### 8.10 Database access

Your extension shares Nexus's database. Use `Nexus.Repo` for all queries:

```elixir
import Ecto.Query
alias Nexus.Repo

# Insert
%FoundationSmokeTest.PostNote{}
|> FoundationSmokeTest.PostNote.changeset(%{post_id: id, text: "..."})
|> Repo.insert()

# Query your own tables
from(n in FoundationSmokeTest.PostNote, where: n.post_id == ^post_id)
|> Repo.all()

# Read a Nexus table by string name when you need to (rare)
from(u in "users", where: u.id == ^user_id, select: u.username)
|> Repo.one()
```

A few rules:

- **Your tables, your schemas.** Define schemas under your extension's module namespace (`FoundationSmokeTest.PostNote`), prefix table names with your slug (`foundation_smoke_test_post_notes`).
- **Reference Nexus tables by string name, not by aliasing internal schemas.** Nexus's internal schema modules (`Nexus.Accounts.User`, `Nexus.Forum.Post`, etc.) are not part of the extension API and can change between versions. Reading from `"users"` or `"posts"` by string name in an Ecto query is stable; reading by alias is not.
- **No automatic transaction wrapping.** If you need transactional consistency across multiple writes, wrap them in `Repo.transaction/1` yourself.

For Ecto queries, changesets, and migrations beyond the basics shown here, see the [Ecto documentation](https://hexdocs.pm/ecto/Ecto.html). Nexus follows Ecto's standard contracts; nothing extension-specific changes them.

### 8.11 File storage

For files your extension creates at runtime — uploads, generated images, exported reports — use `Nexus.Extensions.Storage`. Never construct paths under `/app/uploads/extensions/` manually; if the storage layout ever changes, the helpers update transparently while manual paths break.

```elixir
alias Nexus.Extensions.Storage

# Ensure a subdirectory exists
:ok = Storage.ensure_dir("foundation-smoke-test", "exports")

# Get an absolute filesystem path to write to
abs_path = Storage.path("foundation-smoke-test", "exports/report.pdf")
File.write!(abs_path, pdf_bytes)

# Get the public URL to serve the file to browsers
url = Storage.url("foundation-smoke-test", "exports/report.pdf")
# => "/uploads/extensions/foundation-smoke-test/exports/report.pdf"
```

The five Storage functions:

| Function                  | Purpose                                                                      |
|---------------------------|------------------------------------------------------------------------------|
| `path(slug, rel)`         | Returns the absolute filesystem path for `rel` (file may or may not exist).   |
| `url(slug, rel)`           | Returns the public URL where the file is served (`/uploads/extensions/...`). |
| `ensure_dir(slug, subdir)` | Creates intermediate directories. Pass `""` to ensure the extension's root.   |
| `list_files(slug)`         | Returns top-level filenames in the extension's storage directory.            |
| `delete_all(slug)`         | Deletes the entire extension storage directory. Called automatically on uninstall — you usually don't call this. |

#### Two URL paths — when to use which

Your extension has **two** types of static assets, served through different paths:

| Asset type                 | Lives in repo                  | Served at                          | Use for                                                |
|----------------------------|--------------------------------|------------------------------------|--------------------------------------------------------|
| Bundled assets             | `priv/static/<filename>`       | `/ext/<slug>/assets/<filename>`     | Ship-with-extension files: JS bundle, logo, banner, fonts, static data. |
| Runtime-created files      | Written via `Storage.path/2`   | `/uploads/extensions/<slug>/<rel>`  | Anything generated after install: uploads, exports, cached images. |

Bundled assets are copied into place at install time and don't change between installs. Runtime files are created on demand by your extension and persist across restarts. Both are publicly served — neither path performs authentication, so don't put private files in either location.

#### Uploads from the browser

For files originating in the user's browser — screenshot uploads, attachments, anything driven by your UI rather than by your Elixir code — use Nexus's upload endpoint (§9.15) rather than building your own multipart handler. Uploads land in the same `/uploads/extensions/<slug>/` directory that `Storage.list_files/1` reads from, so the two paths share storage. The upload endpoint also gives you MIME validation, size limits, image processing, and automatic admin-side visibility for free.

### 8.12 Available packages

Your extension runs in the Nexus VM and shares Nexus's dependency tree. You can use any of Nexus's existing dependencies without declaring them in your `mix.exs`:

| Package                    | Useful for                                                                     |
|----------------------------|--------------------------------------------------------------------------------|
| `Ecto`, `Ecto.SQL`         | Database access. See §8.10.                                                    |
| `Phoenix.PubSub`           | Real-time broadcasts. Subscribe with `Phoenix.PubSub.subscribe(Nexus.PubSub, topic)`. |
| `Oban`                     | Background jobs. See §8.7.                                                     |
| `Req`                      | HTTP client. The recommended way to call external APIs from extensions.        |
| `Jason`                    | JSON encoding/decoding.                                                        |
| `Image`                    | Image processing (resize, format conversion, etc.) backed by libvips.          |
| `Floki`                    | HTML parsing.                                                                   |
| `Swoosh`                    | Email composition (Nexus's mailer is built on Swoosh).                        |
| `Joken`                     | JWT encoding/decoding if your extension issues its own tokens.                 |
| `Bcrypt`                    | Password hashing if your extension manages credentials.                       |
| `ExAws`, `ExAws.S3`         | AWS API access (S3 uploads, etc.).                                            |
| All of Elixir's standard library | Everything in `String`, `Enum`, `Map`, `Process`, etc.                  |

If you need a package Nexus doesn't already include, the install pipeline cannot install it — Nexus does not run `mix deps.get` for extension tarballs. You'll either need to vendor the dependency's code into your `lib/` tree (if the license permits) or open a discussion about adding it to Nexus's deps.

### 8.13 Checking permissions

The `permissions` field you declared in your manifest (§6.6) surfaces tier dropdowns in the admin's Permissions page. To actually enforce those tiers in your code, call `Nexus.Extensions.Permissions.check/3`:

```elixir
alias Nexus.Extensions.Permissions

def show(conn, %{"id" => id}) do
  user = conn.assigns[:current_user]  # nil for guests

  case Permissions.check("foundation-smoke-test", "can_view_gallery", user) do
    :ok ->
      # User passes the configured tier — proceed
      gallery = MyExtension.Gallery.get!(id)
      json(conn, %{gallery: gallery})

    :error ->
      conn
      |> put_status(:forbidden)
      |> json(%{error: "Access denied"})
  end
end
```

#### Signature

```elixir
@spec check(slug :: String.t(), key :: String.t(), user :: map() | nil) :: :ok | :error
```

| Argument | Type                | Purpose                                                                       |
|----------|---------------------|-------------------------------------------------------------------------------|
| `slug`   | `String.t()`        | Your extension's slug. The function reads the slug's row from `extensions`.    |
| `key`    | `String.t()`        | The permission key declared in your manifest's `permissions`.                  |
| `user`   | `map()` or `nil`    | The user struct (typically `conn.assigns[:current_user]`), or `nil` for guests.|

Returns `:ok` if the user meets the configured tier, `:error` otherwise.

#### Resolution order

When checking, `Permissions.check/3` looks up the configured tier in this order:

1. The value the admin saved on the Permissions page (`ext.settings[key]`).
2. The `default` you declared in the manifest entry.
3. `"member"` if no default was declared.

That is — the manifest default is a fallback, not a hard floor. If the admin sets a permission to `everyone` and your manifest declared `member` as the default, the saved `everyone` wins. The default is what the admin sees pre-filled in the dropdown on first install; after that, the admin's choice is authoritative.

#### Common usage patterns

**In a plug router** — the typical case. Check at the top of each handler:

```elixir
defmodule FoundationSmokeTest.ApiRouter do
  use Plug.Router
  alias Nexus.Extensions.Permissions

  plug :match
  plug :dispatch

  get "/items" do
    case Permissions.check("foundation-smoke-test", "can_view_items", conn.assigns[:current_user]) do
      :ok    -> send_resp(conn, 200, Jason.encode!(%{items: list_items()}))
      :error -> send_resp(conn, 403, Jason.encode!(%{error: "Access denied"}))
    end
  end

  post "/items" do
    case Permissions.check("foundation-smoke-test", "can_create_item", conn.assigns[:current_user]) do
      :ok    -> # ... create the item
      :error -> send_resp(conn, 403, Jason.encode!(%{error: "Access denied"}))
    end
  end
end
```

**In a hook handler** — gating expensive work behind a tier:

```elixir
def handle_event("post_created", %{"user_id" => user_id, "post_id" => post_id}, _settings) do
  user = Nexus.Accounts.get_user(user_id)

  case Permissions.check("foundation-smoke-test", "can_trigger_analysis", user) do
    :ok    -> enqueue_analysis(post_id)
    :error -> :ok  # silently skip — user isn't entitled
  end
end
```

**For UI-side gating** — your bundle can read the current tier asynchronously and decide what to render:

There's no direct `Permissions.check` from JavaScript. The bundle's recommended pattern is to expose a `/permissions` endpoint in your own API that returns the resolved tiers for the current user, and check those server-side before each privileged action regardless. UI-side checks are presentation; the server-side `Permissions.check/3` is the gate that matters.

#### The guest case

`user` can be `nil` — for example, an unauthenticated request hitting a route that's reachable to guests. In that case:

- If the configured tier is `everyone` AND the admin's site-wide `guest_browsing` setting is on, the check passes.
- If the configured tier is `everyone` BUT guest browsing is off site-wide, the check fails — guests get nothing.
- For any other tier (`member`, `moderator`, `admin`), guests always fail.

This means `everyone` doesn't mean "literally anyone unconditionally" — it's "anyone the site has decided to let in at all." When a site administrator turns off guest browsing, every `everyone`-tier surface becomes member-only, including yours. This is by design — extension permissions inherit the site's posture rather than overriding it.

#### Returning a Plug.Conn directly

For routes inside a Plug router, returning the conn from the matched clause is the standard pattern. If you find yourself repeating the `case … :ok -> … :error -> ... 403 ...` shape, consider a small private helper:

```elixir
defp require_permission(conn, key, then_fn) do
  case Permissions.check("foundation-smoke-test", key, conn.assigns[:current_user]) do
    :ok    -> then_fn.(conn)
    :error -> conn |> send_resp(403, ~s({"error":"Access denied"})) |> halt()
  end
end

# Use:
get "/items" do
  require_permission(conn, "can_view_items", fn conn ->
    send_resp(conn, 200, Jason.encode!(%{items: list_items()}))
  end)
end
```

There's no built-in Plug-level macro for this — Nexus's own permission system uses per-handler checks too. Keep your helper local to your router.


---

## 9. Implementation: JavaScript bundle

Your JS bundle binds React components and click handlers to the surfaces your manifest declared. Every `register*` call cross-checks itself against your manifest at register time and logs a console warning if you try to register something the manifest didn't declare. The registration still goes through (Nexus doesn't break the UI mid-render over a developer-feedback issue), but it surfaces as a mismatch in the admin runtime panel — see §11.3.

### 9.1 The `window.NexusExtensions` global

Your bundle is auto-injected as a `<script>` tag in Nexus's HTML head, before React mounts. By the time your code runs, `window.NexusExtensions` is already present and ready to receive registrations.

```javascript
(function() {
  "use strict";
  const NE   = window.NexusExtensions;
  const SLUG = "foundation-smoke-test";

  // All register* calls go here.
  // The bundle is a plain ES script — no build step required.
})();
```

A few conventions worth following:

- **Wrap your code in an IIFE.** Your bundle shares a global execution context with Nexus and every other extension's bundle. An IIFE keeps your variables and helpers out of the global scope.
- **Define `SLUG` once.** Every `register*` call needs your slug. Define it as a const and reference it everywhere; that way a slug rename means one edit, not many.
- **Use `React.createElement`, not JSX.** Your bundle has no build step. JSX won't work unless you add one. `React.createElement(Component, props, ...children)` is the unbuilt equivalent — Nexus exposes React as `window.React` along with hooks like `useState`, `useEffect`, and so on. See §9.14.1 for the full set of host-provided primitives.

The complete smoke test bundle structure looks like this:

```javascript
(function() {
  "use strict";
  const NE   = window.NexusExtensions;
  const SLUG = "foundation-smoke-test";

  // ─── Define your components ────────────────────────────────────────
  function HomePage({ currentUser }) {
    return React.createElement("div", { style: { padding: "32px 0" } },
      React.createElement("h2", null, "Foundation Smoke Test"),
      React.createElement("p", null, "If you're seeing this, routing works.")
    );
  }

  function PostFooterComponent({ post_id }) {
    return React.createElement("div", null, "Post footer for ", post_id);
  }

  // ─── Register surfaces declared in the manifest ────────────────────
  NE.registerRoute(SLUG, "/", HomePage, { title: "Home" });
  NE.registerSlot({ slug: SLUG, slot: "post_footer", component: PostFooterComponent });
  // ... more register* calls as the manifest grows
})();
```

This whole bundle structure is what the rest of §9 fills in. Each subsection covers one register call and the component contract it implies.

### 9.2 `registerSlot` and `propsForSlot`

Slots receive a fixed set of props — the **hard cutoff** noted in §7.1. There's no implicit spread of host state. Your component receives exactly the props its slot's contract declares, and nothing else.

```javascript
function SmokePostFooter({ post_id }) {
  return React.createElement("div",
    { style: { padding: "12px 16px", borderRadius: 8, background: "rgba(255,255,255,0.04)" } },
    "Smoke test footer for post ", post_id
  );
}

NE.registerSlot({
  slug:      SLUG,
  slot:      "post_footer",
  component: SmokePostFooter,
  priority:  50,
});
```

#### Signature

```javascript
NE.registerSlot({ slug, slot, component, priority = 50 })
```

| Parameter   | Required | Purpose                                                                          |
|-------------|----------|----------------------------------------------------------------------------------|
| `slug`      | yes      | Your extension's slug. Must match `^[a-z0-9-]+$`.                                |
| `slot`      | yes      | One of the declared slot names. See §7.1 for the full list.                       |
| `component` | yes      | React component. Receives only the slot's declared props.                         |
| `priority`  | no       | Lower numbers render first when multiple extensions fill the same slot. Default 50. |

#### Props each slot receives

| Slot              | Props                                                                                  |
|-------------------|----------------------------------------------------------------------------------------|
| `post_footer`     | `{ post_id }` — string UUID of the post.                                                |
| `profile_sidebar` | `{ username, current_user }` — username string and viewer's user object (or null).      |

If you need data beyond the declared props, fetch it from your own `/ext/<slug>/api/` endpoints using the props you do have (`post_id`, `username`) as lookup keys. See §9.11.

![The post_footer slot rendered on a /post/:id page, below the post body and above the reply thread. The component received post_id=6 and renders that prop directly.](images/slot-post-footer.png)

### 9.3 `registerRoute`

Full-page extension routes mounted under `/ext/<slug>/...`. When a user navigates to a registered route, Nexus's SPA shell renders your component as the page.

```javascript
function GameDetailPage({ slug: gameSlug, currentUser }) {
  return React.createElement("div",
    { style: { padding: "24px 0" } },
    React.createElement("h1", null, "Game: ", gameSlug),
    currentUser && React.createElement("p", null, "Viewing as @", currentUser.username)
  );
}

NE.registerRoute(SLUG, "/games/:slug", GameDetailPage, { title: "Game details" });
```

#### Signature

```javascript
NE.registerRoute(slug, path, component, options = {})
```

| Parameter   | Required | Purpose                                                                          |
|-------------|----------|----------------------------------------------------------------------------------|
| `slug`      | yes      | Your slug.                                                                        |
| `path`      | yes      | Route path **relative** to your namespace, starting with `/`. Do **not** include `/ext/`. |
| `component` | yes      | React component rendered when the route matches.                                  |
| `options`   | no       | Options object. `options.title` sets the back-header title.                        |

Path patterns:

- `"/"` → `/ext/<slug>` (your extension's home)
- `"/browse"` → `/ext/<slug>/browse`
- `"/users/:username"` → `/ext/<slug>/users/:username`, with `username` available as a component prop
- `"/games/:slug"` → `/ext/<slug>/games/:slug`, with `slug` available as a component prop (independent of your extension's slug — they share a name but Nexus passes the URL param)

The path must also be declared in your manifest's `routes` field (§7.2). The two must match: a declared path with no `registerRoute` call produces a 404; a `registerRoute` call without a manifest declaration logs a warning in the admin runtime panel.

#### Props the component receives

```javascript
function MyPage({ ...params, currentUser }) { /* ... */ }
```

| Prop          | Contents                                                                                  |
|---------------|-------------------------------------------------------------------------------------------|
| `...params`   | One prop per `:name` in the route path. Values are URL-decoded strings.                    |
| `currentUser` | The logged-in user object, or `null`/`undefined` for logged-out visitors.                 |

To navigate from inside the component, use `window.NexusExtensions.navigate(url)` (§9.13).

#### Hard refresh, popstate, and bundle loading

Nexus's SPA shell handles hard refreshes and browser back/forward navigation through the same code path as click-driven navigation. If a user hard-refreshes a `/ext/<slug>/games/foo` URL, Nexus serves the HTML shell, your bundle loads, your bundle calls `registerRoute`, and Nexus's router resolves the URL against the live registry.

There's a small window during this resolution where the route hasn't been registered yet. Nexus polls for up to 8 seconds; if your bundle hasn't registered the matching component by then, the page shows an "Extension failed to load" message with a reload link. In practice this only happens when the bundle fails to load entirely (a 404 on the asset URL, a JavaScript syntax error). Healthy bundles register in milliseconds.

### 9.4 `registerAdminPanel` and the templates

The admin panel surface combines a manifest declaration (§7.3 — `admin_panel: { label, icon }`) with a `registerAdminPanel` call that binds a component.

#### Signature

```javascript
NE.registerAdminPanel(slug, { label, icon, component })
```

| Parameter   | Required | Purpose                                                                          |
|-------------|----------|----------------------------------------------------------------------------------|
| `slug`      | yes      | Your slug.                                                                        |
| `label`     | yes      | Shown in the admin sidebar.                                                       |
| `icon`      | no       | Font Awesome class (short form). Defaults to `fa-puzzle-piece`.                   |
| `component` | yes      | React component rendered when the admin clicks your panel.                        |

The component **receives no props.** Nexus renders it with `React.createElement(component, null)`. If your component needs the slug, settings, or anything else, hard-code or import it.

#### Use a template

§7.3 introduced the two templates. Here are the full implementation examples — `SimpleSettingsPanel` for cases where you need a custom settings UI but want help rendering the fields, `TabbedPanel` for extensions that mix settings with custom views.

A reminder from §5: **don't reach for these templates just to render `settings_schema`.** The host already does that automatically via its fallback form. The templates are for the cases where you specifically chose to render settings yourself — for example, when your panel needs cross-field validation, conditional fields, or custom layouts the host's fallback can't express.

**`SimpleSettingsPanel` — settings rendered by your own panel**

A custom panel that renders one boolean field using the template:

```javascript
NE.registerAdminPanel(SLUG, {
  label: "My Extension",
  icon:  "fa-cog",
  component: function() {
    const { SimpleSettingsPanel } = window.NexusExtensionTemplates;
    return React.createElement(SimpleSettingsPanel, {
      slug:   SLUG,
      fields: [
        {
          key:         "enable_debug_log",
          label:       "Verbose handler logging",
          type:        "boolean",
          hint:        "When on, the post_created handler logs to the server console.",
        },
      ],
    });
  },
});
```

If you use this template, **omit the matching keys from `settings_schema`** — otherwise the host's fallback form will render the same fields below your panel and the form appears twice.

`SimpleSettingsPanel` automatically:

- Fetches current settings from `GET /admin/extensions/<slug>` on mount.
- Renders each field as the appropriate form control (using your `type`).
- Marks the form dirty when a field changes, enabling the topbar Save Changes button.
- Saves to `PATCH /admin/extensions/<slug>/settings` when Save Changes is clicked.
- Clears its save registration on unmount.

Field descriptors:

| Field         | Purpose                                                                              |
|---------------|--------------------------------------------------------------------------------------|
| `key`         | Settings key (matches your `settings_schema`).                                       |
| `label`       | Label shown above the input.                                                          |
| `type`        | `"string"` (default), `"boolean"`, `"select"`, `"text"`, `"number"`, `"color"`.      |
| `hint`        | Helper text shown below the input. (This is the template's field name; in your `settings_schema` the equivalent is called `description` — they're separate fields with the same purpose.) |
| `secret`      | When true, renders as a masked password input.                                        |
| `required`    | When true, marks the field with a red asterisk.                                       |
| `placeholder` | Placeholder for empty inputs.                                                          |
| `options`     | Required for `select` — `[{value, label}]` array.                                     |

**`TabbedPanel` — mixed settings + custom views**

For extensions whose admin panel mixes settings with status views, action buttons, or anything else:

```javascript
function SmokeStatusView() {
  // Custom JSX — fetch your own stats, render whatever
  const [stats, setStats] = React.useState(null);
  React.useEffect(() => {
    fetch(`/ext/${SLUG}/api/status`)
      .then(r => r.json())
      .then(setStats);
  }, []);
  return React.createElement("div", null,
    stats ? `Total events handled: ${stats.events_handled}` : "Loading..."
  );
}

NE.registerAdminPanel(SLUG, {
  label: "Foundation Smoke Test",
  icon:  "fa-flask",
  component: function() {
    const { SimpleSettingsPanel, TabbedPanel } = window.NexusExtensionTemplates;
    return React.createElement(TabbedPanel, {
      tabs: [
        {
          key:   "settings",
          label: "Settings",
          icon:  "fa-gear",
          render: () => React.createElement(SimpleSettingsPanel, {
            slug:   SLUG,
            fields: [
              { key: "enable_debug_log", label: "Verbose handler logging", type: "boolean" },
            ],
          }),
        },
        {
          key:    "status",
          label:  "Status",
          icon:   "fa-chart-line",
          render: () => React.createElement(SmokeStatusView),
        },
      ],
    });
  },
});
```

`TabbedPanel` is pure chrome — it owns the tab bar and the active-tab state and nothing else. Each tab's `render` is called only when active, so unmounted tabs don't run effects or fetch data. Switching tabs unmounts the old content and mounts the new.

The topbar Save Changes button automatically wires to whichever `SimpleSettingsPanel` is currently mounted. Tabs containing only custom JSX (no `SimpleSettingsPanel`) leave the Save button disabled — which is correct, since there's nothing dirty to save.

#### Fully custom component — only if you must

If your admin panel needs to do something the templates can't express (a complex form with cross-field validation, a wizard, an embedded external UI), write a fully custom component and wire the topbar Save button manually:

```javascript
function FullyCustomPanel() {
  const [vals, setVals] = React.useState({});
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    fetch(`/admin/extensions/${SLUG}`).then(r => r.json()).then(d => {
      setVals(d.extension?.settings || {});
    });

    // Register save with the topbar
    window._nexusAdminSaveFn = async () => {
      await fetch(`/admin/extensions/${SLUG}/settings`, {
        method:  "PATCH",
        headers: { "content-type": "application/json" },
        body:    JSON.stringify({ settings: vals }),
      });
      setDirty(false);
      return true;
    };

    return () => {
      if (window._nexusAdminSaveFn) window._nexusAdminSaveFn = null;
    };
  }, [vals]);

  const setField = (k, v) => {
    setVals(p => ({ ...p, [k]: v }));
    window._nexusAdminSetDirty?.();
  };

  // ... render your custom UI, calling setField on changes
}
```

This is rarely the right answer. Reach for a template first; only write custom when the template genuinely can't represent what you need.

### 9.5 `registerExploreItem`

The Explore section in Nexus's left sidebar is the main navigation surface. The manifest's `explore` field declares one primary entry (§7.4); `registerExploreItem` is the JS-side binding for that entry plus any additional entries.

The smoke test has one entry, registered to match its manifest declaration:

```javascript
NE.registerExploreItem({
  slug:     SLUG,
  path:     "/",
  label:    "Foundation Smoke Test",
  icon:     "fa-flask",
  authOnly: false,
  priority: 50,
});
```

#### Signature

```javascript
NE.registerExploreItem({ slug, path = "/", id, label, icon = "fa-puzzle-piece", authOnly = false, priority = 50 })
```

| Parameter  | Required | Purpose                                                                          |
|------------|----------|----------------------------------------------------------------------------------|
| `slug`     | yes      | Your slug.                                                                        |
| `path`     | no       | Path within your extension. Defaults to `"/"`. Must start with `/`, must not include `/ext/`. |
| `id`       | no       | Item id (defaults to your slug). Use to register multiple Explore entries — each needs a unique id. |
| `label`    | yes      | Shown in the Explore section.                                                     |
| `icon`     | no       | Font Awesome class (short form). Defaults to `fa-puzzle-piece`.                   |
| `authOnly` | no       | When `true`, hide the item from logged-out visitors. Default `false`.            |
| `priority` | no       | Lower numbers render higher up. Default 50.                                       |

The target path must correspond to a route you registered via `registerRoute`. Clicking the item navigates the SPA to `/ext/<slug><path>`.

#### Multiple Explore entries

The manifest's `explore` field declares one canonical entry. If you want more — a primary page plus a secondary "Recent" link, for example — register them all from JS. The manifest's `explore` declaration is presence-or-absence only; once declared, the validator doesn't count Explore registrations, so extra ones pass without warning.

```javascript
NE.registerExploreItem({ slug: SLUG, path: "/",       label: "Smoke Test", icon: "fa-flask" });
NE.registerExploreItem({ slug: SLUG, path: "/recent", label: "Recent",     id: "smoke-recent", icon: "fa-clock", priority: 51 });
```

Use additional entries sparingly. Each one takes a row in the Explore section, competing with Nexus's built-in navigation and every other extension. If you have three things to navigate to, consider whether one Explore entry leading to a hub page (with the other two as in-page tabs or links) reads cleaner.

### 9.6 `registerRightWidget`

Right widgets are panels in the right sidebar. Your manifest declares them with id, label, scope, and priority (§7.5); `registerRightWidget` binds each id to a component.

```javascript
function SmokeStatusWidget({ currentUser, pageProps }) {
  return React.createElement("div",
    { style: { padding: 12, border: "0.5px solid var(--b1)", borderRadius: 8 } },
    React.createElement("div", { style: { fontSize: 12, color: "var(--t4)" } }, "Smoke Test"),
    React.createElement("div", { style: { fontSize: 14, fontWeight: 500 } }, "Status: ✓")
  );
}

NE.registerRightWidget({
  slug:      SLUG,
  id:        "smoke-status",
  label:     "Smoke Status",
  component: SmokeStatusWidget,
  scope:     "extension",
});
```

#### Signature

```javascript
NE.registerRightWidget({ slug, id, label, component, priority = 50, scope = "extension" })
```

| Parameter   | Required | Purpose                                                                          |
|-------------|----------|----------------------------------------------------------------------------------|
| `slug`      | yes      | Your slug.                                                                        |
| `id`        | yes      | Widget id matching your manifest declaration.                                     |
| `label`     | yes      | Shown in **Admin → Layout → Right sidebar**, not on the widget itself.            |
| `component` | yes      | React component rendered as the widget.                                           |
| `priority`  | no       | Lower numbers render higher up. Default 50.                                       |
| `scope`     | no       | Where the widget appears. See §7.5 for the scope grammar. Default `"extension"`. |

#### Props the component receives

```javascript
function MyWidget({ currentUser, pageProps }) { /* ... */ }
```

| Prop          | Contents                                                                                  |
|---------------|-------------------------------------------------------------------------------------------|
| `currentUser` | The logged-in user object, or `null`.                                                      |
| `pageProps`   | The props of the current page being rendered. **Treat as opaque** — shape varies by page. |

To navigate from inside the widget, use `window.NexusExtensions.navigate(url)` (§9.13).

`pageProps` is provided as an escape hatch for widgets that need context from the page they're rendered on. It's intentionally not documented per-page — the shape is internal and may change. If your widget depends on `pageProps`, version-couple your extension carefully or stick to surfaces with declared contracts (slots, profile tabs, route components).


### 9.7 `registerToolbarButton`

Toolbar buttons appear in the post and reply composers. Each declared button in your manifest's `toolbar_buttons` field needs a matching `registerToolbarButton` call binding its `id` to a click handler.

The smoke test registers two — a simple click-to-alert button and a composer-attachment button using the `attach()` flow:

```javascript
NE.registerToolbarButton({
  slug:    SLUG,
  id:      "smoke-button",
  icon:    "fa-solid fa-flask",
  tip:     "Smoke test toolbar button",
  scope:   "both",
  onClick() {
    alert("Toolbar button click — registration and event wiring both work.");
  },
});

NE.registerToolbarButton({
  slug:    SLUG,
  id:      "smoke-attach-note",
  icon:    "fa-solid fa-note-sticky",
  tip:     "Attach a smoke note",
  scope:   "both",
  priority: 60,
  onClick({ attach, context }) {
    const note = prompt("Note text?");
    if (!note) return;
    const kind = context === "reply" ? "smoke_reply_note" : "smoke_note";
    attach({ kind, data: { text: note } });
  },
});
```

#### Signature

```javascript
NE.registerToolbarButton({ slug, id, icon, tip, onClick, scope = "both", priority = 50 })
```

| Parameter  | Required | Purpose                                                                          |
|------------|----------|----------------------------------------------------------------------------------|
| `slug`     | yes      | Your slug.                                                                        |
| `id`       | yes      | Button id matching your manifest declaration.                                     |
| `icon`     | yes      | **Full** Font Awesome class with style prefix (e.g. `"fa-solid fa-flask"`). Toolbar icons take the full form; this differs from other surfaces. |
| `tip`      | yes      | Tooltip text shown on hover.                                                      |
| `onClick`  | yes      | Click handler. See signature below.                                               |
| `scope`    | no       | `"both"` (default), `"posts"`, or `"replies"`. Must match your manifest declaration. |
| `priority` | no       | Default 50.                                                                       |

All these fields except `onClick` duplicate what your manifest already declared. Keep them in sync — the JS values are what render at runtime, but a mismatch with the manifest will surface in the admin runtime panel.

#### `onClick` signature

```javascript
onClick({ attach, currentUser, context })
```

`onClick` receives a single context object:

| Field          | Purpose                                                                       |
|----------------|-------------------------------------------------------------------------------|
| `attach`       | Function: `attach({ kind, data })` queues an attachment for the in-flight composition. See below. |
| `currentUser`  | The logged-in user object, or `null`.                                          |
| `context`      | `"post"`, `"reply"`, or `null` — which composer the button was clicked in.    |

To navigate from inside `onClick`, use `window.NexusExtensions.navigate(url)` (§9.13).

#### The `attach()` flow

`attach({ kind, data })` adds an attachment to the composer's pending attachments. When the user submits the post or reply, Nexus dispatches each attachment to the extension that declared its `{entity, kind}` pair (§6.3) by calling that extension's `persist_attachment/3` callback (§8.9).

```javascript
attach({ kind: "smoke_note", data: { text: "Some text" } });
```

| Field  | Purpose                                                                              |
|--------|--------------------------------------------------------------------------------------|
| `kind` | Required string. Must match a `kind` declared in your manifest's `side_data`.        |
| `data` | Object with whatever fields your `persist_attachment/3` handler expects. You own this contract end-to-end — there's no host-side schema. |

A few notes:

- You can call `attach()` multiple times to queue multiple attachments of the same kind or different kinds.
- The attachment is queued client-side and sent only when the user actually submits. If they abandon the composition, the attachment is discarded — `persist_attachment/3` is never called.
- The 10 KB per-attachment cap (§8.9) applies. The host JSON-encodes each attachment and rejects oversized ones at the API edge, before they reach your callback.
- Pick the right `kind` for the composer's context — `context` tells you whether the user is composing a post or a reply, so you can dispatch to the matching declared kind.

### 9.8 `registerProfileTab`

Profile tabs appear on `/profile/:username` pages. Each tab your manifest declared in `profile_tabs` needs a matching `registerProfileTab` call binding its `id` to a component.

The smoke test registers two tabs — one always-visible, one own-profile-only. The manifest controls visibility; the JS bindings are identical:

```javascript
function SmokeTabContent({ username, current_user }) {
  const isOwn = current_user && current_user.username === username;
  return React.createElement("div", { style: { padding: "24px 0" } },
    React.createElement("h3", null, "Smoke tab for ", username),
    isOwn && React.createElement("p", null, "This is your own profile.")
  );
}

NE.registerProfileTab({ slug: SLUG, id: "smoke-tab",     component: SmokeTabContent });
NE.registerProfileTab({ slug: SLUG, id: "smoke-ownonly", component: SmokeTabContent });
```

#### Signature

```javascript
NE.registerProfileTab({ slug, id, component })
```

| Parameter   | Required | Purpose                                                                    |
|-------------|----------|----------------------------------------------------------------------------|
| `slug`      | yes      | Your slug.                                                                  |
| `id`        | yes      | Tab id matching your manifest declaration.                                  |
| `component` | yes      | React component rendered as the tab's content.                              |

The tab's label, icon, visibility, and priority all come from the manifest (§7.7). The JS binding handles only the component.

#### Props the component receives

```javascript
function MyProfileTab({ username, current_user }) { /* ... */ }
```

| Prop           | Contents                                                                                  |
|----------------|-------------------------------------------------------------------------------------------|
| `username`     | The username of the profile being viewed (from the URL).                                  |
| `current_user` | The viewer's user object, or `null` if logged-out.                                         |

Same hard-cutoff contract as slots: nothing else is passed. To navigate, use `window.NexusExtensions.navigate(...)`. To get the profile owner's user id or any other data about them, fetch it from your own API by username — that's the canonical identifier exposed by the URL, and it's what your endpoint should accept.

The visibility filter on `own_only` tabs hides the tab button when `current_user.username !== username`, but if a determined visitor reaches your component another way, it will still render. **Enforce server-side any access control your tab depends on** (§7.7).

### 9.9 `registerUserAction`, `registerAccountAction`, `registerPostAction`

These three register click-driven actions that appear in three menus:

| Function                | Menu                                                | Click context receives                            |
|-------------------------|-----------------------------------------------------|---------------------------------------------------|
| `registerUserAction`    | The user card popover (when hovering an avatar) and the mobile user menu. | `{ user, currentUser, closeCard }` |
| `registerAccountAction` | The current user's account menu (topbar dropdown / mobile account sheet). | `{ currentUser, close }`           |
| `registerPostAction`    | The post `…` dropdown menu on `/post/:id` pages.    | `{ post, currentUser, closeMenu }`     |

None of these have manifest declarations. They're JS-only registrations. To navigate from any of these handlers, use `window.NexusExtensions.navigate(url)` (§9.13).

#### `registerUserAction`

Actions on *other* users — viewing their profile, sending them something, anything addressing a target user.

```javascript
NE.registerUserAction({
  id:       "smoke-view-target",
  label:    "View in smoke test",
  icon:     "fa-flask",
  onClick({ user, currentUser, closeCard }) {
    closeCard();
    window.NexusExtensions.navigate(`/ext/${SLUG}/users/${user.username}`);
  },
  authOnly: false,
  priority: 50,
});
```

| Parameter  | Required | Purpose                                                                          |
|------------|----------|----------------------------------------------------------------------------------|
| `id`       | yes      | Unique action id.                                                                 |
| `label`    | yes      | Shown in the menu.                                                                |
| `icon`     | no       | Font Awesome class (short form). Defaults to `fa-puzzle-piece`.                   |
| `onClick`  | yes      | Click handler. Signature: `({ user, currentUser, closeCard }) => {}`.             |
| `authOnly` | no       | Hide for logged-out viewers. Default `false`.                                     |
| `priority` | no       | Default 50.                                                                       |

`user` is the **target** user (the one whose card was clicked); `currentUser` is the **viewer**. Call `closeCard()` before navigating to dismiss the popover.

#### `registerAccountAction`

Actions on the current user's *own* account — settings, personal pages, anything operating on the logged-in user.

```javascript
NE.registerAccountAction({
  id:       "smoke-my-account",
  label:    "My smoke data",
  icon:     "fa-flask",
  onClick({ currentUser, close }) {
    close();
    window.NexusExtensions.navigate(`/ext/${SLUG}/users/${currentUser.username}`);
  },
  priority: 50,
});
```

| Parameter  | Required | Purpose                                                                          |
|------------|----------|----------------------------------------------------------------------------------|
| `id`       | yes      | Unique action id.                                                                 |
| `label`    | yes      | Shown in the menu.                                                                |
| `icon`     | no       | Font Awesome class (short form).                                                  |
| `onClick`  | yes      | Click handler. Signature: `({ currentUser, close }) => {}`.             |
| `priority` | no       | Default 50.                                                                       |

The user is always logged in by the time the account menu opens, so there's no `authOnly`.

#### `registerPostAction`

Actions in the post `…` menu — anything acting on a specific post.

```javascript
NE.registerPostAction({
  id:    "smoke-tag-post",
  label: "Tag for smoke test",
  icon:  "fa-flask",
  visible({ post, currentUser }) {
    return currentUser && currentUser.role === "admin";
  },
  onClick({ post, currentUser, closeMenu }) {
    closeMenu();
    fetch(`/ext/${SLUG}/api/tag-post`, {
      method:  "POST",
      headers: { "content-type": "application/json" },
      body:    JSON.stringify({ post_id: post.id }),
    });
  },
  priority: 50,
});
```

| Parameter  | Required | Purpose                                                                          |
|------------|----------|----------------------------------------------------------------------------------|
| `id`       | yes      | Unique action id.                                                                 |
| `label`    | yes      | Shown in the menu.                                                                |
| `icon`     | no       | Font Awesome class (short form).                                                  |
| `onClick`  | yes      | Click handler. Signature: `({ post, currentUser, closeMenu }) => {}`.   |
| `visible`  | no       | `({ post, currentUser }) => boolean`. Return `false` to hide the action for the given post/viewer combination. |
| `priority` | no       | Default 50.                                                                       |

`visible` is the visibility filter — return false to hide the action without removing it from the registry. Use this for owner-only actions, moderator-only actions, or per-post conditional actions.

### 9.10 `registerNotificationType`

Notification types declared in your manifest's `notification_types` field (§6.4) handle three things server-side: payload validation, preferences UI, channel gating. The browser-side `registerNotificationType` adds a fourth: how the notification is **rendered** in the notifications list and what happens when the user clicks it.

The smoke test fires a notification when a post is created and renders it with a custom body:

```javascript
NE.registerNotificationType("smoke_notif", {
  icon:      "fa-flask",
  iconColor: "var(--ac)",
  renderBody(n) {
    return React.createElement(React.Fragment, null,
      React.createElement("strong", { style: { color: "var(--t1)" } },
        n.actor?.username || "Someone"),
      React.createElement("span", { style: { color: "var(--t3)" } },
        " triggered a smoke notification for post ", n.data?.post_id || "?")
    );
  },
  onClick({ n }) {
    if (n.data?.post_id) {
      window.NexusExtensions.navigate(`/post/${n.data.post_id}`);
    }
  },
});
```

#### Signature

```javascript
NE.registerNotificationType(typeKey, { icon, iconColor, renderBody, onClick })
```

| Parameter    | Required | Purpose                                                                          |
|--------------|----------|----------------------------------------------------------------------------------|
| `typeKey`    | yes      | The notification type key matching your manifest's `notification_types[].key`.    |
| `icon`       | no       | Font Awesome class (short form). Defaults to a generic bell.                      |
| `iconColor`  | no       | CSS color string for the icon. Use a CSS variable for theme-consistency.          |
| `renderBody` | no       | `(n) => ReactNode` — renders the notification body. Receives the full notification object. |
| `onClick`    | no       | `({ n }) => {}` — runs when the user clicks the notification. If omitted, Nexus uses the default click behavior (navigate to `post_id` if set). |

If `renderBody` is omitted, Nexus renders a generic fallback (the actor's username + the type key). For extension notifications you want users to engage with, supply both `renderBody` and `onClick`.

![The notifications page showing two smoke_notif entries. The custom flask icon (from the icon field) and the custom body ("StryGuardian — Smoke test fired for your post") both come from the bundle's renderNotificationType registration. Without these, Nexus would render a generic "Someone sent a notification" fallback.](images/notifications.png)

The notification object passed to `renderBody` and `onClick`:

| Field            | Contents                                                                          |
|------------------|-----------------------------------------------------------------------------------|
| `id`             | Notification ID.                                                                  |
| `type`           | `"extension"` for all extension-fired notifications.                              |
| `data.ext_type`  | Your type key (e.g. `"smoke_notif"`).                                              |
| `data.ext_slug`  | Your slug (Nexus adds this automatically).                                        |
| `data.<...>`     | Whatever else you sent in the `data` field of your `notify_extension` call.       |
| `actor`          | The user who triggered the notification — `{ id, username, avatar_url }`.         |
| `post_id`        | If your `notify_extension` call included a `post_id`.                              |
| `reply_id`       | If your `notify_extension` call included a `reply_id`.                             |
| `read`           | Read state. Don't worry about this — Nexus marks it read automatically.            |
| `inserted_at`    | When the notification was created.                                                 |

### 9.11 Calling your own API

Your bundle calls your own `/ext/<slug>/api/...` endpoints with plain `fetch()`:

```javascript
async function fetchSmokeStats() {
  const r = await fetch(`/ext/${SLUG}/api/stats`);
  if (!r.ok) throw new Error("smoke stats fetch failed");
  return r.json();
}
```

A few rules worth knowing:

- **Auth pass-through.** If the user is logged in, the browser's request to `/ext/<slug>/api/...` is **not** automatically authenticated. Your Plug receives the request with `conn.assigns.current_user` set to `nil` unless you forward the JWT. To authenticate, read the token from `localStorage` and pass it as a Bearer header:

  ```javascript
  const token = localStorage.getItem("nexus_token");
  const headers = token ? { "authorization": `Bearer ${token}` } : {};
  const r = await fetch(`/ext/${SLUG}/api/stats`, { headers });
  ```

  Nexus's `LoadUser` plug then sets `conn.assigns.current_user` to the logged-in user. Your endpoint enforces authentication itself, per §8.6.

- **`window._nexusApi` is for Nexus core endpoints only.** Nexus's own API helper is exposed on `window._nexusApi` for extensions to call Nexus core's `/api/v1/*` endpoints (notifications, uploads, etc.) — see §9.12 and §9.15 for the canonical uses. The helper handles JWT pass-through and 401 token refresh automatically. **It does not work for your own `/ext/<slug>/api/...` paths** — it hardcodes the `/api/v1` prefix. Use raw `fetch()` (as shown above) for your own endpoints.

- **CSRF and CORS.** Your extension's API endpoints share the origin and the auth model of Nexus itself. Same-origin requests don't need CORS preflighting, and Nexus doesn't enforce CSRF tokens on the extension API routes — JWT-based auth handles request validation.

### 9.12 Sending notifications from the bundle

To fire a notification from your JS bundle, POST to `/api/v1/notifications/extension` via the `_nexusApi` helper:

```javascript
async function fireSmokeNotification(targetUserId, postId) {
  await window._nexusApi.post("/notifications/extension", {
    slug:           SLUG,
    target_user_id: targetUserId,
    type:           "smoke_notif",
    data:           { post_id: postId },
    post_id:        postId,
  });
}
```

`_nexusApi.post` handles the JWT header and 401 token refresh automatically (§9.11). The path is relative to `/api/v1`. If you'd rather use raw `fetch()`, the equivalent is a POST to `/api/v1/notifications/extension` with `Authorization: Bearer <jwt>` and `Content-Type: application/json`.

#### Request body

| Field            | Required | Purpose                                                                          |
|------------------|----------|----------------------------------------------------------------------------------|
| `slug`           | yes      | Your slug. Must match an enabled extension.                                       |
| `target_user_id` | yes      | The user to notify.                                                               |
| `type`           | yes      | Notification type key. Max 64 chars. Should match a `notification_types[].key` in your manifest. |
| `data`           | no       | Object passed through to your `renderBody` and `onClick` handlers. Required fields per your manifest's `payload_schema` (§6.4) must be present. |
| `post_id`        | no       | If the notification is about a post, include this. Nexus's default click handler navigates here. |
| `reply_id`       | no       | If the notification is about a reply.                                              |

#### Auth and impersonation

The endpoint requires authentication (Nexus's `:authenticated` pipeline). The **actor** — the user who triggered the notification — is taken from the JWT in the request header, not from the body. This means a bundle cannot fire notifications attributed to other users; the actor is always the currently-logged-in viewer.

If your extension needs to fire notifications without a user actor (a scheduled job, an external webhook), fire them from your Elixir side using `Nexus.Notifications.notify_extension/3` instead. That path supports actor-less notifications and bypasses the JWT requirement.

#### Validation errors

The endpoint validates against your declared `notification_types`. Possible 422 responses:

- `target_user_id and type are required` — one of them is missing.
- `type must be 64 characters or fewer` — your `type` exceeded the limit.
- `missing required fields per payload_schema: ...` — your manifest declared a `payload_schema` and one or more declared fields aren't present in `data`.

A 403 means your extension is disabled or not installed. A 200 with `{ ok: true }` means the notification was enqueued for delivery.

### 9.13 `navigate`, `matchRoute`, `routeUrl`

Three utility functions on `window.NexusExtensions` for navigation and route inspection.

#### `navigate(url)`

The canonical way for extensions to navigate within Nexus. Accepts any URL starting with `/` and routes through the SPA's navigation pipeline — same code path as a hard refresh, so click navigation and direct addressing always produce identical state.

```javascript
window.NexusExtensions.navigate("/ext/foundation-smoke-test/users/alice");
window.NexusExtensions.navigate("/feed");
window.NexusExtensions.navigate("/profile/alice");
```

Use it anywhere you need to navigate — inside components, click handlers, action callbacks. It works the same in every context.

#### `matchRoute(pathname)`

Check whether a path resolves to a registered extension route. Returns `{ component, params, options, pattern, slug }` if it matches, or `null`.

```javascript
const match = window.NexusExtensions.matchRoute("/ext/foundation-smoke-test/users/alice");
// match === { component, params: { username: "alice" }, options: { title: "..." }, pattern: "/ext/foundation-smoke-test/users/:username", slug: "foundation-smoke-test" }
```

This is an advanced helper. Most extensions don't need it — routes are resolved automatically when the user navigates. Use it only if your extension needs to inspect a route from inside a component (for example, to render conditional UI based on whether a particular extension URL is registered).

#### `routeUrl(pattern, params)`

Reconstruct a concrete URL from a route pattern by filling in named params. Inverse of `matchRoute`.

```javascript
const url = window.NexusExtensions.routeUrl(
  "/ext/foundation-smoke-test/users/:username",
  { username: "alice" }
);
// url === "/ext/foundation-smoke-test/users/alice"
```

Also advanced. To navigate, build the URL as a literal string and pass it to `navigate(url)` — that's almost always clearer than building it from a pattern. `routeUrl` exists for the rare case where you have a pattern in hand and need to fill it in programmatically.

### 9.14 Host-provided primitives

Beyond the `register*` APIs, Nexus puts several things on the page your bundle can use directly — React itself, a small curated set of UI components, a complete CSS variable system, reusable CSS classes, and two passive media surfaces (lightbox and lite YouTube embed). This section is the full inventory.

Everything here is available to no-build bundles. Nothing requires importing anything — these are either `window.*` globals or styling Nexus has already applied to the page.

#### 9.14.1 React

`window.React` and `window.ReactDOM` are Nexus's React instance. Use them for hooks, fragments, and `createElement`:

```javascript
const { useState, useEffect, useCallback, useMemo, useRef, Fragment } = window.React;
```

There's only one React on the page — Nexus's. Don't ship your own copy; you'd create two reconcilers competing for the same DOM. The single instance is why your components can receive React elements as props from the host (slots, route components, admin panels) and have them render correctly.

#### 9.14.2 UI components: `window.NexusComponents`

A curated set of five React components ready to use without building anything. Mirrors the `window.NexusExtensionTemplates` pattern used for admin panel templates.

```javascript
const { Toggle, Select, Av, Md, toast } = window.NexusComponents;
```

These five cover most extension UI needs. The list is deliberately small — each is a stable contract that won't break under you, and the surface grows by deliberate choice rather than by accumulation.

##### `Toggle`

A boolean toggle switch. Theme-matched.

```javascript
React.createElement(Toggle, {
  value:    enabled,
  onChange: (v) => setEnabled(v),
  label:    "Enable feature",
  hint:     "Turn this on to do the thing.",
})
```

| Prop       | Type                 | Purpose                                              |
|------------|----------------------|------------------------------------------------------|
| `value`    | boolean              | Current value.                                       |
| `onChange` | `(newValue) => void` | Called with the new boolean on toggle.               |
| `label`    | string (optional)    | Label shown next to the toggle.                      |
| `hint`     | string (optional)    | Helper text below the label.                          |

##### `Select`

A styled dropdown. Accepts either a list of options or raw `<option>` children.

```javascript
React.createElement(Select, {
  value:    sort,
  onChange: (v) => setSort(v),
  options:  [
    { value: "newest", label: "Newest first" },
    { value: "top",    label: "Top rated" },
    { value: "alpha",  label: "A → Z" },
  ],
})
```

| Prop        | Type                                                          | Purpose                                                                  |
|-------------|---------------------------------------------------------------|--------------------------------------------------------------------------|
| `value`     | string                                                         | Currently-selected value.                                                 |
| `onChange`  | `(newValue) => void`                                           | Called with the new value on change.                                      |
| `options`   | `Array<{value, label}>` or `Array<string>`                     | Items to render. Strings get used for both value and label.               |
| `children`  | ReactNode                                                      | Alternative to `options` — raw `<option>` elements you build yourself.   |
| `disabled`  | boolean (optional)                                              | Disables interaction.                                                    |
| `id`        | string (optional)                                              | DOM id for form association.                                              |
| `className` | string (optional)                                              | Extra class names appended to the styling.                                |
| `style`     | object (optional)                                              | Inline style override.                                                    |

##### `Av`

A circular avatar. Renders the user's profile picture or a colored initial fallback. Theme-matched, respects the admin's `--av-radius` setting.

```javascript
React.createElement(Av, { user: { username: "alice", avatar_url: "/..." }, size: 32 })
```

| Prop    | Type                                | Purpose                                                  |
|---------|-------------------------------------|----------------------------------------------------------|
| `user`  | `{ username, avatar_url? }`         | The user to render. `avatar_url` falls back to initials.  |
| `size`  | number (optional, default 28)       | Diameter in pixels.                                       |

##### `Md`

Renders Nexus's markdown flavor — same parser, same sanitizer, same embeds as user-authored posts. Markdown text in, themed HTML out. Code highlighting, mention links (`@username`), and embed handling (YouTube, Vimeo, X, Spotify) all included.

```javascript
React.createElement(Md, { text: "Visit @alice's profile or watch https://youtu.be/dQw4w9WgXcQ" })
```

| Prop   | Type   | Purpose                  |
|--------|--------|--------------------------|
| `text` | string | Markdown source to render.|

The rendered output is wrapped in a `.md-body` div, so the lightbox auto-binds to any images and the YouTube lite embed wires up automatically. See §9.14.5.

##### `toast`

A fire-and-forget toast notification. Not a component — a plain function. A single host-level `<Toasts/>` is already mounted at the app root; calling `toast()` queues a message there.

```javascript
toast("Settings saved");                    // green success (default)
toast("Couldn't save — please retry", "err"); // red error
toast("Heads up", "warn");                  // amber warning
```

The toast auto-dismisses after 3 seconds. No mount, no state, no cleanup.

#### 9.14.3 CSS variables

Nexus sets a complete CSS variable system on `:root` and updates it when the admin changes branding settings or switches between light and dark mode. **Using these variables in your styles is the easiest way to get a theme-matched, theme-reactive UI for free.**

Two groups: theme-customizable (admins can change in branding settings) and fixed (set once at load).

**Theme-customizable** — admin can change these in **Admin → branding**:

| Variable      | Purpose                                                                            |
|---------------|------------------------------------------------------------------------------------|
| `--ac`        | Accent color (the primary brand color).                                            |
| `--ac-on`     | Foreground color to use on top of `--ac` (for text on accent-colored buttons).      |
| `--ac-bg`     | Accent tinted at low alpha — for subtle backgrounds, hover states.                  |
| `--ac-border` | Accent tinted for borders.                                                          |
| `--ac-text`   | Accent in a more legible tint — for accent-colored text on neutral backgrounds.    |
| `--bg`        | Page background.                                                                    |
| `--s1`        | Slightly raised surface (cards, panels).                                            |
| `--s2`        | More raised surface (popovers, dialogs).                                            |
| `--s3`        | Most raised surface (active overlays).                                              |
| `--av-radius` | Avatar border-radius (admin chooses square, circle, or anything between).           |
| `--fs-ui`, `--fs-body`, `--fs-title`, `--fs-content`, `--fs-feed-title`, `--fs-code` | Font sizes for the corresponding text types. |

**Fixed** — set on `:root`, the same value across all installs:

| Variable        | Purpose                                                                          |
|-----------------|----------------------------------------------------------------------------------|
| `--t1`–`--t5`   | Text colors, from highest contrast (`--t1`) to lowest (`--t5`).                  |
| `--b1`, `--b2`, `--b3` | Border colors, increasing in opacity.                                     |
| `--green`, `--red`, `--blue`, `--amber`, `--pink` | Semantic colors for success/error/info/warning/accents. |

A widget styled with `border: 0.5px solid var(--b1)`, `background: var(--s2)`, `color: var(--t1)` will look right on every install, in both light and dark modes, regardless of the admin's branding choices.

#### 9.14.4 Reusable CSS classes

A few CSS classes Nexus defines that work standalone — give your element the class and you get the styling.

| Class           | What it does                                                                          |
|-----------------|---------------------------------------------------------------------------------------|
| `.btn-primary`  | Accent-colored button. Use for primary actions.                                       |
| `.btn-ghost`    | Subtle outlined button. Use for secondary actions.                                    |
| `.md-body`      | Container that styles its children like markdown — code blocks, headings, blockquotes, etc. **Also auto-wires the lightbox** for any `<img>` it contains. |
| `.av-circle`    | Standalone avatar styling. The `Av` component (§9.14.2) uses this internally.         |

For toasts, prefer `window.NexusComponents.toast()` (§9.14.2) — it handles mounting and queueing. The underlying `.toast.ok` / `.toast.err` / `.toast.warn` styles exist if you need to render your own toast-styled element for some reason.

#### 9.14.5 Media: lightbox and lite YouTube embed

Two passive surfaces. Emit the right markup and Nexus's globally-installed handlers do the work.

##### Lightbox

Click any image inside an `.md-body` element to open it in a full-screen lightbox with gallery navigation, zoom, fullscreen, and thumbnail strip. Fancybox 5 is the underlying engine, lazy-loaded the first time a user clicks.

The simplest path — render your text via the `Md` component (§9.14.2) or wrap your content in `.md-body`:

```javascript
React.createElement("div", { className: "md-body" },
  React.createElement("img", { src: "/uploads/extensions/my-ext/screenshot.png" })
)
```

To opt an image into a higher-resolution lightbox source while keeping a lower-resolution thumbnail, set `data-original`:

```javascript
React.createElement("img", {
  src: "/thumb-low.png",
  "data-original": "/full-res.png",
})
```

For programmatic opening — outside the `.md-body` auto-wire path — call `window._openFancybox(items, startIndex)`:

```javascript
window._openFancybox(
  [
    { src: "/thumb1.png", originalSrc: "/full1.png" },
    { src: "/thumb2.png", originalSrc: "/full2.png" },
  ],
  0
);
```

Items are objects with `src` (the thumbnail-ish source) and optional `originalSrc` (the lightbox-resolution source). `startIndex` is the gallery starting position.

##### Lite YouTube embed

A click-to-play YouTube embed that loads the iframe only when the user clicks the thumbnail. Saves ~500 KB of network on every page where a YouTube link is rendered. Emit a `div` with class `yt-lite` and a `data-id` attribute:

```javascript
React.createElement("div", {
  className: "yt-lite",
  "data-id": "dQw4w9WgXcQ",
},
  React.createElement("img", {
    className: "yt-thumb",
    src: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    alt: "YouTube video",
    loading: "lazy",
  })
)
```

When the user clicks anywhere inside that div, Nexus's global click handler swaps in the YouTube iframe with autoplay enabled. The `Md` component does this for you when it sees a YouTube URL in the rendered markdown; the explicit form above is for when you want a video embed without going through markdown.

#### 9.14.6 API helper: `window._nexusApi`

A thin wrapper around `fetch()` that targets Nexus's own `/api/v1/*` endpoints. Auto-adds the JWT, transparently refreshes on 401, and parses the JSON response.

```javascript
// GET
const stats = await window._nexusApi.get("/notifications/unread");

// POST with a JSON body
await window._nexusApi.post("/notifications/extension", {
  slug:           SLUG,
  target_user_id: userId,
  type:           "smoke_notif",
  data:           {},
});

// PATCH, DELETE
await window._nexusApi.patch("/some/path", { ... });
await window._nexusApi.delete("/some/path");

// Multipart file upload — the upload endpoint helper
await window._nexusApi.upload("/uploads/ext/your-slug", file, { type: "extension_image" });
```

All paths are appended to `/api/v1`. **Don't use it for your own `/ext/<slug>/api/...` endpoints** — the prefix is hard-coded. For your own API, raw `fetch()` as shown in §9.11 is the right call.

When you need to call a Nexus core endpoint from your bundle — notifications (§9.12), uploads (§9.15), or anything else under `/api/v1` — `_nexusApi` is the recommended path. It handles the cases (token refresh especially) that raw `fetch()` would force you to implement yourself.

#### 9.14.7 What's not exposed

The `window.NexusComponents` set is curated, not exhaustive. Nexus's internal code uses additional components — link preview cards, reaction buttons, rich text editors, the user-card popover, the toolbar registry — that aren't part of the extension API. Treat them as internals: they may change without notice, and importing them isn't possible from a no-build bundle anyway.

If you need a primitive that isn't in §9.14.2, build it yourself using the CSS variables (§9.14.3) and classes (§9.14.4) — that's how `NexusComponents` themselves are built, and the result will look native to Nexus. If a primitive seems generally useful and you'd like to see it added to the curated set, opening a discussion is the right path; the bar is "stable contract, broadly useful across extensions."

### 9.15 Uploading files from the browser

Nexus exposes an upload endpoint at `POST /api/v1/uploads/ext/:slug` that handles browser-driven file uploads for your extension. Use it when your UI needs to accept files from users — screenshots, attachments, exports, anything originating in the browser rather than something your Elixir code generates. Files uploaded this way land in the same directory tree `Nexus.Extensions.Storage` (§8.11) reads from, so the two paths integrate cleanly.

The endpoint exists so each extension doesn't have to reimplement multipart parsing, MIME validation, image processing, and storage management. It also unifies what admins see: extension uploads appear in **Admin → uploads** alongside core uploads, with the same listing, filtering, and delete controls.

#### The endpoint

```
POST /api/v1/uploads/ext/:slug
```

`:slug` in the path is your extension's slug. The endpoint requires authentication and a verified email address — Nexus's `:verified` pipeline. Anonymous users and members with unverified emails get a 403.

The request is multipart/form-data with these fields:

| Field          | Required | Purpose                                                                              |
|----------------|----------|--------------------------------------------------------------------------------------|
| `file`         | yes      | The file blob (a `File` object from an `<input type="file">` element, typically).    |
| `type`         | yes      | `"extension_image"` or `"extension_file"`. See the two modes below.                  |
| `record_id`    | no       | Opaque string identifying which record in your extension's own DB the file belongs to. See "Linking uploads to your records" below. |
| `allowed_mime` | no       | For `extension_file` only. Comma-separated list of MIME types you accept — a subset of the host's permitted list (see below). Lets your endpoint narrow accepted types beyond the default. |

#### The two modes

**`extension_image`** — for images shown in your UI.

The endpoint validates that the uploaded file is one of: `image/jpeg`, `image/png`, `image/gif`, `image/webp`. SVG is deliberately excluded (XSS risk when served from `/uploads`). The host then auto-resizes the image to a maximum width (default 1200 px) and converts it to webp, returning URLs for both the optimized webp and the original.

**`extension_file`** — for non-image files.

The endpoint accepts any of the host's permitted raw MIME types, which deliberately exclude executables, scripts, and anything a browser could be coerced into executing. The permitted list as of this writing:

- Video: `video/mp4`, `video/webm`, `video/ogg`, `video/quicktime`
- Audio: `audio/mpeg`, `audio/ogg`, `audio/wav`, `audio/webm`, `audio/flac`
- Documents: `application/pdf`, `application/zip`, `application/x-zip-compressed`
- Text: `text/plain`, `text/csv`, `text/markdown`, `application/json`
- Office: `.docx`, `.xlsx`, `.pptx` (the Office Open XML MIME types)

No image processing happens for `extension_file` — the file is stored as-is. Pass `allowed_mime` to narrow the accepted set if you want stricter validation than the host default (e.g., your extension only accepts PDFs).

#### Response shape

On success, the endpoint returns 200 with:

```json
{
  "upload": {
    "id":                  "...",
    "upload_type":         "extension_image",
    "original_name":       "screenshot.png",
    "mime_type":           "image/png",
    "size_bytes":          12345,
    "width":               1200,
    "height":              800,
    "url":                 "/uploads/extensions/your-slug/your-slug_uuid.webp",
    "original_url":        "/uploads/extensions/your-slug/your-slug_uuid.png",
    "extension_slug":      "your-slug",
    "extension_record_id": null,
    "user":                { "id": "...", "username": "alice" },
    "inserted_at":         "2026-05-24T15:00:00Z"
  },
  "url":          "/uploads/extensions/your-slug/your-slug_uuid.webp",
  "original_url": "/uploads/extensions/your-slug/your-slug_uuid.png"
}
```

The `url` field at the top level is what you'll typically use — the optimized webp for images, the original for non-images. `original_url` is always the unmodified original, useful when you want a lightbox-resolution version of an image while displaying a smaller thumbnail.

Errors return non-2xx with `{ "error": "..." }`:

- 400 — no file provided, or `type` is invalid
- 403 — not authenticated, email not verified, or trying to upload a core admin-only type
- 422 — file failed validation (size, MIME, image processing) — the message describes which

#### JS example: image upload

The recommended path is `window.NexusExtensions.uploadFile`, which handles auth, JWT refresh, and FormData construction for you:

```javascript
async function uploadScreenshot(file) {
  const { url, original_url, upload, error } =
    await window.NexusExtensions.uploadFile(file, {
      slug: SLUG,
      type: "extension_image",
    });

  if (error) throw new Error(error);
  return { url, original_url, upload };
}
```

`uploadFile` returns a promise resolving to `{ upload, url, original_url }` on success or `{ error }` on failure. It auto-refreshes expired JWTs and retries once.

#### JS example: file upload with MIME restriction

```javascript
async function uploadResume(file) {
  return await window.NexusExtensions.uploadFile(file, {
    slug:        SLUG,
    type:        "extension_file",
    allowedMime: ["application/pdf"],  // narrow to a single type
  });
}
```

`allowedMime` is an array on the JS side; the helper joins it into the comma-separated `allowed_mime` form-field the endpoint expects. The narrowing is validated server-side as a subset of the host's permitted list — you can narrow, but you cannot grant your extension MIME types the host hasn't whitelisted.

#### Raw fetch — when you need full control

The `uploadFile` helper covers the typical cases. If you need to inspect the raw response, customize headers, track upload progress, or do anything else the helper doesn't expose, fall back to raw `fetch` with `FormData`:

```javascript
const token = localStorage.getItem("nexus_token");

const body = new FormData();
body.append("file", file);
body.append("type", "extension_image");

const r = await fetch(`/api/v1/uploads/ext/${SLUG}`, {
  method:  "POST",
  headers: { "authorization": `Bearer ${token}` },
  body,
});
```

**Do not set the `Content-Type` header manually.** When the body is a `FormData`, the browser sets it for you with the correct multipart boundary. Setting it yourself will break the request.

#### Linking uploads to your records

The `record_id` field is a free-form string the host stores alongside the upload row. The host doesn't interpret it — it's there for your extension to link uploads back to records in your own database.

The typical pattern is: an extension defines its own schema with a UUID primary key, the user creates a record, then uploads files against that record's id. Later, when rendering the record, you list its uploads by `record_id`:

```javascript
// Step 1 — create your record by calling your own API
const r = await fetch(`/ext/${SLUG}/api/screenshots`, {
  method:  "POST",
  headers: {
    "content-type":  "application/json",
    "authorization": `Bearer ${localStorage.getItem("nexus_token")}`,
  },
  body: JSON.stringify({ title: "My screenshot" }),
});
const { id: recordId } = await r.json();

// Step 2 — upload the image, linking it to the record
await window.NexusExtensions.uploadFile(file, {
  slug:     SLUG,
  type:     "extension_image",
  recordId: recordId,
});
```

Server-side, list a record's uploads with `Nexus.Uploads.list_extension_uploads/2`:

```elixir
uploads = Nexus.Uploads.list_extension_uploads("your-slug", record_id: record_id)
# Each upload has .url, .original_url, .mime_type, .width, .height, etc.
```

For records that own a single file, use the `record_id` as a logical "the file for this record." For records that own a gallery, link multiple uploads to the same `record_id` and order them however you like. The host doesn't care — `record_id` is purely your application's contract.

#### Storage path and the Storage helper

Uploaded files are stored at `/app/uploads/extensions/<slug>/<slug>_<uuid>.<ext>` on disk and served at `/uploads/extensions/<slug>/<slug>_<uuid>.<ext>`. This is the **same directory tree** `Nexus.Extensions.Storage` (§8.11) reads from. That means:

- `Storage.list_files("your-slug")` returns the uploaded filenames alongside any files you wrote with `Storage.path/2`.
- `Storage.url("your-slug", "filename")` produces a URL that resolves to the upload.
- `Storage.delete_all("your-slug")` deletes files from both sources at once.

The two paths are complementary: the upload endpoint is what your bundle calls from the browser; `Storage` is what your Elixir code uses to write files server-side. They share storage.

#### Lifecycle

- **On uninstall**, the host automatically calls `Nexus.Uploads.delete_extension_uploads/1` for your slug, deleting every upload row and its associated file. You don't need to clean up in `on_uninstall/0`.
- **On boot**, uploaded files persist — they live in the bind-mounted `/app/uploads` directory, not inside the container or build dir. Restarts don't touch them.

#### Limits

- **Size**: 5 MB per file by default. Admins can raise this in **Admin → Uploads → max_size_mb**.
- **MIME types**: as listed above. The whitelist is host-controlled; the host's policy is "no SVG, no executables, no scripts, no HTML." If you need a type that isn't on the list, raise it as a discussion — the bar is "safe to serve from a CDN."
- **Per-request**: one file per upload request. Use multiple requests in parallel if you need to upload several files.

### 9.16 `registerFollowingTab`

Adds a tab to the **Following** feed page (`/following`). The page's built-in "Posts" tab is always first and can't be replaced; extensions append additional tabs to the right. Use this surface to give users an extension-specific feed of content from accounts they follow — for example, a gallery extension might add a "Photos" tab showing recent images from followed users.

```javascript
function GalleryFollowingFeed({ currentUser }) {
  // Your component fetches its own data and renders its own feed.
  // currentUser is the logged-in viewer; this tab only appears for
  // authenticated users since the Following page itself requires login.
  return React.createElement("div", null, /* … */);
}

NE.registerFollowingTab({
  key:       "gallery-following",
  label:     "Photos",
  component: GalleryFollowingFeed,
});
```

#### Signature

```javascript
NE.registerFollowingTab({ key, label, component })
```

| Parameter   | Required | Purpose                                                                       |
|-------------|----------|-------------------------------------------------------------------------------|
| `key`       | yes      | Unique tab identifier across all extensions. No spaces. Used as the React key.|
| `label`     | yes      | Shown in the tab bar.                                                          |
| `component` | yes      | React component rendered as the tab's content. Receives `{ currentUser }`.    |

There's no manifest declaration for this surface — registration is JS-only. Registering twice with the same `key` produces a console warning and the second call is dropped.

#### Props the component receives

```javascript
function MyFollowingTab({ currentUser }) { /* ... */ }
```

| Prop           | Contents                                                          |
|----------------|-------------------------------------------------------------------|
| `currentUser`  | The viewer's user object. Always present — the Following page requires login. |

The component is fully responsible for fetching its own data (call your `/ext/<slug>/api/...` endpoints), rendering its own feed, and handling its own pagination. The host provides the tab bar and the active-tab routing; everything else is yours.

#### When the tab bar appears

The Following page only renders a tab bar if at least one extension has registered a Following tab. With zero registered tabs, the page renders exactly as it did before — no tab bar, the Posts feed fills the page. This means installing a non-Following extension doesn't change the Following page's appearance at all.

### 9.17 `registerModerationSection`

Adds extension content to **both** the forum-side ModerationPage (`/moderation`, visible to moderators and admins) **and** the admin-side AdminModerationPanel (under **Admin → Moderation**). A single registration call mounts your content in both places; your component receives a `context` prop telling it which one it's currently rendering in.

Use this surface when your extension owns content that needs moderator review — gallery image approvals, custom report queues, or anything else that fits the "queue of items awaiting moderator action" pattern.

```javascript
function GalleryApprovalsQueue({ currentUser, context }) {
  // context is "moderator" (forum-side panel) or "admin" (admin panel).
  // Fetch and render your queue.
  return React.createElement("div", null, /* … */);
}

function GalleryReportsQueue({ currentUser, context }) {
  return React.createElement("div", null, /* … */);
}

NE.registerModerationSection({
  slug:     SLUG,
  label:    "Gallery",
  logo_url: "/uploads/extensions/gallery/logo.png",
  approvals: {
    badge:     () => pendingApprovalCount(),
    component: GalleryApprovalsQueue,
  },
  reports: {
    badge:     () => pendingReportCount(),
    component: GalleryReportsQueue,
  },
});
```

#### Signature

```javascript
NE.registerModerationSection({ slug, label, logo_url, approvals, reports })
```

| Parameter   | Required        | Purpose                                                                          |
|-------------|-----------------|----------------------------------------------------------------------------------|
| `slug`      | yes             | Your extension's slug.                                                            |
| `label`     | yes             | Section header text shown in both panels (e.g. "Gallery").                        |
| `logo_url`  | no              | Optional logo URL shown next to the label.                                        |
| `approvals` | one of these    | `{ badge, component }` for the Approvals tab.                                     |
| `reports`   | one of these    | `{ badge, component }` for the Reports tab.                                       |

At least one of `approvals` or `reports` must be provided. You can provide both; omitting one means your extension won't appear in that tab.

#### The `approvals` and `reports` objects

```javascript
{
  badge:     () => 7,                  // function returning the current count
  component: ReactComponent,           // React component for the tab content
}
```

`badge` is called by the host to display a count beside your extension's section header in the tab — e.g., "Gallery (7)" if there are 7 pending items. The function is called each time the page rerenders; cache the count in module state if computing it is expensive. Return 0 to suppress the badge.

#### Props the component receives

```javascript
function MyModerationQueue({ currentUser, context }) { /* ... */ }
```

| Prop           | Contents                                                                                     |
|----------------|----------------------------------------------------------------------------------------------|
| `currentUser`  | The viewer's user object. Moderators or admins — the page is gated behind those tiers.       |
| `context`      | `"moderator"` when mounted in the forum-side ModerationPage; `"admin"` when in AdminModerationPanel. |

Use `context` to show different controls in the two locations — for example, the admin panel might expose bulk actions (clear all, export to CSV) that the forum-side panel doesn't.

#### When the tabs appear

The "Extension Approvals" and "Extension Reports" tabs are hidden in both panels when no extensions have registered for them. With zero registered moderation sections, the moderation page looks exactly as it does today — extension-aware moderation has no visual footprint on installs that don't use it.

#### Where to enforce moderator-only actions

These components are mounted on pages already gated to moderators and admins; you don't need to re-check the viewer's role in your component. However, any HTTP actions your component triggers (approving an item, dismissing a report, etc.) must enforce permissions server-side in your own Plug router using `Permissions.check/3` (§8.13). Client-side mounting is a UI affordance, not access control.


---

## 10. Install, update, uninstall

This section describes what an admin sees when they install, update, or uninstall your extension — and what each `load_status` state means when something goes wrong. Most of the mechanics (callbacks, return values, cleanup ordering) live in §8.4–§8.5; this section is the admin's-eye view. If your extension is misbehaving in a Nexus install, the load_status reference here is the first place to look.

### 10.1 Install

The admin installs your extension by entering a **manifest URL** in **Admin → Extensions → Install from URL** — a URL pointing to a publicly-accessible `manifest.json` in your repo (typically `https://raw.githubusercontent.com/<user>/<repo>/main/manifest.json`).

#### What Nexus does

1. **Fetches the manifest.** A `Req.get/1` to the manifest URL. Nexus parses the JSON and validates it against the schema. If validation fails, the install aborts at this stage with the validator's specific error messages.
2. **Derives the GitHub repo.** From the manifest URL or the manifest's `repository` field, Nexus extracts `<user>/<repo>`. Without this, there's no tarball to download.
3. **Fetches the latest GitHub release.** Calls the GitHub API to find your repo's latest release. The release tag (stripped of any leading `v`) becomes the `installed_version`.
4. **Creates the DB row.** A row in `extensions` is inserted with the manifest contents, version, and `load_status: "not_loaded"`.
5. **Runs the loader pipeline.** Downloads the release tarball, compiles, migrates, registers (see §10.2). On success, calls your `on_install/1`. On failure, sets the appropriate load_status (see §10.4).

The DB row is created **before** the loader runs. If the loader fails, the DB row persists with a failure load_status — the admin sees the extension in the list with a red status pill and can retry without re-entering the URL.

#### The loader pipeline

When the loader runs against a downloaded tarball, it executes a series of steps in order. Each step is tagged with a failure code so the resulting load_status names the specific failure:

| Step              | Failure load_status   | What happens                                                                       |
|-------------------|-----------------------|------------------------------------------------------------------------------------|
| Download          | `download_failed`     | Pulls the release tarball from GitHub. Network errors, 404s, and timeouts land here. |
| Manifest validate | `manifest_invalid`    | Reads `manifest.json` from the extracted tarball and re-validates. Should match step 1 of the install flow, but caught again in case the release's manifest differs from the URL-fetched one. |
| Compile           | `compile_failed`      | Compiles every `.ex` file via `Code.compile_file/2`. Syntax errors, missing dependencies, undefined modules — all land here. |
| Find module       | `manifest_invalid`    | Finds the module the manifest's `module` field declared. If the compiled output doesn't include a module matching that name, the manifest's declaration is wrong. |
| Check exports     | `manifest_invalid`    | Verifies the declared module exports every callback the manifest's fields require — `handle_event/3` if hooks are declared, `handle_digest_section/3` if digest_sections are declared, etc. |
| Migrations        | `migration_failed`    | Runs each module returned by `migrations/0` in order. Migration errors land here. |
| Assets            | `compile_failed`      | Copies `priv/static/*` to the extension's served-assets directory. |
| Supervisor        | `compile_failed`      | Starts your `child_specs/0` children under the extension's supervisor. A crashing `child_specs/0` callback or a child that fails to start lands here. |
| Registry          | `compile_failed`      | Inserts your hooks, slots, routes, digest sections, etc., into the in-memory ETS registry. Should never fail in practice. |

Once every step above passes, Nexus calls your `on_install/1` callback. If it returns `:ok` or `{:ok, _}`, the load_status becomes `"loaded"`. If it returns `{:error, reason}` or raises, the load_status becomes `"install_failed"` with the reason as the message — the extension is loaded (registry populated, migrations done) but flagged as having a broken init.

#### When the admin sees an immediate error

Three failure modes happen **before** the loader runs and produce specific load_status values:

- `no_repo`: the manifest URL didn't resolve to a `<user>/<repo>` pair. Most often this means the URL is something other than a `raw.githubusercontent.com` URL (or another supported format) and the manifest doesn't have a `repository` field.
- `no_release`: the repo exists but has no published GitHub release. Push a release (Releases → Draft a new release) and retry.
- `manifest_invalid`: the manifest fetched at step 1 didn't pass validation. The specific schema errors are surfaced in the load_error field shown in the admin panel.

#### Retrying a failed install

Failed installs leave the DB row in place. The admin retries by toggling the extension off and back on — the toggle's enable path goes back through the loader, picking up any fixes you've pushed to the GitHub release.

For some failures (manifest_invalid, no_repo), you need to fix the cause first. For transient failures (download_failed when GitHub had an outage), the retry alone is enough.

### 10.2 Update

The admin updates your extension by clicking **Update** in the admin extensions list. The button appears when Nexus's periodic latest-release check has detected a newer release tag than `installed_version`.

#### What Nexus does

1. **Fetches the new release's manifest.** A GitHub API call to read `manifest.json` at the release tag — not the default branch. The version your release ships is what's validated.
2. **Updates the DB row.** Writes the new manifest, version, release notes, and bundle URL.
3. **Runs `Loader.reload/4`.** Stops the old extension's supervisor, unloads the old module, downloads the new tarball, runs the full loader pipeline against it. Same failure semantics as install — a failure here sets the load_status accordingly.
4. **Calls `on_update/2`.** With `(old_version, new_version)`. Runs in a `Task.start` so the admin's request doesn't block on slow callbacks. Failures from `on_update/2` set load_status to `"update_failed"` after the fact — the extension stays loaded, but the admin sees the update wasn't clean.

If the loader pipeline fails during update, the old version is already unloaded by then. The admin sees a failure load_status and has no running extension until the failure is fixed or they roll back manually.

#### What you don't control

Two update behaviours are deliberately host-controlled rather than extension-controlled:

- **You can't skip versions.** An update always goes from `installed_version` to the latest release. If a user is on 1.0 and the latest release is 3.0, the loader compiles and migrates straight to 3.0 — your 2.0 migrations run as part of the migration step, but only your `on_update/2` for the 1.0 → 3.0 jump is called, with `("1.0.0", "3.0.0")` as args.
- **You can't refuse an update.** `on_update/2` runs after the new code is already loaded. Returning `{:error, _}` flags the update as failed but doesn't roll back. If you need to refuse an update under some condition, that gate has to be your migrations — fail in a migration and the install pipeline aborts before `on_update/2` runs.

### 10.3 Uninstall

The admin uninstalls your extension by clicking **Uninstall** in the admin extensions list. The button always works — uninstalls don't fail in a way that blocks removal.

#### What Nexus does

1. **Calls `on_uninstall/0`.** Your last chance to clean up external resources. Errors are captured as warnings (the admin sees them in the uninstall response) but don't block the uninstall.
2. **Cancels Oban jobs.** Any pending Oban jobs whose worker module starts with your extension's root module name are deleted from the queue. Jobs already executing run to completion (see §8.7). Jobs in `available`, `scheduled`, or `retryable` states are dropped.
3. **Rolls back migrations.** Each module returned by `migrations/0` is rolled back in reverse order. Rollback failures log but don't block.
4. **Unloads the module.** The extension's compiled module is purged from the VM and its supervisor is stopped.
5. **Deletes file storage and cached tarballs.** `/app/uploads/extensions/<slug>/` is removed (anything in `Nexus.Extensions.Storage` for your slug, plus any browser-uploaded files). The tarball cache at `/app/uploads/extensions/.cache/<slug>/` is also removed.
6. **Removes the DB row.** The `extensions` row is deleted.
7. **Cleans up layout config.** Layout settings that referenced your slug (explore items, right widgets, toolbar entries the admin had reordered) are removed from the saved layout.

Once uninstall completes, the only thing that remains is your data in DB tables your migrations didn't drop. If your `change/0` migrations only used `create table`, the rollback drops them automatically; if you used non-reversible operations and the rollback failed, your tables persist (you can drop them manually).

#### Cleanup failures don't block

If your `on_uninstall/0` raises, if migrations refuse to roll back, if the storage directory has a permissions issue — none of these stop the uninstall from completing. The DB row is removed, the module is unloaded, and the extension stops appearing in the admin UI. Cleanup gaps surface as warnings in the response.

This is by design — a partially-broken extension shouldn't trap the admin into a state they can't escape.

#### Force-uninstall — the escape hatch

If a normal uninstall fails outright (the request returns 500, the extension's DB row gets stuck in a non-removable state), the admin can trigger a **force-uninstall** from the overflow menu on the per-extension page. Force-uninstall is more aggressive:

- **Skips `on_uninstall/0`** — the callback doesn't run.
- **Skips migration rollback** — your tables stay in the database. The admin must drop them manually if they want the schema cleaned up.
- Still cleans up the supervisor, Oban jobs, storage, uploads, the tarball cache, the DB row, and layout config — best-effort each, with warnings on failure.

Force-uninstall is for the situation where the extension's code is broken enough that running it during uninstall would itself fail. The trade-off is that tables persist on purpose — surviving the uninstall lets the admin manually inspect or recover data before dropping.

### 10.4 Load status reference

The full set of load_status values, what they mean, and how to recover:

| `load_status`        | Meaning                                                                                | Recovery                                                                       |
|----------------------|----------------------------------------------------------------------------------------|--------------------------------------------------------------------------------|
| `loaded`             | Everything is running. Hooks dispatch, registrations are live.                          | No action needed.                                                              |
| `not_loaded`         | DB row exists but the loader has not been run. Mostly a transitional state.            | Toggle enable to trigger a load.                                               |
| `disabled`           | Admin has disabled the extension. Modules stay loaded; dispatch is filtered out.       | Toggle enable to re-activate.                                                  |
| `manifest_invalid`   | `manifest.json` failed schema validation or its `module` declaration doesn't match the compiled output. | Fix the manifest, push a new release, toggle enable to reload.   |
| `compile_failed`     | One of the `.ex` files in your release didn't compile. Or static assets failed to copy, or `child_specs/0` raised, or the registry insert failed. | Fix the underlying error, push a new release, toggle enable to retry. |
| `migration_failed`   | A migration raised during install or update. Often caused by a previous migration being silently skipped due to a version-integer collision (see §8.5). | Fix the migration. Check for `undefined_table` errors — those indicate a silent skip earlier in the list. May require manual cleanup of partially-applied changes. |
| `download_failed`    | The release tarball couldn't be downloaded. Network error, 404, or timeout.            | Check the release exists, retry. Transient — usually resolves on retry.       |
| `install_failed`     | `on_install/1` returned `{:error, reason}` or raised. The extension is otherwise loaded. | Fix the init code, push a new release, retry. Or — if `on_install` was the only issue — uninstall and reinstall. |
| `update_failed`      | `on_update/2` returned non-ok or raised. The new version is loaded but its init didn't complete cleanly. | Fix `on_update/2`, push a new release, click Update again.                |
| `no_release`         | The repo exists but has no published GitHub releases.                                   | Publish a release tag.                                                          |
| `no_repo`            | The manifest URL didn't yield a `<user>/<repo>` pair, and `repository` wasn't in the manifest. | Use a URL Nexus can parse (raw.githubusercontent.com is the canonical form), or add a `repository` field to the manifest. |

In every failure state, the `load_error` column holds a human-readable message describing the specific cause. This is what the admin sees in the per-extension page under "Status."

### 10.5 Boot and reload

When Nexus restarts — a deployment, a server reboot, a `mix phx.server` cycle in development — every enabled extension is reloaded. This shares most of its code with the install pipeline (§10.1), but with an important optimization: **a tarball cache means most boots don't hit GitHub at all.**

#### The tarball cache

Every successful download is cached to `<uploads_dir>/extensions/.cache/<slug>/<version>/release.tar.gz`. The cache lives in the bind-mounted uploads directory, so it survives container rebuilds. On boot, when the loader is told to load `<slug>` at `<installed_version>` and finds the cached tarball, it skips the download step entirely and extracts the cached file.

This means the boot path is:

- **Fresh install** → GitHub download → cache → compile → migrate → register.
- **Subsequent boots** → cache hit → extract → compile → migrate → register. No network.
- **Update** → GitHub download for the new version → cache → compile → migrate → register. The old version's cache entry is then pruned.

GitHub is involved only at install time and update time. Routine restarts are network-free.

#### What runs on every boot

For every enabled extension, Nexus:

1. Locates the release tarball — cache hit, or download if missing.
2. Validates the manifest from the extracted tarball.
3. Compiles every `.ex` file.
4. Runs `migrations/0`. **Already-applied versions no-op via `schema_migrations`** — Ecto's idempotency makes this safe. The exception is the silent-skip bug from §8.5: if a previous boot wrote a version row before a later migration failed, the later migration will keep getting skipped on every boot.
5. Copies bundled assets.
6. Calls `child_specs/0` and starts the resulting children under your extension's supervisor.
7. Registers your hooks, slots, routes, etc., into the in-memory registry.

#### What does *not* run on boot

The lifecycle callbacks tied to discrete events are **not** invoked on boot:

| Callback        | Runs on              | Does NOT run on            |
|-----------------|----------------------|-----------------------------|
| `on_install/1`  | First install only.  | Boot. Update. Re-enabling. |
| `on_update/2`   | Updates only.        | Boot. Install. Re-enabling. |
| `on_uninstall/0`| Uninstall only.      | Boot. Disabling.           |

If your extension needs initialization work that runs on every boot (warming a cache, opening an external connection, scheduling a recurring job), put it in `child_specs/0`. Those processes start on every boot, and the BEAM supervises them for you. Don't put boot-time work in `on_install/1` — it'll only run once, ever.

#### Practical consequences

- **Most boots are fast and offline.** Compile and migrate are still required on every boot, but the network round-trip is gone for cached versions. Cold restarts are dominated by compile time, which is roughly seconds per extension.
- **GitHub matters at install and update — not at boot.** If GitHub is unreachable during a routine restart, your already-installed extensions still load from cache. GitHub becomes load-bearing again only when an admin installs something new or runs an update.
- **The first boot of a never-cached version goes to GitHub.** This applies to fresh installs and to extensions that were installed before the caching system existed (and so don't have a cache entry yet). After the first successful boot, subsequent restarts are offline.
- **In-memory state in child processes is reset.** Anything your `child_specs/0` children kept in their state (caches, counters, in-flight work) is gone after a restart. Persist anything that needs to survive a boot to the database or the filesystem.
- **Compiled module state is reset.** Module attributes initialized at compile time get re-initialized. Process dictionaries are gone. This is standard OTP behavior, but worth noting if you were relying on module-level memoization.
- **Disabled extensions don't load.** `load_all_enabled` filters by the `enabled` flag on the DB row. A disabled extension is skipped entirely on boot — modules don't compile, migrations don't replay (which means no silent-skip risk from disabled extensions), children don't start. Re-enabling triggers a fresh load.
- **Boot failures use the same `load_status` values as install failures.** If compile fails on boot, you see `compile_failed`. If a child crashes during startup, you see `compile_failed` (the supervisor step is grouped with compile in the load_status mapping — see §10.4). The admin's recovery path is the same: toggle off and on, or fix the underlying issue and let the next boot try again.

#### Design implications for extension authors

Two patterns to internalize:

**Idempotency.** Anything that runs in `migrations/0`, `child_specs/0`, or your registered children's startup should be safe to run again. Migrations get this for free via Ecto. Children should expect their state to be empty on startup and rebuild from persisted sources. If you create files at child startup, check whether they exist first.

**`on_install/1` is for one-time setup.** Seeding initial data, generating an API token, sending a welcome email — these belong in `on_install/1` precisely because they should happen exactly once. Don't try to make `on_install/1` boot-safe; that's not what it's for.


---

## 11. The admin panel

This section walks through what an admin sees in **Admin → Extensions** — the list page, the per-extension page, the runtime registrations panel — and what each control does. As an extension developer, this is also your primary diagnostic surface: if your extension is misbehaving, the runtime panel tells you exactly what Nexus thinks your extension declared and what it sees registered.

### 11.1 The extensions list

The list page (**Admin → Extensions**) shows every installed extension as a card. Each card displays:

- **Name and version**.
- **Status pill** — a coloured indicator showing the extension's `load_status`. Green for `loaded`, amber for warning states (`install_failed`, `update_failed`, `not_loaded`), red for hard failures (`compile_failed`, `migration_failed`, `manifest_invalid`, etc.), muted grey for `disabled`. The pill text is the human-readable label from `LOAD_STATUS_INFO` in the admin code — `"Loaded"`, `"Install hook failed"`, `"Migration failed"`, etc.
- **Description and author**, pulled from your manifest.
- **Action buttons** — Install Updates (visible when a newer version is available), Manage (opens the per-extension page).

Above the list, an **Install from URL** action accepts a manifest URL and runs the install flow described in §10.1.

The list is the home page for extension management. Admins typically arrive here to install something new, check whether anything is in a failure state, or click through to an extension's settings.

![The smoke test's card on the extensions list. The "Loaded" pill in the top-right shows the load_status; the GitHub and Readme buttons link to the manifest's repository and homepage fields; the Manage button opens the per-extension page.](images/extensions-list-card.png)

### 11.2 The per-extension page

Clicking **Manage** on a card (or the sidebar entry that the `admin_panel` surface creates — see §7.3) opens the per-extension page. Its sections, top to bottom:

1. **Identity strip** — name, version, status pill, enable/disable toggle, and the `…` overflow menu. The overflow menu holds the rare actions: View repo, View homepage, Sync from GitHub, and **Uninstall**. Toggling enable triggers the runtime transition described in §10.4.
2. **Status banner** — visible only when the extension is in a non-`loaded` state. Shows the load_status label, the recovery hint, and the `load_error` message.
3. **Your registered admin panel** — the component you bound via `registerAdminPanel` (§7.3, §9.4), if you registered one. Omitted entirely otherwise.
4. **Settings (fallback form)** — rendered inline below your panel **whenever your `settings_schema` has any keys**, regardless of whether you registered an admin panel. This is the auto-generated form from §5. Saves to `PATCH /admin/extensions/<slug>/settings`.
5. **Advanced** — a collapsed section. Expanding it reveals only the **Runtime registrations** panel (§11.3). No other controls live here.

**Concretely on the fallback form:** if your registered admin panel already renders forms for keys that exist in `settings_schema`, those forms appear twice — once in your panel, once in the auto-rendered fallback below. To opt out, either drop the duplicated keys from `settings_schema` (the host has no form to render then), or render only non-settings content in your panel (status displays, documentation, custom controls). See §5's "Settings UI: pick one" callout for the architectural choice.

The topbar Save Changes button is shared between every admin page. When you're on an extension's per-extension page, it shows the dirty/clean state of whichever form is mounted — the fallback form, or your panel if it's wired to `window._nexusAdminSaveFn`. There's only one Save button, and it always commits whatever's mounted.

![The full admin page context with the smoke test entry visible in the left sidebar under "Installed extensions" — a direct shortcut to the per-extension page. Built-in admin sections (overview, layout, email, etc.) sit above; extensions are listed at the bottom.](images/admin-page-sidebar.png)

### 11.3 The runtime registrations panel

This is the most important admin surface for debugging an extension. Expand **Runtime registrations** at the bottom of any per-extension page and you see Nexus's current view of what your extension declared and what it has registered.

![The smoke test's runtime registrations panel — fully expanded and fully matched. Every kind the manifest declares (hooks, slots, routes, right_widgets, toolbar_buttons, profile_tabs, side_data, digest_sections, notification_types, admin_panel, explore) appears in both the "Declared in manifest" column and the "Registered at runtime" column. Hooks show their declared priority and payload schema. This is what a healthy extension looks like.](images/runtime-panel.png)

The panel has three sub-views:

**Module** — the Elixir module Nexus is using for this extension. If empty, no module is loaded (the extension is disabled or in a hard-failure state).

**Declared vs. registered** — a side-by-side comparison, one row per surface kind your manifest mentioned. Each row has three columns:

| Column                | Contents                                                                                |
|-----------------------|-----------------------------------------------------------------------------------------|
| Kind                  | The surface name (`hooks`, `slots`, `routes`, `right_widgets`, `toolbar_buttons`, `profile_tabs`, `digest_sections`, `notification_types`, `admin_panel`, `explore`, `side_data`). |
| Declared in manifest  | What your `manifest.json` listed for this kind.                                          |
| Registered at runtime | What Nexus currently has wired up — for hooks/digest_sections/side_data this comes from Elixir-side registration; for everything else, from the live JS `window.NexusExtensions` registry. |

Items appearing in both columns match (the declaration and the registration agree). Items in only one column are mismatches:

- **Declared but not registered** — your manifest lists it, but the corresponding `register*` call (for JS-side surfaces) or callback export (for Elixir-side surfaces) didn't happen. The most common cause is a slug typo, a missed `register*` call in your bundle, or a missing callback in your Elixir module. The surface won't function until this is fixed.
- **Registered but not declared** — your bundle called `register*` for something your manifest didn't list. The registration still goes through (the surface works), but it's invisible to the manifest's contract. Same applies for hook handlers your Elixir module exports that aren't in your manifest's `hooks` list.

**Warnings** — a list, only shown when there are entries. Populated by `_validateAgainstManifest` at register-time on the JS side. The same "registered but not declared" cases that show up in the right-only column of the comparison are also surfaced here as a flat warning list with the specific message:

> `registered slots entry "post_footer" but manifest does not declare it. Declared: profile_sidebar`

> `registered routes path "/games/:slug" but manifest does not declare it. Declared: /`

> `registered toolbar_buttons id "smoke-attach-note" but manifest does not declare it. Declared: smoke-button`

These exact strings are what extension authors see when they're hitting the deliberate-mismatch case. They're meant to be self-explanatory; if you see one in your own extension during development, the message tells you both what you registered and what your manifest does declare, so the diff is right there.

The panel does not flag the **manifest declares X but bundle didn't register it** case as a warning — it only shows up as an empty right column in the comparison. The reasoning: the JS side has no way to know whether a missing registration is "broken" or "deferred until a later code path runs." The Warnings list is purely for things the bundle did register, where the diagnostic is unambiguous.

#### Practical usage

When developing an extension:

- After your first install, expand the runtime panel and verify the comparison rows look right.
- Every declared kind should appear in both columns. If something's only in the left column, fix the `register*` call or callback export.
- The Warnings list should be empty for a well-formed extension. Each warning is a manifest/bundle sync issue you should fix before releasing.
- On manifest changes, re-release and reinstall (or update). The panel re-reads on every expand so your edits are reflected immediately.

#### A deliberate-mismatch example

To see what a mismatch looks like in practice, you can deliberately desynchronize your manifest and bundle:

1. In your bundle, add a `registerSlot` call for a slot your manifest doesn't list:
   ```javascript
   NE.registerSlot({ slug: SLUG, slot: "profile_sidebar", component: SomeComponent });
   ```
2. Make sure `profile_sidebar` is **not** in your manifest's `slots` array.
3. Reinstall, then open the runtime panel.

The `slots` row in the comparison will show `profile_sidebar` only in the Registered column. The Warnings list will show a corresponding line:

> `registered slots entry "profile_sidebar" but manifest does not declare it. Declared: post_footer`

Removing the offending `registerSlot` call (or adding `profile_sidebar` to your manifest's `slots` array) and reinstalling makes the warning disappear. This is the loop to follow whenever the panel shows a mismatch in your own extension.


---

## 12. Appendices

Quick-lookup references for fields you'll consult repeatedly while working on an extension.

### Appendix A — Hook events

The 11 events Nexus dispatches. Declare them in your manifest's `hooks` field (§6.1); handle them in `handle_event/3` (§8.3).

| Event              | Payload keys                              | Notes                                                                          |
|--------------------|-------------------------------------------|--------------------------------------------------------------------------------|
| `post_created`     | `user_id`, `post_id`                      | Actor is the post creator.                                                      |
| `post_updated`     | `user_id`, `post_id`                      | Actor is the editor — may be a moderator, not the original author.              |
| `post_deleted`     | `user_id`, `post_id`                      | Actor is the deleter. Post is already removed from the DB.                      |
| `reply_created`    | `user_id`, `reply_id`, `post_id`          | `post_id` is the parent post being replied to.                                  |
| `reply_deleted`    | `user_id`, `reply_id`, `post_id`          | Clean up linked rows here.                                                       |
| `reaction_added`   | `user_id`, `emoji`, `post_id`, `reply_id` | Exactly one of `post_id`/`reply_id` is non-nil.                                  |
| `reaction_removed` | `user_id`, `emoji`, `post_id`, `reply_id` | Mirror of `reaction_added`.                                                      |
| `report_created`   | `user_id`, `report_id`                    | Actor is the reporter.                                                          |
| `report_resolved`  | `user_id`, `report_id`, `status`          | Actor is the moderator. Status: `"reviewed"`, `"dismissed"`, or `"actioned"`.   |
| `user_registered`  | `user_id`                                 | `user_id` IS the new user.                                                       |
| `user_login`       | `user_id`                                 | `user_id` IS the user logging in.                                                |

Full payload semantics and dispatch behaviour are in §8.3.

### Appendix B — Slots

Every slot Nexus exposes, with the props its component receives. Declare them in your manifest's `slots` field (§7.1); register components with `registerSlot` (§9.2).

| Slot              | Props                          | Where it renders                                                                |
|-------------------|--------------------------------|---------------------------------------------------------------------------------|
| `post_footer`     | `{ post_id }`                  | Bottom of `/post/:id` pages, below the post body, above the reply thread.        |
| `profile_sidebar` | `{ username, current_user }`   | Left rail of `/profile/:username` pages, above the profile's main content area.  |

The hard-cutoff prop contract is described in §7.1.

### Appendix C — Load status

The complete set of `load_status` values, their admin-facing labels, and recovery paths.

| `load_status`        | Admin label              | Recovery                                                                    |
|----------------------|--------------------------|-----------------------------------------------------------------------------|
| `loaded`             | "Loaded"                 | No action needed.                                                            |
| `not_loaded`         | "Not loaded"             | Toggle enable to trigger a load.                                             |
| `disabled`           | "Disabled"               | Toggle enable to re-activate.                                                |
| `manifest_invalid`   | "Invalid manifest"       | Fix the manifest, push a new release, toggle enable.                         |
| `compile_failed`     | "Compile failed"         | Fix the underlying error, push a new release, toggle enable.                 |
| `migration_failed`   | "Migration failed"       | Fix the migration. May require manual cleanup of partially-applied changes. |
| `download_failed`    | "Download failed"        | Retry — usually transient.                                                   |
| `install_failed`     | "Install hook failed"    | Fix `on_install/1`, push a new release, retry. Or uninstall and reinstall.   |
| `update_failed`      | "Update hook failed"     | Fix `on_update/2`, push a new release, click Update again.                   |
| `no_release`         | "No release"             | Publish a release tag on GitHub.                                              |
| `no_repo`            | "No GitHub repo"         | Use a parseable URL or add `repository` to your manifest.                    |

Full semantics in §10.4.

### Appendix D — Manifest JSON Schema

The manifest's full schema is published at `/manifest_schema.json` on every Nexus host. Reference it from your `manifest.json` with the `$schema` field so editors like VS Code give you autocomplete and inline validation:

```json
{
  "$schema":         "https://your-nexus-host/manifest_schema.json",
  "manifest_version": 2,
  "name":             "Foundation Smoke Test",
  "slug":             "foundation-smoke-test"
}
```

Replace `your-nexus-host` with the host you're developing against — for billyrayfoss.com, the URL is `https://billyrayfoss.com/manifest_schema.json`. The schema is the host's authoritative declaration of every manifest field; if a field appears here that isn't in this guide, the schema is right and the guide will be updated.

### Appendix E — Common errors

A short list of the failure modes extension developers run into most often and what's actually wrong in each case.

**"manifest does not declare it" warnings in the runtime panel**

Your bundle called `register*` for something your manifest didn't list. Either add it to the manifest (the usual fix — every runtime registration should be declared) or remove the `register*` call (if it shouldn't have been there in the first place). See §11.3.

**`load_status: "manifest_invalid"` with "module ... does not implement Nexus.Extensions.Behaviour"**

Your manifest's `module` field points to a module that doesn't have `use Nexus.Extensions.Behaviour`. Add the `use` line at the top of your module (§8.1), or update the manifest's `module` field to the correct module name.

**`load_status: "manifest_invalid"` with "missing required callback ... `handle_event/3`"**

Your manifest declares hooks but your module doesn't export `handle_event/3` (or the equivalent for digest_sections / side_data / etc.). Add the callback to your module. See §8.3 for hooks, §8.8 for digest_sections, §8.9 for persist_attachment.

**`load_status: "compile_failed"` with "undefined function ..."**

Your code references a function or module that doesn't exist in the Nexus VM. Check spelling. If you're using a package, verify it's in the available packages list (§8.12) — extensions can't pull in their own dependencies.

**`load_status: "migration_failed"` with `undefined_table` on a table you just declared**

A previous migration in your `migrations/0` list was silently skipped because its version integer already existed in Postgres's `schema_migrations` table. The skip happens with no error, but a later migration that references the skipped migration's tables blows up with `undefined_table`. The fix: your migration module names must produce version integers that don't collide with Nexus core or other installed extensions. Use the `V<YYYYMMDDhhmmss>` form with a date that postdates Nexus core's most recent migration. See §8.5 for the safety rules and how to pick safe version integers.

**My settings form appears twice on the admin page**

Your registered admin panel renders fields that also exist in `settings_schema`. The host's fallback form renders all schema keys regardless of what your panel does, so the same fields appear in your panel and again below it. Either drop the duplicated keys from `settings_schema`, or remove the field-rendering code from your panel. See §5's "Settings UI: pick one" callout and §11.2.

**Bundle code runs but settings come back as `nil`**

You're reading settings with atom keys (`settings[:enable_debug_log]`) instead of strings (`settings["enable_debug_log"]`). Settings map keys are always strings. See §8.2.

**Component renders but slot props are undefined**

Slots receive only the props in their contract (§7.1). If your `post_footer` component destructures `{ post_id, current_user }`, `current_user` will be undefined — that slot only provides `post_id`. Use the `profile_sidebar` slot if you need viewer context, or fetch it from your own API.

**Toolbar button click throws "attach is not a function"**

You're destructuring the wrong argument. The onClick handler receives a single context object: `onClick({ attach, currentUser, context })`. See §9.7.

**Workers crash on the next execution after uninstall**

Your Oban workers aren't nested under your extension's root module namespace. Move them under `<YourExtension>.Workers.*` so the uninstall cleanup catches them. See §8.7.

**Notification fires but renders as plain "Someone sent a notification"**

You declared the notification type in your manifest but didn't call `registerNotificationType` in your bundle (or the type key doesn't match). The renderer falls back to a generic message when no JS-side renderer is registered. See §9.10.

**Extension page shows "Extension failed to load"**

Your bundle didn't load (404 on the asset URL, syntax error, etc.) or didn't register a route matching the URL within the 8-second poll window. Check the browser console for the actual error. See §9.3.

**Admin's Save Changes button doesn't enable when fields change**

You're using a fully custom admin panel (not `SimpleSettingsPanel`) and didn't call `window._nexusAdminSetDirty()` from your field handlers, or you didn't register `window._nexusAdminSaveFn`. Switch to `SimpleSettingsPanel` if you can; if you genuinely need custom, see the fully-custom example in §9.4.

