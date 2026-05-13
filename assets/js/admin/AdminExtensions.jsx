import { useState, useEffect, useRef } from "react";
import { api } from "../lib/api";
import { ago } from "../lib/utils";
import { toast } from "../components/Toasts";
import { Select, Toggle } from "../components/Select";
import { F } from "./FormHelpers";

// ── Extension admin panels + NexusExtensionTemplates ─────────────────────────

// ── Extension Settings Form ───────────────────────────────────────────────────
// Renders a settings form from settings_schema + settings_tabs declared in manifest.
// No template = "No settings" message.
// Has schema but no tabs = simple single-page form.
// Has settings_tabs = tabbed form matching the PWA admin panel style.
function ExtensionSettingsForm({ext, onSaved}) {
  const schema = ext.settings_schema || {};
  const tabs   = ext.settings_tabs   || [];
  const [vals, setVals] = useState({...ext.settings});
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState(tabs[0]?.key || null);

  const hasSchema = Object.keys(schema).length > 0;

  const save = async () => {
    setSaving(true);
    try {
      const d = await api.patch(`/admin/extensions/${ext.slug}/settings`, {settings: vals});
      if(d.extension) { onSaved(d.extension); toast("Settings saved"); }
      else toast(d.error || "Failed to save", "err");
    } finally { setSaving(false); }
  };

  const renderField = (key) => {
    const field = schema[key];
    if(!field) return null;
    const val = vals[key] ?? field.default ?? "";
    const set = v => setVals(p => ({...p, [key]: v}));

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

  if(!hasSchema) return (
    <div style={{padding:"32px 0",textAlign:"center",color:"var(--t5)"}}>
      <i className="fa-solid fa-sliders" style={{fontSize:24,opacity:.3,marginBottom:10,display:"block"}}/>
      This extension has no configurable settings.
    </div>
  );

  if(tabs.length > 0) return (
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
      <div style={{marginTop:20,display:"flex",justifyContent:"flex-end"}}>
        <button className="btn-primary" style={{fontSize:13,padding:"7px 20px"}}
          onClick={save} disabled={saving}>{saving?"Saving…":"Save settings"}</button>
      </div>
    </div>
  );

  return (
    <div>
      {Object.keys(schema).map(key=>renderField(key))}
      <div style={{marginTop:20,display:"flex",justifyContent:"flex-end"}}>
        <button className="btn-primary" style={{fontSize:13,padding:"7px 20px"}}
          onClick={save} disabled={saving}>{saving?"Saving…":"Save settings"}</button>
      </div>
    </div>
  );
}

// ── Extension Detail Panel ────────────────────────────────────────────────────
function ExtensionDetail({ext: initialExt, onBack, onToggle, onUninstall}) {
  const [ext, setExt] = useState(initialExt);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const toggle = async () => {
    const d = await api.post(`/admin/extensions/${ext.slug}/toggle`);
    if(d.extension) { setExt(d.extension); onToggle(d.extension); }
  };

  const uninstall = async () => {
    const d = await api.delete(`/admin/extensions/${ext.slug}`);
    if(d.ok) { toast(`${ext.name} uninstalled`); onUninstall(ext.slug); }
    else toast(d.error||"Failed","err");
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

      {/* Description */}
      {ext.description&&(
        <div style={{fontSize:13,color:"var(--t3)",marginBottom:20,lineHeight:1.6}}>
          {ext.description}
        </div>
      )}

      {/* Hook + slot summary */}
      {(ext.hooks?.length > 0 || ext.slots?.length > 0) && (
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:24}}>
          {ext.hooks?.map(h=>(
            <div key={h.id} style={{fontSize:11,padding:"3px 10px",borderRadius:20,
              background:"rgba(167,139,250,0.08)",border:"0.5px solid rgba(167,139,250,0.2)",
              color:"#c4b5fd"}}>
              <i className="fa-solid fa-bolt" style={{fontSize:9,marginRight:5}}/>
              {h.event}
            </div>
          ))}
          {ext.slots?.map(s=>(
            <div key={s.id} style={{fontSize:11,padding:"3px 10px",borderRadius:20,
              background:"rgba(52,211,153,0.08)",border:"0.5px solid rgba(52,211,153,0.2)",
              color:"#6ee7b7"}}>
              <i className="fa-solid fa-puzzle-piece" style={{fontSize:9,marginRight:5}}/>
              {s.slot}
            </div>
          ))}
        </div>
      )}

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
      </div>
    </div>
  );
}

