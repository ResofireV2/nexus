# Nexus Extension Development Guide

## Quick start

```bash
mix nexus.extension.new my-extension --author "Your Name" --description "Does something cool"
cd extensions/my-extension
```

## Extension structure

A Nexus extension is a GitHub repository containing a `manifest.json` and a JS bundle. The service-side code (webhook handlers, API, database) lives in a separate deployment — the extension repository is just the manifest and frontend bundle that Nexus pulls in.

```
my-extension/
├── manifest.json        # Tells Nexus about the extension
├── assets/
│   └── js/
│       └── my-extension.js  # Frontend bundle (compiled, self-contained)
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
  "webhook_url":    "https://my-extension.example.com/webhook",
  "js_bundle_url":  "https://my-extension.example.com/assets/my-extension.js",
  "hooks": [
    { "event": "post_created", "priority": 50 }
  ],
  "slots": [
    { "slot": "post_footer", "component": "MyPostFooter", "priority": 50 }
  ],
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

## Webhook hooks

Nexus fires a `POST` request to your `webhook_url` for each registered event. The body is JSON:

```json
{
  "event":     "post_created",
  "payload":   { "post_id": 42 },
  "settings":  { "api_key": "sk-...", "enabled": true },
  "extension": "my-extension",
  "timestamp": 1717000000
}
```

### Available hook events

| Event             | Payload                              | Fired when                    |
|-------------------|--------------------------------------|-------------------------------|
| `post_created`    | `{ post_id }`                        | A post is published           |
| `post_updated`    | `{ post_id }`                        | A post is edited              |
| `post_deleted`    | `{ post_id }`                        | A post is deleted             |
| `reply_created`   | `{ reply_id, post_id }`              | A reply is posted             |
| `user_registered` | `{ user_id }`                        | A new user registers          |
| `user_login`      | `{ user_id }`                        | A user logs in                |
| `reaction_added`  | `{ emoji, user_id, post_id }`        | A reaction is added           |
| `report_created`  | `{ report_id }`                      | Content is reported           |

### Webhook signature verification

If you set a **Webhook Secret** in the extension settings, Nexus signs every delivery with an `X-Nexus-Signature: sha256=<hex>` header. Verify it against the raw request body using HMAC-SHA256.

---

## Frontend bundle

Your `js_bundle_url` is loaded by Nexus after the forum SPA initialises. It must be a self-contained IIFE — no ES module syntax, no external imports. React is available on `window.React`; do not bundle it.

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
    if (window._nexusNavigate)
      window._nexusNavigate("ext-route",
        window.NexusExtensions.matchRoute(`/gamepedia/users/${username}`) || {});
  }
  return React.createElement("a", {
    href: `/gamepedia/users/${username}`,
    onClick: go,
  }, "Gamelog");
}

window.NexusExtensions.registerSlot("profile_sidebar", GamelogLink, 50);
```

---

### SPA routes

Register a full-page route in the Nexus SPA. The URL is handled client-side — Nexus renders your component without a page reload.

```js
window.NexusExtensions.registerRoute(pattern, Component, options)
```

| Parameter   | Type             | Description                                                          |
|-------------|------------------|----------------------------------------------------------------------|
| `pattern`   | string           | URL pattern — colon-prefixed segments become params, e.g. `"/my-ext/users/:username"` |
| `Component` | React component  | Receives `{ navigate, currentUser, ...params }`                      |
| `options`   | object           | `{ title }` — shown in the back-button header                        |

**Example:**

```js
function GamelogPage({ username, currentUser, navigate }) {
  // ...
}

window.NexusExtensions.registerRoute(
  "/gamepedia/users/:username",
  GamelogPage,
  { title: "Gamelog" }
);
```

Navigate to a registered route from anywhere in your bundle:

```js
if (window._nexusNavigate)
  window._nexusNavigate("ext-route",
    window.NexusExtensions.matchRoute("/gamepedia/users/alice") || {});
```

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
const { TabbedPanel } = window.NexusExtensionTemplates;

