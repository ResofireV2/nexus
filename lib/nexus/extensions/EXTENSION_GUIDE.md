# Nexus Extension Development Guide

## Quick start

```bash
mix nexus.extension.new my-extension --author "Your Name" --description "Does something cool"
cd extensions/my-extension
```

## Extension structure

A Nexus extension is a GitHub repository containing a `manifest.json`, Elixir source code, and an optional JS bundle. Nexus fetches the release tarball, compiles the source into the running VM, runs any migrations, starts any declared processes, and registers hooks/slots/routes/digest sections in its in-memory registry. There is no separate service to deploy and no webhook delivery — extension code runs in-process alongside Nexus core.

```
my-extension/
├── manifest.json           # Identity, branding, settings schema, release pointer
├── lib/
│   └── my_extension.ex     # Module implementing Nexus.Extensions.Behaviour
├── priv/
│   └── static/
│       └── my-extension.js # Optional frontend bundle (compiled, self-contained)
└── README.md
```

## manifest.json

```json
{
  "name":           "My Extension",
  "slug":           "my-extension",
  "version":        "1.0.0",
  "description":    "Does something cool.",
  "author":         "your-github-username",
  "homepage":       "https://github.com/you/my-extension",
  "logo_url":       "https://my-extension.example.com/assets/logo.png",
  "banner_url":     "https://my-extension.example.com/assets/banner.png",
  "categories":     ["games", "integrations"],
  "settings_schema": {
    "api_key": {
      "type":        "string",
      "label":       "API Key",
      "required":    true,
      "secret":      true,
      "placeholder": "sk-..."
    },
    "enabled": {
      "type":    "boolean",
      "label":   "Enable feature",
      "default": true
    }
  },
  "settings_tabs": [
    {
      "key":    "general",
      "label":  "General",
      "icon":   "fa-gear",
      "fields": ["api_key", "enabled"]
    }
  ]
}
```

Hooks and slots are not declared in `manifest.json` in the in-VM model. They are derived from your module: hooks come from your `handle_event/3` callback, slots come from the `:slots` key returned by `manifest/0` in your Elixir module. See [`behaviour.ex`](behaviour.ex) for the full callback contract.

### Branding fields

| Field        | Description                                                              |
|--------------|--------------------------------------------------------------------------|
| `logo_url`   | Square icon shown on the extension card. Recommended 200×200px, PNG/WebP. Displayed at 48×48px with rounded corners. |
| `banner_url` | Wide hero image shown at the top of the extension card. Recommended 800×400px, PNG/WebP/JPEG. Displayed at full card width, 120px tall, `object-fit: cover`. |
| `categories` | Array of category strings shown as tags on the card, e.g. `["games", "integrations"]`. Keep to 1–4 short labels. |
| `readme_url` | Direct URL to a raw README markdown file. If omitted, Nexus automatically derives it from `homepage` for GitHub repos. Only needed if your README lives at a non-standard path. |

Both image URLs must be publicly accessible with no authentication. Host them alongside your JS bundle.

### Settings field types

| Type      | Description                                      |
|-----------|--------------------------------------------------|
| `string`  | Single-line text input (default)                 |
| `boolean` | Toggle switch                                    |
| `select`  | Dropdown — requires `options: [{value, label}]`  |
| `text`    | Multi-line textarea                              |
| `number`  | Numeric input                                    |
| `color`   | Hex color input with color picker                |

Add `"secret": true` to any field that should be masked (API keys, tokens, etc).

---

## Installing an extension

In the Nexus admin panel go to **Forum Settings → Extensions → Install from URL** and paste your GitHub repo URL or a direct link to your `manifest.json`.

---

## Event hooks

When a forum event occurs, Nexus invokes `handle_event/3` on every loaded extension that exports it:

```elixir
def handle_event("post_created", %{post_id: id}, _settings) do
  MyExtension.do_something_with_post(id)
end

def handle_event(_event, _payload, _settings), do: :ok
```

Each call runs in a supervised `Task` — crashes are caught and logged without affecting the caller or other extensions. Return values are ignored.

### Available hook events

