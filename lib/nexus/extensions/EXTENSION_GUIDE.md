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

## Deploying your extension service

Your extension backend (webhook receiver, API, JS bundle server) can be any language or framework. The only requirements are:

- `GET  /assets/my-extension.js` — serves the JS bundle with `Access-Control-Allow-Origin: *`
- `POST /webhook` — receives Nexus hook events
- `GET  /api/*` — any API routes your frontend needs

Use Caddy or nginx to proxy both your service and Nexus behind the same domain. Drop a `Caddyfile` snippet in your extension repo and add `import /opt/my-extension/Caddyfile` to your Nexus `Caddyfile` once. Future extension updates never require touching the Nexus `Caddyfile` again.
