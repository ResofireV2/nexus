# Extension Guide — addendum

Text to fold into the Nexus Extension Development Guide. Two small edits.

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

## Why this is worth documenting

Three of the official extensions (Gamepedia, Tickets and Awards) read the
templates at bundle load time. It went unnoticed while Nexus shipped a single
JavaScript bundle, because the admin code happened to be present on every page.
Once the admin tree was split into a lazily-loaded bundle, all three broke on
ordinary pages — Gamepedia and Tickets failed to load at all, and Awards' admin
panel threw when opened.

The split was correct and matched the guide; the extensions were relying on
behaviour the guide never promised. The rule above makes that contract explicit
so third-party authors don't repeat it.
