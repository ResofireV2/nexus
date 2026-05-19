import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { ago, formatApiErrors } from "../lib/utils";
import { toast } from "../components/Toasts";
import { Select, Toggle } from "../components/Select";
import { F } from "../admin/FormHelpers";

const applyTheme   = (...args) => window._applyTheme   && window._applyTheme(...args);
const resolveTheme = (...args) => window._resolveTheme && window._resolveTheme(...args);

// ── SettingsPage + AppearanceTab ──────────────────────────────────────────────

function AppearanceTab() {
  const darkOn  = window._darkEnabled  !== false;
  const lightOn = window._lightEnabled !== false;
  const [themePref, setThemePref] = useState(()=>{ try { return localStorage.getItem("nexus_theme_pref")||"auto"; } catch { return "auto"; } });
  const opts = [
    {v:"auto",  icon:"fa-circle-half-stroke", label:"Auto",  desc:"Follows your device setting"},
    ...(darkOn  ? [{v:"dark",  icon:"fa-moon", label:"Dark",  desc:"Always dark"}]  : []),
    ...(lightOn ? [{v:"light", icon:"fa-sun",  label:"Light", desc:"Always light"}] : []),
  ];
  return (<>
    <div style={{fontSize:15,fontWeight:600,color:"var(--t1)",marginBottom:4}}>Appearance</div>
    <div style={{fontSize:13,color:"var(--t4)",marginBottom:20}}>Choose how the forum looks for you.</div>
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {opts.map(({v,icon,label,desc})=>{
        const active = themePref===v;
        return (
          <div key={v}
            onClick={()=>{
              try { localStorage.setItem("nexus_theme_pref", v); } catch {}
              setThemePref(v);
              const theme = resolveTheme(v, window._defaultTheme, window._darkEnabled, window._lightEnabled);
              applyTheme(theme, window._appBrandingForTheme||{});
            }}
            style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",background:active?"var(--ac-bg)":"var(--s2)",border:`0.5px solid ${active?"var(--ac-border)":"var(--b1)"}`,borderRadius:10,cursor:"pointer",transition:"all .1s"}}>
            <i className={`fa-solid ${icon}`} style={{fontSize:16,color:active?"var(--ac)":"var(--t4)",width:20,textAlign:"center"}}/>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:500,color:active?"var(--ac-text)":"var(--t2)"}}>{label}</div>
              <div style={{fontSize:11,color:"var(--t5)",marginTop:1}}>{desc}</div>
            </div>
            {active&&<i className="fa-solid fa-check" style={{fontSize:12,color:"var(--ac)"}}/>}
          </div>
        );
      })}
    </div>
  </>);
}


// ── SecurityTab ───────────────────────────────────────────────────────────────