| Event             | Payload                              | Fired when                    |
|-------------------|--------------------------------------|-------------------------------|
| `post_created`    | `%{post_id: id}`                     | A post is published           |
| `post_updated`    | `%{post_id: id}`                     | A post is edited              |
| `post_deleted`    | `%{post_id: id}`                     | A post is deleted             |
| `reply_created`   | `%{reply_id: id, post_id: pid}`      | A reply is posted             |
| `user_registered` | `%{user_id: id}`                     | A new user registers          |
| `user_login`      | `%{user_id: id}`                     | A user logs in                |
| `reaction_added`  | `%{emoji: e, user_id: uid, post_id: pid}` | A reaction is added      |
| `report_created`  | `%{report_id: id}`                   | Content is reported           |

The `settings` argument is the extension's stored settings map at the time of dispatch. Do not call `Nexus.Extensions.get_extension_by_slug/1` to fetch them — they are already passed in.

---

## Frontend bundle

Place your compiled bundle at `priv/static/my-extension.js` in your extension repository and tell Nexus where it is by implementing `js_bundle_path/0`:

```elixir
@impl true
def js_bundle_path, do: "my-extension.js"
```

Nexus copies the file into the extension's assets directory at install/update time and serves it at `/ext/<slug>/assets/<file>`. The script tag is injected into the HTML head before React mounts.

The bundle must be a self-contained IIFE — no ES module syntax, no external imports. React is available on `window.React`; do not bundle it.

Minimal bundle structure:

```js
(function () {
  "use strict";

  // All registrations go here.
  // window.React, window.NexusExtensions, and window.NexusExtensionTemplates
  // are all available at this point.

  const React = window.React;

  // ... your components and registrations

})();
```

---

## JS API reference — `window.NexusExtensions`

All registration methods are idempotent — calling them a second time with the same `id`/`slug`/`type` replaces the previous registration.

---

### Slot components

Render React components in named locations throughout the forum UI.

```js
window.NexusExtensions.registerSlot(slotName, Component, priority)
```

| Slot               | Location                         | Props passed to component              |
|--------------------|----------------------------------|----------------------------------------|
| `post_footer`      | Below post content               | `{ postId }`                           |
| `profile_sidebar`  | Below profile stats, above tabs  | `{ username, currentUser, navigate }`  |
| `admin_sidebar`    | Admin panel sidebar area         | none                                   |

**Example:**

```js
function GamelogLink({ username, navigate }) {
  function go(e) {
    e.preventDefault();
    window.NexusExtensions.navigate(`/ext/gamepedia/users/${username}`);
  }
  return React.createElement("a", {
    href: `/ext/gamepedia/users/${username}`,
    onClick: go,
  }, "Gamelog");
}

window.NexusExtensions.registerSlot("profile_sidebar", GamelogLink, 50);
```

---

### SPA routes

Register a full-page route in the Nexus SPA. The URL is handled client-side — Nexus renders your component without a page reload.

All extension routes live under `/ext/<your-slug>/...`. This prefix is owned exclusively by extensions, so your routes can never collide with Nexus core URLs. Nexus prefixes paths automatically — do not include `/ext/` in your path.

```js
window.NexusExtensions.registerRoute(slug, path, Component, options)
```

| Parameter   | Type             | Description                                                          |
|-------------|------------------|----------------------------------------------------------------------|
| `slug`      | string           | Your extension slug (matches `manifest.json`)                        |
| `path`      | string           | Path RELATIVE to your namespace — must start with `/`. Colon-prefixed segments become params (e.g. `"/users/:username"`) |
| `Component` | React component  | Receives `{ navigate, currentUser, ...params }`                      |
| `options`   | object           | `{ title }` — shown in the back-button header                        |

**Example:**

```js
function GamelogPage({ username, currentUser, navigate }) {
  // ...
}

window.NexusExtensions.registerRoute(
  "gamepedia",
  "/users/:username",
  GamelogPage,
  { title: "Gamelog" }
);
// → registered at /ext/gamepedia/users/:username
```

Navigate to a registered route from anywhere in your bundle:

```js
window.NexusExtensions.navigate("/ext/gamepedia/users/alice");
```

`NexusExtensions.navigate(url)` accepts any URL within Nexus — extension routes or core routes. It resolves the URL through the same code path as a hard refresh, so click navigation and hard refresh always produce identical state.

---

### Admin panel

