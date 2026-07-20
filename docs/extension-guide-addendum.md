# Extension Guide — addendum

Text to fold into the Nexus Extension Development Guide.

---

## 1. Add to §9.3 `registerAdminPanel`

Immediately after the existing sentence *"Component receives no props. Use
`window.NexusExtensionTemplates.SimpleSettingsPanel` or `TabbedPanel`."*

> ⚠ **Read `window.NexusExtensionTemplates` inside your panel component, never at
> the top level of your bundle.**
>
> The templates are defined by Nexus's admin interface, which is only loaded when
> an admin opens `/admin`. On every other page the global does not exist yet.
>
> ```js
> // Wrong — runs the moment the bundle loads, on every page
> const { TabbedPanel, SimpleSettingsPanel } = window.NexusExtensionTemplates;
>
> function MyPanel() { return e(TabbedPanel, { tabs: [...] }); }
> ```
>
> ```js
> // Right — runs when the panel renders, which only happens on /admin
> function MyPanel() {
>   const { TabbedPanel, SimpleSettingsPanel } = window.NexusExtensionTemplates;
>   return e(TabbedPanel, { tabs: [...] });
> }
> ```
>
> Reading it at load time destructures `undefined` and throws, taking your whole
> bundle down — including toolbar buttons, widgets and routes that have nothing
> to do with the admin panel. Guarding the load-time read is not a fix either: a
> bundle that bails out early because the templates are missing disables all of
> its own surfaces on ordinary pages.
>
> The same rule applies to `window._nexusAdminSaveFn` and
> `window._nexusAdminSetDirty`.

---

## 2. Add to §9.15 Host-provided UI primitives

After the table, as a closing note:

> The primitives above are available on every page, as soon as your bundle runs.
>
> Anything **not** in this table — notably
> `window.NexusExtensionTemplates.{SimpleSettingsPanel, TabbedPanel}` (§9.3) —
> belongs to the admin interface and only exists once `/admin` has been opened.
> Access those at render time, from inside the component that uses them.

---

## Why 1–2 are worth documenting

Three of the official extensions (Gamepedia, Tickets and Awards) read the
templates at bundle load time. It went unnoticed while Nexus shipped a single
JavaScript bundle, because the admin code happened to be present on every page.
Once the admin tree was split into a lazily-loaded bundle, all three broke on
ordinary pages — Gamepedia and Tickets failed to load at all, and Awards' admin
panel threw when opened.

The split was correct and matched the guide; the extensions were relying on
behaviour the guide never promised. The rule above makes that contract explicit
so third-party authors don't repeat it.

---

## 3. Correct §7.1 / §9.2 `compose_attachments` props

The guide lists this slot's props as `{ attachments, set_attachments }`. The
setter is passed as **`setAttachments`** — camelCase.

`propsForSlot` in `assets/js/nexus.jsx` is the runtime authority and returns:

```js
case "compose_attachments":
  return {
    attachments:    ctx.attachments    ?? [],
    setAttachments: ctx.setAttachments ?? (() => {}),
  };
```

Destructuring `set_attachments` yields `undefined`, and the remove control
throws the moment a user clicks it.

Note this slot is deliberately inconsistent with its neighbours: `post_footer`
passes `post_id` and `profile_sidebar` passes `current_user`, both snake_case.
Only `compose_attachments` uses camelCase. Worth calling out explicitly rather
than leaving authors to infer a convention that does not hold.

---

## 4. Correct §9.2 `post_footer` prop type

The guide describes `post_id` as *"post UUID"*. Posts use a bigserial integer
primary key — `create table(:posts)` with no `primary_key: false` and no
`binary_id`. `propsForSlot` passes `ctx.post?.id`, an integer.

Extensions storing this in their own tables should declare the column as
`:integer`, not `:uuid` or `:string`.

---

## 5. Correct §8.4 `routes/0` prefix

The `@callback routes` docstring in `Nexus.Extensions.Behaviour` gave this
example:

```elixir
def routes do
  [{"/api", MyExtension.ApiRouter, []}]
end
```

That is wrong and does not match the host router. `NexusWeb.Router` matches
`/ext/:slug/api/*path`, consuming the literal `api` segment before
`ExtensionRouter.serve_api/3` runs, and `dispatch_to_routes/3` then strips
whatever prefix the extension declared. Declaring `"/api"` therefore requires
callers to hit `/ext/my-extension/api/api/...`.

The correct prefix is almost always `"/"`:

```elixir
def routes do
  [{"/", MyExtension.ApiRouter, []}]
end
```

With that, a request to `/ext/my-extension/api/items` reaches the plug with
`path_info: ["items"]`, so the `Plug.Router` should define `get "/items"`.

The guide's §8.4 already states this correctly; the behaviour docstring was the
source of the contradiction and has been corrected.

---

## Why 3–5 are worth documenting

All three were cases where a documented contract disagreed with the running
code. `SlotContracts` names `propsForSlot` as the runtime authority in its own
moduledoc, then disagreed with it on the attachment setter. The UUID claim would
lead an author to build a schema that cannot store what it receives. And the
`routes/0` example contradicted both the guide and the router.

An author following the documentation would have written broken code in each
case, and the failures are quiet: a setter that is `undefined` until clicked, a
column type that only bites on insert, a route that 404s with no explanation.
