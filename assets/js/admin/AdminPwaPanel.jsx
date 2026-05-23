import React, { useState, useEffect, useRef } from "react";
import { api } from "../lib/api";
import { fmtBytes } from "../lib/utils";
import { toast } from "../components/Toasts";
import { Select, Toggle } from "../components/Select";
import { F, ColorPicker } from "./FormHelpers";

// ── IosInstallPrompt, AdminPwaPanel ───────────────────────────────────────────

// ── iOS Install Prompt ───────────────────────────────────────────────────────
// Shows a sticky footer on Safari/iOS guiding users through the manual
// Add to Home Screen flow. Controlled by site_settings["pwa"].
function IosInstallPrompt({onDismiss, pwaCfg={}}) {
  const [visible, setVisible] = useState(false);
  const [arrowDir, setArrowDir] = useState("down");

  useEffect(()=>{
    const delay = pwaCfg.ios_prompt_delay ?? 10000;
    const timer = setTimeout(()=>{ setVisible(true); updateArrow(); }, delay);
    const handler = ()=>updateArrow();
    window.addEventListener("orientationchange", handler);
    window.addEventListener("resize", handler);
    return ()=>{ clearTimeout(timer); window.removeEventListener("orientationchange",handler); window.removeEventListener("resize",handler); };
  },[]);

  function updateArrow() {
    const isPad = /iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    const padAlwaysUp = pwaCfg.ios_pad_always_up !== false;
    if(isPad && padAlwaysUp){ setArrowDir("up"); return; }
    const autoDetect = pwaCfg.ios_auto_detect_orientation !== false;
    if(!autoDetect){ setArrowDir("down"); return; }
    setArrowDir(window.innerHeight > window.innerWidth ? "down" : "up");
  }

  if(!visible) return null;

  const appName = pwaCfg.app_name || "Nexus";
  const text = pwaCfg.ios_prompt_text
    ? pwaCfg.ios_prompt_text.replace("{appName}", appName)
    : `Install ${appName} — tap the Share button then "Add to Home Screen".`;

  const isUp = arrowDir === "up";

  return (
    <div style={{position:"fixed",left:0,right:0,[isUp?"top":"bottom"]:0,zIndex:999,display:"flex",flexDirection:"column",alignItems:"center",pointerEvents:"none"}}>
      {/* Arrow pointing toward share button */}
      {isUp&&<div style={{width:0,height:0,borderLeft:"10px solid transparent",borderRight:"10px solid transparent",borderBottom:"10px solid var(--s2)",pointerEvents:"none"}}/>}
      <div style={{width:"100%",maxWidth:480,background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:isUp?"0 0 14px 14px":"14px 14px 0 0",padding:"14px 18px",display:"flex",alignItems:"center",gap:12,boxShadow:"0 -4px 24px rgba(0,0,0,0.4)",pointerEvents:"all"}}>
        <i className="fa-solid fa-share-from-square" style={{fontSize:20,color:"var(--ac)",flexShrink:0}}/>
        <span style={{flex:1,fontSize:13,color:"var(--t2)",lineHeight:1.5}}>{text}</span>
        <button onClick={()=>{setVisible(false);onDismiss?.();}} style={{background:"none",border:"none",color:"var(--t4)",fontSize:18,cursor:"pointer",padding:"0 4px",flexShrink:0,lineHeight:1}}>✕</button>
      </div>
      {!isUp&&<div style={{width:0,height:0,borderLeft:"10px solid transparent",borderRight:"10px solid transparent",borderTop:"10px solid var(--s2)",pointerEvents:"none"}}/>}
    </div>
  );
}



