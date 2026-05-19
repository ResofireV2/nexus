import { useState, useEffect, useRef } from "react";
import { api } from "../lib/api";
import { ago, fmtDate, fmtBytes } from "../lib/utils";
import { toast } from "../components/Toasts";
import { Select, Toggle } from "../components/Select";
import { F } from "./FormHelpers";

// ── AdminIntegrationsPanel, AdminAntiSpamPanel, AdminLogsPanel,
// ── AdminDigestPanel, AdminLeaderboardPanel ────────────────────────────────────

// ── AdminIntegrationsPanel ────────────────────────────────────────────────────
function AdminIntegrationsPanel({cfg, setCfg}) {
  return (
    <div>
      <div className="fgt">GitHub OAuth — Sign in with GitHub</div>
      <div style={{fontSize:13,color:"var(--t3)",marginBottom:12,lineHeight:1.7}}>
        Create an OAuth App at <a href="https://github.com/settings/developers" target="_blank" rel="noopener" style={{color:"var(--ac)"}}>github.com/settings/developers</a>.
        Set the callback URL to <code style={{fontSize:11}}>{window.location.origin}/api/v1/auth/oauth/github/callback</code>
      </div>
      <Toggle label="Enable Sign in with GitHub" value={!!cfg.github_oauth_enabled} onChange={v=>setCfg(p=>({...p,github_oauth_enabled:v}))}/>
      <F label="Client ID">
        <input className="fi" value={cfg.github_client_id||""} placeholder="Ov23li…"
          onChange={e=>setCfg(p=>({...p,github_client_id:e.target.value}))}/>
      </F>
      <F label="Client Secret">
        <input className="fi" type="password" value={cfg.github_client_secret||""} placeholder="••••••••"
          onChange={e=>setCfg(p=>({...p,github_client_secret:e.target.value}))}/>
      </F>

      <div className="fgt" style={{marginTop:24}}>Google OAuth — Sign in with Google</div>
      <div style={{fontSize:13,color:"var(--t3)",marginBottom:12,lineHeight:1.7}}>
        Create credentials at <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener" style={{color:"var(--ac)"}}>Google Cloud Console</a> (OAuth 2.0 Client ID, type: Web application).
        Set the authorised redirect URI to <code style={{fontSize:11}}>{window.location.origin}/api/v1/auth/oauth/google/callback</code>
      </div>
      <Toggle label="Enable Sign in with Google" value={!!cfg.google_oauth_enabled} onChange={v=>setCfg(p=>({...p,google_oauth_enabled:v}))}/>
      <F label="Client ID">
        <input className="fi" value={cfg.google_client_id||""} placeholder="123456789-abc….apps.googleusercontent.com"
          onChange={e=>setCfg(p=>({...p,google_client_id:e.target.value}))}/>
      </F>
      <F label="Client Secret">
        <input className="fi" type="password" value={cfg.google_client_secret||""} placeholder="GOCSPX-…"
          onChange={e=>setCfg(p=>({...p,google_client_secret:e.target.value}))}/>
      </F>

      <div className="fgt" style={{marginTop:24}}>GitHub API — Extension updates</div>
      <div style={{fontSize:13,color:"var(--t3)",marginBottom:16,lineHeight:1.7}}>
        A GitHub personal access token is required to check extensions for updates and install from tagged releases.
        Create one at <a href="https://github.com/settings/tokens" target="_blank" rel="noopener" style={{color:"var(--ac)"}}>github.com/settings/tokens</a> with <code style={{fontSize:11}}>public_repo</code> read access.
        Without a token the GitHub API is rate-limited to 60 requests/hour. With a token: 5,000/hour.
      </div>
      <F label="Personal access token" hint="Stored securely. Never exposed to the frontend.">
        <input className="fi" type="password" value={cfg.github_token||""} placeholder="ghp_…"
          onChange={e=>setCfg(p=>({...p,github_token:e.target.value}))}/>
      </F>
    </div>
  );
}



