import { useState, useEffect } from "react";
import { api } from "../lib/api";
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
      else toast(d.error||Object.values(d.errors||{}).flat().join(", ")||"Failed","err");
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
      {/* Header + horizontal tabs */}
      <div style={{borderBottom:"0.5px solid var(--b1)",padding:"0 24px",flexShrink:0}}>
        <div style={{height:48,display:"flex",alignItems:"center"}}>
          <span style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>Settings</span>
        </div>
        <div style={{display:"flex",gap:0,marginBottom:-1}}>
          {[{k:"profile",icon:"fa-user",label:"Profile"},{k:"password",icon:"fa-lock",label:"Password"},{k:"notifications",icon:"fa-bell",label:"Notifications"},...((window._darkEnabled!==false&&window._lightEnabled!==false)?[{k:"appearance",icon:"fa-circle-half-stroke",label:"Appearance"}]:[])].map(s=>(
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