// ── PWA Admin Panel ───────────────────────────────────────────────────────────
function AdminPwaPanel({pwaCfg, setPwaCfg, saving, saveSection, general}) {
  const [pwaTab,setPwaTab]=useState("general");
  const [vapidGenerating,setVapidGenerating]=useState(false);
  const [vapidError,setVapidError]=useState(null);
  const [iconUploading,setIconUploading]=useState(false);
  const [iconError,setIconError]=useState(null);
  const [badgeUploading,setBadgeUploading]=useState(false);
  const [badgeError,setBadgeError]=useState(null);
  const [swState,setSwState]=useState(null); // null=checking, 'active'|'installing'|'none'

  useEffect(()=>{
    if(!("serviceWorker" in navigator)){setSwState("none");return;}
    navigator.serviceWorker.getRegistration("/").then(reg=>{
      if(!reg) setSwState("none");
      else if(reg.active) setSwState("active");
      else setSwState("installing");
    }).catch(()=>setSwState("none"));
  },[]);

  const PWA_TABS=[
    {k:"general", icon:"fa-cog",          label:"General"},
    {k:"icons",   icon:"fa-image",         label:"Icons"},
    {k:"push",    icon:"fa-bell",          label:"Push"},
    {k:"apple",   icon:"fa-mobile-screen-button", label:"Apple"},
    {k:"status",  icon:"fa-circle-check",  label:"Status"},
  ];

  const hasVapid=!!(pwaCfg.vapid_public);

  // ── Icon sizes grid ──────────────────────────────────────────────────────
  const ICON_SIZES=[512,384,192,180,144,96,48];
  const REQUIRED_SIZES=[192,512];

  const handleIconUpload=e=>{
    const file=e.target.files?.[0]; if(!file) return;
    setIconError(null); setIconUploading(true);
    const fd=new FormData(); fd.append("icon-source",file);
    const token=localStorage.getItem("nexus_token");
    fetch("/api/v1/admin/pwa/icons",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:fd})
      .then(r=>r.json())
      .then(d=>{
        setIconUploading(false);
        if(d.ok&&d.icons){setPwaCfg(p=>({...p,...d.icons}));}
        else setIconError(d.error||"Upload failed");
      })
      .catch(()=>{setIconUploading(false);setIconError("Upload failed. Please try again.");});
    e.target.value="";
  };

  const handleIconDelete=async()=>{
    if(!confirm("Delete all PWA icons? This cannot be undone.")) return;
    setIconError(null);
    const d=await api.delete("/admin/pwa/icons");
    if(d.ok){
      const cleared=Object.fromEntries(ICON_SIZES.map(s=>[`icon_${s}_path`,null]));
      setPwaCfg(p=>({...p,...cleared}));
    } else setIconError(d.error||"Delete failed");
  };

  const handleBadgeUpload=e=>{
    const file=e.target.files?.[0]; if(!file) return;
    setBadgeError(null); setBadgeUploading(true);
    const fd=new FormData(); fd.append("badge",file);
    const token=localStorage.getItem("nexus_token");
    fetch("/api/v1/admin/pwa/badge",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:fd})
      .then(r=>r.json())
      .then(d=>{
        setBadgeUploading(false);
        if(d.url) setPwaCfg(p=>({...p,badge_url:d.url}));
        else setBadgeError(d.error||"Upload failed");
      })
      .catch(()=>{setBadgeUploading(false);setBadgeError("Upload failed. Please try again.");});
    e.target.value="";
  };

  const handleBadgeDelete=async()=>{
    const d=await api.delete("/admin/pwa/badge");
    if(d.ok) setPwaCfg(p=>({...p,badge_url:null}));
  };

  const handleGenerateVapid=async()=>{
    if(hasVapid&&!confirm("Regenerate VAPID keys? All existing push subscriptions will be deleted and users will need to re-subscribe.")) return;
    setVapidGenerating(true); setVapidError(null);
    const d=await api.post("/admin/pwa/vapid",{});
    setVapidGenerating(false);
    if(d.public_key) setPwaCfg(p=>({...p,vapid_public:d.public_key}));
    else setVapidError(d.error||"Failed to generate VAPID keys. Check server logs.");
  };

  // ── Status checks ────────────────────────────────────────────────────────
  const statusChecks=()=>{
    const forumUrl=window.location.origin;
    const checks=[];
    checks.push(forumUrl.startsWith("https://")
      ?{type:"ok",  title:"HTTPS enabled",        body:"Your forum is served over HTTPS. PWAs require a secure context."}
      :{type:"err", title:"HTTPS not detected",    body:"Your forum base URL does not use HTTPS. PWAs require HTTPS to be installable."});
    const appName=pwaCfg.app_name||general?.site_name||"";
    checks.push(appName
      ?{type:"ok",  title:"App name set",          body:`"${appName}" will appear on the install prompt and splash screen.`}
      :{type:"warn",title:"App name not set",      body:"Set an app name on the General tab. The forum name will be used as a fallback."});
    const has192=!!(pwaCfg.icon_192_path);
    const has512=!!(pwaCfg.icon_512_path);
    checks.push((has192&&has512)
      ?{type:"ok",  title:"Icons ready",           body:"Required icons (192×192 and 512×512) are uploaded and ready."}
      :{type:"err", title:"Icons missing",         body:"At least a 192×192 and 512×512 icon are required for the app to be installable."});
    checks.push(hasVapid
      ?{type:"ok",  title:"Push notifications ready", body:"VAPID keys are configured. Push notifications are active."}
      :{type:"warn",title:"VAPID keys not configured",body:"Generate VAPID keys on the Push tab to enable push notifications."});
    if(swState===null)
      checks.push({type:"warn",title:"Checking service worker…",body:"Verifying that the service worker is registered and active."});
    else if(swState==="active")
      checks.push({type:"ok",  title:"Service worker active",   body:"The service worker is registered and serving requests."});
    else if(swState==="installing")
      checks.push({type:"warn",title:"Service worker installing",body:"Registered but not yet active. Reload the page to complete installation."});
    else
      checks.push({type:"err", title:"Service worker not registered",body:"Visit the forum in a browser tab to trigger service worker registration."});
    return checks;
  };

  const dotColor={ok:"var(--green)",warn:"var(--amber)",err:"var(--red)"};
  const borderColor={ok:"rgba(52,211,153,0.3)",warn:"rgba(251,191,36,0.3)",err:"rgba(248,113,113,0.3)"};

  return (
    <div>
      {/* Tab bar — desktop: underline buttons; mobile: dropdown. */}
      <div className="admin-tabs-underline">
        {PWA_TABS.map(t=>(
          <button key={t.k} onClick={()=>setPwaTab(t.k)}
            className={`admin-tab-underline${pwaTab===t.k?" active":""}`}>
            <i className={`fa-solid ${t.icon}`}/>
            {t.label}
          </button>
        ))}
      </div>
      <div className="admin-tabs-mob">
        <details>
          <summary>
            <span className="atm-label">
              {(()=>{
                const cur = PWA_TABS.find(t=>t.k===pwaTab) || PWA_TABS[0];
                return <>
                  <i className={`fa-solid ${cur.icon}`} style={{fontSize:12,color:"var(--t4)"}}/>
                  <span>{cur.label}</span>
                </>;
              })()}
            </span>
            <i className="fa-solid fa-chevron-down" style={{fontSize:11,color:"var(--t5)"}}/>
          </summary>
          <div className="atm-menu">
            {PWA_TABS.map(t=>(
              <div key={t.k}
                className={`atm-item${pwaTab===t.k?" active":""}`}
                onClick={e=>{setPwaTab(t.k); e.currentTarget.closest("details").removeAttribute("open");}}>
                <i className={`fa-solid ${t.icon}`} style={{fontSize:12,color:"var(--t5)",width:14}}/>
                {t.label}
              </div>
            ))}
          </div>
        </details>
      </div>

      {/* ── General tab ── */}
      {pwaTab==="general"&&<>
        <div className="fgt">App identity</div>
        <F label="App name" hint="Full name shown on the splash screen and install prompt. Defaults to your forum name if left empty.">
          <input className="fi" value={pwaCfg.app_name||""} onChange={e=>setPwaCfg(p=>({...p,app_name:e.target.value}))} placeholder="Nexus"/>
        </F>
        <F label="Short name" hint="Truncated label shown under the home screen icon. Keep under 12 characters.">
          <input className="fi" value={pwaCfg.short_name||""} onChange={e=>setPwaCfg(p=>({...p,short_name:e.target.value}))} placeholder="Nexus"/>
        </F>
        <F label="Start URL" hint="The page opened when the app is launched from the home screen.">
          <input className="fi" value={pwaCfg.start_url||""} onChange={e=>setPwaCfg(p=>({...p,start_url:e.target.value}))} placeholder="/"/>
        </F>

        <div className="fgt" style={{marginTop:20}}>Appearance</div>
        <F label="Theme color" hint="Controls the browser chrome color on Android. Leave empty to use the forum accent color.">
          <ColorPicker value={pwaCfg.theme_color||""} onChange={v=>setPwaCfg(p=>({...p,theme_color:v}))}/>
        </F>
        <F label="Background color" hint="Fills the splash screen behind your icon. Leave empty to use #030712.">
          <ColorPicker value={pwaCfg.bg_color||""} onChange={v=>setPwaCfg(p=>({...p,bg_color:v}))}/>
        </F>

        <div className="fgt" style={{marginTop:20}}>Behavior</div>
        <Toggle label="Force portrait orientation" hint="Prevents the installed app from rotating to landscape mode." value={!!pwaCfg.force_portrait} onChange={v=>setPwaCfg(p=>({...p,force_portrait:v}))}/>
      </>}

      {/* ── Icons tab ── */}
      {pwaTab==="icons"&&<>
        <div className="fgt">Icon management</div>
        <div style={{fontSize:13,color:"var(--t4)",marginBottom:4}}>Upload a single high-resolution source image and all required sizes will be generated automatically.</div>
        <div style={{fontSize:13,color:"var(--t5)",marginBottom:16}}>Recommended: 1024×1024 PNG or JPEG. The image will be cropped to a square at each size.</div>

        {iconError&&<div style={{fontSize:13,color:"var(--red)",marginBottom:12,padding:"8px 12px",background:"rgba(248,113,113,0.08)",borderRadius:8,border:"0.5px solid rgba(248,113,113,0.2)"}}>{iconError}</div>}

        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:24}}>
          <label style={{cursor:"pointer"}}>
            <input type="file" accept="image/png,image/jpeg,image/webp" style={{display:"none"}} disabled={iconUploading} onChange={handleIconUpload}/>
            <span className="btn-primary" style={{fontSize:13,padding:"7px 18px",pointerEvents:"none",display:"inline-flex",alignItems:"center",gap:6}}>
              {iconUploading
                ?<><i className="fa-solid fa-spinner fa-spin" style={{fontSize:11}}/>Generating…</>
                :<><i className="fa-solid fa-arrow-up-from-bracket" style={{fontSize:11}}/>{ICON_SIZES.some(s=>pwaCfg[`icon_${s}_path`])?"Replace icons":"Upload source image"}</>}
            </span>
          </label>
          {ICON_SIZES.some(s=>pwaCfg[`icon_${s}_path`])&&(
            <button className="btn-ghost" style={{fontSize:13,padding:"7px 18px",color:"var(--red)"}} onClick={handleIconDelete}>
              <i className="fa-solid fa-trash" style={{fontSize:11,marginRight:6}}/>Delete all icons
            </button>
          )}
        </div>

        <div className="fgt">Generated sizes</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(90px,1fr))",gap:10,marginTop:8}}>
          {ICON_SIZES.map(size=>{
            const path=pwaCfg[`icon_${size}_path`];
            const filled=!!path;
            const isReq=REQUIRED_SIZES.includes(size);
            return (
              <div key={size} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:5,padding:"10px 6px",border:`0.5px ${filled?"solid":"dashed"} ${filled?"rgba(52,211,153,0.4)":"var(--b1)"}`,borderRadius:8,background:"var(--bg2)",textAlign:"center"}}>
                <div style={{width:48,height:48,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:8,overflow:"hidden",background:"var(--s2)"}}>
                  {filled
                    ?<img src={path} style={{width:"100%",height:"100%",objectFit:"contain"}} alt=""/>
                    :<i className="fa-solid fa-image" style={{fontSize:20,color:"var(--t5)"}}/>}
                </div>
                <div style={{fontSize:11,fontWeight:600,color:"var(--t4)"}}>{size}×{size}</div>
                {isReq&&<span style={{fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:4,background:filled?"transparent":"rgba(248,113,113,0.15)",color:filled?"var(--green)":"var(--red)"}}>{filled?"✓ Ready":"Required"}</span>}
              </div>
            );
          })}
        </div>
      </>}

      {/* ── Push tab ── */}
      {pwaTab==="push"&&<>
        <div className="fgt">VAPID keys</div>
        <div style={{fontSize:13,color:"var(--t4)",marginBottom:12}}>VAPID keys authenticate your server when sending push notifications. Generate them once — regenerating will invalidate all existing subscriptions and users will need to re-subscribe.</div>

        {hasVapid
          ?<div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,fontSize:13,color:"var(--green)"}}>
            <i className="fa-solid fa-circle-check" style={{fontSize:13}}/>VAPID keys are configured and ready.
           </div>
          :<div style={{fontSize:13,color:"var(--red)",marginBottom:12,padding:"8px 12px",background:"rgba(248,113,113,0.08)",borderRadius:8,border:"0.5px solid rgba(248,113,113,0.2)"}}>
            VAPID keys have not been generated yet. Push notifications will not work until keys are generated.
           </div>}

        {vapidError&&<div style={{fontSize:13,color:"var(--red)",marginBottom:12,padding:"8px 12px",background:"rgba(248,113,113,0.08)",borderRadius:8,border:"0.5px solid rgba(248,113,113,0.2)"}}>{vapidError}</div>}

        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:28}}>
          <button className={hasVapid?"btn-ghost":"btn-primary"} style={{fontSize:13,padding:"7px 18px",...(hasVapid?{color:"var(--red)"}:{})}} disabled={vapidGenerating} onClick={handleGenerateVapid}>
            {vapidGenerating
              ?<><i className="fa-solid fa-spinner fa-spin" style={{marginRight:6}}/>Generating…</>
              :hasVapid?"Regenerate VAPID keys":"Generate VAPID keys"}
          </button>
          {hasVapid&&<span style={{fontSize:12,color:"var(--t5)"}}>Regenerating invalidates all existing subscriptions.</span>}
        </div>

        <div className="fgt">Notification badge</div>
        <div style={{fontSize:13,color:"var(--t4)",marginBottom:12}}>A small monochrome icon shown in Android system notifications. Upload a PNG with a white logo on a transparent background — Android masks it to the system notification color. Keep your logo centered. Resized to 96×96 px automatically.</div>

        {badgeError&&<div style={{fontSize:13,color:"var(--red)",marginBottom:10,padding:"8px 12px",background:"rgba(248,113,113,0.08)",borderRadius:8,border:"0.5px solid rgba(248,113,113,0.2)"}}>{badgeError}</div>}

        {pwaCfg.badge_url&&(
          <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:16,padding:12,background:"var(--bg2)",border:"0.5px solid var(--b1)",borderRadius:8,width:"fit-content"}}>
            <div style={{width:48,height:48,borderRadius:4,background:"#444",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
              <img src={pwaCfg.badge_url} style={{width:"100%",height:"100%",objectFit:"contain"}} alt="badge"/>
            </div>
            <button className="btn-ghost" style={{fontSize:12,padding:"5px 12px",color:"var(--red)"}} onClick={handleBadgeDelete}>
              <i className="fa-solid fa-trash" style={{fontSize:11,marginRight:6}}/>Delete badge
            </button>
          </div>
        )}

        <label style={{cursor:"pointer"}}>
          <input type="file" accept="image/png,image/jpeg,image/webp" style={{display:"none"}} disabled={badgeUploading} onChange={handleBadgeUpload}/>
          <span className="btn-ghost" style={{fontSize:13,padding:"7px 18px",pointerEvents:"none",display:"inline-flex",alignItems:"center",gap:6}}>
            {badgeUploading
              ?<><i className="fa-solid fa-spinner fa-spin" style={{fontSize:11}}/>Uploading…</>
              :<><i className="fa-solid fa-arrow-up-from-bracket" style={{fontSize:11}}/>{pwaCfg.badge_url?"Replace badge":"Upload badge image"}</>}
          </span>
        </label>
      </>}

      {/* ── Apple / iOS tab ── */}
      {pwaTab==="apple"&&<>
        <div className="fgt">iOS install prompt</div>
        <div style={{fontSize:13,color:"var(--t4)",marginBottom:16}}>Safari on iPhone and iPad does not support the standard install prompt. This shows a sticky footer guiding users through the manual Add to Home Screen flow.</div>

        <div style={{marginBottom:20}}>
          <div className="toggle-row">
            <div>
              <div style={{fontSize:15,color:"var(--t2)"}}>Show iOS install prompt</div>
              <div style={{fontSize:13,color:"var(--t5)",marginTop:3}}>Shown only in Safari on iOS/iPadOS. Not shown when the app is already installed.</div>
            </div>
            <Toggle value={pwaCfg.ios_prompt_enabled} onChange={v=>setPwaCfg(p=>({...p,ios_prompt_enabled:v}))}/>
          </div>
        </div>

        {pwaCfg.ios_prompt_enabled&&<>
          <F label="Prompt text" hint="Shown in the sticky footer. Use {appName} to insert your app name.">
            <input className="fi" value={pwaCfg.ios_prompt_text||""} onChange={e=>setPwaCfg(p=>({...p,ios_prompt_text:e.target.value}))}
              placeholder={`Install ${pwaCfg.app_name||"Nexus"} — tap the Share button then "Add to Home Screen".`}/>
          </F>
          <F label="Delay before showing (ms)" hint="How long after page load before the prompt slides up.">
            <input className="fi" type="number" min="0" style={{maxWidth:120}} value={pwaCfg.ios_prompt_delay??10000} onChange={e=>setPwaCfg(p=>({...p,ios_prompt_delay:parseInt(e.target.value)||0}))}/>
          </F>
          <div className="toggle-row" style={{marginBottom:14}}>
            <div>
              <div style={{fontSize:15,color:"var(--t2)"}}>Auto-detect share button position</div>
              <div style={{fontSize:13,color:"var(--t5)",marginTop:3}}>Points the arrow toward Safari's share button based on device and orientation.</div>
            </div>
            <Toggle value={pwaCfg.ios_auto_detect_orientation!==false} onChange={v=>setPwaCfg(p=>({...p,ios_auto_detect_orientation:v}))}/>
          </div>
          <div className="toggle-row" style={{marginBottom:14}}>
            <div>
              <div style={{fontSize:15,color:"var(--t2)"}}>Always point up on iPad</div>
              <div style={{fontSize:13,color:"var(--t5)",marginTop:3}}>Safari's share button is always in the top bar on iPad.</div>
            </div>
            <Toggle value={pwaCfg.ios_pad_always_up!==false} onChange={v=>setPwaCfg(p=>({...p,ios_pad_always_up:v}))}/>
          </div>
        </>}

        <div className="fgt" style={{marginTop:20}}>Status bar</div>
        <F label="Status bar style" hint="Controls iOS status bar appearance when running in standalone mode.">
          <Select style={{maxWidth:260}} value={pwaCfg.status_bar_style||"black-translucent"} onChange={v=>setPwaCfg(p=>({...p,status_bar_style:v}))}>
            <option value="default">Default</option>
            <option value="black">Black</option>
            <option value="black-translucent">Black translucent</option>
          </Select>
        </F>
        <div style={{fontSize:12,color:"var(--t5)",marginTop:-8,marginBottom:14}}>Requires a redeploy to take effect — the value is written into the HTML head.</div>
      </>}

      {/* ── Status tab ── */}
      {pwaTab==="status"&&<>
        <div className="fgt">PWA readiness</div>
        <div style={{display:"flex",flexDirection:"column",gap:8,maxWidth:560}}>
          {statusChecks().map((c,i)=>(
            <div key={i} style={{display:"flex",alignItems:"flex-start",gap:12,padding:"12px 14px",borderRadius:8,border:`0.5px solid ${borderColor[c.type]}`,background:"var(--bg2)"}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:dotColor[c.type],flexShrink:0,marginTop:5}}/>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:"var(--t1)",marginBottom:2}}>{c.title}</div>
                <div style={{fontSize:12,color:"var(--t4)",lineHeight:1.5}}>{c.body}</div>
              </div>
            </div>
          ))}
        </div>
      </>}
    </div>
  );
}


// ── Exports ──────────────────────────────────────────────────────────────────
export { IosInstallPrompt, AdminPwaPanel };