Register an entry in the admin sidebar under the **Installed Extensions** section. Clicking it renders your component in the admin content area.

```js
window.NexusExtensions.registerAdminPanel(slug, { label, icon, component })
```

| Parameter   | Description                                                    |
|-------------|----------------------------------------------------------------|
| `slug`      | Matches your extension slug in `manifest.json`                 |
| `label`     | Label shown in the sidebar nav                                 |
| `icon`      | Font Awesome solid icon class, e.g. `"fa-gamepad"`             |
| `component` | React component rendered in the admin content area             |

Use the pre-built templates from `window.NexusExtensionTemplates` — see below.

**Example:**

```js
const { SimpleSettingsPanel } = window.NexusExtensionTemplates;

window.NexusExtensions.registerAdminPanel("my-extension", {
  label: "My Extension",
  icon:  "fa-gamepad",
  component: () => React.createElement(SimpleSettingsPanel, {
    slug: "my-extension",
    fields: [
      { key: "api_key", label: "API Key", type: "string", secret: true },
      { key: "enabled", label: "Enabled", type: "boolean" },
    ],
  }),
});
```

---

### Admin panel templates — `window.NexusExtensionTemplates`

Two ready-made panel components. Import them at the top of your bundle:

```js
const { SimpleSettingsPanel, TabbedPanel } = window.NexusExtensionTemplates;
```

#### `SimpleSettingsPanel`

Flat list of settings fields with one save flow. Loads current values from the API automatically, tracks dirtiness, and wires itself into the top-bar Save Changes button — when the admin clicks Save, this panel's settings are persisted.

```js
React.createElement(SimpleSettingsPanel, {
  slug:   "my-extension",
  fields: [
    { key: "api_key",  label: "API Key",  type: "string",  secret: true },
    { key: "enabled",  label: "Enabled",  type: "boolean" },
    { key: "timeout",  label: "Timeout",  type: "number",  hint: "In milliseconds" },
  ],
})
```

#### `TabbedPanel`

Uniform tabbed navigation chrome. Use this when your extension is complex enough to benefit from being organised into multiple sections (settings + status, credentials + advanced, etc.).

`TabbedPanel` is pure chrome — it owns the tab bar, the active-tab state, and the styling, and it has no opinion on what lives inside any tab. Each tab supplies a `render` function that returns arbitrary JSX. Drop a `SimpleSettingsPanel` inside a tab to get a settings form wired up to the top-bar Save button, or render any other React content (status displays, action buttons, log viewers, etc.) for tabs that aren't settings forms.

```js
React.createElement(TabbedPanel, {
  tabs: [
    // A settings tab — drop a SimpleSettingsPanel inside the render fn.
    {
      key:    "credentials",
      label:  "Credentials",
      icon:   "fa-key",
      render: () => React.createElement(SimpleSettingsPanel, {
        slug: "my-extension",
        fields: [
          { key: "client_id",     label: "Client ID",     type: "string" },
          { key: "client_secret", label: "Client Secret", type: "string", secret: true },
        ],
      }),
    },

    // A custom tab — render whatever JSX you want.
    {
      key:    "status",
      label:  "Status",
      icon:   "fa-chart-line",
      render: () => React.createElement(MyStatusView, { slug: "my-extension" }),
    },
  ],
})
```

**Tab descriptor:**

| Property | Type      | Description                                                  |
|----------|-----------|--------------------------------------------------------------|
| `key`    | string    | Unique identifier for the tab                                |
| `label`  | string    | Label shown in the tab bar                                   |
| `icon`   | string    | Optional Font Awesome solid class (e.g. `"fa-gear"`)         |
| `render` | function  | Called when the tab is active — returns the tab's React node |

The `render` function is only invoked when its tab is active. Switching tabs unmounts the old content and mounts the new — this is what allows `SimpleSettingsPanel` instances in different tabs to swap their save-fn registration cleanly. A `useEffect` inside a tab will only run when the admin actually visits that tab.

##### How the top-bar Save button behaves with `TabbedPanel`

- A tab containing a `SimpleSettingsPanel` wires up the top-bar Save button automatically when that tab is active.
- A tab containing pure custom content leaves the Save button disabled (nothing dirty, nothing to save). This is the correct UX — the button is meaningful, not always-on.
- Switching tabs swaps the active save fn, so the Save button always saves whichever settings group is currently visible.