// ── AdminAntiSpamPanel ────────────────────────────────────────────────────────
function AdminAntiSpamPanel({spamCfg, setSpamCfg}) {
  const [tab, setTab]         = useState("settings");
  const [blocked, setBlocked] = useState(null);
  const [compStats, setCompStats] = useState(null);

  useEffect(() => {
    if (tab === "log" && blocked === null) {
      api.get("/admin/blocked-registrations").then(d => setBlocked(d.blocked || []));
    }
    if (tab === "composition" && compStats === null) {
      api.get("/admin/composition-stats").then(d => setCompStats(d.stats || {})).catch(()=>setCompStats({}));
    }
  }, [tab]);

  const tabStyle = active => ({
    padding:"6px 16px", borderRadius:20, fontSize:12, fontWeight:500, cursor:"pointer",
    background: active ? "var(--ac-bg)" : "transparent",
    color: active ? "var(--ac-text)" : "var(--t4)",
    border: active ? "0.5px solid var(--ac)" : "0.5px solid transparent",
  });

  const numInput = (key, def, opts={}) => (
    <input type="number" value={spamCfg[key]??def}
      onChange={e=>setSpamCfg(p=>({...p,[key]:parseFloat(e.target.value)||def}))}
      style={{width:opts.wide?110:80,padding:"5px 10px",background:"var(--s2)",
        border:"0.5px solid var(--b1)",borderRadius:8,color:"var(--t1)",fontSize:13,outline:"none"}}
      {...opts.extra}/>
  );

  const VERDICT_LABELS = {
    implausibly_fast:   "Implausibly fast",
    no_keystrokes:      "No keystrokes",
    dominated_by_paste: "Dominated by paste",
    metadata_missing:   "No metadata",
  };

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:24}}>
        <button style={tabStyle(tab==="settings")}     onClick={()=>setTab("settings")}>Settings</button>
        <button style={tabStyle(tab==="composition")}  onClick={()=>setTab("composition")}>Composition analysis</button>
        <button style={tabStyle(tab==="log")}          onClick={()=>setTab("log")}>Blocked registrations</button>
      </div>

      {/* ── Settings tab ── */}
      {tab==="settings"&&<>
        <div className="fgt">StopForumSpam</div>
        <Toggle label="Enable SFS check at registration" hint="Checks IP, email and username against StopForumSpam.org on every registration. Fails open — if SFS is unreachable, registration proceeds normally." value={!!spamCfg.sfs_enabled} onChange={v=>setSpamCfg(p=>({...p,sfs_enabled:v}))}/>
        <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:8}}>
          <label style={{fontSize:12,color:"var(--t3)",display:"flex",flexDirection:"column",gap:4}}>
            Frequency threshold
            <input type="number" min="1" max="500" value={spamCfg.sfs_frequency??5} onChange={e=>setSpamCfg(p=>({...p,sfs_frequency:parseInt(e.target.value)||5}))}
              style={{width:90,padding:"5px 10px",background:"var(--s2)",border:"0.5px solid var(--b1)",borderRadius:8,color:"var(--t1)",fontSize:13,outline:"none"}}/>
            <span style={{fontSize:11,color:"var(--t5)"}}>Combined report count across IP/email/username</span>
          </label>
          <label style={{fontSize:12,color:"var(--t3)",display:"flex",flexDirection:"column",gap:4}}>
            Confidence threshold (%)
            <input type="number" min="1" max="100" value={spamCfg.sfs_confidence??50} onChange={e=>setSpamCfg(p=>({...p,sfs_confidence:parseFloat(e.target.value)||50}))}
              style={{width:90,padding:"5px 10px",background:"var(--s2)",border:"0.5px solid var(--b1)",borderRadius:8,color:"var(--t1)",fontSize:13,outline:"none"}}/>
            <span style={{fontSize:11,color:"var(--t5)"}}>Highest confidence score across checked fields</span>
          </label>
        </div>

        <div className="fgt" style={{marginTop:16}}>Cloudflare Turnstile</div>
        <Toggle
          label="Enable Turnstile CAPTCHA on registration"
          hint="Requires a Cloudflare Turnstile site key and secret key. The widget automatically matches the forum's dark or light theme. Fails open — if Cloudflare is unreachable, registration proceeds normally."
          value={!!spamCfg.turnstile_enabled}
          onChange={v=>setSpamCfg(p=>({...p,turnstile_enabled:v}))}
        />
        {!!spamCfg.turnstile_enabled && <>
          <F label="Site key" hint="Public key — goes in the frontend widget. Safe to expose.">
            <input className="fi" placeholder="0x4AAAAAAA..." value={spamCfg.turnstile_site_key||""} onChange={e=>setSpamCfg(p=>({...p,turnstile_site_key:e.target.value}))}/>
          </F>
          <F label="Secret key" hint="Private key — never exposed to users. Used for server-side verification only.">
            <input className="fi" type="password" placeholder="0x4AAAAAAA..." value={spamCfg.turnstile_secret_key||""} onChange={e=>setSpamCfg(p=>({...p,turnstile_secret_key:e.target.value}))}/>
          </F>
          <div style={{fontSize:12,color:"var(--t5)",marginBottom:8}}>
            Get your keys at <a href="https://dash.cloudflare.com/?to=/:account/turnstile" target="_blank" rel="noopener" style={{color:"var(--ac-text)"}}>dash.cloudflare.com → Turnstile</a>. Add your forum's domain as an allowed hostname when creating the widget.
          </div>
        </>}

        <div className="fgt" style={{marginTop:16}}>New account restrictions</div>
        <div style={{fontSize:13,color:"var(--t3)",marginBottom:12}}>
          New accounts under 24 hours old are blocked from sending direct messages. This is always enforced and cannot be disabled.
        </div>
      </>}

      {/* ── Composition analysis tab ── */}
      {tab==="composition"&&<>
        <div className="fgt">Detection</div>
        <Toggle label="Enable composition analysis"
          hint="Analyses how posts are written — typing speed, keystrokes, paste events — to detect automated submissions. New users only; established members are exempt."
          value={!!spamCfg.composition_enabled}
          onChange={v=>setSpamCfg(p=>({...p,composition_enabled:v}))}/>
        <Toggle label="Report-only mode"
          hint="Log verdicts to the audit log but do not hold posts for approval. Use this when first enabling to check for false positives before enforcing."
          value={!!spamCfg.composition_report_only}
          onChange={v=>setSpamCfg(p=>({...p,composition_report_only:v}))}/>

        <div className="fgt" style={{marginTop:16}}>Graduation — who is screened</div>
        <div style={{fontSize:13,color:"var(--t4)",marginBottom:12,lineHeight:1.6}}>
          A user graduates out of screening once <em>both</em> thresholds are met.
          Admins and moderators are never screened.
        </div>
        <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:4}}>
          <label style={{fontSize:12,color:"var(--t3)",display:"flex",flexDirection:"column",gap:4}}>
            Approved posts required
            {numInput("composition_approved_threshold", 5)}
            <span style={{fontSize:11,color:"var(--t5)"}}>Posts that passed approval</span>
          </label>
          <label style={{fontSize:12,color:"var(--t3)",display:"flex",flexDirection:"column",gap:4}}>
            Minimum account age (days)
            {numInput("composition_min_account_age_days", 3)}
            <span style={{fontSize:11,color:"var(--t5)"}}>Days since registration</span>
          </label>
        </div>

        <div className="fgt" style={{marginTop:16}}>Detection thresholds</div>
        <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:4}}>
          <label style={{fontSize:12,color:"var(--t3)",display:"flex",flexDirection:"column",gap:4}}>
            Max typing speed (chars/sec)
            {numInput("composition_velocity_cps", 10, {extra:{step:"0.5"}})}
            <span style={{fontSize:11,color:"var(--t5)"}}>Hold if faster than this</span>
          </label>
          <label style={{fontSize:12,color:"var(--t3)",display:"flex",flexDirection:"column",gap:4}}>
            Min length for velocity check
            {numInput("composition_min_len_velocity", 100)}
            <span style={{fontSize:11,color:"var(--t5)"}}>Characters</span>
          </label>
          <label style={{fontSize:12,color:"var(--t3)",display:"flex",flexDirection:"column",gap:4}}>
            Max paste ratio (0.0 – 1.0)
            {numInput("composition_paste_ratio", 0.8, {extra:{step:"0.05",min:"0",max:"1"}})}
            <span style={{fontSize:11,color:"var(--t5)"}}>Hold if pasted chars exceed this fraction</span>
          </label>
          <label style={{fontSize:12,color:"var(--t3)",display:"flex",flexDirection:"column",gap:4}}>
            Min length for paste check
            {numInput("composition_min_len_paste", 150)}
            <span style={{fontSize:11,color:"var(--t5)"}}>Characters</span>
          </label>
        </div>

        <div style={{marginTop:12}}>
          <Toggle label="Hold posts with no metadata"
            hint="Posts submitted with no composition signals (API clients, bots with JS disabled) are held for approval. Off by default to avoid blocking legitimate API use."
            value={!!spamCfg.composition_hold_missing}
            onChange={v=>setSpamCfg(p=>({...p,composition_hold_missing:v}))}/>
        </div>

        {/* Stats block */}
        <div className="fgt" style={{marginTop:20}}>Activity</div>
        {compStats===null
          ? <div style={{fontSize:13,color:"var(--t5)"}}>Loading…</div>
          : <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
              {[
                {label:"Total held",      val: compStats.total ?? 0},
                {label:"Pending review",  val: compStats.pending ?? 0},
              ].map(({label,val})=>(
                <div key={label} style={{background:"var(--bg3)",border:"0.5px solid var(--b1)",borderRadius:10,padding:"12px 18px",minWidth:110}}>
                  <div style={{fontSize:22,fontWeight:600,color:"var(--t1)",letterSpacing:-0.5}}>{val}</div>
                  <div style={{fontSize:11,color:"var(--t5)",marginTop:2}}>{label}</div>
                </div>
              ))}
              {Object.entries(compStats.by_verdict||{}).filter(([,n])=>n>0).map(([v,n])=>(
                <div key={v} style={{background:"var(--bg3)",border:"0.5px solid var(--b1)",borderRadius:10,padding:"12px 18px",minWidth:110}}>
                  <div style={{fontSize:22,fontWeight:600,color:"var(--t1)",letterSpacing:-0.5}}>{n}</div>
                  <div style={{fontSize:11,color:"var(--t5)",marginTop:2}}>{VERDICT_LABELS[v]||v}</div>
                </div>
              ))}
            </div>
        }
      </>}

      {/* ── Blocked registrations tab ── */}
      {tab==="log"&&<>
        {blocked===null
          ? <div style={{padding:"48px 0",textAlign:"center",color:"var(--t5)",fontSize:13}}>Loading…</div>
          : blocked.length===0
            ? <div style={{padding:"48px 0",textAlign:"center",color:"var(--t5)",fontSize:13}}>No blocked registrations yet.</div>
            : <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{borderBottom:"0.5px solid var(--b1)"}}>
                      {["Time","IP","Email","Username","Reason"].map(h=>
                        <th key={h} style={{padding:"8px 12px",textAlign:"left",color:"var(--t5)",fontWeight:500}}>{h}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {blocked.map(b=>
                      <tr key={b.id} style={{borderBottom:"0.5px solid var(--b1)"}}>
                        <td style={{padding:"8px 12px",color:"var(--t5)",whiteSpace:"nowrap"}}>{new Date(b.inserted_at).toLocaleString()}</td>
                        <td style={{padding:"8px 12px",color:"var(--t3)",fontFamily:"monospace"}}>{b.ip||"—"}</td>
                        <td style={{padding:"8px 12px",color:"var(--t3)"}}>{b.email||"—"}</td>
                        <td style={{padding:"8px 12px",color:"var(--t3)"}}>{b.username||"—"}</td>
                        <td style={{padding:"8px 12px"}}>
                          <span style={{padding:"2px 8px",borderRadius:20,fontSize:11,fontWeight:500,
                            background:b.reason==="sfs"?"rgba(251,146,60,0.1)":"rgba(96,165,250,0.1)",
                            color:b.reason==="sfs"?"#fb923c":"#60a5fa",
                            border:`0.5px solid ${b.reason==="sfs"?"rgba(251,146,60,0.3)":"rgba(96,165,250,0.3)"}`}}>
                            {b.reason==="sfs"?"StopForumSpam":"honeypot"}
                          </span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
        }
      </>}
    </div>
  );
}




// ── AdminLogsPanel ────────────────────────────────────────────────────────────
function AdminLogsPanel() {
  const [tab, setTab] = useState("jobs");
  const [jobs, setJobs] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = (t) => {
    setLoading(true);
    if(t==="jobs") {
      api.get("/admin/logs/jobs").then(d=>{ setJobs(d.jobs||[]); setLoading(false); });
    } else {
      api.get("/admin/logs/settings").then(d=>{ setSettings(d.logs||[]); setLoading(false); });
    }
  };

  useEffect(()=>{ load(tab); },[tab]);

  const STATE_COLOR = {discarded:"var(--red)", retryable:"var(--amber)"};
  const STATE_BG    = {discarded:"rgba(248,113,113,0.1)", retryable:"rgba(251,191,36,0.1)"};

  const diffSettings = (oldV, newV) => {
    const keys = new Set([...Object.keys(oldV||{}), ...Object.keys(newV||{})]);
    return Array.from(keys).filter(k => JSON.stringify((oldV||{})[k]) !== JSON.stringify((newV||{})[k])).map(k => ({
      key: k,
      from: (oldV||{})[k],
      to:   (newV||{})[k]
    }));
  };

  return (
    <div>
      <div style={{fontSize:18,fontWeight:600,color:"var(--t1)",letterSpacing:-0.3,marginBottom:4}}>Logs</div>
      <div style={{fontSize:12,color:"var(--t4)",marginBottom:20}}>Job failures and settings changes.</div>

      {/* Tab bar */}
      <div style={{display:"flex",gap:0,borderBottom:"0.5px solid var(--b1)",marginBottom:20}}>
        {[{id:"jobs",label:"Job failures"},{id:"settings",label:"Settings changes"}].map(t=>(
          <div key={t.id} onClick={()=>setTab(t.id)}
            style={{fontSize:13,color:tab===t.id?"var(--t1)":"var(--t4)",padding:"10px 0",marginRight:24,cursor:"pointer",borderBottom:`1.5px solid ${tab===t.id?"var(--ac)":"transparent"}`,marginBottom:-1}}>
            {t.label}
          </div>
        ))}
      </div>

      {loading && <div style={{padding:"40px 0",textAlign:"center",color:"var(--t5)"}}>Loading…</div>}

      {/* Job failures */}
      {!loading && tab==="jobs" && jobs !== null && <>
        {jobs.length===0
          ? <div style={{padding:"48px 0",textAlign:"center",color:"var(--t5)"}}>
              <i className="fa-solid fa-circle-check" style={{fontSize:28,color:"var(--green)",opacity:.5,marginBottom:12,display:"block"}}/>
              No failed or retrying jobs
            </div>
          : <>
              <div style={{display:"grid",gridTemplateColumns:"80px 1fr 80px 80px 1fr 120px",gap:0,padding:"0 14px 8px",fontSize:10,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.8px",borderBottom:"0.5px solid var(--b1)",marginBottom:4}}>
                <div>State</div><div>Worker</div><div>Queue</div><div>Attempts</div><div>Error</div><div>When</div>
              </div>
              {jobs.map(j=>(
                <div key={j.id} style={{display:"grid",gridTemplateColumns:"80px 1fr 80px 80px 1fr 120px",gap:0,padding:"10px 14px",borderBottom:"0.5px solid var(--b1)",alignItems:"start"}}>
                  <div>
                    <span style={{fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:20,background:STATE_BG[j.state],color:STATE_COLOR[j.state]}}>{j.state}</span>
                  </div>
                  <div style={{fontSize:12,color:"var(--t2)",fontFamily:"monospace",wordBreak:"break-all"}}>{j.worker}</div>
                  <div style={{fontSize:12,color:"var(--t4)"}}>{j.queue}</div>
                  <div style={{fontSize:12,color:"var(--t4)"}}>{j.attempt}/{j.max_attempts}</div>
                  <div style={{fontSize:11,color:"var(--red)",fontFamily:"monospace",wordBreak:"break-all",lineHeight:1.5}}>{j.last_error?.message||"—"}</div>
                  <div style={{fontSize:11,color:"var(--t5)"}}>{j.attempted_at?ago(j.attempted_at):ago(j.inserted_at)}</div>
                </div>
              ))}
            </>}
      </>}

      {/* Settings changes */}
      {!loading && tab==="settings" && settings !== null && <>
        {settings.length===0
          ? <div style={{padding:"48px 0",textAlign:"center",color:"var(--t5)"}}>No settings changes recorded yet</div>
          : settings.map((l,i)=>{
              const diffs = diffSettings(l.old_value, l.new_value);
              return (
                <div key={l.id||i} style={{padding:"12px 14px",borderBottom:"0.5px solid var(--b1)"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:diffs.length?8:0}}>
                    <span style={{fontSize:12,fontWeight:500,color:"var(--ac-text)",background:"var(--ac-bg)",padding:"2px 8px",borderRadius:20}}>{l.section}</span>
                    <span style={{fontSize:12,color:"var(--t4)"}}>changed by</span>
                    <span style={{fontSize:12,fontWeight:500,color:"var(--t2)"}}>{l.admin||"unknown"}</span>
                    <span style={{fontSize:11,color:"var(--t5)",marginLeft:"auto"}}>{ago(l.inserted_at)}</span>
                  </div>
                  {diffs.map(d=>(
                    <div key={d.key} style={{display:"flex",alignItems:"baseline",gap:8,fontSize:11,fontFamily:"monospace",marginTop:4}}>
                      <span style={{color:"var(--t4)",minWidth:160,flexShrink:0}}>{d.key}</span>
                      <span style={{color:"rgba(248,113,113,0.8)",textDecoration:"line-through"}}>{JSON.stringify(d.from)}</span>
                      <span style={{color:"var(--t5)"}}>→</span>
                      <span style={{color:"rgba(52,211,153,0.9)"}}>{JSON.stringify(d.to)}</span>
                    </div>
                  ))}
                </div>
              );
            })}
      </>}
    </div>
  );
}



// ── AdminDigestPanel ──────────────────────────────────────────────────────────
const DIGEST_SECTIONS = [
  {id:"posts",       label:"Top posts",        icon:"fa-pen-to-square"},
  {id:"leaderboard", label:"Leaderboard",      icon:"fa-trophy"},
  {id:"badges",      label:"Badges awarded",   icon:"fa-medal"},
  {id:"members",     label:"New members",      icon:"fa-users"},
  {id:"spaces",      label:"Trending spaces",  icon:"fa-layer-group"},
];
const DIGEST_FREQUENCIES = ["daily","weekly","monthly"];
const TIMEZONES = [
  {group:"UTC",        zones:["UTC"]},
  {group:"Americas",   zones:["America/New_York","America/Chicago","America/Denver","America/Los_Angeles","America/Anchorage","America/Halifax","America/Toronto","America/Vancouver","America/Sao_Paulo","America/Argentina/Buenos_Aires","America/Bogota","America/Lima","America/Mexico_City"]},
  {group:"Europe",     zones:["Europe/London","Europe/Dublin","Europe/Paris","Europe/Berlin","Europe/Madrid","Europe/Rome","Europe/Amsterdam","Europe/Brussels","Europe/Zurich","Europe/Stockholm","Europe/Oslo","Europe/Helsinki","Europe/Warsaw","Europe/Prague","Europe/Budapest","Europe/Bucharest","Europe/Athens","Europe/Moscow"]},
  {group:"Asia/Pacific", zones:["Asia/Dubai","Asia/Karachi","Asia/Kolkata","Asia/Dhaka","Asia/Bangkok","Asia/Singapore","Asia/Shanghai","Asia/Tokyo","Asia/Seoul","Australia/Sydney","Australia/Melbourne","Pacific/Auckland","Pacific/Honolulu"]},
  {group:"Africa",     zones:["Africa/Johannesburg","Africa/Lagos","Africa/Nairobi","Africa/Cairo"]},
];

function AdminDigestPanel({digestCfg, setDigestCfg, saving, saveSection}) {
  const [sendingTest, setSendingTest] = useState(false);
  const [allSections, setAllSections] = useState(DIGEST_SECTIONS);

  const cfg = digestCfg;
  const set = (k,v) => setDigestCfg(p=>({...p,[k]:v}));

  useEffect(() => {
    api.get("/admin/digest/sections").then(d => {
      if(d.sections && d.sections.length) setAllSections(d.sections);
    }).catch(() => {});
  }, []);

  const enabledFreqs = cfg.frequencies || ["weekly"];
  const toggleFreq = (f) => {
    const next = enabledFreqs.includes(f)
      ? enabledFreqs.filter(x=>x!==f)
      : [...enabledFreqs, f];
    set("frequencies", next);
  };

  // Merge saved order with any new sections from extensions not yet in the saved list
  const baseSectionOrder = cfg.section_order || allSections.map(s=>s.id);
  const knownIds = new Set(baseSectionOrder);
  const sectionOrder = [
    ...baseSectionOrder,
    ...allSections.map(s=>s.id).filter(id => !knownIds.has(id))
  ];
  const moveSection = (id, dir) => {
    const idx = sectionOrder.indexOf(id);
    if(idx === -1) return;
    const next = [...sectionOrder];
    const swap = idx + dir;
    if(swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    set("section_order", next);
  };

  const sendTest = async () => {
    const freq = enabledFreqs[0] || "weekly";
    setSendingTest(true);
    const d = await api.post("/admin/digest/test", {frequency: freq});
    setSendingTest(false);
    if(d.ok) toast(`Test digest sent (${freq})`);
    else toast(d.error||"Failed","err");
  };

  const fi = {width:"100%",background:"var(--s1)",border:"0.5px solid var(--b2)",borderRadius:8,padding:"8px 12px",fontSize:13,color:"var(--t2)",fontFamily:"inherit",outline:"none",boxSizing:"border-box"};
  const weekDays = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20,flexWrap:"wrap"}}>
        <div style={{flex:1}}>
          <div style={{fontSize:18,fontWeight:600,color:"var(--t1)",letterSpacing:-0.3}}>Digest email</div>
          <div style={{fontSize:12,color:"var(--t4)",marginTop:2}}>Send periodic email roundups to subscribed members.</div>
        </div>
        <button className="btn-ghost" style={{fontSize:12,display:"flex",alignItems:"center",gap:6}} onClick={sendTest} disabled={sendingTest||!cfg.enabled}>
          <i className="fa-solid fa-paper-plane" style={{fontSize:11}}/>{sendingTest?"Sending…":"Send test"}
        </button>

      </div>

      {/* Enable / disable */}
      <div style={{background:"var(--s1)",border:"0.5px solid var(--b1)",borderRadius:12,padding:"18px 20px",marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:500,color:"var(--t2)"}}>Enable digest emails</div>
            <div style={{fontSize:12,color:"var(--t4)",marginTop:2}}>Members who opt in will receive digest emails at their chosen frequency.</div>
          </div>
          <div style={{position:"relative",width:40,height:22,borderRadius:11,background:cfg.enabled?"var(--ac)":"rgba(255,255,255,0.1)",cursor:"pointer",transition:"background .15s",flexShrink:0}}
            onClick={()=>set("enabled",!cfg.enabled)}>
            <div style={{position:"absolute",top:2,left:cfg.enabled?20:2,width:18,height:18,borderRadius:"50%",background:"#fff",transition:"left .15s"}}/>
          </div>
        </div>
      </div>

      {/* Available frequencies */}
      <div style={{background:"var(--s1)",border:"0.5px solid var(--b1)",borderRadius:12,padding:"18px 20px",marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:500,color:"var(--t2)",marginBottom:12}}>Available frequencies</div>
        <div style={{display:"flex",gap:8}}>
          {DIGEST_FREQUENCIES.map(f=>(
            <div key={f} onClick={()=>toggleFreq(f)}
              style={{padding:"7px 18px",borderRadius:20,border:`0.5px solid ${enabledFreqs.includes(f)?"rgba(167,139,250,0.4)":"rgba(255,255,255,0.1)"}`,background:enabledFreqs.includes(f)?"rgba(167,139,250,0.12)":"transparent",color:enabledFreqs.includes(f)?"#c4b5fd":"var(--t4)",cursor:"pointer",fontSize:13}}>
              {f}
            </div>
          ))}
        </div>
      </div>

      {/* Send schedule */}
      <div style={{background:"var(--s1)",border:"0.5px solid var(--b1)",borderRadius:12,padding:"18px 20px",marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:500,color:"var(--t2)",marginBottom:16}}>Send schedule</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 24px"}}>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:6}}>Timezone</div>
            <Select style={fi} value={cfg.timezone||"UTC"} onChange={v=>set("timezone",v)}>
              {TIMEZONES.map(g=>(
                <optgroup key={g.group} label={g.group}>
                  {g.zones.map(z=><option key={z} value={z}>{z.replace(/_/g," ")}</option>)}
                </optgroup>
              ))}
            </Select>
          </div>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:6}}>Send time</div>
            <input style={{...fi,width:"100%"}} type="time" value={cfg.send_time||"08:00"} onChange={e=>set("send_time",e.target.value)}/>
          </div>
          {enabledFreqs.includes("weekly")&&(
            <div style={{marginBottom:16}}>
              <div style={{fontSize:11,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:6}}>Weekly send day</div>
              <Select style={fi} value={cfg.weekly_day||"monday"} onChange={v=>set("weekly_day",v)}>
                {weekDays.map(d=><option key={d} value={d}>{d.charAt(0).toUpperCase()+d.slice(1)}</option>)}
              </Select>
            </div>
          )}
          {enabledFreqs.includes("monthly")&&(
            <div style={{marginBottom:16}}>
              <div style={{fontSize:11,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:6}}>Monthly send day</div>
              <Select style={fi} value={cfg.monthly_day||1} onChange={v=>set("monthly_day",parseInt(v))}>
                {Array.from({length:28},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}
              </Select>
            </div>
          )}
        </div>
      </div>

      {/* Content sections */}
      <div style={{background:"var(--s1)",border:"0.5px solid var(--b1)",borderRadius:12,padding:"18px 20px",marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:500,color:"var(--t2)",marginBottom:4}}>Content sections</div>
        <div style={{fontSize:12,color:"var(--t4)",marginBottom:16}}>Toggle sections on/off and reorder them with the arrows.</div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {sectionOrder.map((id,idx)=>{
            const sec = allSections.find(s=>s.id===id);
            if(!sec) return null;
            const includeKey = sec.cfg_key || {leaderboard:"include_leaderboard",badges:"include_badges",members:"include_new_members",spaces:"include_trending_spaces"}[id];
            const extKey = sec.ext ? "include_ext_"+id : null;
            const included = sec.toggleable===false ? true : (includeKey ? cfg[includeKey]!==false : (extKey ? cfg[extKey]!==false : true));
            return (
              <div key={id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"var(--s2)",border:"0.5px solid var(--b1)",borderRadius:8}}>
                <i className={`fa-solid ${sec.icon}`} style={{fontSize:13,color:"var(--t4)",width:16,textAlign:"center"}}/>
                <span style={{flex:1,fontSize:13,color:included?"var(--t2)":"var(--t5)"}}>{sec.label}</span>
                {sec.toggleable!==false&&(
                  <div style={{position:"relative",width:32,height:18,borderRadius:9,background:included?"var(--ac)":"rgba(255,255,255,0.1)",cursor:"pointer",transition:"background .15s",flexShrink:0}}
                    onClick={()=>{ const k=includeKey||(sec.ext?"include_ext_"+id:null); if(k) set(k,!included); }}>
                    <div style={{position:"absolute",top:2,left:included?14:2,width:14,height:14,borderRadius:"50%",background:"#fff",transition:"left .15s"}}/>
                  </div>
                )}
                <div style={{display:"flex",flexDirection:"column",gap:2}}>
                  <button onClick={()=>moveSection(id,-1)} disabled={idx===0}
                    style={{background:"none",border:"none",color:idx===0?"var(--b2)":"var(--t4)",cursor:idx===0?"default":"pointer",padding:"2px 4px",lineHeight:1}}>
                    <i className="fa-solid fa-chevron-up" style={{fontSize:9}}/>
                  </button>
                  <button onClick={()=>moveSection(id,1)} disabled={idx===sectionOrder.length-1}
                    style={{background:"none",border:"none",color:idx===sectionOrder.length-1?"var(--b2)":"var(--t4)",cursor:idx===sectionOrder.length-1?"default":"pointer",padding:"2px 4px",lineHeight:1}}>
                    <i className="fa-solid fa-chevron-down" style={{fontSize:9}}/>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Post count */}
      <div style={{background:"var(--s1)",border:"0.5px solid var(--b1)",borderRadius:12,padding:"18px 20px"}}>
        <div style={{fontSize:13,fontWeight:500,color:"var(--t2)",marginBottom:12}}>Post count</div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <input style={{...fi,width:80}} type="number" min={1} max={20} value={cfg.top_posts_count||5} onChange={e=>set("top_posts_count",parseInt(e.target.value)||5)}/>
          <span style={{fontSize:13,color:"var(--t4)"}}>top posts per digest</span>
        </div>
      </div>
    </div>
  );
}



// ── AdminLeaderboardPanel ─────────────────────────────────────────────────────
function AdminLeaderboardPanel({lbCfg, setLbCfg, saving, saveSection}) {
  const [recalculating, setRecalculating] = useState(false);

  const recalculate = async () => {
    if(!confirm("This will recompute scores for every member. For large communities this may take a while. Continue?")) return;
    setRecalculating(true);
    const res = await api.post("/admin/leaderboard/recalculate", {});
    setRecalculating(false);
    if(res.ok) toast(`Recalculation started — ${res.enqueued} member${res.enqueued===1?"":"s"} queued`);
    else toast(res.error||"Failed","err");
  };

  const fi = {width:"100%",background:"var(--s1)",border:"0.5px solid var(--b2)",borderRadius:8,padding:"8px 12px",fontSize:13,color:"var(--t2)",fontFamily:"inherit",outline:"none",boxSizing:"border-box"};

  // Tile input for point values — icon + label + large centered number input
  const PointTile = ({label, cfgKey, icon, color}) => (
    <div style={{background:"var(--s2)",borderRadius:10,padding:"14px 14px 12px",display:"flex",flexDirection:"column",gap:6}}>
      <i className={`fa-solid ${icon}`} style={{fontSize:18,color,marginBottom:2}}/>
      <div style={{fontSize:11,color:"var(--t4)",lineHeight:1.3}}>{label}</div>
      <input
        type="number" min={0} step={1}
        value={lbCfg[cfgKey] ?? 1}
        onChange={e=>setLbCfg(p=>({...p,[cfgKey]:parseInt(e.target.value)||0}))}
        style={{width:"100%",padding:"6px 8px",background:"var(--s1)",border:"0.5px solid var(--b2)",borderRadius:6,
          color:"var(--t1)",fontSize:15,fontWeight:500,textAlign:"center",fontFamily:"inherit",outline:"none"}}
      />
    </div>
  );

  // Streak example pills — recomputed from current config values
  const mul   = lbCfg.streak_multiplier ?? 0.1;
  const cap   = lbCfg.streak_cap        ?? 3.0;
  const streakEx = [3, 7, 14, 20].map(days => ({
    days,
    val:  parseFloat(Math.min(1 + days * mul, cap).toFixed(2)),
    capped: (1 + days * mul) >= cap,
  }));

  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20,flexWrap:"wrap"}}>
        <div style={{flex:1}}>
          <div style={{fontSize:18,fontWeight:600,color:"var(--t1)",letterSpacing:-0.3}}>Leaderboard</div>
          <div style={{fontSize:12,color:"var(--t4)",marginTop:2}}>Configure scoring, point values, and the points currency name.</div>
        </div>
        <button className="btn-ghost" style={{fontSize:12,display:"flex",alignItems:"center",gap:6}} onClick={recalculate} disabled={recalculating}>
          <i className="fa-solid fa-rotate" style={{fontSize:11}}/>{recalculating?"Recalculating…":"Recalculate all scores"}
        </button>
      </div>

      {/* General */}
      <div style={{background:"var(--s1)",border:"0.5px solid var(--b1)",borderRadius:12,padding:"18px 20px",marginBottom:14}}>
        <div style={{fontSize:13,fontWeight:500,color:"var(--t2)",marginBottom:16}}>General</div>
        {/* Enabled toggle */}
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
          <div style={{flex:1}}>
            <div style={{fontSize:11,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:6}}>Enabled</div>
            <div style={{fontSize:12,color:"var(--t4)"}}>Show the leaderboard page and rank stats to members.</div>
          </div>
          <div style={{position:"relative",width:40,height:22,borderRadius:11,background:lbCfg.enabled!==false?"var(--ac)":"rgba(255,255,255,0.1)",cursor:"pointer",transition:"background .15s",flexShrink:0}}
            onClick={()=>setLbCfg(p=>({...p,enabled:p.enabled===false?true:false}))}>
            <div style={{position:"absolute",top:2,left:lbCfg.enabled!==false?20:2,width:18,height:18,borderRadius:"50%",background:"#fff",transition:"left .15s"}}/>
          </div>
        </div>
        {/* Exclude staff toggle */}
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
          <div style={{flex:1}}>
            <div style={{fontSize:11,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:6}}>Exclude admins &amp; moderators</div>
            <div style={{fontSize:12,color:"var(--t4)"}}>Remove staff from rankings so members compete on an equal footing. Staff scores are still tracked — only their visibility is affected.</div>
          </div>
          <div style={{position:"relative",width:40,height:22,borderRadius:11,background:lbCfg.exclude_staff?"var(--ac)":"rgba(255,255,255,0.1)",cursor:"pointer",transition:"background .15s",flexShrink:0}}
            onClick={()=>setLbCfg(p=>({...p,exclude_staff:!p.exclude_staff}))}>
            <div style={{position:"absolute",top:2,left:lbCfg.exclude_staff?20:2,width:18,height:18,borderRadius:"50%",background:"#fff",transition:"left .15s"}}/>
          </div>
        </div>
        {/* Currency name */}
        <div>
          <div style={{fontSize:11,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:6}}>Points currency name</div>
          <div style={{fontSize:11,color:"var(--t5)",opacity:0.7,marginBottom:6}}>What members see (e.g. "points", "kudos", "karma", "stars").</div>
          <input style={{...fi,width:200}} value={lbCfg.points_name||"points"} onChange={e=>setLbCfg(p=>({...p,points_name:e.target.value}))} placeholder="points"/>
        </div>
      </div>

      {/* Point tiles */}
      <div style={{background:"var(--s1)",border:"0.5px solid var(--b1)",borderRadius:12,padding:"18px 20px",marginBottom:14}}>
        <div style={{fontSize:13,fontWeight:500,color:"var(--t2)",marginBottom:14}}>Points per action</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:10}}>
          <PointTile label="Post created"      cfgKey="post_points"              icon="fa-pen-to-square"  color="#a78bfa"/>
          <PointTile label="Reply posted"      cfgKey="reply_points"             icon="fa-reply"          color="#a78bfa"/>
          <PointTile label="Reaction given"    cfgKey="reaction_given_points"    icon="fa-heart"          color="#f472b6"/>
          <PointTile label="Reaction received" cfgKey="reaction_received_points" icon="fa-heart"          color="#f472b6"/>
          <PointTile label="Daily login"       cfgKey="login_points"             icon="fa-arrow-right-to-bracket" color="#60a5fa"/>
          <PointTile label="Badge earned"      cfgKey="badge_points"             icon="fa-medal"          color="#34d399"/>
          <PointTile label="Post pinned"       cfgKey="pin_points"               icon="fa-thumbtack"      color="#fbbf24"/>
          <PointTile label="Mention received"  cfgKey="mention_received_points"  icon="fa-at"             color="#fbbf24"/>
        </div>
      </div>

      {/* Streak multiplier */}
      <div style={{background:"var(--s1)",border:"0.5px solid var(--b1)",borderRadius:12,padding:"18px 20px"}}>
        <div style={{fontSize:13,fontWeight:500,color:"var(--t2)",marginBottom:4}}>Login streak multiplier</div>
        <div style={{fontSize:12,color:"var(--t4)",marginBottom:16}}>
          Daily login points are multiplied by <code style={{color:"var(--ac)"}}>1 + (streak_days × multiplier)</code>, capped at the maximum.
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 24px",marginBottom:14}}>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:6}}>Multiplier per streak day</div>
            <div style={{fontSize:11,color:"var(--t5)",opacity:0.7,marginBottom:6}}>e.g. 0.1 means +10% per day</div>
            <input style={{...fi,width:120}} type="number" min={0} step={0.05}
              value={lbCfg.streak_multiplier ?? 0.1}
              onChange={e=>setLbCfg(p=>({...p,streak_multiplier:parseFloat(e.target.value)||0}))}/>
          </div>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:6}}>Maximum multiplier</div>
            <div style={{fontSize:11,color:"var(--t5)",opacity:0.7,marginBottom:6}}>e.g. 3.0 means up to 3× base</div>
            <input style={{...fi,width:120}} type="number" min={1} step={0.5}
              value={lbCfg.streak_cap ?? 3.0}
              onChange={e=>setLbCfg(p=>({...p,streak_cap:parseFloat(e.target.value)||1}))}/>
          </div>
        </div>
        {/* Live streak examples */}
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <i className="fa-solid fa-fire" style={{fontSize:13,color:"#f472b6",flexShrink:0}}/>
          {streakEx.map(({days,val,capped})=>(
            <div key={days} style={{fontSize:11,padding:"3px 10px",borderRadius:20,
              border:"0.5px solid var(--b2)",color:"var(--t3)"}}>
              {days}d → <span style={{color:"var(--t1)",fontWeight:500}}>{val}×</span>
              {capped&&<span style={{color:"var(--t5)",marginLeft:3}}>(capped)</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// ── Exports ──────────────────────────────────────────────────────────────────
export { AdminIntegrationsPanel, AdminAntiSpamPanel, AdminLogsPanel,
         AdminDigestPanel, DIGEST_SECTIONS, DIGEST_FREQUENCIES, TIMEZONES,
         AdminLeaderboardPanel };
