import React, { useState, useEffect, useRef } from "react";
import { api } from "../lib/api";
import { ago, fmtDate, fmtBytes, userColor, spaceColor, formatApiErrors } from "../lib/utils";
import { toast } from "../components/Toasts";
import { Select, Toggle } from "../components/Select";
import { RsAv, Av } from "../components/Avatar";
import { Md } from "../components/Markdown";
import { F, ColorPicker, formatUptime } from "./FormHelpers";
import { DragList, LayoutAdmin } from "./AdminLayout";
import { ReportCard, ModerationPage, AdminModerationPanel } from "./AdminModeration";
import { AdminIntegrationsPanel, AdminAntiSpamPanel, AdminLogsPanel,
         AdminDigestPanel, AdminLeaderboardPanel } from "./AdminPanels";
import { BadgesPage, AdminBadgesPanel } from "./AdminBadges";
import { AdminExtensionsPanel, ExtensionAdminPage } from "./AdminExtensions";
import { AdminPwaPanel, IosInstallPrompt } from "./AdminPwaPanel";
import { AdminAnalyticsPanel } from "./AdminAnalyticsPanel";
import { AdminPagesPanel } from "./AdminPages";
import { AdminReactionsPanel } from "./AdminReactionsPanel";
import { UpdatesPanel } from "../pages/UpdatesPanel";

// ── TagsAdmin ─────────────────────────────────────────────────────────────────
function TagsAdmin({tags, onRefresh}) {
  const [editing,setEditing]=useState(null);
  const [form,setForm]=useState({name:"",slug:"",description:"",color:"#a78bfa"});
  const [saving,setSaving]=useState(false);

  const autoSlug=name=>name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  const openNew=()=>{ setForm({name:"",slug:"",description:"",color:"#a78bfa"}); setEditing("new"); };
  const openEdit=t=>{ setForm({name:t.name,slug:t.slug,description:t.description||"",color:t.color||"#a78bfa"}); setEditing(t); };
  const close=()=>setEditing(null);
  const COLORS=["#a78bfa","#f472b6","#34d399","#60a5fa","#fbbf24","#f87171","#ec4899","#10b981","#8b5cf6","#0ea5e9"];

  const save=async()=>{
    setSaving(true);
    try {
      if(editing==="new"){
        const d=await api.post("/tags",form);
        if(d.tag){toast("Tag created");onRefresh();close();}
        else toast(d.error||"Failed","err");
      } else {
        const d=await api.patch(`/tags/${editing.slug}`,form);
        if(d.tag){toast("Tag updated");onRefresh();close();}
        else toast(d.error||"Failed","err");
      }
    } finally { setSaving(false); }
  };

  const del=async t=>{
    if(!confirm(`Delete tag "#${t.name}"?`))return;
    await api.delete(`/tags/${t.slug}`);
    toast("Tag deleted"); onRefresh();
  };

  return <>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <div className="fgt" style={{margin:0}}>Tags</div>
      <button className="btn-primary" style={{fontSize:12,padding:"5px 14px"}} onClick={openNew}>+ New tag</button>
    </div>
    <div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden",marginBottom:editing?"16px":"0"}}>
      {tags.length===0?<div style={{padding:"16px 14px",color:"var(--t5)",fontSize:13}}>No tags yet</div>
        :<div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}><table className="atbl"><thead><tr><th>Name</th><th>Slug</th><th>Posts</th><th></th></tr></thead>
          <tbody>{tags.map(t=>(
            <tr key={t.id}>
              <td><div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:t.color||"var(--ac)",flexShrink:0}}></span>
                <span style={{fontWeight:500,color:"var(--t1)"}}>#{t.name}</span>
              </div></td>
              <td style={{color:"var(--t5)",fontFamily:"monospace",fontSize:11}}>{t.slug}</td>
              <td>{t.post_count||0}</td>
              <td style={{textAlign:"right"}}>
                <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}><button onClick={()=>openEdit(t)} style={{fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20,border:"0.5px solid rgba(96,165,250,0.25)",background:"rgba(96,165,250,0.12)",color:"#60a5fa",cursor:"pointer",fontFamily:"inherit"}}>edit</button><button onClick={()=>del(t)} style={{fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20,border:"0.5px solid rgba(248,113,113,0.25)",background:"rgba(248,113,113,0.12)",color:"#f87171",cursor:"pointer",fontFamily:"inherit"}}>delete</button></div>
              </td>
            </tr>
          ))}</tbody>
        </table></div>}
    </div>
    {editing&&<div style={{background:"rgba(255,255,255,0.02)",border:"0.5px solid var(--b2)",borderRadius:12,padding:20}}>
      <div style={{fontSize:13,fontWeight:500,color:"var(--t1)",marginBottom:16}}>{editing==="new"?"New tag":"Edit tag"}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
        <div><label className="f-label">Name</label><input className="fi" value={form.name} onChange={e=>{const n=e.target.value;setForm(p=>({...p,name:n,slug:editing==="new"?autoSlug(n):p.slug}));}}/></div>
        <div><label className="f-label">Slug</label><input className="fi" value={form.slug} onChange={e=>setForm(p=>({...p,slug:e.target.value}))} style={{fontFamily:"monospace"}}/></div>
      </div>
      <div style={{marginBottom:12}}><label className="f-label">Description</label><input className="fi" value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} placeholder="Optional description"/></div>
      <div style={{marginBottom:16}}><label className="f-label">Color</label>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:4}}>
          {COLORS.map(c=><div key={c} onClick={()=>setForm(p=>({...p,color:c}))} style={{width:22,height:22,borderRadius:"50%",background:c,cursor:"pointer",border:`2px solid ${form.color===c?"#fff":"transparent"}`,transition:"border-color .1s"}}/>)}
        </div>
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button className="btn-ghost" onClick={close}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving||!form.name.trim()||!form.slug.trim()}>{saving?"Saving…":"Save tag"}</button>
      </div>
    </div>}
  </>;
}


