import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api";
import { ago } from "../lib/utils";
import { toast } from "../components/Toasts";
import { Select, Toggle } from "../components/Select";
import { F } from "./FormHelpers";
import { Md } from "../components/Markdown";

// ── Extension admin panels + NexusExtensionTemplates ─────────────────────────

// Status presentation lookup. Keys match the load_status values written by
// the Elixir loader (see priv/repo/migrations/20260521000001_*.exs for the
// authoritative list). Returns the badge/banner colour + label + icon class.
// An unknown or null status falls through to a neutral grey "Unknown" state
// so the UI never crashes on a value we haven't seen.
const LOAD_STATUS_INFO = {
  loaded:           {label:"Loaded",           tone:"ok",     icon:"fa-circle-check"},
  not_loaded:       {label:"Not loaded",       tone:"warn",   icon:"fa-clock"},
  disabled:         {label:"Disabled",         tone:"muted",  icon:"fa-circle-pause"},
  no_repo:          {label:"No GitHub repo",   tone:"err",    icon:"fa-triangle-exclamation"},
  no_release:       {label:"No release",       tone:"err",    icon:"fa-triangle-exclamation"},
  download_failed:  {label:"Download failed",  tone:"err",    icon:"fa-circle-xmark"},
  compile_failed:   {label:"Compile failed",   tone:"err",    icon:"fa-circle-xmark"},
  manifest_invalid: {label:"Invalid manifest", tone:"err",    icon:"fa-file-circle-xmark"},
  migration_failed: {label:"Migration failed", tone:"err",    icon:"fa-circle-xmark"},
  // Piece 5: lifecycle hook failure states. Extension is loaded but its
  // on_install/on_update raised — admin should see the error and decide
  // whether to uninstall, retry, or fix the underlying issue.
  install_failed:   {label:"Install hook failed", tone:"warn", icon:"fa-triangle-exclamation"},
  update_failed:    {label:"Update hook failed",  tone:"warn", icon:"fa-triangle-exclamation"},
};

// Map a tone to CSS colour tokens. Inline-style rather than classes because
// the surrounding admin UI uses inline-style throughout.
const STATUS_TONE_STYLE = {
  ok:    {color:"#34d399", bg:"rgba(52,211,153,0.15)", border:"rgba(52,211,153,0.3)"},
  warn:  {color:"#fbbf24", bg:"rgba(251,191,36,0.15)", border:"rgba(251,191,36,0.3)"},
  err:   {color:"#f87171", bg:"rgba(248,113,113,0.15)", border:"rgba(248,113,113,0.35)"},
  muted: {color:"var(--t4)", bg:"rgba(255,255,255,0.05)", border:"var(--b1)"},
};

function statusInfo(status) {
  return LOAD_STATUS_INFO[status] ||
    {label: status || "Unknown", tone: "muted", icon: "fa-circle-question"};
}

// Banner shown in the detail view when an extension is anything other than
// "loaded". For "loaded" returns null (the card-list badge already conveys
// the OK state and we don't want to clutter the detail view).
function ExtensionStatusBanner({ext}) {
  const status = ext.load_status;
  // If status is null (pre-migration row) treat as loaded and show nothing.
  if (!status || status === "loaded") return null;

  const info = statusInfo(status);
  const tone = STATUS_TONE_STYLE[info.tone];

  return (
    <div style={{
      display:"flex", alignItems:"flex-start", gap:10,
      padding:"10px 14px",
      background: tone.bg, border:`0.5px solid ${tone.border}`,
      borderRadius:8, color: tone.color,
    }}>
      <i className={`fa-solid ${info.icon}`} style={{fontSize:13, marginTop:2}}/>
      <div style={{flex:1, minWidth:0}}>
        <div style={{fontSize:13, fontWeight:500, marginBottom: ext.load_error ? 4 : 0}}>
          {info.label}
        </div>
        {ext.load_error && (
          // load_error can be a multi-line compile message. Use a
          // monospaced block with whitespace preserved and scroll on overflow.
          <pre style={{
            fontSize:11, lineHeight:1.5, color: tone.color,
            background:"rgba(0,0,0,0.15)", border:"0.5px solid rgba(0,0,0,0.2)",
            borderRadius:6, padding:"6px 8px", margin:"4px 0 0",
            maxHeight:200, overflow:"auto",
            whiteSpace:"pre-wrap", wordBreak:"break-word",
            fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace",
          }}>
            {ext.load_error}
          </pre>
        )}
        {ext.loaded_at && (
          <div style={{fontSize:10, color: tone.color, opacity:0.7, marginTop:4}}>
            since {ago(ext.loaded_at)}
          </div>
        )}
      </div>
    </div>
  );
}