// ── Admin Extensions Panel ────────────────────────────────────────────────────
// Unified extensions page — store, installed state, and install-from-URL
// all live on one screen. No separate "browse store" view.
// ── RebuildingOverlay ────────────────────────────────────────────────────────
// Shown after an extension update is applied to a service-backed extension.
// Polls the extension's health endpoint every 4 seconds until the reported
// version matches the expected new version, then calls onDone.
function RebuildingOverlay({slug, onDone, onError}) {
  const [elapsed, setElapsed] = React.useState(0);
  const [status, setStatus]   = React.useState("Waiting for rebuild to start…");
  const MAX_WAIT = 300; // 5 minutes max

  React.useEffect(() => {
    let cancelled = false;
    let seconds   = 0;

    const tick = async () => {
      if(cancelled) return;
      seconds += 4;
      setElapsed(seconds);

      if(seconds > MAX_WAIT) {
        onError("Rebuild timed out after 5 minutes. Check the server logs.");
        return;
      }

      try {
        const r = await fetch(`/api/v1/extensions/${slug}/api/health`, {
          headers: {"Accept": "application/json"}
        });

        if(r.ok) {
          const data = await r.json();
          const version = data.version || data.vsn;
          setStatus(`Service is up — detected version ${version || "unknown"}`);
          if(version) {
            onDone(version);
            return;
          }
        } else {
          setStatus("Service restarting… waiting to come back online");
        }
      } catch {
        setStatus("Service is down — rebuild in progress…");
      }

      setTimeout(tick, 4000);
    };

    // Give the service a moment before first poll — rebuild takes time to start
    setStatus("Deploy triggered — waiting for rebuild to begin…");
    setTimeout(tick, 6000);

    return () => { cancelled = true; };
  }, [slug]);

  const mins  = Math.floor(elapsed / 60);
  const secs  = elapsed % 60;
  const timer = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <div style={{
      position:"absolute", inset:0, zIndex:100,
      background:"var(--bg)", borderRadius:12,
      display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center",
      gap:20, padding:48, textAlign:"center",
      border:"0.5px solid var(--b1)",
    }}>
      <i className="fa-solid fa-spinner fa-spin" style={{fontSize:36,color:"var(--ac)"}}/>
      <div>
        <div style={{fontSize:16,fontWeight:500,color:"var(--t1)",marginBottom:8}}>
          Rebuilding extension service
        </div>
        <div style={{fontSize:13,color:"var(--t4)",marginBottom:4}}>{status}</div>
        {elapsed > 0&&(
          <div style={{fontSize:12,color:"var(--t5)"}}>Waiting {timer}…</div>
        )}
      </div>
      <div style={{fontSize:12,color:"var(--t5)",maxWidth:420,lineHeight:1.7}}>
        The service is being pulled from GitHub and rebuilt. This typically takes 30–90 seconds.
        The overlay will dismiss automatically when the new version is detected.
      </div>
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
      };
    });
    return [...storeWithInstalled, ...installedOnly];
  })();

  const q = filter.trim().toLowerCase();
  const visibleItems = allItems.filter(item=>{
    if(tab==="installed" && !installedSlugs.has(item.slug)) return false;
    if(tab==="all" && installedSlugs.has(item.slug)) return false;
    if(q) return (
      item.name?.toLowerCase().includes(q) ||
      item.description?.toLowerCase().includes(q) ||
      item.author?.toLowerCase().includes(q) ||
      (item.categories||[]).some(c=>c.toLowerCase().includes(q))
    );
    return true;
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
      <div style={{display:"flex",alignItems:"center",gap:0,borderBottom:"0.5px solid var(--b1)",marginBottom:24}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{padding:"10px 18px",background:"none",border:"none",
              borderBottom:tab===t.id?"2px solid var(--ac)":"2px solid transparent",
              color:tab===t.id?"var(--ac-text)":"var(--t4)",
              fontWeight:tab===t.id?500:400,fontSize:13,cursor:"pointer",
              fontFamily:"inherit",marginBottom:-1,transition:"color .1s",whiteSpace:"nowrap"}}>
            {t.label}
          </button>
        ))}
        {tab!=="url"&&(
          <div style={{marginLeft:"auto",position:"relative",flexShrink:0}}>
            <i className="fa-solid fa-magnifying-glass" style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:11,color:"var(--t5)",pointerEvents:"none"}}/>
            <input value={filter} onChange={e=>setFilter(e.target.value)}
              placeholder="Search…"
              style={{paddingLeft:28,paddingRight:10,height:30,fontSize:12,background:"var(--s3)",
                border:"0.5px solid var(--b1)",borderRadius:8,color:"var(--t1)",
                fontFamily:"inherit",outline:"none",width:160}}/>
          </div>
        )}
        <button onClick={checkForUpdates} disabled={checkingUpdates}
          style={{marginLeft:tab==="url"?"auto":8,background:"rgba(139,92,246,.12)",
            border:"0.5px solid rgba(139,92,246,.3)",borderRadius:8,
            color:"var(--ac)",cursor:checkingUpdates?"default":"pointer",
            padding:"6px 12px",fontSize:12,flexShrink:0,fontFamily:"inherit",fontWeight:500,
            display:"flex",alignItems:"center",gap:6,opacity:checkingUpdates?0.6:1}}
          title="Check for updates">
          <i className={`fa-solid fa-arrow-up-right-dots${checkingUpdates?" fa-beat":""}`} style={{fontSize:12}}/>
          {checkingUpdates?"Checking…":"Check for updates"}
        </button>
        <button onClick={()=>{loadStore();loadExtensions();}}
          style={{marginLeft:4,background:"none",border:"none",
            color:"var(--t5)",cursor:"pointer",padding:"4px 8px",fontSize:13,flexShrink:0}}
          title="Refresh">
          <i className="fa-solid fa-rotate-right"/>
        </button>
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

              return (
                <div key={item.slug} style={{
                  background:"var(--s3)",border:"0.5px solid var(--b1)",borderRadius:14,
                  overflow:"hidden",display:"flex",flexDirection:"column",
                  transition:"border-color .15s",cursor:"default"}}
                  onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(255,255,255,0.15)"}
                  onMouseLeave={e=>e.currentTarget.style.borderColor="var(--b1)"}>

                  {/* Banner / hero image */}
                  <div style={{height:120,position:"relative",flexShrink:0,overflow:"hidden",
                    background:item.banner_url?"transparent":`linear-gradient(135deg,${accentColor}22,${accentColor}08)`}}>
                    {item.banner_url&&(
                      <img src={item.banner_url} alt=""
                        style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}
                        onError={e=>{e.target.style.display="none";}}/>
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
                    {/* Installed / update available badges */}
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
                        <div style={{fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:20,
                          background:"rgba(52,211,153,0.15)",border:"0.5px solid rgba(52,211,153,0.3)",
                          color:"#34d399",display:"flex",alignItems:"center",gap:4}}>
                          <i className="fa-solid fa-circle-check" style={{fontSize:9}}/>
                          Installed
                        </div>
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

                    {/* Author + installs */}
                    <div style={{fontSize:12,color:"var(--t5)",display:"flex",alignItems:"center",gap:8}}>
                      <span>by {item.author||"unknown"}</span>
                      {item.installs!=null&&<>
                        <span style={{opacity:.4}}>·</span>
                        <span><i className="fa-solid fa-download" style={{fontSize:9,marginRight:3}}/>{Number(item.installs).toLocaleString()}</span>
                      </>}
                    </div>

                    {/* Description */}
                    {item.description&&(
                      <div style={{fontSize:12,color:"var(--t3)",lineHeight:1.55,
                        display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",
                        overflow:"hidden"}}>
                        {item.description}
                      </div>
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

                    {/* Hooks + slots summary */}
                    {(item.hooks?.length>0||item.slots?.length>0)&&(
                      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:2}}>
                        {item.hooks?.length>0&&(
                          <span style={{fontSize:10,padding:"2px 8px",borderRadius:20,
                            background:"rgba(167,139,250,0.08)",border:"0.5px solid rgba(167,139,250,0.2)",
                            color:"#c4b5fd",display:"flex",alignItems:"center",gap:4}}>
                            <i className="fa-solid fa-bolt" style={{fontSize:8}}/>
                            {item.hooks.length} hook{item.hooks.length!==1?"s":""}
                          </span>
                        )}
                        {item.slots?.length>0&&(
                          <span style={{fontSize:10,padding:"2px 8px",borderRadius:20,
                            background:"rgba(52,211,153,0.08)",border:"0.5px solid rgba(52,211,153,0.2)",
                            color:"#6ee7b7",display:"flex",alignItems:"center",gap:4}}>
                            <i className="fa-solid fa-puzzle-piece" style={{fontSize:8}}/>
                            {item.slots.length} slot{item.slots.length!==1?"s":""}
                          </span>
                        )}
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
                          {window.NexusExtensions.getAdminPanels().some(p=>p.slug===item.slug)&&(
                            <span style={{fontSize:12,color:"var(--t5)",display:"flex",alignItems:"center",gap:5}}>
                              <i className="fa-solid fa-sidebar" style={{fontSize:11}}/>
                              Settings in sidebar
                            </span>
                          )}
                          {item.update_available&&(
                            <button onClick={()=>updateExtension(item.slug)}
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
                          {item.manifest_url&&(
                            <button onClick={async()=>{
                              const d = await api.post(`/admin/extensions/${item.slug}/sync`);
                              if(d.extension){ toast("Manifest synced"); loadExtensions(); loadStore(); }
                              else toast(d.error||"Sync failed","err");
                            }} style={{fontSize:12,padding:"6px 14px",borderRadius:8,
                              background:"rgba(96,165,250,0.08)",border:"0.5px solid rgba(96,165,250,0.3)",
                              color:"#60a5fa",cursor:"pointer",fontFamily:"inherit",fontWeight:500}}>
                              <i className="fa-solid fa-rotate" style={{marginRight:5,fontSize:11}}/>Sync
                            </button>
                          )}
                          <button onClick={async()=>{
                            if(!window.confirm(`Uninstall ${item.name}?`)) return;
                            const d = await api.delete(`/admin/extensions/${item.slug}`);
                            if(d.ok){ toast(`${item.name} uninstalled`); loadExtensions(); loadStore(); }
                            else toast(d.error||"Uninstall failed","err");
                          }} style={{fontSize:12,padding:"6px 14px",borderRadius:8,
                            background:"rgba(248,113,113,0.1)",border:"0.5px solid rgba(248,113,113,0.3)",
                            color:"var(--red)",cursor:"pointer",fontFamily:"inherit",fontWeight:500}}>
                            Uninstall
                          </button>
                        </div>
                      ):(
                        <button
                          onClick={()=>installFromStore(item)}
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
// Usage from an extension bundle:
//
//   const { InfoPanel, SimpleSettingsPanel, TabbedPanel } = window.NexusExtensionTemplates;
//
//   // No-settings extension — just show name, version, description
//   window.NexusExtensions.registerAdminPanel("my-ext", {
//     label: "My Extension", icon: "fa-star",
//     component: () => React.createElement(InfoPanel, {
//       name: "My Extension", version: "1.0.0",
//       description: "Does something useful.",
//       status: "active",               // "active" | "inactive" | "error"
//       statusLabel: "Running",
//       links: [{ label: "Docs", href: "https://..." }],
//     }),
//   });
//
//   // Simple flat settings — no tabs
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
//   // Tabbed panel — like the PWA panel
//   window.NexusExtensions.registerAdminPanel("my-ext", {
//     label: "My Extension", icon: "fa-star",
//     component: () => React.createElement(TabbedPanel, {
//       slug: "my-ext",
//       tabs: [
//         { key: "general", label: "General", icon: "fa-gear",
//           fields: [{ key: "api_key", label: "API Key", type: "string", secret: true }] },
//         { key: "advanced", label: "Advanced", icon: "fa-sliders",
//           fields: [{ key: "timeout", label: "Timeout (ms)", type: "number" }] },
//       ],
//     }),
//   });

// InfoPanel — read-only summary card. No settings, no save button.
// Props: name, version, description, author, status ("active"|"inactive"|"error"),
//        statusLabel, links [{ label, href }]
function ExtensionInfoPanel({ name, version, description, author, status="active", statusLabel, links=[] }) {
  const statusColor = status==="active" ? "var(--green)" : status==="error" ? "var(--red)" : "var(--t5)";
  const statusDot   = { width:8, height:8, borderRadius:"50%", background:statusColor, flexShrink:0 };
  return (
    <div>
      <div style={{display:"flex",alignItems:"flex-start",gap:14,padding:"18px 20px",
        background:"var(--s3)",border:"0.5px solid var(--b1)",borderRadius:12,marginBottom:20}}>
        <div style={{width:44,height:44,borderRadius:10,background:"rgba(167,139,250,0.1)",
          border:"0.5px solid rgba(167,139,250,0.2)",display:"flex",alignItems:"center",
          justifyContent:"center",flexShrink:0}}>
          <i className="fa-solid fa-puzzle-piece" style={{fontSize:18,color:"var(--ac)"}}/>
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
            <div style={{fontSize:15,fontWeight:500,color:"var(--t1)"}}>{name}</div>
            {version&&<div style={{fontSize:11,color:"var(--t5)"}}>v{version}</div>}
            <div style={{display:"flex",alignItems:"center",gap:5,marginLeft:"auto"}}>
              <div style={statusDot}/>
              <span style={{fontSize:12,color:statusColor}}>{statusLabel||status}</span>
            </div>
          </div>
          {author&&<div style={{fontSize:12,color:"var(--t5)",marginBottom:6}}>by {author}</div>}
          {description&&<div style={{fontSize:13,color:"var(--t3)",lineHeight:1.6}}>{description}</div>}
        </div>
      </div>
      {links.length>0&&(
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {links.map((l,i)=>(
            <a key={i} href={l.href} target="_blank" rel="noopener"
              style={{fontSize:12,padding:"5px 12px",borderRadius:8,
                border:"0.5px solid var(--b1)",color:"var(--t3)",textDecoration:"none",
                display:"flex",alignItems:"center",gap:5}}>
              <i className="fa-solid fa-arrow-up-right-from-square" style={{fontSize:9}}/>
              {l.label}
            </a>
          ))}
        </div>
      )}
      <div style={{marginTop:32,padding:"16px 20px",background:"var(--s3)",
        border:"0.5px solid var(--b1)",borderRadius:12,
        fontSize:13,color:"var(--t5)",textAlign:"center"}}>
        This extension has no configurable settings.
      </div>
    </div>
  );
}

// Shared field renderer used by both SimpleSettingsPanel and TabbedPanel.
// Reads/writes from a values object via getValue / setValue callbacks.
function ExtensionFieldRenderer({ field, value, onChange }) {
  const { key, label, hint, type, secret, placeholder, options=[], required } = field;
  const id = `epf-${key}`;
  return (
    <div style={{marginBottom:18}}>
      <label htmlFor={id} style={{fontSize:12,color:"var(--t4)",display:"block",marginBottom:6,fontWeight:500}}>
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
      {hint&&<div style={{fontSize:11,color:"var(--t5)",marginTop:5}}>{hint}</div>}
    </div>
  );
}

// Shared save logic for SimpleSettingsPanel and TabbedPanel.
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

// SimpleSettingsPanel — flat list of fields with a single Save button.
// Props: slug (string), fields (array of field descriptors)
// Field descriptor: { key, label, type, hint, placeholder, secret, required, options }
// Supported types: "string" (default), "boolean", "select", "text", "number", "color"
function SimpleSettingsPanel({ slug, fields=[] }) {
  const { vals, setVals, loaded, saving, save } = useExtensionSettings(slug, fields);

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

// TabbedPanel — settings split across tabs, like the PWA panel.
// Props: slug (string), tabs (array of tab descriptors)
// Tab descriptor: { key, label, icon (FA class, optional), fields[] }
function TabbedPanel({ slug, tabs=[] }) {
  const allFields = tabs.flatMap(t=>t.fields||[]);
  const { vals, setVals, loaded, saving, save } = useExtensionSettings(slug, allFields);
  const [activeTab, setActiveTab] = React.useState(tabs[0]?.key||"");

  if(!loaded) return (
    <div style={{padding:"48px 0",textAlign:"center",color:"var(--t5)"}}>
      <i className="fa-solid fa-spinner fa-spin"/>
    </div>
  );
  if(!tabs.length) return (
    <div style={{padding:"32px 0",textAlign:"center",color:"var(--t5)",fontSize:13}}>
      No tabs defined for this panel.
    </div>
  );
  const currentTab = tabs.find(t=>t.key===activeTab)||tabs[0];
  return (
    <div>
      <div style={{display:"flex",gap:4,marginBottom:24,borderBottom:"0.5px solid var(--b1)",paddingBottom:0}}>
        {tabs.map(t=>(
          <button key={t.key} onClick={()=>setActiveTab(t.key)}
            style={{display:"flex",alignItems:"center",gap:7,padding:"8px 14px",
              borderRadius:"8px 8px 0 0",
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
      {(currentTab.fields||[]).map(f=>(
        <ExtensionFieldRenderer key={f.key} field={f} value={vals[f.key]}
          onChange={v=>setVals(p=>({...p,[f.key]:v}))}/>
      ))}
    </div>
  );
}

// Expose templates globally so extension bundles can use them without
// importing React or any Nexus internals directly.
window.NexusExtensionTemplates = {
  InfoPanel: ExtensionInfoPanel,
  SimpleSettingsPanel,
  TabbedPanel,
};

// Extensions use these to integrate with the top-bar Save Changes button.
window._nexusAdminSaveFn   = null;
window._nexusAdminSetDirty = null;

// ── Exports ──────────────────────────────────────────────────────────────────
export { ExtensionSettingsForm, ExtensionDetail, AdminExtensionsPanel,
         RebuildingOverlay, ExtensionInfoPanel, ExtensionFieldRenderer,
         useExtensionSettings, SimpleSettingsPanel, TabbedPanel };