#### `SimpleSettingsPanel` field descriptor properties

| Property      | Type    | Description                                             |
|---------------|---------|---------------------------------------------------------|
| `key`         | string  | Settings key — must match `settings_schema` in manifest |
| `label`       | string  | Human-readable label                                    |
| `type`        | string  | `string` \| `boolean` \| `select` \| `text` \| `number` \| `color` |
| `secret`      | boolean | Masks input as password field                           |
| `hint`        | string  | Small helper text shown below the field                 |
| `placeholder` | string  | Input placeholder text                                  |
| `required`    | boolean | Marks field as required                                 |
| `options`     | array   | For `select` type: `[{ value, label }]`                 |

---

### Explore section items

Add a nav item to the Explore section of the left sidebar. Appears in the admin **Layout → Left Sidebar** drag-to-reorder list with an "extension" badge.

```js
window.NexusExtensions.registerExploreItem({
  slug:     "gamepedia",
  label:    "Games",
  icon:     "fa-gamepad",
  path:     "/",            // optional — defaults to "/"
})
// → links to /ext/gamepedia
```

| Parameter  | Type    | Description                                                            |
|------------|---------|------------------------------------------------------------------------|
| `slug`     | string  | Your extension slug. Required.                                         |
| `label`    | string  | Text shown in the sidebar. Required.                                   |
| `icon`     | string  | Font Awesome solid class (e.g. `"fa-gamepad"`)                         |
| `path`     | string  | Path within your extension's namespace. Defaults to `"/"`.             |
| `id`       | string  | Item ID used for layout save/restore. Defaults to `slug`.              |
| `authOnly` | boolean | If `true`, the item is hidden when the visitor is not logged in.       |
| `priority` | number  | Lower priority renders higher in the list. Defaults to `50`.           |

The target path must correspond to a route registered via `registerRoute(slug, path, ...)`. Routes and Explore items can be registered in any order — the URL is resolved at click time.

---

### Right sidebar widgets

Add a widget card to the right sidebar. Appears in the admin **Layout → Right Sidebar** drag-to-reorder list.

```js
function NowPlayingWidget({ navigate, currentUser }) {
  // return React content
}

window.NexusExtensions.registerRightWidget({
  id:        "my-ext-now-playing",
  label:     "Now Playing",
  component: NowPlayingWidget,
  priority:  50,
})
```

The component receives `{ navigate, currentUser }` and is wrapped in a standard widget card with a label header.

---

### Composer toolbar buttons

Add a button to the post composer toolbar, alongside Bold, Italic, etc.

```js
window.NexusExtensions.registerToolbarButton({
  icon:    "fa-gamepad",
  tip:     "Link a game",
  color:   "var(--ac)",
  onClick(linkedGames, setLinkedGames) {
    // linkedGames: current array of linked objects
    // setLinkedGames: call with a new array to update
  },
}, priority)
```

---

### User card actions

Add action buttons to the user card popover and the mobile account menu.

```js
window.NexusExtensions.registerUserAction({
  id:       "my-ext-view-gamelog",
  label:    "View Gamelog",
  icon:     "fa-gamepad",
  authOnly: false,
  priority: 50,
  onClick({ user, currentUser, navigate, closeCard }) {
    closeCard();
    window.NexusExtensions.navigate(`/ext/gamepedia/users/${user.username}`);
  },
})
```

Call `closeCard()` before navigating to dismiss the popover first.

---

### Post menu actions

Add items to the `…` dropdown on a post, between Edit and Delete.

```js
window.NexusExtensions.registerPostAction({
  id:       "my-ext-link-game",
  label:    "Link a Game",
  icon:     "fa-gamepad",
  priority: 50,
  visible({ post, currentUser }) {
    return true; // return false to hide for specific posts/users
  },
  onClick({ post, currentUser, navigate, closeMenu }) {
    closeMenu();
    // open a modal, navigate, etc.
  },
})
```

---

### Custom notification types

Register a display handler for a notification type your service emits.