window.NexusExtensions.registerAdminPanel("my-extension", {
  label: "My Extension",
  icon:  "fa-gamepad",
  component: () => React.createElement(TabbedPanel, {
    slug: "my-extension",
    tabs: [
      {
        key:    "general",
        label:  "General",
        icon:   "fa-gear",
        fields: [
          { key: "api_key", label: "API Key", type: "string", secret: true },
          { key: "enabled", label: "Enabled", type: "boolean" },
        ],
      },
    ],
  }),
});
```

---

### Admin panel templates — `window.NexusExtensionTemplates`

Three ready-made panel components. Import them at the top of your bundle:

```js
const { InfoPanel, SimpleSettingsPanel, TabbedPanel } = window.NexusExtensionTemplates;
```

#### `InfoPanel`

Read-only card for extensions with no configurable settings.

```js
React.createElement(InfoPanel, {
  name:        "My Extension",
  version:     "1.0.0",
  description: "Does something useful.",
  author:      "you",
  status:      "active",         // "active" | "inactive" | "error"
  statusLabel: "Running",        // optional override for the status label
  links: [
    { label: "Documentation", href: "https://..." },
    { label: "GitHub",        href: "https://github.com/you/my-extension" },
  ],
})
```

#### `SimpleSettingsPanel`

Flat list of settings fields with a single Save button. Loads current values from the API automatically.

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

Settings split across tabs, identical in style to the core PWA panel.

```js
React.createElement(TabbedPanel, {
  slug: "my-extension",
  tabs: [
    {
      key:    "credentials",
      label:  "Credentials",
      icon:   "fa-key",
      fields: [
        { key: "client_id",     label: "Client ID",     type: "string" },
        { key: "client_secret", label: "Client Secret", type: "string", secret: true },
      ],
    },
    {
      key:    "security",
      label:  "Security",
      icon:   "fa-shield",
      fields: [
        { key: "webhook_secret", label: "Webhook Secret", type: "string", secret: true },
      ],
    },
  ],
})
```

**Field descriptor properties:**

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
  id:       "my-ext-browse",
  label:    "Browse Games",
  icon:     "fa-gamepad",
  page:     "ext-route",
  props:    window.NexusExtensions.matchRoute("/gamepedia") || {},
  authOnly: false,
  priority: 50,
})
```

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
    navigate("ext-route",
      window.NexusExtensions.matchRoute(`/gamepedia/users/${user.username}`) || {});
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
    navigate("ext-route",
      window.NexusExtensions.matchRoute("/gamepedia") || {});
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

  NE.registerRoute("/my-ext/browse", BrowsePage, { title: "Browse" });

  // ── Profile sidebar link ─────────────────────────────────────────────────────

  function ProfileLink({ username }) {
    function go(e) {
      e.preventDefault();
      if (window._nexusNavigate)
        window._nexusNavigate("ext-route",
          NE.matchRoute(`/my-ext/users/${username}`) || {});
    }
    return React.createElement("a", {
      href:    `/my-ext/users/${username}`,
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
    id:    "my-ext-browse",
    label: "Browse",
    icon:  "fa-star",
    page:  "ext-route",
    props: NE.matchRoute("/my-ext/browse") || {},
  });

  // ── Admin panel ──────────────────────────────────────────────────────────────

  NE.registerAdminPanel("my-extension", {
    label:     "My Extension",
    icon:      "fa-star",
    component: () => React.createElement(NET.TabbedPanel, {
      slug: "my-extension",
      tabs: [
        {
          key:    "general",
          label:  "General",
          icon:   "fa-gear",
          fields: [
            { key: "api_key", label: "API Key", type: "string", secret: true },
          ],
        },
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

## Deploying your extension service

Your extension backend (webhook receiver, API, JS bundle server) can be any language or framework. The only requirements are:

- `GET  /assets/my-extension.js` — serves the JS bundle with `Access-Control-Allow-Origin: *`
- `POST /webhook` — receives Nexus hook events
- `GET  /api/*` — any API routes your frontend needs

Use Caddy or nginx to proxy both your service and Nexus behind the same domain. Drop a `Caddyfile` snippet in your extension repo and add `import /opt/my-extension/Caddyfile` to your Nexus `Caddyfile` once. Future extension updates never require touching the Nexus `Caddyfile` again.

---

## Digest email sections

Extensions can contribute sections to Nexus digest emails. When a digest is sent, Nexus calls a webhook on your extension for each section it declares. Your extension queries its own database, builds the response, and Nexus renders it using the native email template — so it looks visually consistent with the built-in sections.

### 1. Declare sections in manifest.json

```json
{
  "digest_sections": [
    {
      "key": "gamepedia_new_games",
      "label": "New Games",
      "icon": "fa-gamepad",
      "webhook_path": "/digest/new_games",
      "enabled_by_default": true
    },
    {
      "key": "gamepedia_top_discussed",
      "label": "Most Discussed Games",
      "icon": "fa-fire",
      "webhook_path": "/digest/top_discussed",
      "enabled_by_default": true
    }
  ]
}
```

| Field | Required | Description |
|---|---|---|
| `key` | ✓ | Unique identifier. Use your extension slug as a prefix (e.g. `gamepedia_new_games`) to avoid collisions. |
| `label` | ✓ | Section heading shown in the email and admin UI. |
| `icon` | | FontAwesome icon class for the admin UI (e.g. `fa-gamepad`). |
| `webhook_path` | ✓ | Path appended to your `webhook_url` base. Must start with `/`. |
| `enabled_by_default` | | Whether the section is on by default. Admins can toggle it. |

### 2. Handle the webhook

Nexus sends a `POST` request to `{your_webhook_base}{webhook_path}` with:

```json
{
  "from": "2026-05-02T00:00:00Z",
  "to":   "2026-05-09T00:00:00Z",
  "frequency": "weekly",
  "period_label": "this week",
  "extension": "gamepedia",
  "settings": { }
}
```

Use `from` and `to` to scope your queries to the digest period. Your extension responds with:

```json
{
  "title": "New Games",
  "layout": "list",
  "cta": {
    "label": "Browse all games",
    "url": "https://gamepedia.billyrayfoss.com"
  },
  "items": [
    {
      "label": "Elden Ring",
      "sublabel": "Action RPG · FromSoftware · 2022",
      "badge": "NEW",
      "badge_color": "#34d399",
      "url": "https://gamepedia.billyrayfoss.com/games/elden-ring"
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

### 5. Example — Gamepedia new games (Elixir/Phoenix)

```elixir
# router.ex
post "/digest/new_games", DigestController, :new_games
post "/digest/top_discussed", DigestController, :top_discussed

# digest_controller.ex
def new_games(conn, params) do
  from_dt = parse_dt(params["from"])
  to_dt   = parse_dt(params["to"])
  limit   = 5

  games = Repo.all(
    from g in Game,
    where: g.inserted_at >= ^from_dt and g.inserted_at <= ^to_dt,
    order_by: [desc: g.inserted_at],
    limit: ^limit
  )

  items = Enum.map(games, fn g ->
    %{
      label:    g.title,
      sublabel: "#{g.genre} · #{g.developer}",
      badge:    "NEW",
      badge_color: "#34d399",
      url:      "https://gamepedia.billyrayfoss.com/games/#{g.slug}"
    }
  end)

  json(conn, %{
    title:  "New Games",
    layout: "list",
    cta:    %{label: "Browse all games", url: "https://gamepedia.billyrayfoss.com"},
    items:  items
  })
end

def top_discussed(conn, params) do
  from_dt = parse_dt(params["from"])

  games = Repo.all(
    from g in Game,
    join: gl in GameLog, on: gl.game_id == g.id,
    where: gl.inserted_at >= ^from_dt,
    group_by: [g.id, g.title, g.slug],
    order_by: [desc: count(gl.id)],
    limit: 5,
    select: %{title: g.title, slug: g.slug, log_count: count(gl.id)}
  )

  items = Enum.map(games, fn g ->
    %{
      label:    g.title,
      value:    "#{g.log_count} logs",
      url:      "https://gamepedia.billyrayfoss.com/games/#{g.slug}"
    }
  end)

  json(conn, %{
    title:  "Most Discussed Games",
    layout: "leaderboard",
    items:  items
  })
end
```

### 6. Admin control

Once installed, each extension section appears in **Admin → Digest → Content sections** alongside the built-in sections. Admins can:
- Toggle individual extension sections on or off
- Drag/reorder them relative to built-in sections

If an extension is disabled or uninstalled, its sections are automatically omitted from the digest.