function SecurityTab({currentUser, onLogout, onUserUpdate}) {
  const [sessions, setSessions]         = useState(null);
  const [sessLoading, setSessLoading]   = useState(true);
  const [sessError, setSessError]       = useState(false);
  const [oauthProviders, setOauthProviders] = useState({google: false, github: false});
  const [terminating, setTerminating]   = useState(null); // id being terminated
  const [exporting, setExporting]       = useState(false);
  const [deleting, setDeleting]         = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(()=>{
    api.get("/auth/sessions").then(d=>{
      if(d.sessions) {
        setSessions(d.sessions);
      } else {
        setSessions([]);
        if(d.error) setSessError(true);
      }
      setSessLoading(false);
    }).catch(()=>{
      setSessions([]);
      setSessError(true);
      setSessLoading(false);
    });

    api.get("/branding").then(d=>{
      setOauthProviders(d.settings?.oauth_providers || {google: false, github: false});
    }).catch(()=>{});
  }, []);

  const terminateSession = async (id) => {
    setTerminating(id);
    await api.delete(`/auth/sessions/${id}`).catch(()=>{});
    setSessions(p => p.filter(s => s.id !== id));
    setTerminating(null);
    toast("Session terminated");
  };

  const terminateOthers = async () => {
    await api.delete("/auth/sessions").catch(()=>{});
    setSessions(p => p.filter(s => s.current));
    toast("All other sessions terminated");
  };

  const requestExport = async () => {
    setExporting(true);
    try {
      const d = await api.get("/auth/export");
      if (d.export) {
        const blob = new Blob([JSON.stringify(d.export, null, 2)], {type: "application/json"});
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        a.download = `nexus-data-export-${new Date().toISOString().slice(0,10)}.json`;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast("Data export downloaded");
      }
    } catch {
      toast("Export failed — please try again");
    } finally {
      setExporting(false);
    }
  };

  const scheduledeletion = async () => {
    setDeleting(true);
    try {
      const d = await api.post("/auth/schedule-deletion", {});
      if (d.ok) {
        onUserUpdate && onUserUpdate({...currentUser, status: "pending_deletion", deletion_scheduled_at: d.deletion_scheduled_at});
        setShowDeleteModal(false);
        toast("Account deletion scheduled");
      }
    } catch {
      toast("Failed to schedule deletion");
    } finally {
      setDeleting(false);
    }
  };

  const cancelDeletion = async () => {
    try {
      const d = await api.delete("/auth/schedule-deletion");
      if (d.ok) {
        onUserUpdate && onUserUpdate({...currentUser, status: "active", deletion_scheduled_at: null});
        toast("Deletion cancelled — account restored");
      }
    } catch {
      toast("Failed to cancel deletion");
    }
  };

  const deviceIcon = (device="") => {
    if (device.includes("iPhone") || device.includes("iPad") || device.includes("Android"))
      return "fa-mobile-screen-button";
    return "fa-desktop";
  };

  const hasLinked = oauthProviders.google || oauthProviders.github;
  const otherSessions = sessions ? sessions.filter(s => !s.current) : [];

  return (
    <div>
      <div style={{fontSize:15,fontWeight:600,color:"var(--t1)",marginBottom:4}}>Security</div>
      <div style={{fontSize:13,color:"var(--t4)",marginBottom:28}}>Manage two-factor authentication, linked accounts, and active sessions.</div>

      {/* ── 2FA ── */}
      <div style={{fontSize:11,fontWeight:500,letterSpacing:".07em",textTransform:"uppercase",color:"var(--t5)",marginBottom:12}}>Two-factor authentication</div>
      <div style={{background:"var(--s2)",border:"0.5px solid var(--b1)",borderRadius:12,padding:"16px 18px",display:"flex",alignItems:"center",gap:16,marginBottom:28,flexWrap:"wrap"}}>
        <div style={{width:38,height:38,borderRadius:10,background:"var(--s3)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <i className="fa-solid fa-shield-halved" style={{fontSize:18,color:"var(--t4)"}}/>
        </div>
        <div style={{flex:1}}>
          <div style={{fontSize:13,fontWeight:500,color:"var(--t1)",marginBottom:3}}>
            <span>Authenticator app</span>
            <span style={{marginLeft:9,fontSize:11,padding:"2px 8px",borderRadius:20,fontWeight:500,
              display:"inline-block",verticalAlign:"middle",
              background:"rgba(248,113,113,0.1)",color:"var(--red)",border:"0.5px solid rgba(248,113,113,0.25)"}}>
              Not enabled
            </span>
          </div>
          <div style={{fontSize:12,color:"var(--t4)"}}>Add a TOTP app like Google Authenticator or Authy for an extra layer of login security.</div>
        </div>
        <button className="btn-primary" style={{fontSize:12,padding:"7px 16px",flexShrink:0}}>Enable 2FA</button>
      </div>

      {/* ── Linked accounts ── */}
      {hasLinked && <>
        <div style={{fontSize:11,fontWeight:500,letterSpacing:".07em",textTransform:"uppercase",color:"var(--t5)",marginBottom:12}}>Linked accounts</div>
        <div style={{background:"var(--s2)",border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden",marginBottom:28}}>
          {oauthProviders.github && (()=>{
            const linked = currentUser?.oauth_provider === "github";
            return (
              <div style={{display:"flex",alignItems:"center",gap:14,padding:"14px 18px",borderBottom:oauthProviders.google?"0.5px solid var(--b1)":"none"}}>
                <div style={{width:32,height:32,borderRadius:8,border:"0.5px solid var(--b1)",background:"var(--s3)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <i className="fa-brands fa-github" style={{fontSize:17,color:"var(--t2)"}}/>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:500,color:"var(--t1)"}}>GitHub</div>
                  <div style={{fontSize:12,color:linked?"var(--green)":"var(--t5)"}}>
                    {linked ? `Connected · @${currentUser?.oauth_uid||currentUser?.username}` : "Not connected"}
                  </div>
                </div>
                {linked
                  ? <button className="btn-ghost" style={{fontSize:12,color:"var(--red)",borderColor:"rgba(248,113,113,0.3)"}}>Disconnect</button>
                  : <a href="/api/v1/auth/oauth/github" className="btn-ghost" style={{fontSize:12,textDecoration:"none"}}>Connect</a>}
              </div>
            );
          })()}
          {oauthProviders.google && (()=>{
            const linked = currentUser?.oauth_provider === "google";
            return (
              <div style={{display:"flex",alignItems:"center",gap:14,padding:"14px 18px"}}>
                <div style={{width:32,height:32,borderRadius:8,border:"0.5px solid var(--b1)",background:"var(--s3)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <i className="fa-brands fa-google" style={{fontSize:16,color:"var(--t2)"}}/>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:500,color:"var(--t1)"}}>Google</div>
                  <div style={{fontSize:12,color:linked?"var(--green)":"var(--t5)"}}>
                    {linked ? `Connected · ${currentUser?.email}` : "Not connected"}
                  </div>
                </div>
                {linked
                  ? <button className="btn-ghost" style={{fontSize:12,color:"var(--red)",borderColor:"rgba(248,113,113,0.3)"}}>Disconnect</button>
                  : <a href="/api/v1/auth/oauth/google" className="btn-ghost" style={{fontSize:12,textDecoration:"none"}}>Connect</a>}
              </div>
            );
          })()}
        </div>
      </>}

      {/* ── Active sessions ── */}
      <div style={{fontSize:11,fontWeight:500,letterSpacing:".07em",textTransform:"uppercase",color:"var(--t5)",marginBottom:12}}>Active sessions</div>
      <div style={{background:"var(--s2)",border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden",marginBottom:28}}>
        {sessLoading
          ? <div style={{padding:"24px",textAlign:"center",color:"var(--t5)",fontSize:13}}>Loading…</div>
          : sessError
            ? <div style={{padding:"24px",textAlign:"center",color:"var(--red)",fontSize:13}}>
                <i className="fa-solid fa-triangle-exclamation" style={{marginRight:6}}/>
                Could not load sessions. The sessions endpoint may not be deployed yet.
              </div>
          : !sessions || sessions.length === 0
            ? <div style={{padding:"24px",textAlign:"center",color:"var(--t5)",fontSize:13}}>No active sessions found.</div>
            : sessions.map((s,i) => (
                <div key={s.id} style={{display:"flex",alignItems:"center",gap:14,padding:"12px 18px",
                  borderBottom:i<sessions.length-1?"0.5px solid var(--b1)":"none"}}>
                  <div style={{width:34,height:34,borderRadius:9,background:"var(--s3)",border:"0.5px solid var(--b1)",
                    display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <i className={`fa-solid ${deviceIcon(s.device)}`} style={{fontSize:15,color:"var(--t4)"}}/>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:500,color:"var(--t1)",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                      {s.device}
                      {s.current && <span style={{fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:20,
                        background:"rgba(52,211,153,0.1)",color:"var(--green)",border:"0.5px solid rgba(52,211,153,0.25)"}}>
                        This device
                      </span>}
                    </div>
                    <div style={{fontSize:11,color:"var(--t5)",marginTop:2,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                      <span style={{fontFamily:"monospace"}}>{s.ip_address}</span>
                      <span>·</span>
                      <span>Last active {ago(s.last_active)}</span>
                      <span>·</span>
                      <span>Created {ago(s.created_at)}</span>
                    </div>
                  </div>
                  {!s.current && (
                    <button className="btn-ghost" style={{fontSize:11,padding:"4px 12px",flexShrink:0,color:"var(--t4)"}}
                      disabled={terminating === s.id}
                      onClick={()=>terminateSession(s.id)}>
                      {terminating === s.id ? "…" : "Terminate"}
                    </button>
                  )}
                </div>
              ))
        }
        {otherSessions.length > 1 && (
          <div style={{padding:"10px 18px",borderTop:"0.5px solid var(--b1)",display:"flex",justifyContent:"flex-end"}}>
            <span style={{fontSize:12,color:"var(--t4)",cursor:"pointer",textDecoration:"underline",textDecorationColor:"rgba(255,255,255,0.15)",textUnderlineOffset:3}}
              onClick={terminateOthers}>
              Terminate all other sessions
            </span>
          </div>
        )}
      </div>

      {/* ── Your data ── */}
      <div style={{fontSize:11,fontWeight:500,letterSpacing:".07em",textTransform:"uppercase",color:"var(--t5)",marginBottom:12,marginTop:32}}>Your data</div>
      <div style={{background:"var(--s2)",border:"0.5px solid var(--b1)",borderRadius:12,padding:"18px",display:"flex",alignItems:"flex-start",gap:16,marginBottom:32}}>
        <div style={{width:44,height:44,borderRadius:11,background:"var(--ac-bg)",border:"0.5px solid var(--ac-border)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <i className="fa-solid fa-file-arrow-down" style={{fontSize:18,color:"var(--ac-text)"}}/>
        </div>
        <div style={{flex:1}}>
          <div style={{fontSize:13,fontWeight:500,color:"var(--t1)",marginBottom:4}}>Download your data</div>
          <div style={{fontSize:12,color:"var(--t4)",marginBottom:12}}>Export a copy of your profile, posts, replies, and direct messages as a JSON file.</div>
          <button className="btn-ghost" style={{fontSize:12,padding:"6px 14px"}} disabled={exporting} onClick={requestExport}>
            <i className="fa-solid fa-download" style={{fontSize:11,marginRight:6}}/>
            {exporting ? "Preparing…" : "Request data export"}
          </button>
        </div>
      </div>

      {/* ── Danger zone ── */}
      <div style={{fontSize:11,fontWeight:500,letterSpacing:".07em",textTransform:"uppercase",color:"var(--t5)",marginBottom:12}}>Danger zone</div>

      {/* Log out everywhere */}
      <div style={{border:"0.5px solid rgba(248,113,113,0.25)",borderRadius:12,padding:"16px 18px",display:"flex",alignItems:"center",gap:16,marginBottom:12}}>
        <div style={{width:38,height:38,borderRadius:10,background:"rgba(248,113,113,0.08)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <i className="fa-solid fa-arrow-right-from-bracket" style={{fontSize:16,color:"var(--red)"}}/>
        </div>
        <div style={{flex:1}}>
          <div style={{fontSize:13,fontWeight:500,color:"var(--t1)",marginBottom:3}}>Log out everywhere</div>
          <div style={{fontSize:12,color:"var(--t4)"}}>Terminates all sessions, revokes all tokens, and invalidates any pending email confirmations.</div>
        </div>
        <button className="btn-ghost" style={{fontSize:12,color:"var(--red)",borderColor:"rgba(248,113,113,0.3)",flexShrink:0}}
          onClick={()=>{ if(confirm("This will log you out on all devices. Continue?")) onLogout(); }}>
          Log out everywhere
        </button>
      </div>

      {/* Delete account / pending deletion */}
      <div style={{background:"rgba(248,113,113,0.04)",border:"0.5px solid rgba(248,113,113,0.15)",borderRadius:12,overflow:"hidden"}}>
        <div style={{padding:"14px 18px",borderBottom:"0.5px solid rgba(248,113,113,0.12)",fontSize:11,fontWeight:500,letterSpacing:".07em",textTransform:"uppercase",color:"rgba(248,113,113,0.5)"}}>Irreversible actions</div>
        {currentUser?.status === "pending_deletion" ? (
          <div style={{padding:"16px 18px",display:"flex",flexDirection:"column",gap:12}}>
            <div style={{display:"flex",alignItems:"center",gap:14}}>
              <div style={{width:38,height:38,borderRadius:10,background:"rgba(248,113,113,0.08)",border:"0.5px solid rgba(248,113,113,0.15)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <i className="fa-solid fa-user-slash" style={{fontSize:16,color:"var(--red)"}}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:500,color:"var(--t1)",marginBottom:3,display:"flex",alignItems:"center",gap:8}}>
                  Account deletion scheduled
                  <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11,fontWeight:500,background:"rgba(248,113,113,0.1)",color:"var(--red)",border:"0.5px solid rgba(248,113,113,0.25)",borderRadius:20,padding:"2px 9px"}}>
                    <span style={{width:6,height:6,borderRadius:"50%",background:"var(--red)",display:"inline-block"}}/>
                    Pending
                  </span>
                </div>
                {currentUser?.deletion_scheduled_at && (
                  <div style={{fontSize:12,color:"var(--t4)"}}>
                    Scheduled for <strong style={{color:"rgba(248,113,113,0.75)"}}>{new Date(currentUser.deletion_scheduled_at).toLocaleString()}</strong>
                  </div>
                )}
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,paddingLeft:52}}>
              <button className="btn-ghost" style={{fontSize:12,padding:"6px 14px"}} onClick={cancelDeletion}>Cancel deletion</button>
              <span style={{fontSize:12,color:"var(--t5)"}}>or</span>
              <button className="btn-ghost" style={{fontSize:12,padding:"6px 14px",color:"var(--ac-text)",borderColor:"var(--ac-border)"}} disabled={exporting} onClick={requestExport}>
                <i className="fa-solid fa-download" style={{fontSize:11,marginRight:5}}/>
                Download my data first
              </button>
            </div>
          </div>
        ) : (
          <div style={{padding:"16px 18px",display:"flex",alignItems:"center",gap:14}}>
            <div style={{width:38,height:38,borderRadius:10,background:"rgba(248,113,113,0.08)",border:"0.5px solid rgba(248,113,113,0.15)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <i className="fa-solid fa-user-slash" style={{fontSize:16,color:"var(--red)"}}/>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:500,color:"var(--t1)",marginBottom:3}}>Delete account</div>
              <div style={{fontSize:12,color:"var(--t4)"}}>Permanently delete your account. You will have 30 days to change your mind before your data is removed.</div>
            </div>
            <button style={{fontSize:12,padding:"6px 14px",borderRadius:20,background:"rgba(248,113,113,0.1)",border:"0.5px solid rgba(248,113,113,0.3)",color:"var(--red)",cursor:"pointer",fontFamily:"inherit",fontWeight:500,flexShrink:0}}
              onClick={()=>setShowDeleteModal(true)}>
              Delete account
            </button>
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      {showDeleteModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:9000,display:"flex",alignItems:"center",justifyContent:"center",padding:24}} onClick={e=>{if(e.target===e.currentTarget)setShowDeleteModal(false);}}>
          <div style={{background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:16,overflow:"hidden",boxShadow:"0 8px 40px rgba(0,0,0,0.5)",maxWidth:440,width:"100%"}}>
            <div style={{padding:"20px 22px 16px",borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:36,height:36,borderRadius:9,background:"rgba(248,113,113,0.1)",border:"0.5px solid rgba(248,113,113,0.2)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <i className="fa-solid fa-triangle-exclamation" style={{fontSize:15,color:"var(--red)"}}/>
              </div>
              <div>
                <div style={{fontSize:15,fontWeight:600,color:"var(--t1)"}}>Delete your account?</div>
                <div style={{fontSize:12,color:"var(--t4)"}}>This begins a 30-day grace period.</div>
              </div>
            </div>
            <div style={{padding:"18px 22px"}}>
              <div style={{fontSize:13,color:"var(--t3)",marginBottom:16,lineHeight:1.6}}>
                Your account will be scheduled for permanent deletion in 30 days. During this time you can still log in and read, but you won't be able to post or reply.
              </div>
              <div style={{background:"var(--ac-bg)",border:"0.5px solid var(--ac-border)",borderRadius:10,padding:"12px 14px",display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
                <i className="fa-solid fa-circle-info" style={{fontSize:14,color:"var(--ac-text)",flexShrink:0}}/>
                <div style={{fontSize:12,color:"var(--ac-text)",flex:1}}>Want a copy of your data before it's gone?</div>
                <button className="btn-ghost" style={{fontSize:11,padding:"4px 12px",color:"var(--ac-text)",borderColor:"var(--ac-border)",flexShrink:0}} onClick={requestExport}>Download</button>
              </div>
              <div style={{fontSize:12,color:"var(--t5)",marginBottom:18}}>You can cancel at any time before the deadline from your Security settings.</div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button className="btn-ghost" style={{fontSize:12,padding:"7px 18px"}} onClick={()=>setShowDeleteModal(false)}>Keep my account</button>
                <button style={{fontSize:12,padding:"7px 18px",borderRadius:20,background:"rgba(248,113,113,0.1)",border:"0.5px solid rgba(248,113,113,0.3)",color:"var(--red)",cursor:"pointer",fontFamily:"inherit",fontWeight:500}} disabled={deleting} onClick={scheduledeletion}>
                  {deleting ? "Scheduling…" : "Schedule deletion"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function SettingsPage({currentUser, onUpdate, navigate}) {
  const [tab,setTab]=useState("profile");
  const [profile,setProfile]=useState({username:currentUser?.username||"",bio:currentUser?.bio||""});
  const [pw,setPw]=useState({current:"",next:"",confirm:""});
  const [saving,setSaving]=useState(false);
  const [pwErr,setPwErr]=useState(null);
  const [digestSettings,setDigestSettings]=useState({enabled:false,frequencies:[]});

  // Fetch digest settings when notifications tab is first opened
  useEffect(()=>{
    if(tab==="notifications") {
      api.get("/branding").then(d=>{
        const ds = d.settings?.digest || {};
        setDigestSettings({enabled:ds.enabled===true, frequencies:ds.frequencies||[]});
      }).catch(()=>{});
    }
  },[tab]);

  // Notification preferences — loaded from currentUser.preferences
  const DEFAULT_NOTIF_PREFS = {
    reply:         {web:true,  email:false, push:true},
    followed_post: {web:true,  email:false, push:true},
    mention:       {web:true,  email:false, push:true},
    reaction:      {web:false, email:false, push:false},
    dm:            {web:true,  email:true,  push:true},
    badge:         {web:true,  email:false, push:false},
    announcement:  {web:true,  email:true,  push:true},
  };
  const savedPrefs = currentUser?.preferences?.notifications || {};
  const [notifPrefs, setNotifPrefs] = useState(()=>{
    const merged = {};
    Object.keys(DEFAULT_NOTIF_PREFS).forEach(k=>{
      merged[k] = {...DEFAULT_NOTIF_PREFS[k], ...(savedPrefs[k]||{})};
    });
    return merged;
  });
  const [notifSaving, setNotifSaving] = useState(false);

  // Push subscription state
  const [pushSubscribed, setPushSubscribed] = useState(!!currentUser?.has_push_subscription);
  const [pushLoading, setPushLoading]       = useState(false);
  const [pushError, setPushError]           = useState(null);
  const [vapidReady, setVapidReady]         = useState(false);
  const [pushSubs, setPushSubs]             = useState([]);
  const pushSupported = "serviceWorker" in navigator && "PushManager" in window;

  // Check VAPID config and current subscription state on mount
  useEffect(()=>{
    if(!pushSupported) return;
    fetch("/api/v1/pwa/vapid-public-key")
      .then(r=>r.ok?r.json():null)
      .then(d=>{ if(d?.public_key) setVapidReady(true); })
      .catch(()=>{});
    navigator.serviceWorker.ready.then(reg=>
      reg.pushManager.getSubscription()
    ).then(sub=>{ setPushSubscribed(!!sub); }).catch(()=>{});
    // Load all subscriptions for this user
    api.get("/push/subscriptions").then(d=>{
      if(d.subscriptions) setPushSubs(d.subscriptions);
    }).catch(()=>{});
  },[pushSupported]);

  const subscribePush = async () => {
    console.log("subscribePush: started");
    setPushLoading(true); setPushError(null);
    try {
      // Fetch VAPID public key
      console.log("subscribePush: fetching VAPID key");
      const kr = await fetch("/api/v1/pwa/vapid-public-key");
      console.log("subscribePush: VAPID key response status", kr.status);
      if(!kr.ok) { setPushError("Push notifications are not configured. Contact an admin."); return; }
      const {public_key} = await kr.json();
      console.log("subscribePush: VAPID key received, length", public_key?.length);

      // Convert base64url key to Uint8Array for applicationServerKey
      const padding = "=".repeat((4 - public_key.length % 4) % 4);
      const base64  = (public_key + padding).replace(/-/g,"+").replace(/_/g,"/");
      const raw     = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      console.log("subscribePush: key converted, bytes", raw.length);

      // Subscribe via PushManager
      console.log("subscribePush: waiting for service worker");
      const reg = await navigator.serviceWorker.ready;
      console.log("subscribePush: calling pushManager.subscribe");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: raw
      });
      console.log("subscribePush: got subscription", sub.endpoint?.slice(0,60));

      // POST subscription to server
      const subJson = sub.toJSON();
      console.log("subscribePush: posting to server", subJson);
      const d = await api.post("/push/subscribe", {subscription: subJson});
      console.log("subscribePush: server response", d);
      if(d.ok) {
        setPushSubscribed(true);
        api.get("/push/subscriptions").then(d=>{ if(d.subscriptions) setPushSubs(d.subscriptions); }).catch(()=>{});
        setNotifPrefs(p=>{
          const next={...p};
          Object.keys(next).forEach(k=>{ next[k]={...next[k],push:true}; });
          return next;
        });
        toast("Push notifications enabled");
      } else {
        setPushError(d.error||"Failed to save subscription");
        await sub.unsubscribe();
      }
    } catch(e) {
      console.error("Push subscribe error:", e.name, e.message, e);
      if(e.name==="NotAllowedError") setPushError("Permission denied. Allow notifications in your browser settings.");
      else if(e.name==="InvalidStateError") setPushError("Service worker not ready. Try reloading the page.");
      else setPushError(`Failed to enable push notifications: ${e.message||e.name}`);
    } finally {
      setPushLoading(false);
    }
  };

  const unsubscribePush = async () => {
    setPushLoading(true); setPushError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if(sub) await sub.unsubscribe();
      await api.delete("/push/subscribe");
      setPushSubscribed(false);
      // Disable push for all notification types
      setNotifPrefs(p=>{
        const next={...p};
        Object.keys(next).forEach(k=>{ next[k]={...next[k],push:false}; });
        return next;
      });
      toast("Push notifications disabled");
    } catch {
      setPushError("Failed to disable push notifications.");
    } finally {
      setPushLoading(false);
    }
  };

  const emailLocked = window._requireEmailVerification===true && !currentUser?.email_verified && currentUser?.role !== "admin";

  const NOTIF_ROWS = [
    {k:"reply",         label:"Followed post replies",   desc:"New replies on posts you follow"},
    {k:"followed_post", label:"Followed posts",          desc:"Someone replies to a post you're following"},
    {k:"mention",       label:"Mentions",                desc:"Someone @mentioned you in a post or reply"},
    {k:"reaction",      label:"Reactions",               desc:"Someone reacted to your content"},
    {k:"dm",            label:"Direct messages",         desc:"A new message in your conversations"},
    {k:"badge",         label:"Badge awarded",           desc:"You earned a new badge"},
    {k:"announcement",  label:"Announcements",           desc:"Site-wide announcements from moderators"},
  ];

  const saveProfile=async()=>{
    setSaving(true);
    try {
      const d=await api.patch("/auth/me",{username:profile.username,bio:profile.bio});
      if(d.user){onUpdate(d.user);toast("Profile updated");}
      else toast(formatApiErrors(d, "Failed"), "err");
    } finally { setSaving(false); }
  };

  const savePassword=async()=>{
    setPwErr(null);
    if(pw.next!==pw.confirm){setPwErr("Passwords don't match");return;}
    if(pw.next.length<8){setPwErr("Password must be at least 8 characters");return;}
    setSaving(true);
    try {
      const d=await api.patch("/auth/me",{current_password:pw.current,new_password:pw.next});
      if(d.ok){toast("Password updated");setPw({current:"",next:"",confirm:""});}
      else setPwErr(d.error||"Failed");
    } finally { setSaving(false); }
  };

  const saveNotifPrefs=async()=>{
    setNotifSaving(true);
    try {
      const d=await api.patch("/auth/me",{preferences:{notifications:notifPrefs}});
      if(d.user){onUpdate(d.user);toast("Notification preferences saved");}
      else toast(d.error||"Failed","err");
    } finally { setNotifSaving(false); }
  };

  const toggleNotif=(key,channel)=>{
    if(channel==="email"&&emailLocked) return;
    if(channel==="push"&&!pushSubscribed) return;
    setNotifPrefs(p=>({...p,[key]:{...p[key],[channel]:!p[key][channel]}}));
  };

  const Toggle = ({on, onClick, disabled=false}) => (
    <div onClick={disabled?undefined:onClick}
      style={{width:36,height:20,borderRadius:10,background:on&&!disabled?"var(--ac)":"rgba(255,255,255,0.1)",cursor:disabled?"not-allowed":"pointer",position:"relative",transition:"background .15s",flexShrink:0,opacity:disabled?0.4:1}}>
      <div style={{position:"absolute",top:2,left:on?18:2,width:16,height:16,borderRadius:"50%",background:"#fff",transition:"left .15s"}}/>
    </div>
  );

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* Header + tabs: desktop bar / mobile dropdown */}
      <div style={{borderBottom:"0.5px solid var(--b1)",padding:"0 24px",flexShrink:0}}>
        <div style={{height:48,display:"flex",alignItems:"center"}}>
          <span style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>Settings</span>
        </div>
        {/* Desktop — hidden on mobile via CSS */}
        <div className="settings-desktop-tabs" style={{gap:0,marginBottom:-1}}>
          {[{k:"profile",icon:"fa-user",label:"Profile"},{k:"password",icon:"fa-lock",label:"Password"},{k:"notifications",icon:"fa-bell",label:"Notifications"},{k:"security",icon:"fa-shield",label:"Security"},...((window._darkEnabled!==false&&window._lightEnabled!==false)?[{k:"appearance",icon:"fa-circle-half-stroke",label:"Appearance"}]:[])].map(s=>(
            <button key={s.k} onClick={()=>setTab(s.k)}
              style={{display:"flex",alignItems:"center",gap:7,padding:"10px 16px",
                background:"none",border:"none",
                borderBottom:tab===s.k?"2px solid var(--ac)":"2px solid transparent",
                color:tab===s.k?"var(--ac-text)":"var(--t4)",
                fontWeight:tab===s.k?500:400,fontSize:13,cursor:"pointer",
                fontFamily:"inherit",marginBottom:-1,transition:"color .1s"}}>
              <i className={`fa-solid ${s.icon}`} style={{fontSize:12}}/>
              {s.label}
            </button>
          ))}
        </div>
        {/* Mobile — shown only on narrow screens */}
        {(()=>{
          const allTabs=[{k:"profile",icon:"fa-user",label:"Profile"},{k:"password",icon:"fa-lock",label:"Password"},{k:"notifications",icon:"fa-bell",label:"Notifications"},{k:"security",icon:"fa-shield",label:"Security"},...((window._darkEnabled!==false&&window._lightEnabled!==false)?[{k:"appearance",icon:"fa-circle-half-stroke",label:"Appearance"}]:[])];
          const active=allTabs.find(s=>s.k===tab)||allTabs[0];
          return (
            <div className="settings-tabs-mob">
              <details>
                <summary>
                  <span style={{display:"flex",alignItems:"center",gap:8}}>
                    <i className={`fa-solid ${active.icon}`} style={{fontSize:12,color:"var(--ac)"}}/>
                    <span style={{color:"var(--ac)"}}>{active.label}</span>
                  </span>
                  <i className="fa-solid fa-chevron-down" style={{fontSize:11,color:"var(--t5)"}}/>
                </summary>
                <div className="stm-menu">
                  {allTabs.map(s=>(
                    <div key={s.k} className={`stm-item${tab===s.k?" active":""}`}
                      onClick={e=>{setTab(s.k);e.currentTarget.closest("details").removeAttribute("open");}}>
                      <i className={`fa-solid ${s.icon}`} style={{fontSize:12}}/>
                      {s.label}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          );
        })()}
      </div>
      <div style={{flex:1,display:"flex",overflow:"hidden"}}>
        {/* Settings content */}
        <div style={{flex:1,overflow:"auto",padding:"24px 32px"}}>
          {tab==="profile"&&<>
            <div style={{fontSize:15,fontWeight:600,color:"var(--t1)",marginBottom:20}}>Profile</div>
            <F label="Username" hint="Changing your username will affect your profile URL">
              <input className="fi" value={profile.username} onChange={e=>setProfile(p=>({...p,username:e.target.value}))}/>
            </F>
            <F label="Bio">
              <textarea className="fi" style={{resize:"vertical",minHeight:80}} value={profile.bio} onChange={e=>setProfile(p=>({...p,bio:e.target.value}))} placeholder="Tell the community a bit about yourself…"/>
            </F>
            <button className="btn-primary" onClick={saveProfile} disabled={saving}>{saving?"Saving…":"Save profile"}</button>
          </>}

          {tab==="password"&&<>
            <div style={{fontSize:15,fontWeight:600,color:"var(--t1)",marginBottom:20}}>Change password</div>
            <F label="Current password">
              <input className="fi" type="password" placeholder="••••••••" value={pw.current} onChange={e=>setPw(p=>({...p,current:e.target.value}))}/>
            </F>
            <F label="New password" hint="Minimum 8 characters">
              <input className="fi" type="password" placeholder="••••••••" value={pw.next} onChange={e=>setPw(p=>({...p,next:e.target.value}))}/>
            </F>
            <F label="Confirm new password">
              <input className="fi" type="password" placeholder="••••••••" value={pw.confirm} onChange={e=>setPw(p=>({...p,confirm:e.target.value}))}/>
            </F>
            {pwErr&&<div className="ferr" style={{marginBottom:12}}>{pwErr}</div>}
            <button className="btn-primary" onClick={savePassword} disabled={saving||!pw.current||!pw.next}>{saving?"Saving…":"Update password"}</button>
          </>}

          {tab==="appearance"&&<AppearanceTab/>}
          {tab==="security"&&<SecurityTab currentUser={currentUser} onLogout={()=>{api.post("/auth/global-logout",{});api.setToken(null);window.dispatchEvent(new Event("nexus:logout"));}} onUserUpdate={onUpdate}/>}
          {tab==="notifications"&&<>
            <div style={{fontSize:15,fontWeight:600,color:"var(--t1)",marginBottom:4}}>Notification preferences</div>
            <div style={{fontSize:13,color:"var(--t4)",marginBottom:20}}>Choose how you want to be notified for each activity.</div>

            {emailLocked&&(
              <div style={{background:"rgba(251,191,36,0.08)",border:"0.5px solid rgba(251,191,36,0.25)",borderRadius:10,padding:"10px 14px",marginBottom:20,display:"flex",alignItems:"center",gap:10,fontSize:12,color:"var(--amber)"}}>
                <i className="fa-solid fa-triangle-exclamation" style={{flexShrink:0}}/>
                Email notifications require a verified address.{" "}
                <span style={{textDecoration:"underline",cursor:"pointer"}} onClick={async()=>{
                  const d=await api.post("/auth/resend-verification",{});
                  if(d.ok) toast("Verification email sent — check your inbox");
                  else toast(d.error||"Failed to send","err");
                }}>Send verification email</span>
              </div>
            )}

            {/* Channel header */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 64px 64px 64px",gap:0,paddingBottom:10,borderBottom:"0.5px solid var(--b1)",marginBottom:4}}>
              <div style={{fontSize:10,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.6px"}}>activity</div>
              {["web","email","push"].map(ch=>(
                <div key={ch} style={{fontSize:10,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.6px",textAlign:"center"}}>{ch}</div>
              ))}
            </div>

            {NOTIF_ROWS.map(row=>(
              <div key={row.k} style={{display:"grid",gridTemplateColumns:"1fr 64px 64px 64px",alignItems:"center",padding:"13px 0",borderBottom:"0.5px solid var(--b1)"}}>
                <div>
                  <div style={{fontSize:13,color:"var(--t2)",marginBottom:2}}>{row.label}</div>
                  <div style={{fontSize:11,color:"var(--t5)"}}>{row.desc}</div>
                </div>
                <div style={{display:"flex",justifyContent:"center"}}>
                  <Toggle on={notifPrefs[row.k]?.web} onClick={()=>toggleNotif(row.k,"web")}/>
                </div>
                <div style={{display:"flex",justifyContent:"center"}}>
                  <Toggle on={notifPrefs[row.k]?.email&&!emailLocked} onClick={()=>toggleNotif(row.k,"email")} disabled={emailLocked}/>
                </div>
                <div style={{display:"flex",justifyContent:"center"}}>
                  {pushSubscribed
                    ?<Toggle on={notifPrefs[row.k]?.push} onClick={()=>toggleNotif(row.k,"push")}/>
                    :<div style={{fontSize:10,fontWeight:500,padding:"3px 8px",borderRadius:20,background:"rgba(255,255,255,0.05)",color:"var(--t5)",border:"0.5px solid var(--b1)",whiteSpace:"nowrap"}}>off</div>}
                </div>
              </div>
            ))}

            {/* Push subscription control */}
            <div style={{marginTop:20,paddingTop:16,borderTop:"0.5px solid var(--b1)"}}>
              {!pushSupported&&(
                <div style={{fontSize:12,color:"var(--t5)",marginBottom:12}}>Push notifications are not supported in this browser.</div>
              )}
              {pushSupported&&!vapidReady&&(
                <div style={{fontSize:12,color:"var(--t5)",marginBottom:12}}>Push notifications have not been configured yet. An admin needs to generate VAPID keys in the PWA settings.</div>
              )}
              {pushSupported&&vapidReady&&(
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12,flexWrap:"wrap"}}>
                  {pushSubscribed
                    ?<>
                      <div style={{display:"flex",alignItems:"center",gap:6,fontSize:13,color:"var(--green)"}}>
                        <i className="fa-solid fa-circle-check" style={{fontSize:12}}/>Push notifications enabled
                      </div>
                      <button className="btn-ghost" style={{fontSize:12,padding:"5px 14px",color:"var(--t4)"}}
                        disabled={pushLoading} onClick={unsubscribePush}>
                        {pushLoading?"…":"Disable"}
                      </button>
                    </>
                    :<>
                      <div style={{fontSize:13,color:"var(--t4)"}}>Enable push notifications to get notified even when the tab is closed.</div>
                      <button className="btn-primary" style={{fontSize:12,padding:"5px 14px"}}
                        disabled={pushLoading} onClick={subscribePush}>
                        {pushLoading?"Enabling…":"Enable push notifications"}
                      </button>
                    </>}
                  {pushError&&<div style={{fontSize:12,color:"var(--red)",width:"100%"}}>{pushError}</div>}
                </div>
              )}
              <div style={{display:"flex",justifyContent:"flex-end"}}>
                <button className="btn-primary" style={{fontSize:13,padding:"7px 20px"}} onClick={saveNotifPrefs} disabled={notifSaving}>{notifSaving?"Saving…":"Save preferences"}</button>
              </div>

              {/* Active push subscriptions — device list */}
              {pushSubs.length>0&&(
                <div style={{marginTop:20,paddingTop:20,borderTop:"0.5px solid var(--b1)"}}>
                  <div style={{fontSize:14,fontWeight:500,color:"var(--t1)",marginBottom:4}}>Subscribed devices</div>
                  <div style={{fontSize:12,color:"var(--t4)",marginBottom:14}}>
                    {pushSubs.length} device{pushSubs.length!==1?"s":""} subscribed. Revoke a device to stop push notifications on it.
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {pushSubs.map(sub=>{
                      const ep = sub.endpoint||"";
                      const isApple = ep.includes("push.apple.com");
                      const isMozilla = ep.includes("mozilla.com")||ep.includes("mozaws.net");
                      const isWindows = ep.includes("windows.com");
                      const label = isApple?"iPhone · Safari" : isMozilla?"Firefox" : isWindows?"Windows · Edge" : "Chrome";
                      const icon = isApple?"fa-brands fa-apple" : isMozilla?"fa-brands fa-firefox-browser" : isWindows?"fa-brands fa-windows" : "fa-brands fa-chrome";
                      const host = ep.includes("googleapis")||ep.includes("fcm")?"fcm.googleapis.com" : isApple?"web.push.apple.com" : isMozilla?"updates.push.mozilla.com" : "push service";
                      const isCurrentDevice = pushSubscribed && sub === pushSubs[pushSubs.length-1];
                      const timeAgo = sub.inserted_at ? ago(sub.inserted_at) : "";
                      return (
                        <div key={sub.id} style={{background:"var(--s2)",border:"0.5px solid var(--b1)",borderRadius:12,padding:"11px 14px",display:"flex",alignItems:"center",gap:12}}>
                          <div style={{width:36,height:36,borderRadius:9,background:"var(--s3)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                            <i className={icon} style={{fontSize:16,color:"var(--t4)"}}/>
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:13,fontWeight:500,color:"var(--t1)"}}>{label}</div>
                            <div style={{fontSize:11,color:"var(--t5)"}}>{host} · {timeAgo}</div>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                            {isCurrentDevice&&<span style={{fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:20,background:"rgba(52,211,153,0.1)",color:"var(--green)"}}>this device</span>}
                            <button className="btn-ghost" style={{fontSize:12,padding:"4px 12px",color:"var(--red)"}}
                              onClick={async()=>{
                                await api.delete(`/push/subscriptions/${sub.id}`);
                                setPushSubs(p=>p.filter(s=>s.id!==sub.id));
                                if(isCurrentDevice){ setPushSubscribed(false); }
                              }}>
                              Revoke
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Following */}
            <div style={{marginTop:28,paddingTop:24,borderTop:"0.5px solid var(--b1)"}}>
              <div style={{fontSize:15,fontWeight:600,color:"var(--t1)",marginBottom:4}}>Following</div>
              <div style={{fontSize:13,color:"var(--t4)",marginBottom:16}}>
                Control when you automatically follow posts and get notified about new replies.
              </div>
              <div className="toggle-row" style={{marginBottom:0}}>
                <div>
                  <div style={{fontSize:14,color:"var(--t2)"}}>Auto-follow posts I create</div>
                  <div style={{fontSize:12,color:"var(--t5)",marginTop:3}}>
                    You'll be notified when others reply to threads you start.
                  </div>
                </div>
                <div className="tgl"
                  style={{background:(currentUser?.preferences?.auto_follow_own_posts!==false)?"var(--ac)":"rgba(255,255,255,0.1)"}}
                  onClick={()=>{
                    const next={...currentUser?.preferences||{},auto_follow_own_posts:currentUser?.preferences?.auto_follow_own_posts===false?true:false};
                    api.patch("/auth/me",{preferences:next}).then(d=>{if(d.user)onUpdate(d.user);});
                    toast("Preference saved");
                  }}>
                  <div className="tgl-knob" style={{left:(currentUser?.preferences?.auto_follow_own_posts!==false)?23:3,background:"#fff"}}/>
                </div>
              </div>
              <div className="toggle-row" style={{marginTop:16,marginBottom:0}}>
                <div>
                  <div style={{fontSize:14,color:"var(--t2)"}}>Auto-follow posts I reply to</div>
                  <div style={{fontSize:12,color:"var(--t5)",marginTop:3}}>
                    You'll be notified of further replies on any thread you engage with.
                  </div>
                </div>
                <div className="tgl"
                  style={{background:(currentUser?.preferences?.auto_follow_replied_posts!==false)?"var(--ac)":"rgba(255,255,255,0.1)"}}
                  onClick={()=>{
                    const next={...currentUser?.preferences||{},auto_follow_replied_posts:currentUser?.preferences?.auto_follow_replied_posts===false?true:false};
                    api.patch("/auth/me",{preferences:next}).then(d=>{if(d.user)onUpdate(d.user);});
                    toast("Preference saved");
                  }}>
                  <div className="tgl-knob" style={{left:(currentUser?.preferences?.auto_follow_replied_posts!==false)?23:3,background:"#fff"}}/>
                </div>
              </div>
            </div>

            {/* Digest frequency */}
            {window._digestFrequencies?.length > 0 && (
              <div style={{marginTop:28,paddingTop:24,borderTop:"0.5px solid var(--b1)"}}>
                <div style={{fontSize:15,fontWeight:600,color:"var(--t1)",marginBottom:4}}>Digest email</div>
                <div style={{fontSize:13,color:"var(--t4)",marginBottom:16}}>Receive a periodic roundup of top posts, badges, and community activity.</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {["off",...(window._digestFrequencies||[])].map(f=>(
                    <div key={f} onClick={()=>{
                      const prefs={...notifPrefs};
                      const next={...currentUser?.preferences||{},digest_frequency:f==="off"?null:f};
                      api.patch("/auth/me",{preferences:next}).then(d=>{if(d.user)onUpdate(d.user);});
                      toast(f==="off"?"Digest unsubscribed":`Digest set to ${f}`);
                    }}
                      style={{padding:"7px 18px",borderRadius:20,border:`0.5px solid ${(currentUser?.preferences?.digest_frequency||"off")===f?"rgba(167,139,250,0.4)":"rgba(255,255,255,0.1)"}`,background:(currentUser?.preferences?.digest_frequency||"off")===f?"rgba(167,139,250,0.12)":"transparent",color:(currentUser?.preferences?.digest_frequency||"off")===f?"#c4b5fd":"var(--t4)",cursor:"pointer",fontSize:13}}>
                      {f}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>}
        </div>
      </div>
    </div>
  );
}


// ── Exports ───────────────────────────────────────────────────────────────────
export { AppearanceTab, SettingsPage };