```js
window.NexusExtensions.registerNotificationType("my_ext_event", {
  icon:      "fa-gamepad",
  iconColor: "var(--ac)",

  renderBody(n) {
    return React.createElement(React.Fragment, null,
      React.createElement("strong", { style: { color: "var(--t1)" } },
        n.data?.game_name || "A game"),
      React.createElement("span", { style: { color: "var(--t3)" } },
        " was added to the library")
    );
  },

  onClick({ n, navigate }) {
    window.NexusExtensions.navigate("/ext/gamepedia");
  },
})
```

---

## Full bundle example

```js
(function () {
  "use strict";

  const React = window.React;
  const NE    = window.NexusExtensions;
  const NET   = window.NexusExtensionTemplates;
  const BASE  = "/my-ext/api";

  function apiFetch(path, opts = {}) {
    const token = localStorage.getItem("nexus_token");
    return fetch(BASE + path, {
      headers: {
        "Content-Type":  "application/json",
        "Authorization": token ? `Bearer ${token}` : "",
        ...opts.headers,
      },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(r => r.json());
  }

  // ── Full page ────────────────────────────────────────────────────────────────

  function BrowsePage({ navigate, currentUser }) {
    const [items, setItems] = React.useState([]);
    React.useEffect(() => {
      apiFetch("/items").then(r => setItems(r.items || []));
    }, []);
    return React.createElement("div", null,
      items.map(item => React.createElement("div", { key: item.id }, item.name))
    );
  }

  NE.registerRoute("my-extension", "/browse", BrowsePage, { title: "Browse" });

  // ── Profile sidebar link ─────────────────────────────────────────────────────

  function ProfileLink({ username }) {
    function go(e) {
      e.preventDefault();
      NE.navigate(`/ext/my-extension/users/${username}`);
    }
    return React.createElement("a", {
      href:    `/ext/my-extension/users/${username}`,
      onClick: go,
      style:   { display: "flex", alignItems: "center", padding: "6px 10px",
                 fontSize: 13, color: "var(--t2)", textDecoration: "none",
                 borderRadius: 8 },
    },
      React.createElement("i", { className: "fa-solid fa-star", style: { marginRight: 6 } }),
      "My Extension"
    );
  }

  NE.registerSlot("profile_sidebar", ProfileLink, 50);

  // ── Explore item ─────────────────────────────────────────────────────────────

  NE.registerExploreItem({
    slug:  "my-extension",
    label: "Browse",
    icon:  "fa-star",
    path:  "/browse",
  });

  // ── Admin panel ──────────────────────────────────────────────────────────────

  NE.registerAdminPanel("my-extension", {
    label:     "My Extension",
    icon:      "fa-star",
    component: () => React.createElement(NET.SimpleSettingsPanel, {
      slug: "my-extension",
      fields: [
        { key: "api_key", label: "API Key", type: "string", secret: true },
      ],
    }),
  });

  // ── Post action ──────────────────────────────────────────────────────────────

  NE.registerPostAction({
    id:    "my-ext-action",
    label: "Do something",
    icon:  "fa-star",
    onClick({ post, closeMenu }) {
      closeMenu();
      apiFetch(`/posts/${post.id}/action`, { method: "POST" });
    },
  });

})();
```

---

## Phoenix 1.8 compatibility

Nexus runs on Phoenix 1.8. If your in-VM extension includes controllers or a router, you must follow these requirements:

### Controllers

`use Phoenix.Controller` now **requires** a `:formats` option in Phoenix 1.8. Always specify it:

```elixir
defmodule MyExtension.MyController do
  use Phoenix.Controller, formats: [:json]
  import Plug.Conn

  def index(conn, _params) do
    json(conn, %{items: []})
  end
end
```

Use `formats: [:json]` for API-only controllers. Without the `:formats` option Phoenix 1.8 will emit a deprecation warning and may not route correctly.

### Routers

`use Phoenix.Router` works as expected in Phoenix 1.8 with no changes required:

```elixir
defmodule MyExtension.ApiRouter do
  use Phoenix.Router, helpers: false
  import Plug.Conn
  import Phoenix.Controller

  pipeline :api do
    plug :accepts, ["json"]
    plug :fetch_query_params
  end

  scope "/" do
    pipe_through :api
    get "/items", MyExtension.ItemController, :index
  end
end
```

---

## Background jobs

