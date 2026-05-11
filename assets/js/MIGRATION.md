# Nexus Frontend Refactor — Migration Guide

## What was created

```
assets/js/
  lib/
    api.js          ← the `api` object (fetch, token, refresh)
    utils.js        ← ago(), fmtDate(), fmtBytes(), SPACE_COLORS, userColor(), spaceColor()
  components/
    Avatar.jsx      ← RsAv, Av, UserCardPopover, useUserCard, openUserCard
    Select.jsx      ← Select, Toggle
    Toasts.jsx      ← toast(), Toasts
```

`build.js` now has path aliases. Any file can import like:

```js
import { api }            from "lib/api";
import { ago, userColor } from "lib/utils";
import { RsAv, Av }       from "components/Avatar";
import { Select, Toggle } from "components/Select";
import { toast, Toasts }  from "components/Toasts";
```

---

## Step 1 — Add imports to the top of nexus.jsx

Add these lines right after the existing React/ReactDOM imports:

```js
import { api }                                       from "./lib/api";
import { ago, fmtDate, fmtMsgTime, fmtDaySep,
         fmtBytes, SPACE_COLORS, userColor,
         spaceColor }                                from "./lib/utils";
import { RsAv, Av, openUserCard,
         useUserCard, UserCardPopover }              from "./components/Avatar";
import { Select, Toggle }                            from "./components/Select";
import { toast, Toasts }                             from "./components/Toasts";
```

---

## Step 2 — Delete the now-duplicated code from nexus.jsx

Remove these blocks entirely (they now live in the extracted files):

### From lib/api.js (lines ~378–452 in nexus.jsx)
- The `window._installPrompt` block
- The entire `const api = { ... }` object

### From lib/utils.js (lines ~1444–1496)
- `let _tid = 0; const _tl = new Set();`
- `function toast(...)`
- `function fmtBytes(...)`
- `function Toasts()`
- `function ago(...)`
- `function fmtDate(...)`
- `function fmtMsgTime(...)`
- `function fmtDaySep(...)`
- `const SPACE_COLORS = [...]`
- `function spaceColor(...)`
- `function userColor(...)`

### From components/Avatar.jsx (lines ~1497–1635)
- `let _ucardSetState = null`
- `function useUserCard()`
- `function openUserCard(...)`
- `function UserCardPopover(...)`
- `function RsAv(...)`
- `function Av(...)`

---

## Step 3 — Replace all inline avatar img tags

Search for any `<img` tag that:
- Has `borderRadius: "var(--av-radius)"` in its style, OR
- Has `objectFit: "cover"` alongside a user's `avatar_url`

Replace each one with the appropriate component.

**Common patterns to search for:**

```
avatar_url
av-radius
objectFit.*cover
```

### Replacement reference

| Old inline code | Replace with |
|---|---|
| `{u.avatar_url ? <img src={u.avatar_url} style={{width:28,...}} alt={u.username}/> : <div style={{background:userColor(u),...}}>{initials}</div>}` | `<Av user={u} size={28} />` |
| `{u.avatar_url ? <img src={u.avatar_url} style={{width:34,...}} ... onClick={openCard}/> : <div ...>{initials}</div>}` | `<RsAv user={u} size={34} />` |
| Avatar with no click behavior | `<RsAv user={u} noCard />` |
| Avatar with forced color | `<RsAv user={u} color="#a78bfa" />` |

### Specific inline instances to fix (as of extraction)

These are the locations with raw inline avatar code that bypass RsAv/Av:

- **line ~364** — `ref-popup-av` img in RefPreviewPopup → `<Av user={...} />`
- **line ~1552** — UserCardPopover cover avatar (96px) → already fixed in Avatar.jsx
- **line ~2042** — leaderboard list avatar (32px) → `<Av user={u} size={32} />`
- **line ~2446** — mention popup avatar → `<Av user={u} size={28} />`
- **line ~2879** — post author avatar (38px) → `<RsAv user={author} size={38} />`
- **line ~2913** — participants list avatar (28px) → `<RsAv user={u} size={28} />`
- **line ~3003** — live events avatar → `<RsAv user={...} size={28} />`
- **line ~3238** — OP avatar in feed card (26px) → `<RsAv user={p.user} size={26} noCard />`
- **line ~3248** — participant avatar in feed card (26px) → `<RsAv user={u} size={26} noCard />`
- **line ~3276** — last reply user avatar in feed card → `<RsAv user={lastUser} size={26} noCard />`
- **line ~4189** — reply avatar → `<RsAv user={r.user} size={34} />`
- **line ~4939** — profile page own avatar (96px) → `<RsAv user={user} size={96} noCard />`
- **line ~6895** — admin user list avatar → `<Av user={u} size={28} />`

---

## Step 4 — Replace raw `<select>` elements

Search for `<select` and replace each with `<Select>`.

**Pattern:**
```jsx
// Before
<select className="fi" value={sort} onChange={e => setSort(e.target.value)}>
  <option value="newest">Newest</option>
  <option value="oldest">Oldest</option>
</select>

// After
<Select value={sort} onChange={setSort}>
  <option value="newest">Newest</option>
  <option value="oldest">Oldest</option>
</Select>
```

Or using the `options` shorthand:
```jsx
<Select value={sort} onChange={setSort} options={[
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
]} />
```

---

## Step 5 — Replace inline toggles with `<Toggle>`

Search for `className="tgl"` and replace each surrounding pattern with:

```jsx
// Before
<div className="tgl" style={{background: val ? "var(--ac)" : "var(--tgl-off)"}} onClick={() => setVal(p=>!p)}>
  <div className="tgl-knob" style={{left: val ? 23 : 3, background: val ? "#fff" : "var(--tgl-knob-off)"}}/>
</div>

// After
<Toggle value={val} onChange={setVal} />
// or with a label:
<Toggle value={val} onChange={setVal} label="Enable feature" hint="Optional hint text" />
```

---

## Going further — next files to extract

Once the above is done, these are the natural next extractions in order of impact:

1. **`components/Toasts.jsx`** — already done
2. **`components/RichTextArea.jsx`** — lines ~2231–2466, self-contained, ~235 lines
3. **`components/Reactions.jsx`** — lines ~1944–2133
4. **`pages/AdminPage.jsx`** — lines ~5878–10580, the biggest single chunk (~4700 lines)
5. **`pages/MessagesPage.jsx`** — lines ~5138–5698
6. Remaining pages one at a time

Each extraction follows the same pattern:
1. Copy the functions/components to the new file
2. Add necessary imports at the top of the new file
3. Export everything the rest of the app needs
4. Import into nexus.jsx and delete the old definitions
5. Build and verify nothing broke