// ── SpacesAdmin ───────────────────────────────────────────────────────────────
// ── Admin Spaces CRUD ─────────────────────────────────────────────────────────
function SpacesAdmin({spaces, onRefresh, layoutCfg={}, setLayoutCfg}) {
  const [editing,setEditing]=useState(null); // null | "new" | space object
  const [form,setForm]=useState({name:"",slug:"",description:"",color:"#a78bfa",icon:"fa-layer-group",visibility:"public"});
  const [saving,setSaving]=useState(false);

  var savedOrder = layoutCfg.spaces_order || [];
  var orderedForEditor = (function(){
    var ordered = spaces.slice();
    if(savedOrder.length) ordered.sort(function(a,b){var ai=savedOrder.indexOf(a.id);var bi=savedOrder.indexOf(b.id);if(ai===-1)return 1;if(bi===-1)return -1;return ai-bi;});
    return ordered;
  })();
  function saveSpacesOrder(ordered) {
    var next = Object.assign({}, layoutCfg, {spaces_order: ordered.map(function(s){return s.id;})});
    if(setLayoutCfg) setLayoutCfg(next);
    api.patch("/admin/settings/layout", {value: next}).catch(function(){});
    // Also update the position column on each space so list_spaces() returns
    // them in the correct order everywhere — composer, All Spaces table, API.
    api.post("/admin/spaces/reorder", {order: ordered.map(function(s){return s.id;})}).catch(function(){});
  }

  const openNew=()=>{ setForm({name:"",slug:"",description:"",color:"#a78bfa",icon:"fa-layer-group",visibility:"public"}); setEditing("new"); };
  const openEdit=s=>{ setForm({name:s.name,slug:s.slug,description:s.description||"",color:s.color||"#a78bfa",icon:s.icon||"fa-layer-group",visibility:s.visibility}); setEditing(s); };
  const close=()=>setEditing(null);

  const autoSlug=name=>name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");

  const save=async()=>{
    setSaving(true);
    try {
      if(editing==="new") {
        const d=await api.post("/admin/spaces",form);
        if(d.space){toast("Space created");onRefresh();close();}
        else toast(formatApiErrors(d, "Failed"),"err");
      } else {
        // Explicitly build payload to avoid any stale closure issues with form state
        const payload={name:form.name,slug:form.slug,description:form.description||"",color:form.color,icon:form.icon||"fa-layer-group",visibility:form.visibility};
        const d=await api.patch(`/admin/spaces/${editing.slug}`,payload);
        if(d.space){toast("Space updated");onRefresh();close();}
        else toast(formatApiErrors(d, "Failed"),"err");
      }
    } finally { setSaving(false); }
  };

  const del=async(s)=>{
    if(!confirm(`Delete space "${s.name}"? This cannot be undone.`))return;
    await api.delete(`/admin/spaces/${s.slug}`);
    toast("Space deleted"); onRefresh();
  };

  const COLORS=["#a78bfa","#f472b6","#34d399","#60a5fa","#fbbf24","#f87171","#ec4899","#10b981","#8b5cf6","#0ea5e9"];

  return <>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <div className="fgt" style={{margin:0}}>Spaces</div>
      <button className="btn-primary" style={{fontSize:12,padding:"5px 14px"}} onClick={openNew}>+ New space</button>
    </div>
    <div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden",marginBottom:editing?"16px":"0"}}>
      {spaces.length===0?<div style={{padding:"16px 14px",color:"var(--t5)",fontSize:13}}>No spaces yet</div>
        :<div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}><table className="atbl"><thead><tr><th>Name</th><th>Slug</th><th>Visibility</th><th>Posts</th><th></th></tr></thead>
          <caption style={{captionSide:"top",textAlign:"left",paddingBottom:8}}>
            <div className="fgt" style={{marginBottom:6}}>Sidebar order</div>
            <div style={{fontSize:12,color:"var(--t4)",marginBottom:10}}>Drag to reorder how spaces appear in the left sidebar.</div>
            <DragList
              items={orderedForEditor}
              onChange={saveSpacesOrder}
              renderItem={function(s){
                var col=s.color||spaceColor(s);
                return React.createElement('div',{style:{display:"flex",alignItems:"center",gap:10,flex:1}},
                  React.createElement('i',{className:"fa-solid "+(s.icon||"fa-layer-group"),style:{fontSize:13,color:col,width:16,textAlign:"center"}}),
                  React.createElement('span',{style:{fontSize:13,color:"var(--t2)",fontWeight:500}},s.name)
                );
              }}
            />
            <div className="fgt" style={{marginTop:20,marginBottom:6}}>All spaces</div>
          </caption>
          <tbody>{spaces.map(s=>(
            <tr key={s.id}>
              <td><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{width:8,height:8,borderRadius:"50%",background:s.color||spaceColor(s),flexShrink:0}}></span><span style={{fontWeight:500,color:"var(--t1)"}}>{s.name}</span></div></td>
              <td style={{color:"var(--t5)",fontFamily:"monospace",fontSize:11}}>{s.slug}</td>
              <td><span style={{fontSize:10,padding:"2px 8px",borderRadius:20,background:"rgba(255,255,255,0.05)",color:"var(--t3)"}}>{s.visibility}</span></td>
              <td>{s.post_count||0}</td>
              <td style={{textAlign:"right"}}>
                <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}><button onClick={()=>openEdit(s)} style={{fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20,border:"0.5px solid rgba(96,165,250,0.25)",background:"rgba(96,165,250,0.12)",color:"#60a5fa",cursor:"pointer",fontFamily:"inherit"}}>edit</button><button onClick={()=>del(s)} style={{fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20,border:"0.5px solid rgba(248,113,113,0.25)",background:"rgba(248,113,113,0.12)",color:"#f87171",cursor:"pointer",fontFamily:"inherit"}}>delete</button></div>
              </td>
            </tr>
          ))}</tbody>
        </table></div>}
    </div>
    {editing&&<div style={{background:"rgba(255,255,255,0.02)",border:"0.5px solid var(--b2)",borderRadius:12,padding:20}}>
      <div style={{fontSize:13,fontWeight:500,color:"var(--t1)",marginBottom:16}}>{editing==="new"?"New space":"Edit space"}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
        <div><label className="f-label">Name</label><input className="fi" value={form.name} onChange={e=>{const n=e.target.value;setForm(p=>({...p,name:n,slug:editing==="new"?autoSlug(n):p.slug}));}}/></div>
        <div><label className="f-label">Slug</label><input className="fi" value={form.slug} onChange={e=>setForm(p=>({...p,slug:e.target.value}))} style={{fontFamily:"monospace"}}/></div>
      </div>
      <div style={{marginBottom:12}}><label className="f-label">Description</label><input className="fi" value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} placeholder="Optional description"/></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
        <div><label className="f-label">Visibility</label>
          <Select value={form.visibility} onChange={v=>setForm(p=>({...p,visibility:v}))}>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </Select>
        </div>
        <div><label className="f-label">Icon <span style={{fontSize:10,color:"var(--t5)"}}>(Font Awesome class)</span></label>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <div style={{width:36,height:36,borderRadius:8,background:"rgba(255,255,255,0.05)",border:"0.5px solid var(--b2)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <i className={`fa-solid ${form.icon||"fa-layer-group"}`} style={{fontSize:15,color:form.color||"#a78bfa"}}></i>
            </div>
            <input className="fi" value={form.icon||""} onChange={e=>setForm(p=>({...p,icon:e.target.value}))} placeholder="fa-layer-group" style={{fontFamily:"monospace",fontSize:12}}/>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
            {["fa-layer-group","fa-code","fa-gamepad","fa-music","fa-film","fa-book","fa-globe","fa-flask","fa-paint-brush","fa-bolt","fa-heart","fa-star","fa-comments","fa-trophy","fa-wrench","fa-rocket","fa-leaf","fa-camera","fa-graduation-cap","fa-briefcase"].map(ic=>(
              <div key={ic} onClick={()=>setForm(p=>({...p,icon:ic}))} title={ic}
                style={{width:28,height:28,borderRadius:6,background:form.icon===ic?"var(--ac-bg)":"rgba(255,255,255,0.04)",border:`1px solid ${form.icon===ic?"var(--ac-border)":"transparent"}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",transition:"all .1s"}}>
                <i className={`fa-solid ${ic}`} style={{fontSize:12,color:form.icon===ic?form.color||"#a78bfa":"var(--t4)"}}></i>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{marginBottom:16}}>
        <label className="f-label">Color</label>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <input type="color" value={form.color||"#a78bfa"} onChange={e=>setForm(p=>({...p,color:e.target.value}))}
            style={{width:40,height:36,borderRadius:8,border:"0.5px solid var(--b2)",background:"none",cursor:"pointer",padding:2}}/>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {COLORS.map(c=><div key={c} onClick={()=>setForm(p=>({...p,color:c}))} style={{width:24,height:24,borderRadius:"50%",background:c,cursor:"pointer",border:`2px solid ${form.color===c?"#fff":"transparent"}`,transition:"border-color .1s"}}/>)}
          </div>
          <input className="fi" value={form.color||""} onChange={e=>setForm(p=>({...p,color:e.target.value}))}
            style={{fontFamily:"monospace",fontSize:12,width:100}} placeholder="#a78bfa"/>
        </div>
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button className="btn-ghost" onClick={close}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving||!form.name.trim()||!form.slug.trim()}>{saving?"Saving…":"Save space"}</button>
      </div>
    </div>}
  </>;
}


// ── VerifyEmailPage ───────────────────────────────────────────────────────────
export function VerifyEmailPage({token, navigate, onVerified}) {
  const [status, setStatus] = useState("loading");

  useEffect(()=>{
    if (!token) { setStatus("error"); return; }
    api.request("GET", `/auth/verify-email?token=${encodeURIComponent(token)}`, null, false, true)
      .then(d => { if (d.ok) setStatus("ok"); else setStatus("error"); })
      .catch(() => setStatus("error"));
  }, [token]);

  return (
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:40}}>
      <div style={{maxWidth:400,width:"100%",textAlign:"center"}}>
        {status==="loading"&&<>
          <i className="fa-solid fa-spinner fa-spin" style={{fontSize:32,color:"var(--ac)",marginBottom:16,display:"block"}}/>
          <div style={{fontSize:15,color:"var(--t3)"}}>Verifying your email…</div>
        </>}
        {status==="ok"&&<>
          <i className="fa-solid fa-circle-check" style={{fontSize:40,color:"var(--green)",marginBottom:16,display:"block"}}/>
          <div style={{fontSize:18,fontWeight:600,color:"var(--t1)",marginBottom:8}}>Email verified!</div>
          <div style={{fontSize:13,color:"var(--t3)",marginBottom:24}}>Your email has been confirmed. You can now fully participate in the forum.</div>
          <button className="btn-primary" style={{padding:"10px 28px",borderRadius:20}} onClick={()=>{onVerified?.();navigate("feed");}}>Go to forum</button>
        </>}
        {status==="error"&&<>
          <i className="fa-solid fa-circle-xmark" style={{fontSize:40,color:"var(--red)",marginBottom:16,display:"block"}}/>
          <div style={{fontSize:18,fontWeight:600,color:"var(--t1)",marginBottom:8}}>Verification failed</div>
          <div style={{fontSize:13,color:"var(--t3)",marginBottom:24}}>This link may have expired or already been used. Try registering again or contact support.</div>
          <button className="btn-primary" style={{padding:"10px 28px",borderRadius:20}} onClick={()=>navigate("feed")}>Go to forum</button>
        </>}
      </div>
    </div>
  );
}


// ── MagicLoginPage ───────────────────────────────────────────────────────────
// Handles the /magic-login?token=... URL that magic link emails point to.
// Calls the verify endpoint, issues tokens, and logs the user in.
export function MagicLoginPage({token, onLogin, navigate}) {
  const [status, setStatus] = useState("loading");

  useEffect(()=>{
    if (!token) { setStatus("error"); return; }
    api.request("GET", `/auth/magic?token=${encodeURIComponent(token)}`, null, false, true)
      .then(d => {
        if (d.access_token) {
          onLogin(d);
        } else {
          setStatus("error");
        }
      })
      .catch(() => setStatus("error"));
  }, [token]);

  return (
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:40}}>
      <div style={{maxWidth:400,width:"100%",textAlign:"center"}}>
        {status==="loading"&&<>
          <i className="fa-solid fa-spinner fa-spin" style={{fontSize:32,color:"var(--ac)",marginBottom:16,display:"block"}}/>
          <div style={{fontSize:15,color:"var(--t3)"}}>Signing you in…</div>
        </>}
        {status==="error"&&<>
          <i className="fa-solid fa-circle-xmark" style={{fontSize:40,color:"var(--red)",marginBottom:16,display:"block"}}/>
          <div style={{fontSize:18,fontWeight:600,color:"var(--t1)",marginBottom:8}}>Link expired</div>
          <div style={{fontSize:13,color:"var(--t3)",marginBottom:24}}>This magic link has expired or already been used. Magic links are valid for 15 minutes.</div>
          <button className="btn-primary" style={{padding:"10px 28px",borderRadius:20}} onClick={()=>navigate("feed")}>Go to forum</button>
        </>}
      </div>
    </div>
  );
}

// ── AdminPage ─────────────────────────────────────────────────────────────────
export function AdminPage({currentUser, navigate, onSpacesUpdated, layoutCfg={}, setLayoutCfg}) {
  const [sec,setSec_raw]=useState("overview");
  const setSec = (s) => { setSec_raw(s); setMemberSearch(""); };
  const [stats,setStats]=useState(null); const [users,setUsers]=useState([]);
  const [memberSearch,setMemberSearch]=useState("");
  const [queueStats,setQueueStats]=useState(null);
  const [sysStats,setSysStats]=useState(null);
  const [spaces,setSpaces]=useState([]); const [tags,setTags]=useState([]);
  const [reports,setReports]=useState([]); const [modLogs,setModLogs]=useState([]);
  const [showCreateUser,setShowCreateUser]=useState(false);
  const [mobAdminNavOpen,setMobAdminNavOpen]=useState(false);
  const [newUser,setNewUser]=useState({username:"",email:"",password:"",role:"member",skip_verification:false});
  const [general,setGeneral]=useState({}); const [branding,setBranding]=useState({});
  const [emailCfg,setEmailCfg]=useState({}); const [saving,setSaving]=useState(false); const [isDirty,setIsDirty]=useState(false);
  // Extension permission settings: { [slug]: { [permKey]: level } }
  const [extPermCfg,setExtPermCfg]=useState({});
  // Dirty-aware setters — wraps a state setter so any change marks the page dirty.
  const dirty = fn => v => { fn(v); setIsDirty(true); };
  // loadGen increments each time a settings fetch begins. The dirty watcher
  // captures the gen when it runs; it only marks dirty if the gen it captured
  // matches the settled gen, meaning the load is complete and this is a real
  // user-initiated change rather than hydration from the fetch.
  const loadGen = React.useRef(0);
  const settledGen = React.useRef(0);
  const [uploadCfg,setUploadCfg]=useState({});
  const [regCfg,setRegCfg]=useState({});
  const [postCfg,setPostCfg]=useState({});
  const [lbCfg,setLbCfg]=useState({});
  const [digestCfg,setDigestCfg]=useState({});
  const [pwaCfg,setPwaCfg]=useState({});
  const [spamCfg,setSpamCfg]=useState({});
  const [integrationsCfg,setIntegrationsCfg]=useState({});
  const [reactionsCfg,setReactionsCfg]=useState({});
  // Watch all cfg values and mark dirty — but only after the fetch has fully
  // settled. Captures the current gen at effect-run time; if the settled gen
  // hasn't caught up yet, this is still a hydration flush, not a user change.
  useEffect(()=>{
    const gen = loadGen.current;
    if(settledGen.current < gen) return;
    setIsDirty(true);
  },[general,branding,emailCfg,uploadCfg,regCfg,postCfg,lbCfg,digestCfg,pwaCfg,spamCfg,integrationsCfg,reactionsCfg]);
  const [pendingItems,setPendingItems]=useState([]);
  const [uploadStats,setUploadStats]=useState(null);
  const [uploads,setUploads]=useState([]);
  const [uploadFilter,setUploadFilter]=useState("");
  const [uploadPage,setUploadPage]=useState(1);
  const [uploadPages,setUploadPages]=useState(1);

  const fetchUploadData=(pg)=>{
    const p=pg!==undefined?pg:uploadPage;
    api.get("/admin/uploads/stats").then(d=>setUploadStats(d.stats));
    api.get(`/admin/uploads?page=${p}&limit=50`+(uploadFilter?`&type=${uploadFilter}`:"")).then(d=>{setUploads(d.uploads||[]);setUploadPages(d.pages||1);});
  };

  // Load settings exactly once on mount. This must never re-run on currentUser
  // changes — doing so would wipe unsaved admin input every time the visibility
  // handler refreshes the session token and updates currentUser.
  const settingsLoadedOnce = React.useRef(false);
  useEffect(()=>{
    if(currentUser?.role!=="admin") return;
    if(settingsLoadedOnce.current) return;
    settingsLoadedOnce.current = true;
    loadGen.current += 1;
    const myGen = loadGen.current;
    api.get("/admin/settings").then(d=>{const s=d.settings||{};setGeneral(s.general||{});setBranding(s.appearance||{});setEmailCfg(s.email||{});setUploadCfg(s.uploads||{});setRegCfg(s.registration||{});const pc=s.posting||{};setPostCfg(pc);window._postCfg=pc;window._reactionsCfg=s.reactions||{};setLbCfg(s.leaderboard||{});setDigestCfg(s.digest||{});setPwaCfg(s.pwa||{});setSpamCfg(s.anti_spam||{});setIntegrationsCfg(s.integrations||{});setReactionsCfg(s.reactions||{});}).then(()=>{ settledGen.current = myGen; });
  },[currentUser]);

  // Live data — re-runs when currentUser changes (e.g. after session refresh).
  // Does NOT touch settings state so unsaved admin input is never clobbered.
  useEffect(()=>{
    if(currentUser?.role!=="admin")return;
    api.get("/admin/dashboard").then(d=>setStats(d.stats));
    const fetchLive=()=>{
      api.get("/admin/queues").then(d=>setQueueStats(d));
      api.get("/admin/system").then(d=>setSysStats(d.system));
    };
    fetchLive();
    const liveInterval=setInterval(fetchLive,10000);
    api.get("/admin/uploads/stats").then(d=>setUploadStats(d.stats));
    api.get("/admin/users").then(d=>setUsers(d.users||[]));
    api.get("/spaces").then(d=>setSpaces(d.spaces||[]));
    api.get("/tags").then(d=>setTags(d.tags||[]));
    Promise.all(["pending","actioned","dismissed"].map(s=>api.get(`/reports?status=${s}`))).then(results=>{
      setReports(results.flatMap(d=>d.reports||[]));
    });
    api.get("/moderation/log").then(d=>setModLogs(d.logs||[]));

    return ()=>clearInterval(liveInterval);
  },[currentUser]);

  useEffect(()=>{
    if(currentUser?.role!=="admin")return;
    if(sec==="storage") fetchUploadData();
    if(sec==="moderation") api.get("/admin/pending").then(d=>setPendingItems(d.pending||[]));
    setIsDirty(false);
    window._nexusAdminSaveFn = null;
  },[sec, uploadFilter]);

  if(!currentUser||currentUser.role!=="admin") return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)"}}>Access denied</div>;
  const saveSection=async(key,value)=>{setSaving(true);try{await api.patch(`/admin/settings/${key}`,{value});toast("Saved");setIsDirty(false);if(key==="appearance")window._applyBranding&&window._applyBranding(value,general);}finally{setSaving(false);}};
  // Wire global dirty/save hooks so extension SimpleSettingsPanel instances
  // (used standalone or inside a TabbedPanel tab) can signal changes and be
  // saved via the top-bar Save Changes button.
  window._nexusAdminSetDirty = ()=>setIsDirty(true);

  // Re-render when extension bundles register new admin panels at runtime
  const [, forceAdminUpdate] = React.useState(0);
  React.useEffect(()=>{
    const unsub = window.NexusExtensions.onAdminPanelChange(()=>forceAdminUpdate(n=>n+1));
    return unsub;
  },[]);

  // Sidebar entries for installed extensions. Every installed extension gets
  // an entry — those that registered a custom admin panel via the JS bundle
  // contribute their custom label/icon; those that didn't register one still
  // get an entry with a derived label/icon, so server-only extensions
  // (digest sections, hooks, no UI) remain manageable through their own
  // page rather than only via the extensions gallery card.
  const [installedExtensions, setInstalledExtensions] = useState([]);
  React.useEffect(()=>{
    const load = () => {
      api.get("/admin/extensions").then(d => setInstalledExtensions(d.extensions || []));
    };
    load();
    // Also reload when admin panels change — this typically coincides with
    // an extension being newly installed (bundle just loaded into the page).
    const unsub = window.NexusExtensions.onAdminPanelChange(load);
    return unsub;
  },[]);

  // Load initial permission values from each extension's settings
  React.useEffect(()=>{
    if(!installedExtensions.length) return;
    const extsWithPerms = installedExtensions.filter(e => e.permissions && e.permissions.length > 0);
    if(!extsWithPerms.length) return;
    const initial = {};
    extsWithPerms.forEach(e => {
      initial[e.slug] = {};
      e.permissions.forEach(p => {
        initial[e.slug][p.key] = (e.settings && e.settings[p.key]) || p.default || "member";
      });
    });
    setExtPermCfg(initial);
  },[installedExtensions]);

  // Expose a navigator helper so child components (notably ExtensionAdminPage
  // after uninstall) can navigate the admin sidebar without having to lift
  // a callback through several layers.
  React.useEffect(()=>{
    window._nexusAdminNav = (k) => setSec(k);
    // Piece 5 follow-up: a refresh helper so toggle handlers can ask the
    // parent to re-fetch the extensions list. Keeps the sidebar's
    // enabled-state visual in sync with the runtime state after a live
    // disable/enable, instead of waiting for a panel change or reload.
    window._nexusAdminReloadExtensions = () => {
      api.get("/admin/extensions").then(d => setInstalledExtensions(d.extensions || []));
    };
    return () => {
      window._nexusAdminNav = null;
      window._nexusAdminReloadExtensions = null;
    };
  },[]);

  // Build per-extension sidebar entries. Prefer the registered admin panel's
  // label/icon when present (extensions intentionally customize these),
  // fall back to the extension's display name and a generic icon when not.
  //
  // Piece 5 follow-up: include disabled extensions too, marked visually
  // as off. Without this, the admin loses the sidebar shortcut to the
  // re-enable toggle the moment they disable an extension — they'd have
  // to navigate Extensions → Installed → Manage just to flip it back.
  const extPanels = window.NexusExtensions.getAdminPanels();
  const extensionSidebarItems = installedExtensions
    .map(e => {
      const reg = extPanels.find(p => p.slug === e.slug);
      return {
        k:        `ext-panel-${e.slug}`,
        icon:     reg?.icon  || "fa-puzzle-piece",
        label:    reg?.label || e.name,
        disabled: !e.enabled,
      };
    });

  const NAV_SECTIONS = [
    {label:"forum settings", items:[
      {k:"overview",   icon:"fa-chart-line",          label:"overview"},
      {k:"analytics",  icon:"fa-chart-bar",            label:"analytics"},
      {k:"forum-info", icon:"fa-circle-info",          label:"forum info"},
      {k:"appearance", icon:"fa-swatchbook",           label:"appearance"},
      {k:"layout",     icon:"fa-table-columns",         label:"layout"},
      {k:"email",      icon:"fa-envelope",             label:"email"},
      {k:"permissions",icon:"fa-shield",               label:"permissions"},
      {k:"leaderboard",icon:"fa-trophy",               label:"leaderboard"},
      {k:"digest",     icon:"fa-envelope-open-text",   label:"digest"},
      {k:"moderation", icon:"fa-lock",                 label:"moderation"},
      {k:"extensions", icon:"fa-plug",                 label:"extensions", badge:0},
      {k:"pwa",        icon:"fa-mobile-screen",         label:"pwa"},
      {k:"integrations",icon:"fa-plug-circle-bolt",       label:"integrations"},
    ]},
    {label:"manage", items:[
      {k:"members",    icon:"fa-users",                label:"members"},
      {k:"anti-spam",  icon:"fa-shield-halved",        label:"anti-spam"},
      {k:"spaces",     icon:"fa-layer-group",          label:"spaces"},
      {k:"tags",       icon:"fa-tag",                  label:"tags"},
      {k:"badges",     icon:"fa-medal",                label:"badges"},
      {k:"pages",      icon:"fa-file-lines",          label:"pages"},
      {k:"reactions",   icon:"fa-heart",               label:"reactions"},
    ]},
    {label:"system", items:[
      {k:"storage",    icon:"fa-database",             label:"storage"},
      {k:"logs",       icon:"fa-file-lines",           label:"logs"},
      {k:"updates",    icon:"fa-rotate",               label:"updates"},
    ]},
    // One sidebar entry per installed extension. Server-only extensions
    // (no JS bundle, no registerAdminPanel) still appear here — they show
    // the system header (settings form, runtime panel, etc.) and no
    // custom content below it.
    ...(extensionSidebarItems.length > 0 ? [{
      label: "installed extensions",
      items: extensionSidebarItems,
    }] : []),
  ];


  return (
    <>
    <div className="admin-shell">
      <div className="mob-admin-topbar">
        <div className="mob-admin-back" onClick={()=>navigate("feed",{})}>
          <i className="fa-solid fa-arrow-left"/>Back to forum
        </div>
        <button className="mob-icon-btn" onClick={()=>setMobAdminNavOpen(true)}>
          <i className="fa-solid fa-bars"/>
        </button>
      </div>
      <div className={`admin-sidenav${mobAdminNavOpen?" mob-open":""}`}>
        <div className="mob-admin-close">
          <button className="mob-icon-btn" onClick={()=>setMobAdminNavOpen(false)}><i className="fa-solid fa-xmark"/></button>
        </div>
        <div className="admin-topbar" style={{borderBottom:"0.5px solid var(--b1)"}}>
          {(window._getBrandingState&&window._getBrandingState())?.logo_url
            ? <img src={(window._getBrandingState&&window._getBrandingState())?.logo_url} style={{height:28,maxWidth:120,objectFit:"contain"}} alt={(window._getBrandingState&&window._getBrandingState())?.site_name||"nexus"}/>
            : <span className="logo-text">{(window._getBrandingState&&window._getBrandingState())?.site_name||<>nexus<em>.</em></>}</span>}
          <div className="admin-badge"><i className="fa-solid fa-shield-halved" style={{fontSize:13}}></i>administration</div>
        </div>
        <div className="admin-sidenav-scroll">
          {NAV_SECTIONS.map(ns=>(
            <div key={ns.label}>
              <div className="admin-sn-label">{ns.label}</div>
              {ns.items.map(item=>(
                <div key={item.k} className={`admin-sn-item ${sec===item.k?"active":""}`}
                     onClick={()=>{setSec(item.k);setMobAdminNavOpen(false);}}
                     style={item.disabled?{opacity:0.5}:undefined}
                     title={item.disabled?`${item.label} (disabled — click to manage)`:undefined}>
                  <i className={`fa-solid ${item.icon}`}></i>
                  <span className="admin-sn-item-name">{item.label}</span>
                  {item.disabled && (
                    <i className="fa-solid fa-circle-pause"
                       style={{fontSize:10,color:"var(--t5)",marginRight:4}}
                       title="Disabled"/>
                  )}
                  {item.badge>0&&<span className="admin-sn-badge">{item.badge}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{padding:"10px 12px",borderTop:"0.5px solid var(--b1)"}}>
          <div className="admin-sn-item" onClick={()=>navigate("feed")}>
            <i className="fa-solid fa-arrow-left"></i>
            <span className="admin-sn-item-name">view forum</span>
          </div>
        </div>
      </div>
      <div className="admin-content-wrap">
        <div className="admin-topbar">
          <div style={{flex:1}}/>
          <button className="btn-ghost" disabled={!isDirty} onClick={()=>{
            loadGen.current += 1;
            const myGen = loadGen.current;
            api.get("/admin/settings").then(d=>{const s=d.settings||{};setGeneral(s.general||{});setBranding(s.appearance||{});setEmailCfg(s.email||{});setUploadCfg(s.uploads||{});setRegCfg(s.registration||{});const pc=s.posting||{};setPostCfg(pc);window._postCfg=pc;window._reactionsCfg=s.reactions||{};setLbCfg(s.leaderboard||{});setDigestCfg(s.digest||{});setPwaCfg(s.pwa||{});setSpamCfg(s.anti_spam||{});setIntegrationsCfg(s.integrations||{});setReactionsCfg(s.reactions||{});}).then(()=>{ settledGen.current = myGen; setIsDirty(false); toast("Discarded"); });
          }}>Discard</button>
          <button className="btn-primary" onClick={()=>{
            if(sec==="appearance") saveSection("appearance",branding);
            else if(sec==="email") saveSection("email",emailCfg);
            else if(sec==="layout") saveSection("layout",layoutCfg);
            else if(sec==="forum-info") saveSection("general",general);
            else if(sec==="storage") saveSection("uploads",uploadCfg);
            else if(sec==="reactions") saveSection("reactions",reactionsCfg);
            else if(sec==="permissions") {
              const saves = [saveSection("registration",regCfg), saveSection("posting",postCfg)];
              // Save each extension's permission settings
              Object.entries(extPermCfg).forEach(([slug, vals]) => {
                saves.push(api.patch(`/admin/extensions/${slug}/settings`, {settings: vals}).catch(()=>{}));
              });
              Promise.all(saves);
            }
            else if(sec==="leaderboard") saveSection("leaderboard",lbCfg);
            else if(sec==="digest") saveSection("digest",digestCfg);
            else if(sec==="moderation") saveSection("moderation",general);
            else if(sec==="pwa") saveSection("pwa",pwaCfg);
            else if(sec==="anti-spam") saveSection("anti_spam",spamCfg);
            else if(sec==="integrations") saveSection("integrations",integrationsCfg);
            else if(sec.startsWith("ext-panel-")&&window._nexusAdminSaveFn) window._nexusAdminSaveFn().then(()=>setIsDirty(false));
          }} disabled={saving||!isDirty} style={{opacity:isDirty?1:0.4,cursor:isDirty?"pointer":"default"}}>{saving?"…":"Save changes"}</button>
        </div>
        <div className="admin-content-body">

          {sec==="overview"&&<>
            <div className="page-sub">A snapshot of your community's health and activity.</div>

            {/* ── Top stat cards ── */}
            <div className="admin-stat-row">
              {[
                {icon:"fa-users",        color:"#a78bfa", n:stats?.users?.total??0,          label:"total members",    delta:`+${stats?.extended?.members?.new_month??0} this month`},
                {icon:"fa-user-plus",    color:"#34d399", n:stats?.extended?.members?.new_week??0, label:"new this week",  delta:`+${stats?.extended?.members?.new_month??0} this month`},
                {icon:"fa-pen-to-square",color:"#60a5fa", n:stats?.content?.posts??0,         label:"total posts",      delta:`+${stats?.extended?.content?.posts_week??0} this week`},
                {icon:"fa-reply",        color:"#f472b6", n:stats?.content?.replies??0,       label:"total replies",    delta:`+${stats?.extended?.content?.replies_week??0} this week`},
                {icon:"fa-eye-slash",    color:"#fbbf24", n:stats?.extended?.members?.lurkers??0, label:"lurkers",      delta:`${stats?.extended?.members?.active??0} have posted`},
                {icon:"fa-flag",         color:"#f87171", n:stats?.moderation?.pending_reports??0, label:"pending reports", delta:`${stats?.extended?.pending?.posts??0} posts pending`},
              ].map((c,i)=>(
                <div key={i} className="admin-stat-card">
                  <div className="asc-icon" style={{background:`${c.color}18`}}><i className={`fa-solid ${c.icon}`} style={{color:c.color,fontSize:15}}/></div>
                  <div className="asc-n" style={{color:c.color}}>{c.n.toLocaleString()}</div>
                  <div className="asc-l">{c.label}</div>
                  <div className="asc-delta delta-up">{c.delta}</div>
                </div>
              ))}
            </div>

            {/* ── Posts per day sparkline ── */}
            <div className="fgt" style={{marginTop:24}}>Post activity — last 30 days</div>
            <div style={{border:"0.5px solid var(--b1)",borderRadius:12,padding:"16px 20px",marginBottom:4}}>
              {(()=>{
                const data = stats?.extended?.content?.posts_per_day||[];
                if(!data.length) return <div style={{color:"var(--t5)",fontSize:12,padding:"8px 0"}}>No post data yet</div>;
                const max = Math.max(...data.map(d=>d.count),1);
                const today = new Date().toISOString().slice(0,10);
                // Build a full 30-day array filling missing dates with 0
                const days = Array.from({length:30},(_,i)=>{
                  const d = new Date(); d.setDate(d.getDate()-29+i);
                  const key = d.toISOString().slice(0,10);
                  const found = data.find(x=>String(x.date)===key);
                  return {date:key, count:found?.count||0};
                });
                return (
                  <div style={{display:"flex",alignItems:"flex-end",gap:3,height:60}}>
                    {days.map((d,i)=>(
                      <div key={i} title={`${d.date}: ${d.count} posts`} style={{flex:1,minWidth:0,
                        height:`${Math.max((d.count/max)*100,2)}%`,
                        background:d.date===today?"var(--ac)":"rgba(167,139,250,0.35)",
                        borderRadius:"2px 2px 0 0",transition:"height .2s",cursor:"default"}}/>
                    ))}
                  </div>
                );
              })()}
              <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--t5)",marginTop:6}}>
                <span>30 days ago</span><span>today</span>
              </div>
            </div>

            {/* ── Space activity + Top contributors ── */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginTop:20}}>
              <div>
                <div className="fgt" style={{marginBottom:10}}>Most active spaces (30 days)</div>
                <div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden"}}>
                  {(stats?.extended?.space_activity||[]).length===0
                    ?<div style={{padding:"14px 16px",color:"var(--t5)",fontSize:12}}>No data yet</div>
                    :(stats?.extended?.space_activity||[]).map((s,i,arr)=>{
                      const max=arr[0]?.count||1;
                      return (
                        <div key={s.space_id} style={{padding:"9px 14px",borderBottom:i<arr.length-1?"0.5px solid var(--b1)":"none"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                            <span style={{fontSize:12,color:"var(--t2)",fontWeight:500}}>{s.name}</span>
                            <span style={{fontSize:11,color:"var(--t4)"}}>{s.count} posts</span>
                          </div>
                          <div style={{height:3,background:"var(--b1)",borderRadius:2}}>
                            <div style={{height:3,background:"var(--ac)",borderRadius:2,width:`${(s.count/max)*100}%`,transition:"width .3s"}}/>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
              <div>
                <div className="fgt" style={{marginBottom:10}}>Top contributors this week</div>
                <div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden"}}>
                  {(stats?.extended?.top_contributors||[]).length===0
                    ?<div style={{padding:"14px 16px",color:"var(--t5)",fontSize:12}}>No posts this week</div>
                    :(stats?.extended?.top_contributors||[]).map((u,i,arr)=>(
                      <div key={u.user_id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",borderBottom:i<arr.length-1?"0.5px solid var(--b1)":"none"}}>
                        <div style={{width:7,height:7,borderRadius:"50%",background:"var(--ac)",opacity:1-(i*0.15),flexShrink:0}}/>
                        <Av user={{username:u.username,avatar_url:u.avatar_url,avatar_color:u.avatar_color,id:u.user_id}} size={28} />
                        <span style={{flex:1,fontSize:12,color:"var(--t2)"}}>{u.username}</span>
                        <span style={{fontSize:11,color:"var(--t4)"}}>{u.count} post{u.count!==1?"s":""}</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {/* ── Queue health ── */}
            <div className="fgt" style={{marginTop:24}}>Job queue health</div>
            <div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden",marginBottom:4}}>
              <div style={{display:"grid",gridTemplateColumns:"1.2fr repeat(5,1fr)",padding:"8px 14px",borderBottom:"0.5px solid var(--b1)",fontSize:11,color:"var(--t5)",fontWeight:500}}>
                <span>Queue</span><span>Available</span><span>Executing</span><span>Scheduled</span><span>Retrying</span><span>Discarded</span>
              </div>
              {queueStats?Object.entries(queueStats.queues||{}).map(([q,s])=>(
                <div key={q} style={{display:"grid",gridTemplateColumns:"1.2fr repeat(5,1fr)",padding:"9px 14px",borderBottom:"0.5px solid var(--b1)",fontSize:12,alignItems:"center"}}>
                  <span style={{color:"var(--t1)",fontWeight:500}}>{q}</span>
                  <span style={{color:"var(--green)"}}>{s.available||0}</span>
                  <span style={{color:s.executing>0?"var(--ac)":"var(--t4)"}}>{s.executing||0}</span>
                  <span style={{color:"var(--t3)"}}>{s.scheduled||0}</span>
                  <span style={{color:s.retryable>0?"var(--amber)":"var(--t4)"}}>{s.retryable||0}</span>
                  <span style={{color:s.discarded>0?"var(--red)":"var(--t4)"}}>{s.discarded||0}</span>
                </div>
              )):<div style={{padding:"14px 16px",color:"var(--t5)",fontSize:12}}>Loading…</div>}
            </div>

            {/* ── System health ── */}
            <div className="fgt" style={{marginTop:24}}>System health</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:12,marginBottom:4}}>
              {[
                {label:"Total memory",    value:sysStats?`${(sysStats.memory.total/1048576).toFixed(1)} MB`:"—",   color:"#60a5fa"},
                {label:"Process memory",  value:sysStats?`${(sysStats.memory.processes/1048576).toFixed(1)} MB`:"—", color:"#a78bfa"},
                {label:"Processes",       value:sysStats?`${sysStats.process_count} / ${sysStats.process_limit}`:"—", color:"#34d399"},
                {label:"Uptime",          value:sysStats?formatUptime(sysStats.uptime_seconds):"—",                 color:"#fbbf24"},
                {label:"Schedulers",      value:sysStats?`${sysStats.schedulers} online`:"—",                       color:"#f472b6"},
                {label:"OTP release",     value:sysStats?`OTP ${sysStats.otp_release}`:"—",                        color:"#f87171"},
                {label:"Binary memory",   value:sysStats?`${(sysStats.memory.binary/1048576).toFixed(1)} MB`:"—",  color:"#60a5fa"},
                {label:"ETS memory",      value:sysStats?`${(sysStats.memory.ets/1048576).toFixed(1)} MB`:"—",     color:"#a78bfa"},
              ].map((s,i)=>(
                <div key={i} style={{background:"var(--s2)",border:"0.5px solid var(--b1)",borderRadius:10,padding:"12px 14px"}}>
                  <div style={{fontSize:10,color:"var(--t5)",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>{s.label}</div>
                  <div style={{fontSize:14,fontWeight:600,color:s.color}}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* ── Storage ── */}
            <div className="fgt" style={{marginTop:24}}>Storage</div>
            <div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden"}}>
              {uploadStats?<>
                <div style={{display:"grid",gridTemplateColumns:"1.5fr 1fr 1fr",padding:"8px 14px",borderBottom:"0.5px solid var(--b1)",fontSize:11,color:"var(--t5)",fontWeight:500}}>
                  <span>Type</span><span>Files</span><span>Size</span>
                </div>
                {Object.entries(uploadStats.by_type||{}).map(([type,data])=>(
                  <div key={type} style={{display:"grid",gridTemplateColumns:"1.5fr 1fr 1fr",padding:"8px 14px",borderBottom:"0.5px solid var(--b1)",fontSize:12}}>
                    <span style={{color:"var(--t2)"}}>{type.replace("_"," ")}</span>
                    <span style={{color:"var(--t3)"}}>{data.count}</span>
                    <span style={{color:"var(--t3)"}}>{(data.bytes/1048576).toFixed(1)} MB</span>
                  </div>
                ))}
                <div style={{display:"grid",gridTemplateColumns:"1.5fr 1fr 1fr",padding:"9px 14px",fontSize:12,fontWeight:500}}>
                  <span style={{color:"var(--t1)"}}>Total</span>
                  <span style={{color:"var(--ac)"}}>{uploadStats.total_count}</span>
                  <span style={{color:"var(--ac)"}}>{(uploadStats.total_bytes/1048576).toFixed(1)} MB</span>
                </div>
              </>:<div style={{padding:"14px 16px",color:"var(--t5)",fontSize:12}}>Loading…</div>}
            </div>
          </>}

          {(sec==="forum-info")&&<>
            <div className="fgt">Forum identity</div>
            <F label="Forum name" hint="Appears in the browser tab and emails"><input className="fi" value={general.site_name||""} onChange={e=>setGeneral(p=>({...p,site_name:e.target.value}))} placeholder="Nexus"/></F>
            <F label="Forum description"><input className="fi" value={general.site_description||""} onChange={e=>setGeneral(p=>({...p,site_description:e.target.value}))} placeholder="A short description…"/></F>
            <F label="Base URL"><input className="fi" value={general.base_url||""} onChange={e=>setGeneral(p=>({...p,base_url:e.target.value}))} placeholder="forum.example.com"/></F>

            <div className="fgt" style={{marginTop:20}}>Homepage hero</div>
            <F label="Show hero banner" hint="Displays a welcome banner above the post feed on the homepage">
              <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
                <div className={`tgl-track ${general.hero_enabled?"on":""}`} onClick={()=>setGeneral(p=>({...p,hero_enabled:!p.hero_enabled}))} style={{width:36,height:20,borderRadius:10,background:general.hero_enabled?"var(--ac)":"var(--tgl-off)",position:"relative",cursor:"pointer",transition:"background .2s",flexShrink:0}}>
                  <div style={{position:"absolute",top:3,left:general.hero_enabled?18:3,width:14,height:14,borderRadius:"50%",background:"#fff",transition:"left .2s"}}/>
                </div>
                <span style={{fontSize:12,color:"var(--t3)"}}>{general.hero_enabled?"Enabled":"Disabled"}</span>
              </label>
            </F>
            <F label="Hero headline" hint="Large text displayed prominently in the banner">
              <input className="fi" value={general.hero_title||""} onChange={e=>setGeneral(p=>({...p,hero_title:e.target.value}))} placeholder="Welcome to our community"/>
            </F>
            <F label="Hero body text" hint="Supporting text below the headline">
              <textarea className="fi" value={general.hero_body||""} onChange={e=>setGeneral(p=>({...p,hero_body:e.target.value}))} placeholder="A place to discuss ideas, share knowledge, and connect." style={{resize:"vertical",minHeight:72,lineHeight:1.6}}/>
            </F>

            <div className="fgt" style={{marginTop:20}}>Site logo</div>
            <div className="logo-upload-row" style={{display:"flex",alignItems:"center",gap:14,marginBottom:8}}>
              {general.logo_url
                ?<img src={general.logo_url} style={{height:48,borderRadius:8,border:"0.5px solid var(--b2)",background:"var(--bg2)",padding:4}} alt="logo"/>
                :<div style={{width:48,height:48,borderRadius:8,border:"0.5px dashed var(--b2)",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)",fontSize:11}}>none</div>}
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                <label style={{cursor:"pointer"}}>
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" style={{display:"none"}} onChange={async e=>{
                    const f=e.target.files[0]; if(!f)return;
                    const fd=new FormData(); fd.append("file",f); fd.append("type","logo");
                    const token=localStorage.getItem("nexus_token");
                    const r=await fetch("/api/v1/uploads",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:fd});
                    const d=await r.json();
                    if(d.upload){setGeneral(p=>({...p,logo_url:d.original_url}));toast("Logo uploaded");}
                    else toast(d.error||"Upload failed");
                  }}/>
                  <span className="btn-ghost" style={{fontSize:12,pointerEvents:"none"}}>
                    <i className="fa-solid fa-arrow-up-from-bracket" style={{marginRight:6}}></i>Upload logo
                  </span>
                </label>
                {general.logo_url&&<span className="btn-ghost" style={{fontSize:12,color:"var(--red)",cursor:"pointer"}} onClick={()=>setGeneral(p=>({...p,logo_url:null}))}>Remove</span>}
              </div>
              <div style={{fontSize:11,color:"var(--t5)",lineHeight:1.5}}>PNG or SVG recommended.<br/>Max 400px wide.<br/><span style={{color:"var(--amber)"}}>Avoid WebP — not supported in most email clients.</span></div>
            </div>

            <div className="fgt" style={{marginTop:20}}>Favicon</div>
            <div className="logo-upload-row" style={{display:"flex",alignItems:"center",gap:14,marginBottom:8}}>
              {general.favicon_url
                ?<img src={general.favicon_url} style={{width:32,height:32,borderRadius:4,border:"0.5px solid var(--b2)",background:"var(--bg2)",padding:2}} alt="favicon"/>
                :<div style={{width:32,height:32,borderRadius:4,border:"0.5px dashed var(--b2)",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)",fontSize:10}}>none</div>}
              <label style={{cursor:"pointer"}}>
                <input type="file" accept="image/x-icon,image/png,image/svg+xml,image/webp" style={{display:"none"}} onChange={async e=>{
                  const f=e.target.files[0]; if(!f)return;
                  const fd=new FormData(); fd.append("file",f); fd.append("type","favicon");
                  const token=localStorage.getItem("nexus_token");
                  const r=await fetch("/api/v1/uploads",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:fd});
                  const d=await r.json();
                  if(d.upload){setGeneral(p=>({...p,favicon_url:d.original_url}));toast("Favicon uploaded");}
                  else toast(d.error||"Upload failed");
                }}/>
                <span className="btn-ghost" style={{fontSize:12,pointerEvents:"none"}}>
                  <i className="fa-solid fa-arrow-up-from-bracket" style={{marginRight:6}}></i>Upload favicon
                </span>
              </label>
              <div style={{fontSize:11,color:"var(--t5)",lineHeight:1.5}}>.ico or 32×32 PNG.<br/>Shown in browser tabs.</div>
            </div>

            <div className="fgt" style={{marginTop:20}}>OG image</div>
            <div style={{fontSize:12,color:"var(--t4)",marginBottom:12,lineHeight:1.6}}>
              Shown when your forum is shared on social media, Slack, Discord, and iMessage.
              Recommended size: 1200×630px. PNG or JPG.
            </div>
            <div className="logo-upload-row" style={{display:"flex",alignItems:"flex-start",gap:14,marginBottom:8}}>
              {general.og_image_url
                ? <div style={{position:"relative",flexShrink:0}}>
                    <img src={general.og_image_url} style={{width:160,height:84,objectFit:"cover",borderRadius:8,border:"0.5px solid var(--b2)"}} alt="OG image"/>
                    <div style={{position:"absolute",bottom:4,right:4,background:"rgba(0,0,0,0.55)",borderRadius:4,padding:"2px 6px",fontSize:10,color:"#fff"}}>1200×630</div>
                  </div>
                : <div style={{width:160,height:84,borderRadius:8,border:"0.5px dashed var(--b2)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6,color:"var(--t5)",fontSize:11,flexShrink:0}}>
                    <i className="fa-regular fa-image" style={{fontSize:20,opacity:0.4}}/>
                    no image
                  </div>}
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                <label style={{cursor:"pointer"}}>
                  <input type="file" accept="image/jpeg,image/png,image/webp" style={{display:"none"}} onChange={async e=>{
                    const f=e.target.files[0]; if(!f)return;
                    const fd=new FormData(); fd.append("file",f); fd.append("type","og_image");
                    const token=localStorage.getItem("nexus_token");
                    const r=await fetch("/api/v1/uploads",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:fd});
                    const d=await r.json();
                    if(d.upload){setGeneral(p=>({...p,og_image_url:d.original_url}));toast("OG image uploaded");}
                    else toast(d.error||"Upload failed");
                  }}/>
                  <span className="btn-ghost" style={{fontSize:12,pointerEvents:"none"}}>
                    <i className="fa-solid fa-arrow-up-from-bracket" style={{marginRight:6}}/>Upload image
                  </span>
                </label>
                {general.og_image_url&&<span className="btn-ghost" style={{fontSize:12,color:"var(--red)",cursor:"pointer"}} onClick={()=>setGeneral(p=>({...p,og_image_url:null}))}>Remove</span>}
                <div style={{fontSize:11,color:"var(--t5)",lineHeight:1.6,marginTop:2}}>
                  1200×630px recommended.<br/>
                  PNG or JPG — avoid WebP<br/>
                  <span style={{color:"var(--amber)"}}>(email and some crawlers don't support it).</span>
                </div>
              </div>
            </div>
          </>}

          {sec==="appearance"&&<>
            <div className="fgt">Themes</div>
            {(()=>{
              const darkOn  = branding.dark_enabled  !== false;
              const lightOn = branding.light_enabled !== false;
              const onlyOne = (darkOn && !lightOn) || (!darkOn && lightOn);
              const [appTab, setAppTab] = [branding._appTab||"dark", v=>setBranding(p=>({...p,_appTab:v}))];
              return (<>
                {/* Enable/disable toggles */}
                <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:20}}>
                  {[{key:"dark_enabled",label:"Dark mode",def:true,color:"#a78bfa"},{key:"light_enabled",label:"Light mode",def:true,color:"#7351db"}].map(({key,label,def,color})=>{
                    const isOn = key==="dark_enabled" ? darkOn : lightOn;
                    const locked = onlyOne && isOn;
                    return (
                      <div key={key} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",background:"var(--s2)",border:"0.5px solid var(--b1)",borderRadius:10}}>
                        <div style={{width:10,height:10,borderRadius:"50%",background:color,flexShrink:0}}/>
                        <div style={{flex:1}}>
                          <div style={{fontSize:13,fontWeight:500,color:"var(--t2)"}}>{label}</div>
                          {locked&&<div style={{fontSize:11,color:"var(--t5)",marginTop:2}}>At least one theme must be enabled</div>}
                        </div>
                        <div style={{position:"relative",width:40,height:22,borderRadius:11,background:isOn?"var(--ac)":"var(--tgl-off)",cursor:locked?"not-allowed":"pointer",transition:"background .15s",flexShrink:0,opacity:locked?0.5:1}}
                          onClick={()=>{if(locked)return;setBranding(p=>({...p,[key]:!isOn}));}}>
                          <div style={{position:"absolute",top:2,left:isOn?20:2,width:18,height:18,borderRadius:"50%",background:"#fff",transition:"left .15s"}}/>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Default theme selector — only when both enabled */}
                {darkOn && lightOn && (
                  <div style={{marginBottom:20}}>
                    <div style={{fontSize:11,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:8}}>Default theme</div>
                    <div style={{display:"inline-flex",background:"var(--s2)",border:"0.5px solid var(--b1)",borderRadius:10,padding:3,gap:2}}>
                      {[{v:"auto",icon:"fa-circle-half-stroke",label:"Auto"},{v:"dark",icon:"fa-moon",label:"Dark"},{v:"light",icon:"fa-sun",label:"Light"}].map(({v,icon,label})=>{
                        const active = (branding.default_theme||"dark")===v;
                        return (
                          <button key={v} onClick={()=>setBranding(p=>({...p,default_theme:v}))}
                            style={{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:8,border:"none",background:active?"var(--s3)":"transparent",fontSize:12,fontWeight:active?500:400,color:active?"var(--t1)":"var(--t4)",cursor:"pointer",fontFamily:"inherit",transition:"all .1s"}}>
                            <i className={`fa-solid ${icon}`} style={{fontSize:11}}/>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Per-theme color tabs */}
                <div style={{marginBottom:16}}>
                  <div style={{display:"flex",gap:0,borderBottom:"0.5px solid var(--b1)",marginBottom:20}}>
                    {[darkOn&&{id:"dark",label:"Dark theme",icon:"fa-moon"},lightOn&&{id:"light",label:"Light theme",icon:"fa-sun"}].filter(Boolean).map(t=>(
                      <button key={t.id} onClick={()=>setAppTab(t.id)}
                        style={{display:"flex",alignItems:"center",gap:7,padding:"9px 16px",background:"none",border:"none",borderBottom:appTab===t.id?"2px solid var(--ac)":"2px solid transparent",color:appTab===t.id?"var(--ac-text)":"var(--t4)",fontWeight:appTab===t.id?500:400,fontSize:13,cursor:"pointer",fontFamily:"inherit",marginBottom:-1}}>
                        <i className={`fa-solid ${t.icon}`} style={{fontSize:11}}/>{t.label}
                      </button>
                    ))}
                  </div>

                  {appTab==="dark"&&darkOn&&<>
                    <F label="Accent color" hint="Used for buttons, active states, and highlights on dark backgrounds">
                      <ColorPicker
                        value={branding.accent_color||"#a78bfa"}
                        onChange={v=>{
                          setBranding(p=>({...p,accent_color:v}));
                          if(_currentTheme==="dark"&&/^#[0-9a-fA-F]{6}$/.test(v)){const vars=deriveAccentVars(v);if(vars){const r=document.documentElement;r.style.setProperty("--ac",v);r.style.setProperty("--ac-on",vars.onAccent);r.style.setProperty("--ac-bg",vars.acBg);r.style.setProperty("--ac-border",vars.acBorder);r.style.setProperty("--ac-text",vars.acText);}}
                        }}
                      />
                    </F>
                    <F label="Background tint" hint="Subtle hue tint applied to dark surfaces. Use near-black for no tint.">
                      <ColorPicker
                        value={branding.tint_color||"#0d0d14"}
                        onChange={v=>{
                          setBranding(p=>({...p,tint_color:v}));
                          if(_currentTheme==="dark"&&/^#[0-9a-fA-F]{6}$/.test(v)){const tint=deriveTintVars(v);if(tint){const r=document.documentElement;r.style.setProperty("--bg",tint.bg);r.style.setProperty("--s1",tint.s1);r.style.setProperty("--s2",tint.s2);r.style.setProperty("--s3",tint.s3);}}
                        }}
                      />
                    </F>
                  </>}

                  {appTab==="light"&&lightOn&&<>
                    <F label="Accent color" hint="Used for buttons, active states, and highlights on light backgrounds">
                      <ColorPicker
                        value={branding.light_accent_color||"#7351db"}
                        onChange={v=>{
                          setBranding(p=>({...p,light_accent_color:v}));
                          if(_currentTheme==="light"&&/^#[0-9a-fA-F]{6}$/.test(v)){const vars=deriveAccentVarsLight(v);if(vars){const r=document.documentElement;r.style.setProperty("--ac",v);r.style.setProperty("--ac-on",vars.onAccent);r.style.setProperty("--ac-bg",vars.acBg);r.style.setProperty("--ac-border",vars.acBorder);r.style.setProperty("--ac-text",vars.acText);}}
                        }}
                      />
                    </F>
                    <F label="Background tint" hint="Subtle hue tint applied to light surfaces. Use near-white for no tint.">
                      <ColorPicker
                        value={branding.light_tint_color||"#f5f4fb"}
                        onChange={v=>{
                          setBranding(p=>({...p,light_tint_color:v}));
                          if(_currentTheme==="light"&&/^#[0-9a-fA-F]{6}$/.test(v)){const tint=deriveTintVarsLight(v);if(tint){const r=document.documentElement;r.style.setProperty("--bg",tint.bg);r.style.setProperty("--s1",tint.s1);r.style.setProperty("--s2",tint.s2);r.style.setProperty("--s3",tint.s3);}}
                        }}
                      />
                    </F>
                  </>}
                </div>
              </>);
            })()}
            <div className="fgt" style={{marginTop:16}}>Avatars</div>
            <F label="Avatar shape" hint="Controls roundness of all avatars across the forum">
              <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:6}}>
                <input type="range" min="0" max="50" value={branding.avatar_radius??22}
                  onChange={e=>{const v=parseInt(e.target.value);setBranding(p=>({...p,avatar_radius:v}));document.documentElement.style.setProperty("--av-radius",`${v}%`);}}
                  style={{flex:1,accentColor:"var(--ac)"}}/>
                <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
                  {["#a78bfa","#60a5fa","#34d399"].map((c,i)=>(
                    <div key={i} style={{width:32,height:32,borderRadius:`${branding.avatar_radius??22}%`,background:c,flexShrink:0,transition:"border-radius .15s"}}/>
                  ))}
                </div>
                <span style={{fontSize:12,color:"var(--t4)",minWidth:36,textAlign:"right"}}>{branding.avatar_radius??22}%</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--t5)",paddingRight:148}}>
                <span>■ Square</span><span>Rounded</span><span>● Circle</span>
              </div>
            </F>
            <div className="fgt" style={{marginTop:16}}>Typography</div>
            {[
              {key:"fs_ui",      label:"UI labels",          hint:"Section headers, tags, sort pills, timestamps",  min:9,  max:14, def:11},
              {key:"fs_body",    label:"Interface text",     hint:"Sidebar items, feed text, messages, buttons",    min:11, max:16, def:13},
              {key:"fs_feed_title", label:"Feed post titles",   hint:"Post title size on the feed and search pages",  min:11, max:20, def:14},
              {key:"fs_title",   label:"Post titles",        hint:"Thread title on the post page",                  min:16, max:28, def:20},
              {key:"fs_content", label:"Post & reply body",  hint:"Written content inside posts and replies",       min:12, max:18, def:14},
              {key:"fs_code",    label:"Code blocks",        hint:"Inline code and code block text",                min:10, max:15, def:12},
            ].map(({key,label,hint,min,max,def})=>(
              <F key={key} label={label} hint={hint}>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <input type="range" min={min} max={max} value={branding[key]??def}
                    style={{flex:1,accentColor:"var(--ac)"}}
                    onChange={e=>{
                      const v=parseInt(e.target.value);
                      setBranding(p=>({...p,[key]:v}));
                      document.documentElement.style.setProperty(`--${key.replaceAll("_","-")}`,`${v}px`);
                    }}/>
                  <span style={{fontSize:12,color:"var(--t4)",minWidth:32,textAlign:"right"}}>{branding[key]??def}px</span>
                </div>
              </F>
            ))}
            <div className="fgt" style={{marginTop:16}}>Custom CSS</div>
            <textarea className="fi" style={{fontFamily:"monospace",fontSize:12,minHeight:100,resize:"vertical",lineHeight:1.6,color:"var(--ac-text)"}} value={branding.custom_css||""} onChange={e=>setBranding(p=>({...p,custom_css:e.target.value}))} placeholder="/* Additional styles */"/>
          </>}

          {sec==="moderation"&&<AdminModerationPanel
            reports={reports} setReports={setReports}
            modLogs={modLogs} users={users} setUsers={setUsers}
            currentUser={currentUser} navigate={navigate}
          />}

          {sec==="members"&&<>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <div className="fgt" style={{marginBottom:0}}>All members</div>
              <button className="btn-primary" style={{fontSize:12,padding:"6px 16px"}} onClick={()=>{setNewUser({username:"",email:"",password:"",role:"member",skip_verification:false});setShowCreateUser(true);}}>+ New member</button>
            </div>
            <div style={{marginBottom:12,display:"flex",alignItems:"center",gap:8,background:"rgba(255,255,255,0.04)",border:"0.5px solid var(--b1)",borderRadius:20,padding:"7px 14px",maxWidth:360}}>
              <i className="fa-solid fa-magnifying-glass" style={{fontSize:11,color:"var(--t5)",flexShrink:0}}/>
              <input
                style={{background:"transparent",border:"none",outline:"none",fontSize:13,color:"var(--t2)",fontFamily:"inherit",flex:1}}
                placeholder="Search by username or email…"
                value={memberSearch||""}
                onChange={e=>setMemberSearch(e.target.value)}
              />
              {memberSearch&&<button onClick={()=>setMemberSearch("")} style={{background:"none",border:"none",color:"var(--t5)",cursor:"pointer",padding:0,fontSize:12,lineHeight:1,flexShrink:0}}><i className="fa-solid fa-xmark"/></button>}
            </div>
            <div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden"}}>
              <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}><table className="atbl members-tbl"><thead><tr><th>Member</th><th>Role</th><th>Joined</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>{(memberSearch ? users.filter(u=>u.username?.toLowerCase().includes(memberSearch.toLowerCase())||u.email?.toLowerCase().includes(memberSearch.toLowerCase())) : users).map(u=>(
                  <tr key={u.id}>
                    <td style={{fontWeight:500,color:"var(--t1)"}}>{u.username}<div style={{fontSize:11,color:"var(--t5)"}}>{u.email}</div></td>
                    <td><Select style={{background:"rgba(255,255,255,0.05)",border:"0.5px solid var(--b1)",borderRadius:6,padding:"3px 8px",fontSize:11,color:"var(--t1)",fontFamily:"inherit",outline:"none",cursor:"pointer"}} value={u.role} onChange={async v=>{await api.patch(`/admin/users/${u.id}/role`,{role:v});setUsers(p=>p.map(x=>x.id===u.id?{...x,role:v}:x));toast("Role updated");}} disabled={u.id===currentUser.id}><option value="member">member</option><option value="moderator">moderator</option><option value="admin">admin</option></Select></td>
                    <td style={{color:"var(--t5)",fontSize:11}}>{fmtDate(u.inserted_at)}</td>
                    <td><span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:12}}><span style={{width:6,height:6,borderRadius:"50%",background:u.status==="active"?"var(--green)":"var(--red)"}}></span>{u.status}</span></td>
                    <td style={{textAlign:"right"}}>
                      {u.id!==currentUser.id&&<>
                        <div style={{display:"flex",gap:6,justifyContent:"flex-end",flexWrap:"wrap",alignItems:"center"}}>
                          {!u.email_verified&&<button onClick={async()=>{const d=await api.patch(`/admin/users/${u.id}/verify-email`,{});if(d.ok){setUsers(p=>p.map(x=>x.id===u.id?{...x,email_verified:true}:x));toast("Email verified");}else toast(d.error||"Failed","err");}} style={{fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20,border:"0.5px solid rgba(96,165,250,0.25)",background:"rgba(96,165,250,0.12)",color:"#60a5fa",cursor:"pointer",fontFamily:"inherit"}}>verify email</button>}
                          {u.email_verified&&<span style={{fontSize:10,color:"var(--green)",display:"flex",alignItems:"center",gap:3}}><i className="fa-solid fa-circle-check" style={{fontSize:10}}/>verified</span>}
                          {u.status==="banned"
                            ?<button onClick={async()=>{await api.delete(`/moderation/users/${u.username}/ban`);setUsers(p=>p.map(x=>x.id===u.id?{...x,status:"active"}:x));toast("User unbanned");}} style={{fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20,border:"0.5px solid rgba(52,211,153,0.25)",background:"rgba(52,211,153,0.12)",color:"#34d399",cursor:"pointer",fontFamily:"inherit"}}>unban</button>
                            :<button onClick={async()=>{if(!confirm(`Ban ${u.username}?`))return;await api.post(`/moderation/users/${u.username}/ban`,{reason:"Admin action"});setUsers(p=>p.map(x=>x.id===u.id?{...x,status:"banned"}:x));toast("User banned");}} style={{fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20,border:"0.5px solid rgba(248,113,113,0.25)",background:"rgba(248,113,113,0.12)",color:"#f87171",cursor:"pointer",fontFamily:"inherit"}}>ban</button>}
                          {u.status==="suspended"
                            ?<button onClick={async()=>{await api.delete(`/moderation/users/${u.username}/suspend`);setUsers(p=>p.map(x=>x.id===u.id?{...x,status:"active"}:x));toast("Suspension lifted");}} style={{fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20,border:"0.5px solid rgba(52,211,153,0.25)",background:"rgba(52,211,153,0.12)",color:"#34d399",cursor:"pointer",fontFamily:"inherit"}}>unsuspend</button>
                            :<button onClick={async()=>{if(!confirm(`Suspend ${u.username}?`))return;await api.post(`/moderation/users/${u.username}/suspend`,{reason:"Admin action"});setUsers(p=>p.map(x=>x.id===u.id?{...x,status:"suspended"}:x));toast("User suspended");}} style={{fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20,border:"0.5px solid rgba(251,191,36,0.25)",background:"rgba(251,191,36,0.12)",color:"#fbbf24",cursor:"pointer",fontFamily:"inherit"}}>suspend</button>}
                          <button onClick={async()=>{if(!confirm(`Permanently delete ${u.username}? This cannot be undone.`))return;const d=await api.delete(`/admin/users/${u.id}`);if(d.ok){setUsers(p=>p.filter(x=>x.id!==u.id));toast("User deleted");}else toast(d.error||"Failed","err");}} style={{fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20,border:"0.5px solid rgba(248,113,113,0.15)",background:"rgba(248,113,113,0.07)",color:"rgba(248,113,113,0.6)",cursor:"pointer",fontFamily:"inherit"}}>delete</button>
                          <button onClick={async()=>{if(!confirm(`Mark ${u.username} as spammer? This will ban them and delete all their posts and DMs.`))return;const d=await api.post(`/admin/users/${u.id}/mark-spammer`,{});if(d.ok){setUsers(p=>p.filter(x=>x.id!==u.id));toast("Marked as spammer");}else toast(d.error||"Failed","err");}} style={{fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20,border:"0.5px solid rgba(251,146,60,0.25)",background:"rgba(251,146,60,0.1)",color:"#fb923c",cursor:"pointer",fontFamily:"inherit"}}>mark spammer</button>
                        </div>
                      </>}
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
          </>}

          {sec==="email"&&<>
            <div className="fgt">Delivery provider</div>
            <F label="Provider">
              <Select value={emailCfg.provider||"smtp"} onChange={v=>setEmailCfg(p=>({...p,provider:v}))}>
                <option value="smtp">SMTP</option>
                <option value="postmark">Postmark</option>
                <option value="resend">Resend</option>
                <option value="mailgun">Mailgun</option>
              </Select>
            </F>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <F label="From address"><input className="fi" value={emailCfg.from_address||""} onChange={e=>setEmailCfg(p=>({...p,from_address:e.target.value}))} placeholder="hello@yourdomain.com"/></F>
              <F label="From name"><input className="fi" value={emailCfg.from_name||""} onChange={e=>setEmailCfg(p=>({...p,from_name:e.target.value}))} placeholder="Nexus"/></F>
            </div>
            {(emailCfg.provider==="smtp"||!emailCfg.provider)&&<>
              <div className="fgt" style={{marginTop:16}}>SMTP credentials</div>
              <F label="SMTP host"><input className="fi" value={emailCfg.smtp_host||""} onChange={e=>setEmailCfg(p=>({...p,smtp_host:e.target.value}))} placeholder="smtp.example.com"/></F>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <F label="Port"><input className="fi" value={emailCfg.smtp_port||""} onChange={e=>setEmailCfg(p=>({...p,smtp_port:e.target.value}))} placeholder="587"/></F>
                <F label="Encryption">
                  <Select value={emailCfg.smtp_encryption||"tls"} onChange={v=>setEmailCfg(p=>({...p,smtp_encryption:v}))}>
                    <option value="tls">STARTTLS (587)</option>
                    <option value="ssl">SSL/TLS (465)</option>
                    <option value="none">None (25)</option>
                  </Select>
                </F>
              </div>
              <F label="SMTP username"><input className="fi" value={emailCfg.smtp_username||""} onChange={e=>setEmailCfg(p=>({...p,smtp_username:e.target.value}))} placeholder="username or email"/></F>
              <F label="SMTP password"><input className="fi" type="password" value={emailCfg.smtp_password||""} onChange={e=>setEmailCfg(p=>({...p,smtp_password:e.target.value}))} placeholder="••••••••"/></F>
            </>}
            {emailCfg.provider==="postmark"&&<>
              <div className="fgt" style={{marginTop:16}}>Postmark credentials</div>
              <F label="Server API token" hint="Found in your Postmark account under API Tokens"><input className="fi" value={emailCfg.api_key||""} onChange={e=>setEmailCfg(p=>({...p,api_key:e.target.value}))} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"/></F>
            </>}
            {emailCfg.provider==="resend"&&<>
              <div className="fgt" style={{marginTop:16}}>Resend credentials</div>
              <F label="API key" hint="Found in your Resend dashboard"><input className="fi" value={emailCfg.api_key||""} onChange={e=>setEmailCfg(p=>({...p,api_key:e.target.value}))} placeholder="re_xxxxxxxxxxxx"/></F>
            </>}
            {emailCfg.provider==="mailgun"&&<>
              <div className="fgt" style={{marginTop:16}}>Mailgun credentials</div>
              <F label="API key"><input className="fi" value={emailCfg.api_key||""} onChange={e=>setEmailCfg(p=>({...p,api_key:e.target.value}))} placeholder="key-xxxxxxxxxxxx"/></F>
              <F label="Domain"><input className="fi" value={emailCfg.mailgun_domain||""} onChange={e=>setEmailCfg(p=>({...p,mailgun_domain:e.target.value}))} placeholder="mg.yourdomain.com"/></F>
            </>}
            <div style={{marginTop:20,paddingTop:16,borderTop:"0.5px solid var(--b1)",display:"flex",alignItems:"center",gap:10}}>
              <button className="btn-ghost" style={{fontSize:12}} onClick={async()=>{
                const d=await api.post("/admin/test-email",{});
                if(d.ok) toast("Test email sent — check your inbox");
                else toast(d.error||"Failed to send test email","err");
              }}>Send test email</button>
              <span style={{fontSize:11,color:"var(--t5)"}}>Sends to your account email address</span>
            </div>
          </>}

          {sec==="anti-spam"&&<AdminAntiSpamPanel spamCfg={spamCfg} setSpamCfg={setSpamCfg}/>}
          {sec==="integrations"&&<AdminIntegrationsPanel cfg={integrationsCfg} setCfg={setIntegrationsCfg}/>}

          {sec==="spaces"&&<SpacesAdmin spaces={spaces} onRefresh={()=>{ api.get("/spaces").then(d=>setSpaces(d.spaces||[])); onSpacesUpdated?.(); }} layoutCfg={layoutCfg} setLayoutCfg={setLayoutCfg}/>}
          {sec==="tags"&&<TagsAdmin tags={tags} onRefresh={()=>api.get("/tags").then(d=>setTags(d.tags||[]))}/>}

          {sec==="permissions"&&<>
            <div className="fgt">Registration</div>
            <Toggle label="Allow public registration" hint="Anyone can sign up for an account" value={regCfg.open!==false} onChange={v=>setRegCfg(p=>({...p,open:v}))}/>
            <Toggle label="Require email verification" hint="Users must verify their email before posting" value={!!regCfg.require_email_verification} onChange={v=>setRegCfg(p=>({...p,require_email_verification:v}))}/>
            <F label="Minimum account age to post" hint="Hours a new account must exist before posting. 0 = no minimum.">
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <input className="fi" type="number" min="0" max="8760" style={{width:80}} value={regCfg.min_account_age_hours||0} onChange={e=>setRegCfg(p=>({...p,min_account_age_hours:parseInt(e.target.value)||0}))}/>
                <span style={{fontSize:13,color:"var(--t4)"}}>hours</span>
              </div>
            </F>

            <div className="fgt" style={{marginTop:20}}>Profiles</div>
            <Toggle label="Enable question posts" hint="Allows users to mark a post as a question. The OP or mods can then mark a reply as the accepted answer." value={!!postCfg.questions_enabled} onChange={v=>setPostCfg(p=>({...p,questions_enabled:v}))}/>
            <Toggle label="Public media tabs" hint="Allow anyone to view the Media tab on other users' profiles. Off by default — users can only see their own media." value={!!postCfg.media_public} onChange={v=>setPostCfg(p=>({...p,media_public:v}))}/>

            <div className="fgt" style={{marginTop:20}}>Posting</div>
            <Toggle label="Allow guest browsing" hint="Non-logged-in users can read the forum. Disabling redirects guests to login." value={postCfg.guest_browsing!==false} onChange={v=>setPostCfg(p=>({...p,guest_browsing:v}))}/>
            <Toggle label="Allow self-reactions" hint="Users can react to their own posts and replies. Disable to prevent self-promotion." value={postCfg.allow_self_reactions!==false} onChange={v=>setPostCfg(p=>({...p,allow_self_reactions:v}))}/>
            <Toggle label="New users can post immediately" hint="If off, new user posts are queued for moderator approval." value={postCfg.instant_post!==false} onChange={v=>setPostCfg(p=>({...p,instant_post:v}))}/>
            <F label="Max posts per hour" hint="Per-user rate limit. 0 = unlimited.">
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <input className="fi" type="number" min="0" max="100" style={{width:80}} value={postCfg.max_posts_per_hour||0} onChange={e=>setPostCfg(p=>({...p,max_posts_per_hour:parseInt(e.target.value)||0}))}/>
                <span style={{fontSize:13,color:"var(--t4)"}}>per hour</span>
              </div>
            </F>
            <F label="Who can create spaces">
              <Select value={postCfg.who_can_create_spaces||"admin"} onChange={v=>setPostCfg(p=>({...p,who_can_create_spaces:v}))}>
                <option value="admin">Admins only</option>
                <option value="moderator">Moderators and admins</option>
                <option value="member">All members</option>
              </Select>
            </F>
            <F label="Who can upload images">
              <Select value={postCfg.who_can_upload||"member"} onChange={v=>setPostCfg(p=>({...p,who_can_upload:v}))}>
                <option value="admin">Admins only</option>
                <option value="moderator">Moderators and admins</option>
                <option value="member">All members</option>
              </Select>
            </F>

            <div className="fgt" style={{marginTop:20}}>Account deletion</div>
            <F label="Content handling on deletion" hint="What happens to a user's posts and replies when they permanently delete their account.">
              <Select value={postCfg.account_deletion_content||"anonymise"} onChange={v=>setPostCfg(p=>({...p,account_deletion_content:v}))}>
                <option value="anonymise">Anonymise content (show as Deleted User)</option>
                <option value="delete">Delete all content permanently</option>
              </Select>
            </F>

            {/* Extension permissions — one block per extension that declares permissions */}
            {installedExtensions.filter(e=>e.enabled&&e.permissions&&e.permissions.length>0).length>0&&<>
              <div className="fgt" style={{marginTop:20}}>Extension permissions</div>
              <div style={{fontSize:13,color:"var(--t4)",marginBottom:16}}>
                Permissions declared by installed extensions. Saved with the main Save button.
              </div>
              {installedExtensions.filter(e=>e.enabled&&e.permissions&&e.permissions.length>0).map(ext=>(
                <div key={ext.slug} style={{marginBottom:20}}>
                  {/* Extension header */}
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                    <div style={{width:28,height:28,borderRadius:7,background:"var(--s2)",border:"0.5px solid var(--b1)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      {ext.logo_url
                        ? <img src={ext.logo_url} style={{width:18,height:18,borderRadius:4,objectFit:"cover"}} alt=""/>
                        : <i className="fa-solid fa-puzzle-piece" style={{fontSize:12,color:"var(--t4)"}}/>}
                    </div>
                    <span style={{fontSize:13,fontWeight:500,color:"var(--t1)"}}>{ext.name}</span>
                    <span style={{fontSize:10,padding:"1px 7px",borderRadius:20,background:"rgba(167,139,250,0.08)",color:"var(--ac)",border:"0.5px solid rgba(167,139,250,0.2)"}}>extension</span>
                  </div>
                  {/* Permission rows */}
                  <div style={{background:"var(--s2)",border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden"}}>
                    {ext.permissions.map((perm,i)=>(
                      <div key={perm.key} style={{display:"flex",alignItems:"center",padding:"12px 16px",borderBottom:i<ext.permissions.length-1?"0.5px solid var(--b1)":"none"}}>
                        <div style={{flex:1,minWidth:0,paddingRight:16}}>
                          <div style={{fontSize:13,fontWeight:500,color:"var(--t1)",lineHeight:1.4}}>{perm.label}</div>
                          {perm.hint&&<div style={{fontSize:12,color:"var(--t4)",marginTop:2}}>{perm.hint}</div>}
                        </div>
                        <div style={{width:160,flexShrink:0}}>
                          <Select
                            value={(extPermCfg[ext.slug]&&extPermCfg[ext.slug][perm.key])||perm.default||"member"}
                            style={{width:160}}
                            onChange={v=>{
                              setExtPermCfg(p=>({...p,[ext.slug]:{...(p[ext.slug]||{}),[perm.key]:v}}));
                              setIsDirty(true);
                            }}>
                            <option value="everyone">Everyone</option>
                            <option value="member">Members</option>
                            <option value="moderator">Moderators</option>
                            <option value="admin">Admins only</option>
                          </Select>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>}
          </>}

          {sec==="moderation"&&<>
            <div className="fgt">Pending approval</div>
            {pendingItems.length===0
              ?<div style={{fontSize:13,color:"var(--t5)",padding:"12px 0",marginBottom:16}}>No content pending approval</div>
              :<div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden",marginBottom:20}}>
                {pendingItems.map(item=>{
                  const HOLD_LABELS = {
                    implausibly_fast:   {text:"Typed implausibly fast", color:"#fb923c", bg:"rgba(251,146,60,0.1)",   border:"rgba(251,146,60,0.3)"},
                    no_keystrokes:      {text:"No keystrokes detected",  color:"#f87171", bg:"rgba(248,113,113,0.1)", border:"rgba(248,113,113,0.3)"},
                    dominated_by_paste: {text:"Dominated by paste",      color:"#fb923c", bg:"rgba(251,146,60,0.1)",   border:"rgba(251,146,60,0.3)"},
                    metadata_missing:   {text:"No composition metadata", color:"#94a3b8", bg:"rgba(148,163,184,0.1)", border:"rgba(148,163,184,0.3)"},
                  };
                  const hl = item.hold_reason && HOLD_LABELS[item.hold_reason.verdict];
                  return (
                  <div key={`${item.type}-${item.id}`} style={{padding:"12px 16px",borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"flex-start",gap:12}}>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                        <span style={{fontSize:10,background:"var(--bg3)",borderRadius:4,padding:"2px 6px",color:"var(--t4)"}}>{item.type}</span>
                        <span style={{fontSize:12,color:"var(--t4)"}}>{item.user?.username}</span>
                        <span style={{fontSize:11,color:"var(--t5)"}}>{ago(item.inserted_at)}</span>
                        {hl && <span style={{fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:20,
                          background:hl.bg, color:hl.color, border:`0.5px solid ${hl.border}`}}>
                          {item.hold_reason.report_only ? "⚑ " : "⏸ "}{hl.text}
                        </span>}
                      </div>
                      {item.title&&<div style={{fontSize:13,fontWeight:500,color:"var(--t1)",marginBottom:4}}>{item.title}</div>}
                      <div style={{fontSize:12,color:"var(--t3)",lineHeight:1.5}}>{item.body?.slice(0,200)}</div>
                    </div>
                    <div style={{display:"flex",gap:8,flexShrink:0}}>
                      <button className="btn-ghost" style={{fontSize:11,padding:"4px 12px",color:"var(--green)"}} onClick={async()=>{
                        await api.post(`/admin/pending/${item.type}/${item.id}/approve`,{});
                        setPendingItems(p=>p.filter(x=>!(x.type===item.type&&x.id===item.id)));
                        toast("Approved");
                      }}>Approve</button>
                      <button className="btn-ghost" style={{fontSize:11,padding:"4px 12px",color:"var(--red)"}} onClick={async()=>{
                        if(!confirm("Reject and delete this content?"))return;
                        await api.delete(`/admin/pending/${item.type}/${item.id}`);
                        setPendingItems(p=>p.filter(x=>!(x.type===item.type&&x.id===item.id)));
                        toast("Rejected");
                      }}>Reject</button>
                    </div>
                  </div>
                  );
                })}
              </div>}
            <div className="fgt">Content rules</div>
            <Toggle label="Auto-hide reported content" hint="Content with 3+ reports is automatically hidden pending review" value={!!general.auto_hide_reported} onChange={v=>setGeneral(p=>({...p,auto_hide_reported:v}))}/>
            <Toggle label="Notify mods of new reports" hint="Send email to moderators when content is reported" value={!!general.notify_mods_reports} onChange={v=>setGeneral(p=>({...p,notify_mods_reports:v}))}/>
            <div className="fgt" style={{marginTop:16}}>Audit log</div>
            <div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden"}}>
              {modLogs.length===0?<div style={{padding:"16px 14px",color:"var(--t5)",fontSize:13}}>No actions yet</div>
                :modLogs.slice(0,20).map(l=>{
                  const HOLD_REASON_LABELS = {
                    implausibly_fast:   "typed implausibly fast",
                    no_keystrokes:      "no keystrokes detected",
                    dominated_by_paste: "content dominated by paste",
                    metadata_missing:   "no composition metadata",
                  };
                  const ACTION_LABELS = {
                    post_hold:          {text:"Post held by spam filter",   color:"var(--amber)"},
                    post_hold_logged:   {text:"Post flagged (report-only)", color:"var(--t4)"},
                    post_hold_approved: {text:"Held post approved",         color:"var(--green)"},
                    post_hold_rejected: {text:"Held post rejected",         color:"var(--red)"},
                  };
                  const isHoldAction = l.action in ACTION_LABELS;
                  const holdMeta = ACTION_LABELS[l.action];
                  return (
                    <div key={l.id} style={{display:"flex",alignItems:"baseline",gap:10,padding:"9px 14px",borderBottom:"0.5px solid var(--b1)"}}>
                      <div style={{fontSize:11,color:"var(--t5)",minWidth:70}}>{ago(l.inserted_at)}</div>
                      <div style={{fontSize:12,color:"var(--ac-text)",minWidth:90}}>
                        {isHoldAction ? (l.moderator?.username||"system") : l.moderator?.username}
                      </div>
                      <div style={{fontSize:12,flex:1}}>
                        {isHoldAction
                          ? <><span style={{color:holdMeta.color}}>{holdMeta.text}</span>
                              {l.reason && HOLD_REASON_LABELS[l.reason] &&
                                <span style={{color:"var(--t5)"}}> — {HOLD_REASON_LABELS[l.reason]}</span>}
                              {l.target_user && <span style={{color:"var(--t4)"}}> · {l.target_user.username}</span>}
                            </>
                          : <span style={{color:"var(--t3)"}}>{l.action}{l.reason&&` — ${l.reason}`}</span>
                        }
                      </div>
                    </div>
                  );
                })
              }
            </div>
          </>}

          {sec==="badges"&&<AdminBadgesPanel/>}
          {sec==="pages"&&<AdminPagesPanel/>}
          {sec==="reactions"&&<AdminReactionsPanel reactionsCfg={reactionsCfg} setReactionsCfg={setReactionsCfg} setIsDirty={setIsDirty}/>}
          {sec==="analytics"&&<AdminAnalyticsPanel/>}

          {sec==="leaderboard"&&<AdminLeaderboardPanel lbCfg={lbCfg} setLbCfg={setLbCfg} saving={saving} saveSection={saveSection}/>}

          {sec==="digest"&&<AdminDigestPanel digestCfg={digestCfg} setDigestCfg={setDigestCfg} saving={saving} saveSection={saveSection}/>}

          {sec==="pwa"&&<AdminPwaPanel pwaCfg={pwaCfg} setPwaCfg={setPwaCfg} saving={saving} saveSection={saveSection} general={general}/>}

          {sec==="storage"&&<>
            {/* Upload Settings */}
            <div className="fgt">Upload settings</div>
            <F label="Max file size" hint="Per-file limit for all uploads">
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <input className="fi" type="number" min="1" max="100" style={{width:80}} value={uploadCfg.max_size_mb||5} onChange={e=>setUploadCfg(p=>({...p,max_size_mb:parseInt(e.target.value)||5}))}/>
                <span style={{fontSize:13,color:"var(--t4)"}}>MB</span>
              </div>
            </F>
            <F label="Max image width" hint="Images wider than this are resized on upload. Avatars always max at 400px.">
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <input className="fi" type="number" min="400" max="4000" style={{width:100}} value={uploadCfg.max_width||1200} onChange={e=>setUploadCfg(p=>({...p,max_width:parseInt(e.target.value)||1200}))}/>
                <span style={{fontSize:13,color:"var(--t4)"}}>px wide</span>
              </div>
            </F>
            <F label="Convert to WebP" hint="Serve smaller WebP versions embedded in posts. Originals are always kept.">
              <Toggle label="Enabled" value={uploadCfg.convert_to_webp!==false} onChange={v=>setUploadCfg(p=>({...p,convert_to_webp:v}))}/>
            </F>
            {uploadCfg.convert_to_webp!==false&&<F label="WebP quality" hint="1–100. 80–90 is a good balance of size and quality.">
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <input type="range" min="50" max="100" value={uploadCfg.webp_quality||85} onChange={e=>setUploadCfg(p=>({...p,webp_quality:parseInt(e.target.value)}))} style={{flex:1,accentColor:"var(--ac)"}}/>
                <span style={{fontSize:13,color:"var(--ac)",fontVariantNumeric:"tabular-nums",minWidth:28}}>{uploadCfg.webp_quality||85}</span>
              </div>
            </F>}
            <div style={{display:"flex",gap:8,marginTop:4}}>

            </div>

            {/* Storage stats */}
            <div className="fgt" style={{marginTop:28}}>Storage usage</div>
            {uploadStats
              ?<>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10,marginBottom:20}}>
                  {[
                    {k:"post_image", label:"Post images", icon:"fa-image"},
                    {k:"avatar",     label:"Avatars",     icon:"fa-circle-user"},
                    {k:"logo",       label:"Logos",       icon:"fa-palette"},
                    {k:"favicon",    label:"Favicons",    icon:"fa-star"},
                  ].map(({k,label,icon})=>{
                    const s=uploadStats.by_type?.[k]||{count:0,bytes:0};
                    return <div key={k} style={{background:"var(--bg2)",borderRadius:10,padding:"12px 14px",border:"0.5px solid var(--b1)"}}>
                      <i className={`fa-solid ${icon}`} style={{fontSize:14,color:"var(--ac)",marginBottom:6,display:"block"}}></i>
                      <div style={{fontSize:18,fontWeight:600,color:"var(--t1)"}}>{s.count}</div>
                      <div style={{fontSize:11,color:"var(--t5)"}}>{label}</div>
                      <div style={{fontSize:12,color:"var(--t5)",marginTop:3}}>{fmtBytes(s.bytes)}</div>
                    </div>;
                  })}
                </div>
                <div style={{fontSize:12,color:"var(--t4)",marginBottom:20}}>
                  Total: <strong style={{color:"var(--t2)"}}>{uploadStats.total_count} files</strong> · <strong style={{color:"var(--t2)"}}>{fmtBytes(uploadStats.total_bytes)}</strong>
                </div>
              </>
              :<div style={{fontSize:13,color:"var(--t5)",padding:"12px 0"}}>Loading stats…</div>}

            {/* Upload browser */}
            <div className="fgt" style={{marginTop:8}}>All uploads</div>
            <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
              {["","post_image","avatar","logo","favicon"].map(f=>(
                <button key={f} className={uploadFilter===f?"btn-primary":"btn-ghost"} style={{fontSize:11,padding:"4px 12px",borderRadius:20}} onClick={()=>{setUploadFilter(f);setUploadPage(1);fetchUploadData(1);}}>
                  {f||"all"}
                </button>
              ))}
              <button className="btn-ghost" style={{fontSize:11,padding:"4px 12px",borderRadius:20,marginLeft:"auto"}} onClick={fetchUploadData}>
                <i className="fa-solid fa-rotate" style={{marginRight:4}}></i>Refresh
              </button>
            </div>
            {uploads.length===0
              ?<div style={{padding:"20px 0",color:"var(--t5)",fontSize:13}}>No uploads yet</div>
              :<>
                <div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden"}}>
                  <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
                  <table className="atbl">
                    <thead><tr><th style={{width:48}}>File</th><th>Name</th><th>Type</th><th>Size</th><th>Dims</th><th>By</th><th>Date</th><th style={{width:40}}></th></tr></thead>
                    <tbody>
                      {uploads.map(u=>(
                        <tr key={u.id}>
                          <td>
                            {u.url&&<img src={u.url} style={{width:36,height:36,objectFit:"cover",borderRadius:4,border:"0.5px solid var(--b1)"}} alt=""/>}
                          </td>
                          <td style={{maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:11,color:"var(--t3)"}}>{u.original_name}</td>
                          <td><span style={{fontSize:10,background:"var(--bg3)",borderRadius:4,padding:"2px 6px",color:"var(--t4)"}}>{u.upload_type}</span></td>
                          <td style={{fontSize:11,color:"var(--t5)"}}>{fmtBytes(u.size_bytes)}</td>
                          <td style={{fontSize:11,color:"var(--t5)"}}>{u.width&&u.height?`${u.width}×${u.height}`:"-"}</td>
                          <td style={{fontSize:11,color:"var(--t4)"}}>{u.user?.username||"-"}</td>
                          <td style={{fontSize:11,color:"var(--t5)"}}>{ago(u.inserted_at)}</td>
                          <td>
                            <span style={{fontSize:11,color:"var(--red)",cursor:"pointer"}} onClick={async()=>{
                              if(!confirm("Delete this file?"))return;
                              await api.delete(`/admin/uploads/${u.id}`);
                              setUploads(p=>p.filter(x=>x.id!==u.id));
                              fetchUploadData();
                              toast("Deleted");
                            }}>✕</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>
                {uploadPages>1&&(
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:12,fontSize:13}}>
                    <button className="btn-ghost" style={{fontSize:12,padding:"5px 14px"}}
                      disabled={uploadPage<=1}
                      onClick={()=>{const p=uploadPage-1;setUploadPage(p);fetchUploadData(p);}}>
                      <i className="fa-solid fa-arrow-left" style={{marginRight:6}}/>Previous
                    </button>
                    <span style={{color:"var(--t5)",fontSize:12}}>Page {uploadPage} of {uploadPages}</span>
                    <button className="btn-ghost" style={{fontSize:12,padding:"5px 14px"}}
                      disabled={uploadPage>=uploadPages}
                      onClick={()=>{const p=uploadPage+1;setUploadPage(p);fetchUploadData(p);}}>
                      Next<i className="fa-solid fa-arrow-right" style={{marginLeft:6}}/>
                    </button>
                  </div>
                )}
              </>}
          </>}

          {sec==="layout"&&<LayoutAdmin layoutCfg={layoutCfg} setLayoutCfg={setLayoutCfg}/>}
          {(sec==="logs")&&<AdminLogsPanel/>}
          {(sec==="extensions")&&<AdminExtensionsPanel/>}

          {/* Extension admin pages — rendered when sec matches ext-panel-{slug}.
              ExtensionAdminPage handles the system header (status, settings,
              runtime registrations, sync, uninstall) and renders the extension's
              registered component below it when one exists. */}
          {sec.startsWith("ext-panel-")&&(()=>{
            const slug = sec.slice("ext-panel-".length);
            return <ExtensionAdminPage slug={slug}/>;
          })()}

          {(sec==="updates")&&<UpdatesPanel/>}

        </div>
      </div>
    </div>
    {/* Create User Modal */}
    {showCreateUser&&(
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:400,padding:20}} onClick={e=>e.target===e.currentTarget&&setShowCreateUser(false)}>
        <div style={{background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:16,padding:24,width:"100%",maxWidth:420,display:"flex",flexDirection:"column",gap:14}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{fontSize:15,fontWeight:600,color:"var(--t1)"}}>Create member</div>
            <button onClick={()=>setShowCreateUser(false)} style={{background:"none",border:"none",color:"var(--t4)",fontSize:18,cursor:"pointer"}}>✕</button>
          </div>
          <div><label style={{fontSize:12,color:"var(--t4)",display:"block",marginBottom:6}}>Username</label><input className="fi" value={newUser.username} onChange={e=>setNewUser(p=>({...p,username:e.target.value}))} placeholder="username"/></div>
          <div><label style={{fontSize:12,color:"var(--t4)",display:"block",marginBottom:6}}>Email</label><input className="fi" type="email" value={newUser.email} onChange={e=>setNewUser(p=>({...p,email:e.target.value}))} placeholder="user@example.com"/></div>
          <div><label style={{fontSize:12,color:"var(--t4)",display:"block",marginBottom:6}}>Password</label><input className="fi" type="password" value={newUser.password} onChange={e=>setNewUser(p=>({...p,password:e.target.value}))} placeholder="Temporary password"/></div>
          <div><label style={{fontSize:12,color:"var(--t4)",display:"block",marginBottom:6}}>Role</label>
            <Select value={newUser.role} onChange={v=>setNewUser(p=>({...p,role:v}))} style={{fontFamily:"inherit"}}>
              <option value="member">Member</option><option value="moderator">Moderator</option><option value="admin">Admin</option>
            </Select>
          </div>
          <div>
            <label style={{fontSize:12,color:"var(--t4)",display:"block",marginBottom:8}}>Email verification</label>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {[{v:true,label:"Skip — mark as verified immediately",desc:"User can post right away"},{v:false,label:"Require email verification",desc:"User receives a verification email first"}].map(function(opt){return (
                <div key={String(opt.v)} onClick={()=>setNewUser(p=>({...p,skip_verification:opt.v}))}
                  style={{padding:"10px 12px",borderRadius:8,cursor:"pointer",border:`0.5px solid ${newUser.skip_verification===opt.v?"var(--ac-border)":"rgba(255,255,255,0.08)"}`,background:newUser.skip_verification===opt.v?"var(--ac-bg)":"rgba(255,255,255,0.03)"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
                    <i className={`fa-solid ${newUser.skip_verification===opt.v?"fa-circle-dot":"fa-circle"}`} style={{fontSize:11,color:newUser.skip_verification===opt.v?"var(--ac)":"var(--t5)"}}/>
                    <span style={{fontSize:13,color:"var(--t2)",fontWeight:500}}>{opt.label}</span>
                  </div>
                  <div style={{fontSize:11,color:"var(--t5)",paddingLeft:19}}>{opt.desc}</div>
                </div>
              );})}
            </div>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:4}}>
            <button className="btn-ghost" onClick={()=>setShowCreateUser(false)}>Cancel</button>
            <button className="btn-primary" style={{fontSize:13,padding:"7px 20px"}}
              disabled={!newUser.username.trim()||!newUser.email.trim()||!newUser.password.trim()}
              onClick={async()=>{
                const d=await api.post("/admin/users",{...newUser});
                if(d.user){setUsers(p=>[...p,d.user]);setShowCreateUser(false);toast("User created");}
                else toast(formatApiErrors(d, "Failed"),"err");
              }}>
              Create member
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