Nexus provides a dedicated Oban queue named `:extensions` for extension background work. This queue exists exclusively for extensions — Nexus core never schedules jobs into it. Use it for any work your extension needs to run asynchronously: generating reports, sending notifications, processing imports, scheduling periodic tasks, or any operation too slow to run inline during a request.

Using the `:extensions` queue keeps your background work isolated from Nexus's own queues (`default`, `mailers`, `media`, `webhooks`), so your jobs never compete with core forum operations and remain easy to monitor independently.

### Using the extensions queue

Define your worker module with `queue: :extensions`:

```elixir
defmodule MyExtension.Workers.ReportWorker do
  use Oban.Worker,
    queue: :extensions,
    max_attempts: 3

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"user_id" => user_id, "period" => period}}) do
    MyExtension.Reports.generate(user_id, period)
  end
end
```

Enqueue a single job:

```elixir
%{"user_id" => user.id, "period" => "2025"}
|> MyExtension.Workers.ReportWorker.new()
|> Oban.insert()
```

Enqueue many jobs efficiently with `Oban.insert_all/1` — this is strongly preferred over calling `Oban.insert/1` in a loop, as it batches the inserts in a single DB transaction:

```elixir
jobs =
  Enum.map(user_ids, fn id ->
    MyExtension.Workers.ReportWorker.new(%{"user_id" => id, "period" => "2025"})
  end)

Oban.insert_all(jobs)
```

### Concurrency

The `:extensions` queue runs up to **10 concurrent jobs** by default. This is a ceiling — if fewer jobs are queued, fewer run. For batch operations across many users (e.g. a yearly report for every member), this naturally throttles throughput without overwhelming the database.

### Scheduling periodic jobs

To run a job on a schedule, register a cron entry in your extension's `child_specs/0` callback. Oban's `Cron` plugin handles this:

```elixir
@impl true
def child_specs do
  [
    {Oban.Plugins.Cron,
     crontab: [
       # Run at midnight on January 1st every year
       {"0 0 1 1 *", MyExtension.Workers.YearlyReportScheduler, max_attempts: 1}
     ]}
  ]
end
```

> **Note:** Nexus already starts the Oban Cron plugin for its own scheduled work. If you add a second Cron plugin in `child_specs`, both will run independently — entries won't conflict, but be aware that two Cron supervisors are active. For simple periodic needs this is fine.

### What belongs in the extensions queue

Use `:extensions` for work that is:
- **Slow** — anything that touches external APIs, generates reports, or processes large datasets
- **Deferrable** — work that doesn't need to happen inline during a web request
- **Retryable** — Oban's `max_attempts` gives you automatic retry with backoff on failure

Do not use it for work that must complete synchronously before returning an HTTP response. For that, run the work directly in your controller or context function.

---

## Digest email sections

Extensions can contribute sections to Nexus digest emails. When a digest is sent, Nexus invokes your `handle_digest_section/3` callback for each section you declare. Your callback queries the database, returns a section payload, and Nexus renders it using the native email template — so it looks visually consistent with the built-in sections.

### 1. Declare sections from your module

Implement `digest_sections/0` to return a list of section descriptors:

```elixir
@impl true
def digest_sections do
  [
    %{
      key: "gamepedia_new_games",
      label: "New Games",
      icon: "fa-gamepad",
      enabled_by_default: true
    },
    %{
      key: "gamepedia_top_discussed",
      label: "Most Discussed Games",
      icon: "fa-fire",
      enabled_by_default: true
    }
  ]
end
```

| Field | Required | Description |
|---|---|---|
| `key` | ✓ | Unique identifier. Use your extension slug as a prefix (e.g. `gamepedia_new_games`) to avoid collisions. |
| `label` | ✓ | Section heading shown in the email and admin UI. |
| `icon` | | FontAwesome icon class for the admin UI (e.g. `fa-gamepad`). |
| `enabled_by_default` | | Whether the section is on by default. Admins can toggle it. |

### 2. Handle the callback

Implement `handle_digest_section/3`. Nexus calls it with the section key, the digest period, and your extension's stored settings:

```elixir
@impl true
def handle_digest_section(key, period, settings)
```

Where `period` is:

```elixir
%{
  from:         ~U[2026-05-02 00:00:00Z],   # DateTime
  to:           ~U[2026-05-09 00:00:00Z],   # DateTime
  frequency:    "weekly",                    # "daily" | "weekly" | "monthly"
  period_label: "this week"
}
```