// Collapsible runtime introspection block. Calls GET /admin/extensions/:slug/runtime
// on expand and renders the four registered lists. Closed by default; data is
// fetched lazily and cached for the lifetime of the panel.
function ExtensionRuntimePanel({slug}) {
  const [open, setOpen]       = useState(false);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [hookContracts, setHookContracts] = useState(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    // Lazy-load on first expand. Re-fetch on every expand so the admin can
    // see registrations made since the last view (e.g. after a reload).
    if (next) {
      setLoading(true);
      setError(null);
      try {
        // Fetch runtime data and hook contracts in parallel. The contracts
        // are global (same for every extension) but we still re-fetch on
        // every expand — keeps the code path simple and the contract list
        // is tiny (< 1KB).
        const [d, hc] = await Promise.all([
          api.get(`/admin/extensions/${slug}/runtime`),
          api.get(`/admin/extensions/hook-contracts`).catch(() => null),
        ]);
        if (d.runtime) setData(d.runtime);
        else           setError(d.error || "Failed to fetch runtime info");
        // Build a {event_name → contract} lookup for fast access in the row.
        // If the contracts endpoint is unavailable for some reason (older
        // Nexus instance, transient error), we degrade gracefully — the
        // hooks row still renders without payload schemas.
        if (hc?.contracts) {
          const lookup = {};
          for (const c of hc.contracts) lookup[c.event] = c;
          setHookContracts(lookup);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div style={{border:"0.5px solid var(--b1)", borderRadius:8}}>
      <button onClick={toggle} style={{
        width:"100%", display:"flex", alignItems:"center", gap:8,
        padding:"10px 14px", background:"none", border:"none",
        cursor:"pointer", color:"var(--t2)", fontSize:13, fontWeight:500,
        textAlign:"left", fontFamily:"inherit",
      }}>
        <i className={`fa-solid fa-chevron-${open ? "down" : "right"}`}
           style={{fontSize:10, color:"var(--t5)"}}/>
        Runtime registrations
        <span style={{flex:1}}/>
        <span style={{fontSize:11, color:"var(--t5)", fontWeight:400}}>
          {open ? "" : "what's loaded in the VM right now"}
        </span>
      </button>

      {open && (
        <div style={{padding:"4px 14px 14px", borderTop:"0.5px solid var(--b1)"}}>
          {loading && (
            <div style={{fontSize:12, color:"var(--t4)", padding:"12px 0"}}>
              <i className="fa-solid fa-spinner fa-spin" style={{marginRight:6}}/>
              Loading…
            </div>
          )}

          {error && (
            <div style={{fontSize:12, color:"#f87171", padding:"8px 0"}}>
              {error}
            </div>
          )}

          {data && !loading && !error && (
            <div style={{display:"flex", flexDirection:"column", gap:14, paddingTop:8}}>
              <RuntimeRow label="Module"
                value={data.module || <em style={{color:"var(--t5)"}}>not loaded</em>}/>

              {/* Declared: what the manifest promises this extension contributes.
                  Empty sub-sections are hidden to keep the panel scannable —
                  most extensions only declare a subset of the possible kinds. */}
              <DeclaredVsRegisteredPanel slug={slug} data={data} hookContracts={hookContracts}/>

              {/* JS-side mismatches captured at register-time. Surfaces the case
                  where the bundle registers something the manifest didn't
                  declare — undeclared registrations are warnings, not errors,
                  but admins should see them. */}
              <MismatchList slug={slug}/>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RuntimeRow({label, value}) {
  return (
    <div style={{display:"flex", gap:12, fontSize:12, alignItems:"baseline"}}>
      <div style={{width:120, color:"var(--t5)", flexShrink:0}}>{label}</div>
      <div style={{color:"var(--t2)", fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace"}}>
        {value}
      </div>
    </div>
  );
}

function RuntimeList({label, items, render, empty}) {
  return (
    <div style={{display:"flex", gap:12, fontSize:12, alignItems:"flex-start"}}>
      <div style={{width:120, color:"var(--t5)", flexShrink:0, paddingTop:1}}>{label}</div>
      <div style={{flex:1, minWidth:0}}>
        {(!items || items.length === 0) ? (
          <div style={{color:"var(--t5)", fontStyle:"italic"}}>{empty}</div>
        ) : (
          <ul style={{margin:0, padding:0, listStyle:"none",
            display:"flex", flexDirection:"column", gap:3}}>
            {items.map((it, i) => (
              <li key={i} style={{color:"var(--t2)",
                fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace"}}>
                {render(it)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Shows what the manifest declares vs what's actually registered (server-side
// from the registry, client-side from window.NexusExtensions). Each row shows
// declared/registered side-by-side. Items appearing on only one side are
// flagged so the admin can see the mismatch at a glance.
function DeclaredVsRegisteredPanel({slug, data, hookContracts}) {
  const declared = data.declared || {};

  // Live JS-side registrations for this slug. Pulled directly from the
  // NexusExtensions runtime state — no API call needed, the data is already
  // in the page.
  const liveSlots = (window.NexusExtensions && window.NexusExtensions._slots)
    ? Object.entries(window.NexusExtensions._slots).flatMap(([slotName, comps]) =>
        comps.filter(c => c.slug === slug).map(_ => slotName))
    : [];
  const liveRoutes = (window.NexusExtensions && window.NexusExtensions._routes)
    ? window.NexusExtensions._routes
        .filter(r => r.slug === slug)
        // Strip /ext/<slug> prefix to compare against manifest-relative paths
        .map(r => r.pattern.replace(new RegExp("^/ext/" + slug), "") || "/")
    : [];
  const liveRightWidgets = (window.NexusExtensions && window.NexusExtensions._rightWidgets)
    ? window.NexusExtensions._rightWidgets.filter(w => w.slug === slug).map(w => w.id)
    : [];
  const liveToolbarButtons = (window.NexusExtensions && window.NexusExtensions._toolbarButtons)
    ? window.NexusExtensions._toolbarButtons
        .filter(b => b.config?.slug === slug)
        .map(b => b.config.id)
    : [];
  const liveProfileTabs = (window.NexusExtensions && window.NexusExtensions._profileTabs)
    ? window.NexusExtensions._profileTabs.filter(t => t.slug === slug).map(t => t.id)
    : [];
  const liveAdminPanel = !!(window.NexusExtensions && window.NexusExtensions._adminPanels
    && window.NexusExtensions._adminPanels.find(p => p.slug === slug));
  const liveExploreItem = !!(window.NexusExtensions && window.NexusExtensions._exploreItems
    && window.NexusExtensions._exploreItems.find(i => i.slug === slug));
  // Piece 7: extension notification types registered at runtime via
  // NE.registerNotificationType. We compare declared keys against all keys
  // currently in _notifTypes. Since notification types are typically
  // slug-prefixed, this is close enough to a per-extension check.
  const liveNotifTypes = (window.NexusExtensions && window.NexusExtensions._notifTypes)
    ? Object.keys(window.NexusExtensions._notifTypes)
    : [];

  // Server-side registrations come from `data` (the /runtime endpoint).
  const serverHooks = (data.hooks || []).map(h => h.event);
  const serverDigest = (data.digest_sections || []).map(s => s.key);

  // Piece 2.5: hooks declarations are now objects %{event, priority} after
  // normalization. We extract event names for the set-comparison logic and
  // build a priorities lookup so the renderer can show priority next to
  // each event (declared priority from manifest, registered priority from
  // the runtime endpoint).
  const declaredHookObjects   = declared.hooks || [];
  const declaredHookEvents    = declaredHookObjects.map(h =>
    typeof h === "string" ? h : h.event);
  const declaredHookPriorities = {};
  for (const h of declaredHookObjects) {
    if (typeof h === "string") declaredHookPriorities[h] = 50;
    else                       declaredHookPriorities[h.event] = h.priority ?? 50;
  }
  const registeredHookPriorities = {};
  for (const h of (data.hooks || [])) {
    registeredHookPriorities[h.event] = h.priority ?? 50;
  }

  // Build the comparison rows. Each entry is shown only if either side has
  // anything to show — empty rows are noise.
  const rows = [
    {kind: "hooks",           declared: declaredHookEvents,
                              registered: serverHooks,           side: "server",
                              contracts: hookContracts,
                              priorities: {declared: declaredHookPriorities,
                                           registered: registeredHookPriorities}},
    {kind: "slots",           declared: declared.slots || [],
                              registered: liveSlots,             side: "client"},
    {kind: "routes",          declared: (declared.routes || []).map(r => r.path),
                              registered: liveRoutes,            side: "client"},
    {kind: "right_widgets",   declared: (declared.right_widgets || []).map(w => w.id),
                              registered: liveRightWidgets,      side: "client"},
    {kind: "toolbar_buttons", declared: (declared.toolbar_buttons || []).map(b => b.id),
                              registered: liveToolbarButtons,    side: "client"},
    {kind: "profile_tabs",    declared: (declared.profile_tabs || []).map(t => t.id),
                              registered: liveProfileTabs,       side: "client"},
    {kind: "side_data",       declared: (declared.side_data || []).map(s => `${s.entity}:${s.kind}`),
                              registered: (declared.side_data || []).map(s => `${s.entity}:${s.kind}`),
                              side: "server"},
    {kind: "digest_sections", declared: (declared.digest_sections || []).map(s => s.key),
                              registered: serverDigest,          side: "server"},
    {kind: "notification_types",
                              declared: (declared.notification_types || []).map(t => t.key),
                              registered: (declared.notification_types || [])
                                            .map(t => t.key)
                                            .filter(k => liveNotifTypes.includes(k)),
                              side: "client"},
    // Presence-check rows: admin_panel and explore are declared as singular
    // map entries on the manifest, not arrays of ids. They either exist or
    // they don't — there's no id to compare. We use a single sentinel "✓"
    // on both sides so the set-comparison logic in ComparisonRow correctly
    // identifies them as matching when both sides have something. The
    // "declared" / "registered" semantics come from the column position,
    // not the sentinel text itself.
    {kind: "admin_panel",     declared: declared.admin_panel ? ["✓"] : [],
                              registered: liveAdminPanel ? ["✓"] : [],   side: "client"},
    {kind: "explore",         declared: declared.explore ? ["✓"] : [],
                              registered: liveExploreItem ? ["✓"] : [],  side: "client"},
  ].filter(r => r.declared.length > 0 || r.registered.length > 0);

  if (rows.length === 0) {
    return (
      <div style={{fontSize:12, color:"var(--t5)", fontStyle:"italic"}}>
        Extension declares no contributions and has registered nothing.
      </div>
    );
  }

  return (
    <div style={{display:"flex", flexDirection:"column", gap:10}}>
      <div style={{display:"flex", gap:12, fontSize:11, color:"var(--t5)", fontWeight:600,
                   borderBottom:"0.5px solid var(--b1)", paddingBottom:6}}>
        <div style={{width:120, flexShrink:0}}>Kind</div>
        <div style={{flex:1, minWidth:0}}>Declared in manifest</div>
        <div style={{flex:1, minWidth:0}}>Registered at runtime</div>
      </div>
      {rows.map(row => (
        <ComparisonRow key={row.kind} row={row}/>
      ))}
    </div>
  );
}

function ComparisonRow({row}) {
  const declaredSet   = new Set(row.declared);
  const registeredSet = new Set(row.registered);
  // Items missing from one side are flagged.
  const onlyDeclared   = row.declared.filter(d   => !registeredSet.has(d));
  const onlyRegistered = row.registered.filter(r => !declaredSet.has(r));
  const hasMismatch    = onlyDeclared.length > 0 || onlyRegistered.length > 0;

  return (
    <div style={{display:"flex", gap:12, fontSize:12, alignItems:"flex-start"}}>
      <div style={{width:120, color:hasMismatch ? "#fbbf24" : "var(--t5)", flexShrink:0, paddingTop:1,
                   fontWeight: hasMismatch ? 600 : 400}}>
        {row.kind}
        {hasMismatch && <i className="fa-solid fa-triangle-exclamation" style={{marginLeft:6, fontSize:10}}/>}
      </div>
      <ListColumn items={row.declared} highlight={onlyDeclared} side="declared"
                  details={row.contracts}
                  priorities={row.priorities?.declared}/>
      <ListColumn items={row.registered} highlight={onlyRegistered} side="registered"
                  details={row.contracts}
                  priorities={row.priorities?.registered}/>
    </div>
  );
}

function ListColumn({items, highlight, side, details, priorities}) {
  if (!items || items.length === 0) {
    return <div style={{flex:1, minWidth:0, color:"var(--t5)", fontStyle:"italic"}}>—</div>;
  }
  const hiSet = new Set(highlight || []);
  return (
    <ul style={{flex:1, minWidth:0, margin:0, padding:0, listStyle:"none",
                display:"flex", flexDirection:"column", gap:3}}>
      {items.map((it, i) => {
        const isHi = hiSet.has(it);
        // Look up contract detail for this item if a details map is provided.
        // Currently only the hooks row populates `details` (with payload
        // schemas); other rows pass nothing and detail is undefined.
        const detail   = details && details[it];
        // Priority is shown for hooks only (priorities lookup is populated
        // for the hooks row). Other rows pass nothing.
        const priority = priorities && priorities[it];
        return (
          <li key={i} style={{color: isHi ? "#fbbf24" : "var(--t2)",
            fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace",
            wordBreak:"break-all"}}
            title={isHi
              ? (side === "declared"
                  ? "Declared in manifest but not registered at runtime"
                  : "Registered at runtime but not declared in manifest")
              : (detail?.description || null)}>
            {it}
            {priority !== undefined && (
              <span style={{fontSize:10, color:"var(--t5)", fontWeight:400,
                            marginLeft:8,
                            fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace"}}>
                priority: {priority}
              </span>
            )}
            {detail && detail.payload && (
              <div style={{fontSize:10, color:"var(--t5)", fontWeight:400,
                           paddingLeft:8, marginTop:1,
                           fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace"}}>
                payload: {`{${Object.keys(detail.payload).join(", ")}}`}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Surfaces JS-side warnings collected at register-time by _validateAgainstManifest.
// These are undeclared registrations: the bundle registered something the
// manifest didn't promise. Distinct from the declared-vs-registered comparison
// because those mismatches are computed from current state, while this list is
// the chronological record of warnings logged during registration.
function MismatchList({slug}) {
  const mismatches = (window._nexusExtensionMismatches && window._nexusExtensionMismatches[slug]) || [];
  if (mismatches.length === 0) return null;
  return (
    <div style={{display:"flex", gap:12, fontSize:12, alignItems:"flex-start",
                 borderTop:"0.5px solid var(--b1)", paddingTop:10}}>
      <div style={{width:120, color:"#fbbf24", flexShrink:0, paddingTop:1, fontWeight:600}}>
        <i className="fa-solid fa-triangle-exclamation" style={{marginRight:6, fontSize:10}}/>
        Warnings
      </div>
      <ul style={{flex:1, minWidth:0, margin:0, padding:0, listStyle:"none",
                  display:"flex", flexDirection:"column", gap:4}}>
        {mismatches.map((m, i) => (
          <li key={i} style={{color:"var(--t2)", lineHeight:1.5}}>
            {m.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Extension Settings Form ───────────────────────────────────────────────────
// Renders a settings form from settings_schema + settings_tabs declared in manifest.
// No template = "No settings" message.
// Has schema but no tabs = simple single-page form.
// Has settings_tabs = tabbed form matching the PWA admin panel style.
function ExtensionSettingsForm({ext, onSaved}) {
  const schema = ext.settings_schema || {};
  const tabs   = ext.settings_tabs   || [];
  const [vals, setVals] = useState({...ext.settings});
  const [activeTab, setActiveTab] = useState(tabs[0]?.key || null);

  const hasSchema = Object.keys(schema).length > 0;

  // Persist the latest `vals` in a ref so the save function (registered
  // with the admin topbar on mount) can read the current values without
  // depending on `vals` via closure. This avoids stale-closure bugs where
  // the topbar Save button would save whatever `vals` was at the time the
  // save fn was registered.
  const valsRef = useRef(vals);
  useEffect(() => { valsRef.current = vals; }, [vals]);

  // Wire into the admin topbar's save mechanism. When the user clicks the
  // top-right "Save changes" button on an ext-panel-* route, the topbar
  // dispatches to window._nexusAdminSaveFn. Any field change signals
  // dirty via window._nexusAdminSetDirty so the topbar lights up.
  useEffect(() => {
    if (!hasSchema) return;
    window._nexusAdminSaveFn = async () => {
      const d = await api.patch(`/admin/extensions/${ext.slug}/settings`,
        {settings: valsRef.current});
      if (d.extension) { onSaved(d.extension); toast("Settings saved"); }
      else { toast(d.error || "Failed to save", "err"); throw new Error(d.error || "save failed"); }
    };
    return () => { window._nexusAdminSaveFn = null; };
  }, [ext.slug, hasSchema, onSaved]);

  const setField = (key, v) => {
    setVals(p => ({...p, [key]: v}));
    if (window._nexusAdminSetDirty) window._nexusAdminSetDirty();
  };

  const renderField = (key) => {
    const field = schema[key];
    if(!field) return null;
    const val = vals[key] ?? field.default ?? "";
    const set = v => setField(key, v);

    return (
      <F key={key} label={field.label || key} hint={field.hint}>
        {field.type === "boolean" && (
          <div className="toggle-row" style={{marginBottom:0}}>
            <div/>
            <Toggle value={val} onChange={set}/>
          </div>
        )}
        {field.type === "select" && (
          <Select className="fi" value={val} onChange={set}>
            {(field.options||[]).map(o=>(
              <option key={o.value??o} value={o.value??o}>{o.label??o}</option>
            ))}
          </Select>
        )}
        {field.type === "text" && (
          <textarea className="fi" rows={4} value={val}
            onChange={e=>set(e.target.value)}
            placeholder={field.placeholder||""}/>
        )}
        {field.type === "number" && (
          <input className="fi" type="number" style={{maxWidth:160}} value={val}
            onChange={e=>set(Number(e.target.value))}
            placeholder={field.placeholder||""}/>
        )}
        {field.type === "color" && (
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <input className="fi" value={val} onChange={e=>set(e.target.value)}
              placeholder="#000000" style={{maxWidth:140}}/>
            <input type="color" value={val||"#000000"} onChange={e=>set(e.target.value)}
              style={{width:36,height:36,border:"none",borderRadius:6,cursor:"pointer",background:"none"}}/>
          </div>
        )}
        {(!field.type || field.type === "string") && (
          <input className="fi" type={field.secret?"password":"text"} value={val}
            onChange={e=>set(e.target.value)}
            placeholder={field.placeholder||""}
            required={field.required}/>
        )}
      </F>
    );
  };

  // No settings_schema declared in the manifest → render nothing. Callers
  // can rely on this and place the form unconditionally without leaving
  // visual artifacts when an extension has no settings.
  if (!hasSchema) return null;

  if (tabs.length > 0) return (
    <div>
      <div style={{display:"flex",gap:4,marginBottom:24,borderBottom:"0.5px solid var(--b1)",paddingBottom:0}}>
        {tabs.map(t=>(
          <button key={t.key} onClick={()=>setActiveTab(t.key)}
            style={{display:"flex",alignItems:"center",gap:7,padding:"8px 14px",borderRadius:"8px 8px 0 0",
              background:activeTab===t.key?"var(--s3)":"transparent",
              border:activeTab===t.key?"0.5px solid var(--b1)":"0.5px solid transparent",
              borderBottom:activeTab===t.key?"0.5px solid var(--s3)":"none",
              color:activeTab===t.key?"var(--t1)":"var(--t4)",
              cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:500,marginBottom:-1}}>
            {t.icon&&<i className={`fa-solid ${t.icon}`} style={{fontSize:11}}/>}
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map(t=>activeTab===t.key&&(
        <div key={t.key}>
          {(t.fields||[]).map(key=>renderField(key))}
        </div>
      ))}
    </div>
  );

  return (
    <div>
      {Object.keys(schema).map(key=>renderField(key))}
    </div>
  );
}

// ── Extension Detail Panel ────────────────────────────────────────────────────
function ExtensionDetail({ext: initialExt, onBack, onToggle, onUninstall}) {
  const [ext, setExt] = useState(initialExt);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [confirmForce, setConfirmForce] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const toggle = async () => {
    const d = await api.post(`/admin/extensions/${ext.slug}/toggle`);
    if(d.extension) {
      setExt(d.extension);
      onToggle(d.extension);
      // Update client-side active set so surfaces this extension registered
      // (explore items, toolbar buttons, right widgets, etc.) appear or
      // disappear immediately without requiring a page reload.
      if (window.NexusExtensions && window.NexusExtensions.setExtensionActive) {
        window.NexusExtensions.setExtensionActive(d.extension.slug, !!d.extension.enabled);
      }
      // Refresh the parent admin shell's extensions list so the sidebar's
      // enabled-state indicator updates immediately after live toggle.
      if (window._nexusAdminReloadExtensions) window._nexusAdminReloadExtensions();
    }
  };

  const uninstall = async () => {
    const d = await api.delete(`/admin/extensions/${ext.slug}`);
    if(d.ok) {
      toast(`${ext.name} uninstalled`);
      // Piece 5: surface any warnings from the uninstall (on_uninstall
      // raised, Oban cleanup failed, etc.) so the admin sees them.
      if (d.warnings && d.warnings.length > 0) {
        d.warnings.forEach(w => toast(`Uninstall warning: ${w}`, "warn"));
      }
      // Permanently strip all registrations this extension contributed
      // to in-memory client state. Without this, the sidebar entry and
      // any other surfaces would linger until the user reloads the page.
      if (window.NexusExtensions && window.NexusExtensions.removeExtension) {
        window.NexusExtensions.removeExtension(ext.slug);
      }
      onUninstall(ext.slug);
    }
    else toast(d.error||"Failed","err");
  };

  const forceUninstall = async () => {
    const d = await api.delete(`/admin/extensions/${ext.slug}/force`);
    if(d.ok) {
      toast(`${ext.name} force-removed`);
      if(d.warnings && d.warnings.length > 0) {
        d.warnings.forEach(w => toast(`Cleanup warning: ${w}`, "warn"));
      }
      if(window.NexusExtensions && window.NexusExtensions.removeExtension) {
        window.NexusExtensions.removeExtension(ext.slug);
      }
      onUninstall(ext.slug);
    } else toast(d.error||"Force remove failed","err");
  };

  const syncManifest = async () => {
    setSyncing(true);
    try {
      const d = await api.post(`/admin/extensions/${ext.slug}/sync`);
      if(d.extension) { setExt(d.extension); toast("Manifest synced"); }
      else toast(d.error||"Sync failed","err");
    } finally { setSyncing(false); }
  };

  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24}}>
        <button onClick={onBack}
          style={{background:"none",border:"none",cursor:"pointer",color:"var(--t4)",
            fontSize:18,padding:"0 4px",display:"flex",alignItems:"center"}}>
          <i className="fa-solid fa-arrow-left"/>
        </button>
        <div style={{flex:1}}>
          <div style={{fontSize:17,fontWeight:600,color:"var(--t1)"}}>{ext.name}</div>
          <div style={{fontSize:12,color:"var(--t5)"}}>v{ext.version} by {ext.author}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {ext.homepage&&(
            <a href={ext.homepage} target="_blank" rel="noopener"
              style={{fontSize:12,color:"var(--t4)",textDecoration:"none",display:"flex",
                alignItems:"center",gap:5,padding:"5px 10px",border:"0.5px solid var(--b1)",
                borderRadius:8}}>
              <i className="fa-solid fa-arrow-up-right-from-square" style={{fontSize:10}}/>
              Repo
            </a>
          )}
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px",
            background:"var(--s3)",border:"0.5px solid var(--b1)",borderRadius:8}}>
            <span style={{fontSize:12,color:"var(--t4)"}}>
              {ext.enabled?"Enabled":"Disabled"}
            </span>
            <Toggle value={ext.enabled} onChange={toggle}/>
          </div>
        </div>
      </div>

      {/* Load status banner — only shown when not "loaded". For "loaded" we
          stay quiet; the card badge in the list view is enough indication. */}
      <ExtensionStatusBanner ext={ext}/>

      {/* Description */}
      {ext.description&&(
        <div style={{fontSize:13,color:"var(--t3)",marginBottom:20,lineHeight:1.6}}>
          {ext.description}
        </div>
      )}

      {/* Runtime introspection — what's actually registered in the ETS Registry
          right now. Lazy-loaded on expand so we don't fetch it on every detail
          view. Useful when load_status says "loaded" but a specific hook/slot/
          route doesn't seem to be firing. */}
      <ExtensionRuntimePanel slug={ext.slug}/>

      {/* Settings form */}
      <div className="fgt" style={{marginBottom:16}}>Settings</div>
      <ExtensionSettingsForm ext={ext} onSaved={updated=>setExt(updated)}/>

      {/* Manifest sync */}
      {ext.manifest_url&&(
        <div style={{marginTop:24,paddingTop:20,borderTop:"0.5px solid var(--b1)"}}>
          <div style={{fontSize:13,fontWeight:500,color:"var(--t2)",marginBottom:6}}>Manifest</div>
          <div style={{fontSize:12,color:"var(--t4)",marginBottom:12}}>
            Re-fetch the manifest from the source URL to pick up updated metadata, logo, banner, and bundle URL without reinstalling.
          </div>
          <button onClick={syncManifest} disabled={syncing}
            style={{fontSize:12,padding:"6px 16px",borderRadius:8,
              background:"rgba(96,165,250,0.08)",border:"0.5px solid rgba(96,165,250,0.3)",
              color:"#60a5fa",cursor:syncing?"default":"pointer",fontFamily:"inherit",
              opacity:syncing?0.6:1}}>
            <i className="fa-solid fa-rotate" style={{marginRight:6,fontSize:11}}/>{syncing?"Syncing…":"Sync manifest"}
          </button>
        </div>
      )}

      {/* Danger zone */}
      <div style={{marginTop:32,paddingTop:24,borderTop:"0.5px solid var(--b1)"}}>
        <div style={{fontSize:13,fontWeight:500,color:"var(--red)",marginBottom:12}}>Danger zone</div>
        {!confirmUninstall
          ? <button onClick={()=>setConfirmUninstall(true)}
              style={{fontSize:12,padding:"6px 16px",borderRadius:8,background:"rgba(239,68,68,0.08)",
                border:"0.5px solid rgba(239,68,68,0.3)",color:"var(--red)",cursor:"pointer",
                fontFamily:"inherit"}}>
              Uninstall extension
            </button>
          : <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:13,color:"var(--t3)"}}>
                Remove {ext.name} and all its settings?
              </span>
              <button onClick={uninstall}
                style={{fontSize:12,padding:"6px 14px",borderRadius:8,
                  background:"var(--red)",border:"none",color:"#fff",
                  cursor:"pointer",fontFamily:"inherit",fontWeight:500}}>
                Confirm uninstall
              </button>
              <button onClick={()=>setConfirmUninstall(false)}
                style={{fontSize:12,padding:"6px 14px",borderRadius:8,
                  background:"none",border:"0.5px solid var(--b1)",color:"var(--t4)",
                  cursor:"pointer",fontFamily:"inherit"}}>
                Cancel
              </button>
            </div>}

        {/* Force remove — only shown when extension failed to load */}
        {ext.load_status !== "loaded" && (
          <div style={{marginTop:16,paddingTop:16,borderTop:"0.5px solid var(--b1)"}}>
            <div style={{fontSize:12,color:"var(--t4)",marginBottom:10}}>
              This extension failed to load. If uninstall is not working, use force remove to delete
              the record immediately. Migration rollback and module cleanup are skipped — you may need
              to clean up any database tables this extension created manually.
            </div>
            {!confirmForce
              ? <button onClick={()=>setConfirmForce(true)}
                  style={{fontSize:12,padding:"6px 16px",borderRadius:8,background:"rgba(239,68,68,0.08)",
                    border:"0.5px solid rgba(239,68,68,0.3)",color:"var(--red)",cursor:"pointer",
                    fontFamily:"inherit"}}>
                  Force remove
                </button>
              : <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  <span style={{fontSize:13,color:"var(--t3)"}}>
                    Force-delete {ext.name} with no cleanup?
                  </span>
                  <button onClick={forceUninstall}
                    style={{fontSize:12,padding:"6px 14px",borderRadius:8,
                      background:"var(--red)",border:"none",color:"#fff",
                      cursor:"pointer",fontFamily:"inherit",fontWeight:500}}>
                    Confirm force remove
                  </button>
                  <button onClick={()=>setConfirmForce(false)}
                    style={{fontSize:12,padding:"6px 14px",borderRadius:8,
                      background:"none",border:"0.5px solid var(--b1)",color:"var(--t4)",
                      cursor:"pointer",fontFamily:"inherit"}}>
                    Cancel
                  </button>
                </div>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Extension Admin Page ──────────────────────────────────────────────────────
// Full per-extension admin page. Reached from the admin sidebar's "installed
// extensions" entry — each installed extension gets one of these regardless
// of whether it registered a custom admin panel via registerAdminPanel.
//
// Layout, top to bottom:
//
//   1. Identity strip (one row, ~40px tall)
//        name · version · status pill · spacer · enable toggle · ⋯ menu
//
//   2. Load status banner if not "loaded" (only shows for problem states).
//
//   3. The extension's registered admin panel component (registerAdminPanel),
//      if one exists. This is the page's primary content — admins came here
//      to interact with the extension's own UI, so it gets the prime visual
//      real estate immediately below the identity strip.
//
//   4. Settings form (when settings_schema is non-empty) — auto-generated.
//      Sits below the extension content with a thin divider above it. Saves
//      via the admin shell's top-right "Save changes" button (no inline
//      Save button; the form registers itself with window._nexusAdminSaveFn
//      and signals dirty via window._nexusAdminSetDirty on field changes).
//
//   5. "Advanced" — collapsible row, defaults closed. Contains the runtime
//      registrations side-by-side comparison panel. Diagnostic only.
//
//   6. Uninstall confirmation banner (only when invoked from the ⋯ menu).
//
// The ⋯ overflow menu houses Sync manifest, Uninstall extension, and (when
// present) the Repo link — all infrequent actions that don't deserve
// permanent visual weight.
//
// Enable/disable: piece 5 implemented live disable. Toggling off stops the
// extension's supervised processes, filters it out of every dispatch site
// (hooks, routes, side-data, digest) immediately. Modules stay loaded so
// re-enable is instant. The client-side rendering of slots/widgets the
// bundle pushed before disable persists until the user reloads.

function ExtensionAdminPage({slug}) {
  const [ext, setExt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [confirmForce, setConfirmForce] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const menuRef = useRef(null);

  const loadExt = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.get("/admin/extensions");
      const found = (d.extensions || []).find(e => e.slug === slug);
      if (!found) setError("Extension not found.");
      else setExt(found);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { loadExt(); }, [loadExt]);

  // Close the overflow menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const toggle = async () => {
    const d = await api.post(`/admin/extensions/${slug}/toggle`);
    if (d.extension) {
      setExt(d.extension);
      if (window.NexusExtensions && window.NexusExtensions.setExtensionActive) {
        window.NexusExtensions.setExtensionActive(d.extension.slug, !!d.extension.enabled);
      }
      if (window._nexusAdminReloadExtensions) window._nexusAdminReloadExtensions();
    }
  };

  const uninstall = async () => {
    const d = await api.delete(`/admin/extensions/${slug}`);
    if (d.ok) {
      toast(`${ext.name} uninstalled`);
      // Piece 5: surface any warnings from the uninstall.
      if (d.warnings && d.warnings.length > 0) {
        d.warnings.forEach(w => toast(`Uninstall warning: ${w}`, "warn"));
      }
      // Strip in-memory registrations so sidebar entries and other
      // contributed surfaces disappear immediately.
      if (window.NexusExtensions && window.NexusExtensions.removeExtension) {
        window.NexusExtensions.removeExtension(slug);
      }
      if (window._nexusAdminNav) window._nexusAdminNav("extensions");
    } else {
      toast(d.error || "Uninstall failed", "err");
    }
  };

  const forceUninstall = async () => {
    const d = await api.delete(`/admin/extensions/${slug}/force`);
    if(d.ok) {
      toast(`${ext.name} force-removed`);
      if(d.warnings && d.warnings.length > 0) {
        d.warnings.forEach(w => toast(`Cleanup warning: ${w}`, "warn"));
      }
      if(window.NexusExtensions && window.NexusExtensions.removeExtension) {
        window.NexusExtensions.removeExtension(slug);
      }
      if(window._nexusAdminNav) window._nexusAdminNav("extensions");
    } else {
      toast(d.error || "Force remove failed", "err");
    }
  };

  const runMigrations = async () => {
    setMenuOpen(false);
    const d = await api.post(`/admin/extensions/${slug}/migrate`);
    if(d.ok) {
      toast(d.message || (d.ran === 0 ? "All migrations already up" : `Ran ${d.ran} migration(s) successfully`));
    } else {
      toast(d.error || "Migration failed", "err");
    }
  };

  const syncManifest = async () => {
    setSyncing(true);
    setMenuOpen(false);
    try {
      const d = await api.post(`/admin/extensions/${slug}/sync`);
      if (d.extension) { setExt(d.extension); toast("Manifest synced"); }
      else toast(d.error || "Sync failed", "err");
    } finally { setSyncing(false); }
  };

  if (loading) {
    return (
      <div style={{padding:"48px 0",textAlign:"center",color:"var(--t5)"}}>
        <i className="fa-solid fa-spinner fa-spin" style={{marginRight:8}}/>
        Loading…
      </div>
    );
  }

  if (error || !ext) {
    return (
      <div style={{padding:"48px 0",textAlign:"center",color:"var(--t5)",fontSize:13}}>
        {error || "Extension not found."}
      </div>
    );
  }

  // Find the registered admin panel component for this slug (if the extension
  // registered one). The bundle's registerAdminPanel call populates this.
  const registeredPanel = window.NexusExtensions
    && window.NexusExtensions.getAdminPanels().find(p => p.slug === slug);

  // Load status pill — small inline indicator next to the name. Skips
  // entirely when the extension is loaded cleanly (the banner below covers
  // the problem cases).
  const statusPill =
    ext.load_status === "loaded"
      ? <span style={{fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:20,
          background:"rgba(52,211,153,0.1)",border:"0.5px solid rgba(52,211,153,0.3)",
          color:"#34d399"}}>Loaded</span>
      : null;

  return (
    <div>
      {/* ─── Identity strip ─────────────────────────────────────────────── */}
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
        <div style={{flex:1,minWidth:0,display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"}}>
          <span style={{fontSize:16,fontWeight:600,color:"var(--t1)"}}>{ext.name}</span>
          <span style={{fontSize:12,color:"var(--t5)"}}>v{ext.version}</span>
          {statusPill}
        </div>

        {/* Enable toggle — naked toggle, no surrounding box or text label.
            Piece 5: live disable. Toggling off takes effect immediately. */}
        <div title={ext.enabled ? "Disable this extension" : "Enable this extension"}
             style={{display:"flex",alignItems:"center",flexShrink:0}}>
          <Toggle value={ext.enabled} onChange={toggle}/>
        </div>

        {/* Overflow menu — rare actions (Repo, Sync, Uninstall) live here */}
        <div ref={menuRef} style={{position:"relative",flexShrink:0}}>
          <button onClick={() => setMenuOpen(o => !o)}
            style={{background:"none",border:"0.5px solid var(--b1)",borderRadius:8,
              padding:"6px 10px",cursor:"pointer",color:"var(--t3)",
              fontSize:14,fontFamily:"inherit",display:"flex",alignItems:"center"}}>
            <i className="fa-solid fa-ellipsis"/>
          </button>
          {menuOpen && (
            <div style={{position:"absolute",right:0,top:"100%",marginTop:6,
              background:"var(--s2)",border:"0.5px solid var(--b1)",borderRadius:10,
              padding:"4px",minWidth:200,zIndex:50,
              boxShadow:"0 8px 24px rgba(0,0,0,0.4)",
              display:"flex",flexDirection:"column",gap:0}}>
              {ext.homepage && (
                <a href={ext.homepage} target="_blank" rel="noopener"
                  onClick={() => setMenuOpen(false)}
                  style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",
                    fontSize:13,color:"var(--t2)",textDecoration:"none",borderRadius:6,
                    cursor:"pointer"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--s3)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <i className="fa-solid fa-arrow-up-right-from-square" style={{fontSize:11,width:14}}/>
                  Open repo
                </a>
              )}
              {ext.manifest_url && (
                <button onClick={syncManifest} disabled={syncing}
                  style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",
                    fontSize:13,color:"var(--t2)",border:"none",background:"transparent",
                    borderRadius:6,cursor:syncing?"default":"pointer",fontFamily:"inherit",
                    opacity:syncing?0.6:1,textAlign:"left"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--s3)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <i className="fa-solid fa-rotate" style={{fontSize:11,width:14}}/>
                  {syncing?"Syncing manifest…":"Sync manifest"}
                </button>
              )}
              <button onClick={runMigrations}
                style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",
                  fontSize:13,color:"var(--t2)",border:"none",background:"transparent",
                  borderRadius:6,cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}
                onMouseEnter={e=>e.currentTarget.style.background="var(--s3)"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <i className="fa-solid fa-database" style={{fontSize:11,width:14}}/>
                Run migrations
              </button>
              <div style={{height:1,background:"var(--b1)",margin:"4px 0"}}/>
              <button onClick={() => {setMenuOpen(false); setConfirmUninstall(true);}}
                style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",
                  fontSize:13,color:"var(--red)",border:"none",background:"transparent",
                  borderRadius:6,cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}
                onMouseEnter={e=>e.currentTarget.style.background="rgba(248,113,113,0.08)"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <i className="fa-solid fa-trash" style={{fontSize:11,width:14}}/>
                Uninstall extension
              </button>
              {ext.load_status !== "loaded" && (
                <button onClick={() => {setMenuOpen(false); setConfirmForce(true);}}
                  style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",
                    fontSize:13,color:"var(--red)",border:"none",background:"transparent",
                    borderRadius:6,cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(248,113,113,0.08)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <i className="fa-solid fa-bolt" style={{fontSize:11,width:14}}/>
                  Force remove
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ─── Load-status banner (only when not loaded) ───────────────────── */}
      <ExtensionStatusBanner ext={ext}/>

      {/* ─── Extension content (primary real estate) ──────────────────────
          The registered admin panel renders immediately below the identity
          strip. Settings and Advanced sit below it so they don't push the
          extension's content off the first viewport. */}
      {registeredPanel && (
        <div>
          {window.React.createElement(registeredPanel.component, null)}
        </div>
      )}

      {/* ─── Settings — below the extension content ─────────────────────── */}
      {/* The form returns null when there's no settings_schema. The thin
          divider only renders alongside a non-empty form to avoid a stray
          divider line on extensions with no settings. */}
      {Object.keys(ext.settings_schema || {}).length > 0 && (
        <div style={{marginTop:registeredPanel?32:0,
                     paddingTop:registeredPanel?24:0,
                     borderTop:registeredPanel?"0.5px solid var(--b1)":"none"}}>
          <ExtensionSettingsForm ext={ext} onSaved={updated => setExt(updated)}/>
        </div>
      )}

      {/* ─── Advanced — collapsed by default ─────────────────────────────── */}
      <div style={{marginTop:24}}>
        <button onClick={() => setAdvancedOpen(o => !o)}
          style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",
            background:"none",border:"none",cursor:"pointer",color:"var(--t4)",
            fontSize:12,fontFamily:"inherit",fontWeight:500}}>
          <i className={`fa-solid fa-chevron-${advancedOpen?"down":"right"}`}
            style={{fontSize:9,color:"var(--t5)"}}/>
          Advanced
        </button>
        {advancedOpen && (
          <div style={{marginTop:8,paddingLeft:18}}>
            <ExtensionRuntimePanel slug={ext.slug}/>
          </div>
        )}
      </div>

      {/* ─── Uninstall confirmation (inline, appears when invoked from menu) */}
      {confirmUninstall && (
        <div style={{marginTop:18,padding:"12px 14px",
          background:"rgba(248,113,113,0.06)",border:"0.5px solid rgba(248,113,113,0.25)",
          borderRadius:8,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <i className="fa-solid fa-triangle-exclamation" style={{color:"var(--red)",fontSize:14}}/>
          <span style={{fontSize:13,color:"var(--t2)",flex:1}}>
            Remove {ext.name} and all its settings?
          </span>
          <button onClick={uninstall}
            style={{fontSize:12,padding:"6px 14px",borderRadius:8,
              background:"var(--red)",border:"none",color:"#fff",
              cursor:"pointer",fontFamily:"inherit",fontWeight:500}}>
            Confirm uninstall
          </button>
          <button onClick={() => setConfirmUninstall(false)}
            style={{fontSize:12,padding:"6px 14px",borderRadius:8,
              background:"none",border:"0.5px solid var(--b1)",color:"var(--t4)",
              cursor:"pointer",fontFamily:"inherit"}}>
            Cancel
          </button>
        </div>
      )}

      {confirmForce && (
        <div style={{marginTop:18,padding:"12px 14px",
          background:"rgba(248,113,113,0.06)",border:"0.5px solid rgba(248,113,113,0.25)",
          borderRadius:8,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <i className="fa-solid fa-bolt" style={{color:"var(--red)",fontSize:14}}/>
          <span style={{fontSize:13,color:"var(--t2)",flex:1}}>
            Force-delete {ext.name}? Migration rollback and module cleanup are skipped — you may need to manually remove any database tables this extension created.
          </span>
          <button onClick={forceUninstall}
            style={{fontSize:12,padding:"6px 14px",borderRadius:8,
              background:"var(--red)",border:"none",color:"#fff",
              cursor:"pointer",fontFamily:"inherit",fontWeight:500}}>
            Confirm force remove
          </button>
          <button onClick={() => setConfirmForce(false)}
            style={{fontSize:12,padding:"6px 14px",borderRadius:8,
              background:"none",border:"0.5px solid var(--b1)",color:"var(--t4)",
              cursor:"pointer",fontFamily:"inherit"}}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function AdminExtensionsPanel() {
  const [tab, setTab]                   = useState("all");       // "all" | "installed" | "url"
  const [extensions, setExtensions]     = useState(null);        // installed extensions
  const [storeItems, setStoreItems]     = useState(null);        // registry entries
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeError, setStoreError]     = useState(null);
  const [installing, setInstalling]     = useState(null);        // slug being installed
  const [installUrl, setInstallUrl]     = useState("");
  const [installError, setInstallError] = useState(null);
  const [filter, setFilter]             = useState("");          // search/filter string
  const [category, setCategory]         = useState("");          // active category filter
  const [sort, setSort]                 = useState("default");   // default|az|za
  const [readme, setReadme]             = useState(null);        // { item, content, loading, error }
  const [updates, setUpdates]           = useState(null);        // null | [] | [{slug,name,current,latest,notes}]
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatingSlug, setUpdatingSlug] = useState(null);

  // Derive the raw README URL from a GitHub homepage URL.
  // https://github.com/owner/repo  →  https://raw.githubusercontent.com/owner/repo/HEAD/README.md
  // Also handles readme_url field if the extension supplies one directly.
  const readmeUrl = (item) => {
    if(item.readme_url) return item.readme_url;
    if(!item.homepage) return null;
    const m = item.homepage.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(\/.*)?$/);
    if(!m) return null;
    return `https://raw.githubusercontent.com/${m[1]}/HEAD/README.md`;
  };

  const openReadme = async (item, e) => {
    e.stopPropagation();
    const url = readmeUrl(item);
    if(!url) return;
    setReadme({ item, content: null, loading: true, error: null });
    try {
      const r = await fetch(url);
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      setReadme({ item, content: text, loading: false, error: null });
    } catch(err) {
      setReadme({ item, content: null, loading: false, error: "Could not load README." });
    }
  };

  useEffect(()=>{ loadExtensions(); loadStore(); },[]);

  const loadExtensions = () =>
    api.get("/admin/extensions").then(d=>setExtensions(d.extensions||[]));

  const loadStore = () => {
    setStoreLoading(true); setStoreError(null);
    api.get("/admin/extensions/store")
      .then(d=>{ if(d.extensions) setStoreItems(d.extensions); else setStoreError(d.error||"Failed to load store"); })
      .catch(()=>setStoreError("Network error"))
      .finally(()=>setStoreLoading(false));
  };

  const checkForUpdates = async () => {
    setCheckingUpdates(true);
    const d = await api.post("/admin/extensions/check-updates");
    setCheckingUpdates(false);
    if(d.updates !== undefined) {
      setUpdates(d.updates);
      if(d.updates.length === 0) toast("All extensions are up to date");
      else toast(`${d.updates.length} update${d.updates.length>1?"s":""} available`);
    } else {
      toast(d.error||"Update check failed","err");
    }
    loadExtensions();
  };

  const updateExtension = async (slug) => {
    setUpdatingSlug(slug);
    const d = await api.post(`/admin/extensions/${slug}/update`);
    setUpdatingSlug(null);
    if(d.extension) {
      setUpdates(prev=>(prev||[]).filter(u=>u.slug!==slug));
      toast(`${d.extension.name} updated to v${(d.extension.installed_version||"").replace(/^v/,"")}`);
      loadExtensions();
    } else {
      toast(d.error||"Update failed","err");
    }
  };

  const installFromUrl = async () => {
    if(!installUrl.trim()) return;
    setInstalling("__url__"); setInstallError(null);
    const d = await api.post("/admin/extensions/install-from-url", {url: installUrl.trim()});
    if(d.extension) {
      toast(`${d.extension.name} installed`);
      setInstallUrl(""); loadExtensions(); loadStore(); setTab("installed");
    } else {
      setInstallError(d.error||"Installation failed");
    }
    setInstalling(null);
  };

  const installFromStore = async (item) => {
    setInstalling(item.slug);
    const d = await api.post("/admin/extensions/install-from-url", {url: item.manifest_url});
    if(d.extension) {
      toast(`${d.extension.name} installed`);
      loadExtensions();
      setStoreItems(prev=>prev.map(s=>s.slug===item.slug?{...s,installed:true}:s));
    } else {
      toast(d.error||"Installation failed","err");
    }
    setInstalling(null);
  };

  // Merge store + installed into a unified list
  const installedSlugs = new Set((extensions||[]).map(e=>e.slug));
  const installedBySlug = Object.fromEntries((extensions||[]).map(e=>[e.slug, e]));

  // Build full item list from store + any installed-but-not-in-store
  const allItems = (() => {
    const store = storeItems || [];
    const storeSlugs = new Set(store.map(i=>i.slug));
    const installedOnly = (extensions||[])
      .filter(e=>!storeSlugs.has(e.slug))
      .map(e=>({
        slug: e.slug, name: e.name, description: e.description,
        author: e.author, version: e.installed_version||e.version, homepage: e.homepage,
        logo_url: e.logo_url, banner_url: e.banner_url,
        categories: e.categories||[], installs: null,
        manifest_url: e.manifest_url, installed: true,
        installed_version: e.installed_version,
        latest_version: e.latest_version,
        release_notes: e.release_notes,
        update_available: !!(updates||[]).find(u=>u.slug===e.slug),
        load_status: e.load_status,
        load_error:  e.load_error,
        loaded_at:   e.loaded_at,
      }));
    // For store items that are installed, merge DB values over store entry
    // so that synced logo_url/banner_url always takes precedence over the registry.
    const updatesBySlug = Object.fromEntries((updates||[]).map(u=>[u.slug, u]));
    const storeWithInstalled = store.map(item => {
      const inst = installedBySlug[item.slug];
      if(!inst) return item;
      return {
        ...item,
        logo_url:          inst.logo_url          || item.logo_url,
        banner_url:        inst.banner_url         || item.banner_url,
        version:           inst.installed_version  || inst.version || item.version,
        installed_version: inst.installed_version,
        latest_version:    inst.latest_version,
        release_notes:     inst.release_notes,
        update_available:  !!updatesBySlug[item.slug],
        installed:         true,
        load_status:       inst.load_status,
        load_error:        inst.load_error,
        loaded_at:         inst.loaded_at,
      };
    });
    return [...storeWithInstalled, ...installedOnly];
  })();

  const q = filter.trim().toLowerCase();
  const allCategories = [...new Set(allItems.flatMap(i => i.categories||[]))].sort();

  const visibleItems = allItems.filter(item=>{
    if(tab==="installed" && !installedSlugs.has(item.slug)) return false;
    if(tab==="all" && installedSlugs.has(item.slug)) return false;
    if(category && !(item.categories||[]).includes(category)) return false;
    if(q) return (
      item.name?.toLowerCase().includes(q) ||
      item.description?.toLowerCase().includes(q) ||
      item.author?.toLowerCase().includes(q) ||
      (item.categories||[]).some(c=>c.toLowerCase().includes(q))
    );
    return true;
  }).sort((a,b)=>{
    // Extensions with available updates always float to the top
    if(a.update_available && !b.update_available) return -1;
    if(!a.update_available && b.update_available) return 1;
    if(sort==="az") return (a.name||"").localeCompare(b.name||"");
    if(sort==="za") return (b.name||"").localeCompare(a.name||"");
    return 0;
  });

  // Accent colour derived from slug for fallback icon background
  const slugColor = slug => {
    const palette = ["#a78bfa","#60a5fa","#34d399","#f472b6","#fb923c","#facc15","#38bdf8"];
    let h = 0; for(const c of (slug||"")) h = (h*31 + c.charCodeAt(0)) & 0xffffffff;
    return palette[Math.abs(h) % palette.length];
  };

  const TABS = [
    {id:"all",       label:"All extensions"},
    {id:"installed", label:`Installed${extensions?.length?` · ${extensions.length}`:""}` },
    {id:"url",       label:"Install from URL"},
  ];

  return (
    <div style={{position:"relative"}}>
      {/* Tab bar + search */}
      <div style={{marginBottom:24}}>
        {/* Tabs row — desktop: underline buttons; mobile: dropdown. */}
        <div className="admin-tabs-underline">
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              className={`admin-tab-underline${tab===t.id?" active":""}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="admin-tabs-mob">
          <details>
            <summary>
              <span className="atm-label">
                <span>{(TABS.find(t=>t.id===tab)||TABS[0]).label}</span>
              </span>
              <i className="fa-solid fa-chevron-down" style={{fontSize:11,color:"var(--t5)"}}/>
            </summary>
            <div className="atm-menu">
              {TABS.map(t=>(
                <div key={t.id}
                  className={`atm-item${tab===t.id?" active":""}`}
                  onClick={e=>{setTab(t.id); e.currentTarget.closest("details").removeAttribute("open");}}>
                  {t.label}
                </div>
              ))}
            </div>
          </details>
        </div>
        {/* Actions row — search + check for updates + refresh */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginTop:10,flexWrap:"wrap"}}>
          {tab!=="url"&&(
            <div style={{position:"relative",flexShrink:0}}>
              <i className="fa-solid fa-magnifying-glass" style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:11,color:"var(--t5)",pointerEvents:"none"}}/>
              <input value={filter} onChange={e=>setFilter(e.target.value)}
                placeholder="Search…"
                style={{paddingLeft:28,paddingRight:10,height:30,fontSize:12,background:"var(--s3)",
                  border:"0.5px solid var(--b1)",borderRadius:8,color:"var(--t1)",
                  fontFamily:"inherit",outline:"none",width:160}}/>
            </div>
          )}
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:4}}>
            <button onClick={checkForUpdates} disabled={checkingUpdates}
              style={{background:"rgba(139,92,246,.12)",
                border:"0.5px solid rgba(139,92,246,.3)",borderRadius:8,
                color:"var(--ac)",cursor:checkingUpdates?"default":"pointer",
                padding:"6px 12px",fontSize:12,flexShrink:0,fontFamily:"inherit",fontWeight:500,
                display:"flex",alignItems:"center",gap:6,opacity:checkingUpdates?0.6:1}}
              title="Check for updates">
              <i className={`fa-solid fa-arrow-up-right-dots${checkingUpdates?" fa-beat":""}`} style={{fontSize:12}}/>
              {checkingUpdates?"Checking…":"Check for updates"}
            </button>
            <button onClick={()=>{if(!storeLoading){loadStore();loadExtensions();}}}
              style={{background:"none",border:"none",
                color:storeLoading?"var(--ac)":"var(--t5)",cursor:storeLoading?"default":"pointer",padding:"4px 8px",fontSize:13,flexShrink:0,transition:"color .2s"}}
              title="Refresh">
              <i className={`fa-solid fa-rotate-right${storeLoading?" fa-spin":""}`}/>
            </button>
          </div>
        </div>
      </div>

      {/* Install from URL tab */}
      {tab==="url"&&(
        <div style={{maxWidth:560}}>
          <div style={{fontSize:14,fontWeight:500,color:"var(--t1)",marginBottom:4}}>Install from GitHub or URL</div>
          <div style={{fontSize:12,color:"var(--t5)",marginBottom:16}}>
            Paste a GitHub repo URL or a direct link to a <code style={{fontSize:11}}>manifest.json</code> file.
          </div>
          <div style={{display:"flex",gap:8}}>
            <input className="fi" style={{flex:1}} value={installUrl}
              onChange={e=>setInstallUrl(e.target.value)}
              placeholder="https://github.com/someone/nexus-my-extension"
              onKeyDown={e=>e.key==="Enter"&&installFromUrl()}/>
            <button className="btn-primary" style={{fontSize:13,padding:"7px 20px",flexShrink:0}}
              onClick={installFromUrl} disabled={installing==="__url__"||!installUrl.trim()}>
              {installing==="__url__"?"Installing…":"Install"}
            </button>
          </div>
          {installError&&<div style={{fontSize:12,color:"var(--red)",marginTop:10}}>{installError}</div>}
        </div>
      )}

      {/* Category pills + sort */}
      {tab!=="url"&&allCategories.length>0&&(
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:16}}>
          <span onClick={()=>setCategory("")}
            style={{fontSize:11,padding:"3px 10px",borderRadius:20,cursor:"pointer",fontFamily:"inherit",userSelect:"none",
              background:category===""?"var(--ac-bg)":"transparent",
              color:category===""?"var(--ac)":"var(--t4)",
              border:`0.5px solid ${category===""?"var(--ac-border)":"var(--b2)"}`}}>
            All
          </span>
          {allCategories.map(c=>(
            <span key={c} onClick={()=>setCategory(p=>p===c?"":c)}
              style={{fontSize:11,padding:"3px 10px",borderRadius:20,cursor:"pointer",fontFamily:"inherit",userSelect:"none",textTransform:"lowercase",
                background:category===c?"var(--ac-bg)":"transparent",
                color:category===c?"var(--ac)":"var(--t4)",
                border:`0.5px solid ${category===c?"var(--ac-border)":"var(--b2)"}`}}>
              {c}
            </span>
          ))}
          <div style={{marginLeft:"auto",flexShrink:0}}>
            <select value={sort} onChange={e=>setSort(e.target.value)}
              style={{fontSize:11,padding:"3px 8px",borderRadius:8,background:"var(--s3)",
                border:"0.5px solid var(--b1)",color:"var(--t3)",fontFamily:"inherit",cursor:"pointer"}}>
              <option value="default">Default</option>
              <option value="az">A → Z</option>
              <option value="za">Z → A</option>
            </select>
          </div>
        </div>
      )}

      {/* Loading / error states */}
      {tab!=="url"&&storeLoading&&!storeItems&&(
        <div style={{padding:"60px 0",textAlign:"center",color:"var(--t5)"}}>
          <i className="fa-solid fa-spinner fa-spin" style={{fontSize:20,marginBottom:10,display:"block"}}/>
          Loading extensions…
        </div>
      )}
      {tab!=="url"&&storeError&&!storeItems&&(
        <div style={{padding:16,background:"rgba(239,68,68,0.06)",border:"0.5px solid rgba(239,68,68,0.2)",borderRadius:10,fontSize:13,color:"var(--red)",display:"flex",alignItems:"flex-start",gap:10}}>
          <i className="fa-solid fa-triangle-exclamation" style={{marginTop:1,flexShrink:0}}/>
          <div>
            <div style={{fontWeight:500,marginBottom:4}}>Could not load extension store</div>
            <div style={{color:"var(--t4)",fontSize:12}}>
              {storeError.startsWith("%") || storeError.length > 200
                ? "The registry returned an invalid response. Check your network connection or try again later."
                : storeError}
            </div>
          </div>
        </div>
      )}

      {/* Extension cards grid */}
      {tab!=="url"&&(storeItems||extensions)&&(
        <>
          {visibleItems.length===0&&(
            <div style={{padding:"60px 0",textAlign:"center",color:"var(--t5)"}}>
              <i className="fa-solid fa-puzzle-piece" style={{fontSize:28,opacity:.3,marginBottom:12,display:"block"}}/>
              <div style={{fontSize:14,marginBottom:4}}>
                {tab==="installed"?"No extensions installed yet":tab==="all"?"No extensions available":"No extensions found"}
              </div>
              {tab==="installed"&&<div style={{fontSize:12}}>Browse the All extensions tab to find something to install.</div>}
              {tab==="all"&&<div style={{fontSize:12}}>All available extensions are already installed.</div>}
            </div>
          )}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:16}}>
            {visibleItems.map(item=>{
              const isInstalled = installedSlugs.has(item.slug);
              const isBusy      = installing===item.slug;
              const accentColor = slugColor(item.slug);

              // Installed cards become navigation tiles — click anywhere
              // outside an interactive child (button, link) and you go to
              // the extension's admin page. Action buttons inside the card
              // call e.stopPropagation() to avoid bubbling.
              const cardOnClick = isInstalled
                ? () => { if (window._nexusAdminNav) window._nexusAdminNav(`ext-panel-${item.slug}`); }
                : undefined;

              return (
                <div key={item.slug} style={{
                  background:"var(--s3)",border:"0.5px solid var(--b1)",borderRadius:14,
                  overflow:"hidden",display:"flex",flexDirection:"column",
                  transition:"border-color .15s",
                  cursor: isInstalled ? "pointer" : "default"}}
                  onClick={cardOnClick}
                  onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(255,255,255,0.15)"}
                  onMouseLeave={e=>e.currentTarget.style.borderColor="var(--b1)"}>

                  {/* Banner / hero image */}
                  <div style={{aspectRatio:"2/1",position:"relative",flexShrink:0,
                    background:item.banner_url?"transparent":`linear-gradient(135deg,${accentColor}22,${accentColor}08)`}}>
                    {item.banner_url&&(
                      <div style={{position:"absolute",inset:0,overflow:"hidden"}}>
                        <img src={item.banner_url} alt=""
                          style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}
                          onError={e=>{e.target.parentElement.style.display="none";}}/>
                      </div>
                    )}
                    {/* Logo overlapping the banner */}
                    <div style={{position:"absolute",bottom:-20,left:16,
                      width:48,height:48,borderRadius:12,
                      background:item.logo_url?"var(--bg)":accentColor+"18",
                      border:`2px solid var(--s3)`,
                      display:"flex",alignItems:"center",justifyContent:"center",
                      overflow:"hidden",flexShrink:0}}>
                      {item.logo_url
                        ?<img src={item.logo_url} alt={item.name}
                            style={{width:"100%",height:"100%",objectFit:"cover"}}
                            onError={e=>{e.target.style.display="none";e.target.nextSibling.style.display="flex";}}/>
                        :null}
                      <i className="fa-solid fa-puzzle-piece"
                        style={{fontSize:20,color:accentColor,
                          display:item.logo_url?"none":"flex"}}/>
                    </div>
                    {/* Installed / update available / load-status badges */}
                    {isInstalled&&(
                      <div style={{position:"absolute",top:10,right:10,display:"flex",gap:6}}>
                        {item.update_available&&(
                          <div style={{fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:20,
                            background:"rgba(251,146,60,0.15)",border:"0.5px solid rgba(251,146,60,0.4)",
                            color:"#fb923c",display:"flex",alignItems:"center",gap:4}}>
                            <i className="fa-solid fa-arrow-up" style={{fontSize:9}}/>
                            Update
                          </div>
                        )}
                        {(() => {
                          // Show a status pill reflecting the load_status from the
                          // server. Default to the legacy "Installed" green badge
                          // for rows that pre-date the load_status field (still
                          // null on first migrate before load_all_enabled runs).
                          const info  = statusInfo(item.load_status || "loaded");
                          const tone  = STATUS_TONE_STYLE[info.tone];
                          return (
                            <div style={{fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:20,
                              background:tone.bg,border:`0.5px solid ${tone.border}`,
                              color:tone.color,display:"flex",alignItems:"center",gap:4}}>
                              <i className={`fa-solid ${info.icon}`} style={{fontSize:9}}/>
                              {info.label}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>

                  {/* Card body */}
                  <div style={{padding:"28px 16px 16px",flex:1,display:"flex",flexDirection:"column",gap:8}}>
                    {/* Name + version */}
                    <div style={{display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap"}}>
                      <div style={{fontSize:15,fontWeight:500,color:"var(--t1)",lineHeight:1.2}}>{item.name}</div>
                      {(item.installed_version||item.version)&&<div style={{fontSize:11,color:"var(--t5)",flexShrink:0}}>v{(item.installed_version||item.version).replace(/^v/,"")}</div>}
                      {item.update_available&&item.latest_version&&(
                        <div style={{fontSize:11,color:"#fb923c",flexShrink:0}}>
                          → v{(item.latest_version||"").replace(/^v/,"")} available
                        </div>
                      )}
                    </div>
                    {/* Release notes — shown when update is available */}
                    {item.update_available&&item.release_notes&&(
                      <div style={{fontSize:12,color:"var(--t4)",background:"rgba(251,146,60,0.05)",
                        border:"0.5px solid rgba(251,146,60,0.2)",borderRadius:8,padding:"8px 12px",
                        lineHeight:1.6,maxHeight:80,overflowY:"auto"}}>
                        {item.release_notes.split("\n").slice(0,5).join(" ").slice(0,200)}
                        {item.release_notes.length>200?"…":""}
                      </div>
                    )}

                    {/* Author */}
                    <div style={{fontSize:12,color:"var(--t5)"}}>
                      by {item.author||"unknown"}
                    </div>

                    {/* Description */}
                    {item.description&&(
                      <div style={{fontSize:12,color:"var(--t3)",lineHeight:1.55,
                        display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",
                        overflow:"hidden"}}>
                        {item.description}
                      </div>
                    )}

                    {/* Load-status banner — shown inline in the card for any
                        installed extension that isn't fully loaded. Carries
                        the full load_error text so the admin can diagnose
                        without leaving the page. Loaded extensions skip this
                        (the green pill in the banner overlay is enough). */}
                    {isInstalled && item.load_status && item.load_status !== "loaded" && (
                      <ExtensionStatusBanner ext={item}/>
                    )}

                    {/* Category tags */}
                    {item.categories?.length>0&&(
                      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:2}}>
                        {item.categories.slice(0,4).map(c=>(
                          <span key={c} style={{fontSize:10,padding:"2px 8px",borderRadius:20,
                            background:"rgba(255,255,255,0.05)",border:"0.5px solid var(--b1)",
                            color:"var(--t4)"}}>
                            {c}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Action row */}
                    <div style={{display:"flex",gap:8,marginTop:"auto",paddingTop:12,
                      borderTop:"0.5px solid var(--b1)",flexWrap:"wrap"}}>
                      {/* GitHub button — always shown if homepage exists */}
                      {item.homepage&&(
                        <a href={item.homepage} target="_blank" rel="noopener"
                          onClick={e=>e.stopPropagation()}
                          style={{fontSize:12,padding:"6px 12px",borderRadius:8,
                            border:"0.5px solid var(--b1)",color:"var(--t3)",
                            textDecoration:"none",display:"flex",alignItems:"center",
                            gap:6,flexShrink:0,fontFamily:"inherit",background:"none",
                            cursor:"pointer"}}>
                          <i className="fa-brands fa-github" style={{fontSize:13}}/>
                          GitHub
                        </a>
                      )}
                      {/* View Readme button — shown if we can derive a README URL */}
                      {readmeUrl(item)&&(
                        <button
                          onClick={e=>openReadme(item,e)}
                          style={{fontSize:12,padding:"6px 12px",borderRadius:8,
                            border:"0.5px solid var(--b1)",color:"var(--t3)",
                            background:"none",cursor:"pointer",fontFamily:"inherit",
                            display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                          <i className="fa-solid fa-file-lines" style={{fontSize:12}}/>
                          View Readme
                        </button>
                      )}
                      <div style={{flex:1}}/>
                      {isInstalled?(
                        <div style={{display:"flex",alignItems:"center",gap:8,marginLeft:"auto"}}>
                          {item.update_available&&(
                            <button onClick={e=>{e.stopPropagation(); updateExtension(item.slug);}}
                              disabled={updatingSlug===item.slug}
                              style={{fontSize:12,padding:"6px 14px",borderRadius:8,
                                background:"rgba(251,146,60,0.1)",border:"0.5px solid rgba(251,146,60,0.4)",
                                color:"#fb923c",cursor:updatingSlug===item.slug?"default":"pointer",
                                fontFamily:"inherit",fontWeight:500,
                                opacity:updatingSlug===item.slug?0.6:1}}>
                              <i className="fa-solid fa-arrow-up" style={{marginRight:5,fontSize:11}}/>
                              {updatingSlug===item.slug?"Updating…":`Update to v${(item.latest_version||"").replace(/^v/,"")}`}
                            </button>
                          )}
                          {/* "Manage" button — explicit navigation hint. The whole card is
                              clickable, but having a labeled button makes the affordance
                              clearer when the rest of the row has other buttons. */}
                          <button onClick={e=>{e.stopPropagation();
                            if(window._nexusAdminNav) window._nexusAdminNav(`ext-panel-${item.slug}`);
                          }} style={{fontSize:12,padding:"6px 14px",borderRadius:8,
                            background:"rgba(167,139,250,0.1)",border:"0.5px solid rgba(167,139,250,0.3)",
                            color:"#a78bfa",cursor:"pointer",fontFamily:"inherit",fontWeight:500,
                            display:"flex",alignItems:"center",gap:5}}>
                            <i className="fa-solid fa-gear" style={{fontSize:11}}/>Manage
                          </button>
                        </div>
                      ):(
                        <button
                          onClick={e=>{e.stopPropagation(); installFromStore(item);}}
                          disabled={isBusy||!item.manifest_url}
                          style={{fontSize:12,padding:"6px 16px",borderRadius:8,
                            background:"var(--ac)",border:"none",color:"#fff",
                            cursor:item.manifest_url?"pointer":"default",
                            fontFamily:"inherit",fontWeight:500,
                            opacity:(isBusy||!item.manifest_url)?0.6:1}}>
                          {isBusy?"Installing…":"Install"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* README modal */}
      {readme&&(
        <div
          onClick={()=>setReadme(null)}
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",
            zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",
            padding:24}}>
          <div
            onClick={e=>e.stopPropagation()}
            style={{background:"var(--s2)",border:"0.5px solid var(--b2)",
              borderRadius:16,width:"100%",maxWidth:760,
              maxHeight:"85vh",display:"flex",flexDirection:"column",
              overflow:"hidden"}}>
            {/* Modal header */}
            <div style={{display:"flex",alignItems:"center",gap:12,
              padding:"16px 20px",borderBottom:"0.5px solid var(--b1)",flexShrink:0}}>
              {readme.item.logo_url&&(
                <img src={readme.item.logo_url} alt=""
                  style={{width:28,height:28,borderRadius:6,objectFit:"cover",flexShrink:0}}/>
              )}
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>{readme.item.name}</div>
                <div style={{fontSize:11,color:"var(--t5)"}}>README.md</div>
              </div>
              {readme.item.homepage&&(
                <a href={readme.item.homepage} target="_blank" rel="noopener"
                  style={{fontSize:11,padding:"4px 10px",borderRadius:7,
                    border:"0.5px solid var(--b1)",color:"var(--t4)",
                    textDecoration:"none",display:"flex",alignItems:"center",gap:5,flexShrink:0}}>
                  <i className="fa-brands fa-github" style={{fontSize:12}}/>
                  GitHub
                </a>
              )}
              <button onClick={()=>setReadme(null)}
                style={{background:"none",border:"none",color:"var(--t4)",
                  fontSize:18,cursor:"pointer",padding:"0 4px",lineHeight:1,flexShrink:0}}>
                ✕
              </button>
            </div>
            {/* Modal body */}
            <div style={{flex:1,overflowY:"auto",padding:"24px 28px"}}>
              {readme.loading&&(
                <div style={{padding:"48px 0",textAlign:"center",color:"var(--t5)"}}>
                  <i className="fa-solid fa-spinner fa-spin" style={{fontSize:20,marginBottom:10,display:"block"}}/>
                  Loading README…
                </div>
              )}
              {readme.error&&(
                <div style={{padding:"48px 0",textAlign:"center",color:"var(--t5)"}}>
                  <i className="fa-solid fa-triangle-exclamation" style={{fontSize:20,marginBottom:10,display:"block",color:"var(--amber)"}}/>
                  {readme.error}
                </div>
              )}
              {readme.content&&<Md text={readme.content}/>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// Ready-made panel components extension developers can use as-is or compose.
// Exposed globally on window.NexusExtensionTemplates so bundles can import them
// without bundling React or any Nexus internals.
//
// Two templates are provided:
//
//   SimpleSettingsPanel — single-page template. Use for simpler extensions
//                         that don't need tabbed navigation. Render whatever
//                         JSX you want as children, or use the built-in
//                         fields shortcut for basic key/value settings.
//
//   TabbedPanel         — tabbed template. Use for more complex extensions
//                         with many options or distinct sections. Each tab
//                         renders whatever JSX the extension chooses —
//                         custom UI, status displays, action buttons, log
//                         viewers, a SimpleSettingsPanel, anything.
//                         TabbedPanel is pure chrome with no opinion on
//                         what lives inside any tab.
//
// Both templates are navigation containers, not limiters. Extensions render
// whatever they need inside them.
//
// Usage from an extension bundle:
//
//   const { SimpleSettingsPanel, TabbedPanel } = window.NexusExtensionTemplates;
//
//   // Single page — custom content
//   window.NexusExtensions.registerAdminPanel("my-ext", {
//     label: "My Extension", icon: "fa-star",
//     component: () => React.createElement(SimpleSettingsPanel, { slug: "my-ext" },
//       React.createElement(MyCustomUI, { slug: "my-ext" })
//     ),
//   });
//
//   // Single page — declarative fields shortcut (simple key/value settings)
//   window.NexusExtensions.registerAdminPanel("my-ext", {
//     label: "My Extension", icon: "fa-star",
//     component: () => React.createElement(SimpleSettingsPanel, {
//       slug: "my-ext",
//       fields: [
//         { key: "api_key",  label: "API Key",  type: "string", secret: true },
//         { key: "enabled",  label: "Enabled",  type: "boolean" },
//         { key: "mode",     label: "Mode",     type: "select",
//           options: [{ value: "fast", label: "Fast" }, { value: "slow", label: "Slow" }] },
//       ],
//     }),
//   });
//
//   // Tabbed — each tab renders whatever you want
//   window.NexusExtensions.registerAdminPanel("my-ext", {
//     label: "My Extension", icon: "fa-star",
//     component: () => React.createElement(TabbedPanel, {
//       tabs: [
//         // Tab with custom content
//         { key: "general", label: "General", icon: "fa-gear",
//           render: () => React.createElement(MyGeneralUI, { slug: "my-ext" }) },
//
//         // Tab using the fields shortcut
//         { key: "settings", label: "Settings", icon: "fa-sliders",
//           render: () => React.createElement(SimpleSettingsPanel, {
//             slug: "my-ext",
//             fields: [{ key: "api_key", label: "API Key", type: "string", secret: true }],
//           }) },
//
//         // Tab with arbitrary custom JSX
//         { key: "status", label: "Status", icon: "fa-chart-line",
//           render: () => React.createElement(MyStatusView, { slug: "my-ext" }) },
//       ],
//     }),
//   });
//
// The top-bar Save button wires up automatically when a SimpleSettingsPanel
// using the fields shortcut is mounted. For custom content, call
// window._nexusAdminSetDirty() to activate Save and register your save
// function on window._nexusAdminSaveFn.

// Field renderer used by SimpleSettingsPanel.
// Reads/writes from a values object via getValue / setValue callbacks.
function ExtensionFieldRenderer({ field, value, onChange }) {
  const { key, label, hint, type, secret, placeholder, options=[], required } = field;
  const id = `epf-${key}`;
  return (
    <div style={{marginBottom:18}}>
      <label htmlFor={id} style={{fontSize:14,color:"var(--t2)",display:"block",marginBottom:6,fontWeight:500}}>
        {label||key}
        {required&&<span style={{color:"var(--red)",marginLeft:3}}>*</span>}
      </label>
      {type==="boolean"&&(
        <div className="toggle-row" style={{marginBottom:0}}>
          <div/>
          <Toggle value={value} onChange={onChange}/>
        </div>
      )}
      {type==="select"&&(
        <Select id={id} value={value??""} onChange={onChange}>
          {options.map(o=>(
            <option key={o.value??o} value={o.value??o}>{o.label??o}</option>
          ))}
        </Select>
      )}
      {type==="text"&&(
        <textarea id={id} className="fi" rows={4} value={value??""} placeholder={placeholder||""}
          onChange={e=>onChange(e.target.value)}/>
      )}
      {type==="number"&&(
        <input id={id} className="fi" type="number" style={{maxWidth:160}} value={value??""}
          placeholder={placeholder||""} onChange={e=>onChange(Number(e.target.value))}/>
      )}
      {type==="color"&&(
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <input id={id} className="fi" value={value??""} placeholder="#000000" style={{maxWidth:140}}
            onChange={e=>onChange(e.target.value)}/>
          <input type="color" value={value||"#000000"} onChange={e=>onChange(e.target.value)}
            style={{width:36,height:36,border:"none",borderRadius:6,cursor:"pointer",background:"none"}}/>
        </div>
      )}
      {(!type||type==="string")&&(
        <input id={id} className="fi" type={secret?"password":"text"} value={value??""}
          placeholder={placeholder||""} required={required}
          onChange={e=>onChange(e.target.value)}/>
      )}
      {hint&&<div style={{fontSize:13,color:"var(--t4)",marginTop:5}}>{hint}</div>}
    </div>
  );
}

// Save logic for SimpleSettingsPanel.
// POSTs to /api/v1/admin/extensions/:slug/settings.
function useExtensionSettings(slug, fields) {
  const allKeys = fields.map(f=>f.key);
  const [vals, setVals] = React.useState({});
  const [loaded, setLoaded] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(()=>{
    if(!slug) return;
    api.get(`/admin/extensions/${slug}`).then(d=>{
      const s = d.extension?.settings || {};
      const init = {};
      allKeys.forEach(k=>{ init[k] = s[k]??null; });
      setVals(init);
      setLoaded(true);
    }).catch(()=>setLoaded(true));
  },[slug]);

  const save = async () => {
    setSaving(true);
    try {
      const d = await api.patch(`/admin/extensions/${slug}/settings`, { settings: vals });
      if(d.extension) toast("Settings saved");
      else toast(d.error||"Failed to save","err");
    } finally { setSaving(false); }
    return true;
  };

  // Register this panel's save fn with the top-bar Save Changes button.
  React.useEffect(()=>{
    if(!loaded) return;
    window._nexusAdminSaveFn = save;
    return ()=>{ if(window._nexusAdminSaveFn===save) window._nexusAdminSaveFn=null; };
  },[loaded, vals]);

  // Dirty-aware setter — signals the top bar when a value changes.
  const setValsDirty = updater => {
    setVals(updater);
    if(window._nexusAdminSetDirty) window._nexusAdminSetDirty();
  };

  return { vals, setVals: setValsDirty, loaded, saving, save };
}

// SimpleSettingsPanel — single-page admin template.
//
// Two usage modes:
//
//   1. Custom content (recommended for most extensions):
//      Pass children — render whatever JSX you want. The panel is a blank
//      canvas; the top-bar Save button wires up only if you call
//      window._nexusAdminSetDirty() and register window._nexusAdminSaveFn
//      yourself. No settings fetch is performed.
//
//      React.createElement(SimpleSettingsPanel, { slug: "my-ext" },
//        React.createElement(MyCustomUI, { ... })
//      )
//
//   2. Declarative fields (convenience shortcut for simple key/value settings):
//      Pass a fields array instead of children. The panel fetches the
//      extension's saved settings, renders a form, and wires Save automatically.
//
//      React.createElement(SimpleSettingsPanel, {
//        slug: "my-ext",
//        fields: [
//          { key: "api_key", label: "API Key", type: "string", secret: true },
//          { key: "enabled", label: "Enabled", type: "boolean" },
//        ],
//      })
//
//   Field types: "string" (default), "boolean", "select", "text", "number", "color"
//
function SimpleSettingsPanel({ slug, fields=[], children }) {
  // Pure custom content — render children directly, no settings fetch needed.
  if(children) {
    return React.createElement('div', null, children);
  }

  // Declarative fields mode — use the settings hook.
  return React.createElement(SimpleSettingsPanelFields, { slug, fields });
}

// Inner component for declarative fields mode — keeps hook usage unconditional.
function SimpleSettingsPanelFields({ slug, fields }) {
  const { vals, setVals, loaded } = useExtensionSettings(slug, fields);

  if(!loaded) return (
    <div style={{padding:"48px 0",textAlign:"center",color:"var(--t5)"}}>
      <i className="fa-solid fa-spinner fa-spin"/>
    </div>
  );
  if(!fields.length) return (
    <div style={{padding:"32px 0",textAlign:"center",color:"var(--t5)",fontSize:13}}>
      No settings defined for this extension.
    </div>
  );
  return (
    <div>
      {fields.map(f=>(
        <ExtensionFieldRenderer key={f.key} field={f} value={vals[f.key]}
          onChange={v=>setVals(p=>({...p,[f.key]:v}))}/>
      ))}
    </div>
  );
}

// TabbedPanel — uniform tabbed navigation chrome.
//
// Props:
//   tabs — array of tab descriptors
//
// Tab descriptor:
//   { key:    string,                    // unique
//     label:  string,                    // shown in the tab bar
//     icon:   "fa-..." (optional),       // Font Awesome solid icon class
//     render: () => React node }         // arbitrary JSX for this tab
//
// TabbedPanel is pure chrome — it owns the tab bar, the active-tab state,
// and the styling. It has no opinion on what lives inside any tab. Drop a
// SimpleSettingsPanel inside a tab to get a settings form wired up to the
// top-bar Save button, or render arbitrary custom JSX (status displays,
// action buttons, log viewers, nested fetches, anything).
//
// The render function is only invoked when its tab is active, so unmounted
// tabs do not run useEffect or fetch data. Switching tabs unmounts the old
// content and mounts the new, which is what allows SimpleSettingsPanel
// instances in different tabs to swap their save-fn registration cleanly.
function TabbedPanel({ tabs=[] }) {
  const [activeTab, setActiveTab] = React.useState(tabs[0]?.key||"");

  if(!tabs.length) return (
    <div style={{padding:"32px 0",textAlign:"center",color:"var(--t5)",fontSize:13}}>
      No tabs defined for this panel.
    </div>
  );
  const currentTab = tabs.find(t=>t.key===activeTab)||tabs[0];
  return (
    <div>
      {/* Desktop: horizontal pill bar */}
      <div className="admin-tabs">
        {tabs.map(t=>(
          <button key={t.key} onClick={()=>setActiveTab(t.key)}
            className={`admin-tab${activeTab===t.key?" active":""}`}>
            {t.icon&&<i className={`fa-solid ${t.icon}`}/>}
            {t.label}
          </button>
        ))}
      </div>
      {/* Mobile: dropdown (matches profile/settings convention) */}
      <div className="admin-tabs-mob">
        <details>
          <summary>
            <span className="atm-label">
              {currentTab.icon&&<i className={`fa-solid ${currentTab.icon}`} style={{fontSize:12,color:"var(--t4)"}}/>}
              <span>{currentTab.label}</span>
            </span>
            <i className="fa-solid fa-chevron-down" style={{fontSize:11,color:"var(--t5)"}}/>
          </summary>
          <div className="atm-menu">
            {tabs.map(t=>(
              <div key={t.key}
                className={`atm-item${activeTab===t.key?" active":""}`}
                onClick={e=>{setActiveTab(t.key); e.currentTarget.closest("details").removeAttribute("open");}}>
                {t.icon&&<i className={`fa-solid ${t.icon}`} style={{fontSize:12,color:"var(--t5)",width:14}}/>}
                {t.label}
              </div>
            ))}
          </div>
        </details>
      </div>
      {currentTab.render ? currentTab.render() : null}
    </div>
  );
}

// Expose templates globally so extension bundles can use them without
// importing React or any Nexus internals directly.
window.NexusExtensionTemplates = {
  SimpleSettingsPanel,
  TabbedPanel,
};

// Extensions use these to integrate with the top-bar Save Changes button.
window._nexusAdminSaveFn   = null;
window._nexusAdminSetDirty = null;

// ── Exports ──────────────────────────────────────────────────────────────────
export { ExtensionSettingsForm, ExtensionDetail, ExtensionAdminPage,
         AdminExtensionsPanel,
         ExtensionFieldRenderer,
         useExtensionSettings, SimpleSettingsPanel, TabbedPanel };