Use `period.from` and `period.to` to scope your queries to the digest window. Return a map matching the digest section schema:

```elixir
%{
  title:  "New Games",
  layout: "list",
  cta:    %{label: "Browse all games", url: "https://gamepedia.billyrayfoss.com"},
  items: [
    %{
      label:       "Elden Ring",
      sublabel:    "Action RPG · FromSoftware · 2022",
      badge:       "NEW",
      badge_color: "#34d399",
      url:         "https://gamepedia.billyrayfoss.com/games/elden-ring"
    }
  ]
}
```

### 3. Layouts

Choose the layout that best fits your data:

| Layout | Best for | Notes |
|---|---|---|
| `list` | Ranked lists of items | Shows a number, label, optional badge and sublabel |
| `leaderboard` | Top N with a score | Medal icons for top 3, right-aligned `value` field |
| `stat_bars` | Comparative counts | Horizontal bar scaled to the highest `value` |
| `pill_grid` | Tags, genres, categories | Wrapping colored pills, good for many small items |

### 4. Item fields

| Field | Used by layouts | Description |
|---|---|---|
| `label` | all | Primary text. Required. |
| `sublabel` | list, leaderboard | Dimmed secondary line below label |
| `value` | leaderboard, stat_bars | Right-aligned number/text |
| `badge` | list | Small pill next to the label (e.g. "NEW", "HOT") |
| `badge_color` | list, stat_bars, pill_grid | Hex color for badge or bar |
| `url` | all | Makes the label a clickable link |

If `items` is empty, the section is silently omitted from the digest. If the callback raises, the error is logged and the section is omitted — it never aborts the digest.

### 5. Example — Gamepedia new games

```elixir
defmodule Gamepedia do
  @behaviour Nexus.Extensions.Behaviour
  use Nexus.Extensions.Behaviour

  import Ecto.Query
  alias Nexus.Repo
  alias Gamepedia.{Game, GameLog}

  @impl true
  def digest_sections do
    [
      %{key: "gamepedia_new_games",    label: "New Games",         icon: "fa-gamepad", enabled_by_default: true},
      %{key: "gamepedia_top_discussed", label: "Most Discussed Games", icon: "fa-fire", enabled_by_default: true}
    ]
  end

  @impl true
  def handle_digest_section("gamepedia_new_games", period, _settings) do
    games = Repo.all(
      from g in Game,
      where: g.inserted_at >= ^period.from and g.inserted_at <= ^period.to,
      order_by: [desc: g.inserted_at],
      limit: 5
    )

    items = Enum.map(games, fn g ->
      %{
        label:       g.title,
        sublabel:    "#{g.genre} · #{g.developer}",
        badge:       "NEW",
        badge_color: "#34d399",
        url:         "https://gamepedia.billyrayfoss.com/games/#{g.slug}"
      }
    end)

    %{
      title:  "New Games",
      layout: "list",
      cta:    %{label: "Browse all games", url: "https://gamepedia.billyrayfoss.com"},
      items:  items
    }
  end

  def handle_digest_section("gamepedia_top_discussed", period, _settings) do
    games = Repo.all(
      from g in Game,
      join: gl in GameLog, on: gl.game_id == g.id,
      where: gl.inserted_at >= ^period.from,
      group_by: [g.id, g.title, g.slug],
      order_by: [desc: count(gl.id)],
      limit: 5,
      select: %{title: g.title, slug: g.slug, log_count: count(gl.id)}
    )

    items = Enum.map(games, fn g ->
      %{
        label: g.title,
        value: "#{g.log_count} logs",
        url:   "https://gamepedia.billyrayfoss.com/games/#{g.slug}"
      }
    end)

    %{title: "Most Discussed Games", layout: "leaderboard", items: items}
  end

  def handle_digest_section(_key, _period, _settings), do: %{items: []}
end
```

### 6. Admin control

Once installed, each extension section appears in **Admin → Digest → Content sections** alongside the built-in sections. Admins can:
- Toggle individual extension sections on or off
- Drag/reorder them relative to built-in sections

If an extension is disabled or uninstalled, its sections are automatically omitted from the digest.
