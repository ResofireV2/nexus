import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { ago, fmtDate } from "../lib/utils";
import { toast } from "../components/Toasts";
import { Select } from "../components/Select";
import { RsAv } from "../components/Avatar";
import { F, ColorPicker } from "./FormHelpers";

// ── RARITY_*, BadgesPageSidebar, BadgesPage, AdminBadgesPanel ─────────────────

// ── Rarity helpers ────────────────────────────────────────────────────────────
const RARITY_COLOR = {common:"var(--t5)", rare:"#93c5fd", epic:"#c4b5fd", legendary:"#fcd34d"};
const RARITY_BG    = {common:"rgba(255,255,255,0.06)", rare:"rgba(96,165,250,0.1)", epic:"rgba(167,139,250,0.12)", legendary:"rgba(251,191,36,0.12)"};

// ── Forum-facing BadgesPage ───────────────────────────────────────────────────
// ── Badges page contextual sidebar ───────────────────────────────────────────
const RARITY_WEIGHT = {legendary:4, epic:3, rare:2, common:1};

function BadgesPageSidebar({currentUser, navigate}) {
  const [earners, setEarners] = useState(null);
  const [myData, setMyData]   = useState(null);

  useEffect(()=>{
    api.get("/badges/recent").then(d=>setEarners(d.earners||[])).catch(()=>setEarners([]));
    if(currentUser) {
      api.get("/badges/my").then(d=>setMyData(d)).catch(()=>{});
    }
  },[currentUser]);

  // Top 5 rarest earned badges, sorted legendary → epic → rare → common
  const rarestBadges = [...(myData?.earned||[])]
    .sort((a,b)=>(RARITY_WEIGHT[b.badge?.rarity]||0)-(RARITY_WEIGHT[a.badge?.rarity]||0))
    .slice(0,5);

  return (
    <>
      {/* Your Rarest Badges */}
      {currentUser&&rarestBadges.length>0&&(
        <div className="rw">
          <div className="rw-label">Your rarest badges</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {rarestBadges.map((e,i)=>{
              const b=e.badge;
              const rc=RARITY_COLOR[b.rarity]||"var(--t5)";
              const rb=RARITY_BG[b.rarity]||"rgba(255,255,255,0.06)";
              return (
                <div key={b.id} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:i<rarestBadges.length-1?"0.5px solid var(--b1)":"none"}}>
                  <div style={{width:32,height:32,borderRadius:9,background:`${b.color}22`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <i className={`fa-solid ${b.icon}`} style={{fontSize:14,color:b.color}}/>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:14,fontWeight:500,color:"var(--t2)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{b.name}</div>
                  </div>
                  <span style={{fontSize:11,fontWeight:500,padding:"2px 8px",borderRadius:20,textTransform:"uppercase",letterSpacing:"0.4px",background:rb,color:rc,flexShrink:0}}>{b.rarity}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Community Earners */}
      <div className="rw">
        <div className="rw-label">Recently earned</div>
        {earners===null
          ?<div style={{fontSize:14,color:"var(--t5)",textAlign:"center",padding:"12px 0"}}>Loading…</div>
          :earners.length===0
            ?<div style={{fontSize:14,color:"var(--t5)",textAlign:"center",padding:"12px 0"}}>No recent activity</div>
            :earners.map((e,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:i<earners.length-1?"0.5px solid var(--b1)":"none"}}>
                {/* User avatar */}
                <RsAv user={{username:e.username,avatar_url:e.avatar_url,avatar_color:e.avatar_color,id:e.user_id}} size={32} noCard />
                {/* Info */}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:500,color:"var(--t2)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",cursor:"pointer"}}
                    onClick={()=>navigate("profile",{username:e.username})}>
                    {e.username}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:5,marginTop:2}}>
                    <i className={`fa-solid ${e.badge_icon}`} style={{fontSize:11,color:e.badge_color}}/>
                    <span style={{fontSize:13,color:"var(--t5)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{e.badge_name}</span>
                  </div>
                </div>
                <span style={{fontSize:12,color:"var(--t5)",flexShrink:0}}>{ago(e.awarded_at)}</span>
              </div>
            ))
        }
      </div>
    </>
  );
}


function BadgesPage({currentUser, navigate}) {
  const [data,   setData]   = useState(null);
  const [filter, setFilter] = useState("all");
  const [loading,setLoading]= useState(true);

  useEffect(()=>{
    if(currentUser) {
      api.get("/badges/my").then(d=>{ setData(d); setLoading(false); });
    } else {
      api.get("/badges").then(d=>{ setData({badges: d.badges||[], earned:[], progress:[], total_badges: d.badges?.length||0, earned_count:0}); setLoading(false); });
    }
  },[currentUser]);

  if(loading) return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)"}}>Loading…</div>;

  const earnedBadges   = (data.earned||[]);
  const progressBadges = (data.progress||[]).filter(p=>p.pct>0).sort((a,b)=>b.pct-a.pct);
  const lockedBadges   = (data.progress||[]).filter(p=>p.pct===0);
  const totalBadges    = data.total_badges||0;
  const earnedCount    = data.earned_count||0;
  const progressPct    = totalBadges>0 ? Math.round(earnedCount/totalBadges*100) : 0;

  const showEarned   = filter==="all"||filter==="earned";
  const showProgress = filter==="all"||filter==="progress";
  const showLocked   = filter==="all"||filter==="locked";

  const BadgeCard = ({badge, earnedAt, awardedBy, progressData}) => {
    const isEarned   = !!earnedAt;
    const inProgress = !isEarned && progressData && progressData.pct>0;
    const isLocked   = !isEarned && (!progressData || progressData.pct===0);
    const rc = RARITY_COLOR[badge.rarity]||"var(--t5)";
    const rb = RARITY_BG[badge.rarity]||"rgba(255,255,255,0.06)";
    return (
      <div style={{borderRadius:14,border:`0.5px solid ${isEarned?"var(--ac-border)":"rgba(255,255,255,0.08)"}`,padding:16,position:"relative",transition:"border-color .15s",background:isEarned?"var(--ac-bg)":"transparent",opacity:isLocked?0.55:1,cursor:"default"}}
        onMouseEnter={e=>e.currentTarget.style.borderColor=isEarned?"var(--ac)":document.documentElement.getAttribute("data-theme")==="light"?"rgba(26,20,80,0.16)":"rgba(255,255,255,0.16)"}
        onMouseLeave={e=>e.currentTarget.style.borderColor=isEarned?"var(--ac-border)":document.documentElement.getAttribute("data-theme")==="light"?"rgba(26,20,80,0.10)":"rgba(255,255,255,0.08)"}>
        {isEarned&&<div style={{position:"absolute",top:10,right:10,width:18,height:18,borderRadius:"50%",background:"#34d399",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <i className="fa-solid fa-check" style={{fontSize:8,color:"#0d0d14"}}/>
        </div>}
        <div style={{width:42,height:42,borderRadius:12,background:`${badge.color}22`,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:11,fontSize:18}}>
          <i className={`fa-solid ${badge.icon}`} style={{color:badge.color}}/>
        </div>
        <div style={{fontSize:13,fontWeight:500,color:isEarned?"var(--t1)":"var(--t3)",marginBottom:4}}>{badge.name}</div>
        <div style={{fontSize:12,color:"var(--t4)",lineHeight:1.55,marginBottom:8}}>{badge.description}</div>
        {isEarned&&(
          <div style={{fontSize:11,color:"#34d399",display:"flex",alignItems:"center",gap:4}}>
            <i className="fa-solid fa-circle-check" style={{fontSize:10}}/>
            earned {new Date(earnedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
            {awardedBy&&<span style={{color:"var(--t5)",marginLeft:4}}>by {awardedBy.username}</span>}
          </div>
        )}
        {inProgress&&(<>
          <div style={{height:3,background:"var(--b1)",borderRadius:3,overflow:"hidden",marginBottom:4,marginTop:8}}>
            <div style={{height:3,borderRadius:3,background:badge.color,width:progressData.pct+"%"}}/>
          </div>
          <div style={{fontSize:11,color:"var(--t5)"}}>{progressData.current_value} / {badge.trigger_threshold} · {progressData.pct}%</div>
        </>)}
        {isLocked&&progressData&&<div style={{fontSize:11,color:"var(--t5)",marginTop:8}}>0 / {badge.trigger_threshold}</div>}
        <div style={{position:"absolute",bottom:10,right:10,fontSize:9,fontWeight:500,padding:"2px 8px",borderRadius:20,textTransform:"uppercase",letterSpacing:"0.4px",background:rb,color:rc}}>{badge.rarity}</div>
      </div>
    );
  };

  const Section = ({label, items, renderItem}) => items.length===0?null:<>
    <div style={{fontSize:11,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.8px",marginBottom:12,marginTop:20,display:"flex",alignItems:"center",gap:8}}>
      {label}<div style={{flex:1,height:"0.5px",background:"var(--b1)"}}/>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:8}}>
      {items.map(renderItem)}
    </div>
  </>;

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"22px 28px 0",borderBottom:"0.5px solid var(--b1)",flexShrink:0}}>
        <div style={{marginBottom:14}}>
          <div style={{fontSize:20,fontWeight:600,color:"var(--t1)",letterSpacing:-0.3,marginBottom:3}}>Badges</div>
          <div style={{fontSize:13,color:"var(--t4)"}}>Earn badges by participating, writing, and contributing to the community.</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:14,flexWrap:"wrap"}}>
          {["all","earned","progress","locked"].map(f=>(
            <button key={f} onClick={()=>setFilter(f)}
              style={{fontSize:12,padding:"5px 14px",borderRadius:20,border:`0.5px solid ${filter===f?"var(--ac-border)":"var(--b2)"}`,background:filter===f?"var(--ac-bg)":"transparent",color:filter===f?"var(--ac-text)":"var(--t4)",cursor:"pointer",fontFamily:"inherit"}}>
              {f==="all"?"all badges":f==="progress"?"in progress":f}
            </button>
          ))}
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"0 28px 32px"}}>
        {currentUser&&<div style={{background:"var(--ac-bg)",border:"0.5px solid var(--ac-border)",borderRadius:14,padding:"16px 20px",margin:"20px 0 8px",display:"flex",alignItems:"center",gap:16}}>
          <div style={{width:40,height:40,borderRadius:12,background:"var(--ac-bg)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <i className="fa-solid fa-medal" style={{color:"var(--ac)",fontSize:18}}/>
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:500,color:"var(--t1)",marginBottom:5}}>your badge collection</div>
            <div style={{height:4,background:"var(--b1)",borderRadius:4,overflow:"hidden",marginBottom:4}}>
              <div style={{height:4,background:"var(--ac)",borderRadius:4,width:progressPct+"%"}}/>
            </div>
            <div style={{fontSize:11,color:"var(--t5)"}}>{earnedCount} earned · {progressBadges.length} in progress · {lockedBadges.length} locked</div>
          </div>
          <div style={{fontSize:22,fontWeight:600,color:"var(--ac)",letterSpacing:-0.5,lineHeight:1,flexShrink:0}}>
            {earnedCount} <span style={{fontSize:13,color:"var(--t5)",fontWeight:400}}>/ {totalBadges}</span>
          </div>
        </div>}
        {showEarned&&<Section label="earned" items={earnedBadges} renderItem={ub=>(
          <BadgeCard key={ub.badge.id} badge={ub.badge} earnedAt={ub.awarded_at} awardedBy={ub.awarded_by}/>
        )}/>}
        {showProgress&&<Section label="in progress" items={progressBadges} renderItem={p=>(
          <BadgeCard key={p.badge.id} badge={p.badge} progressData={p}/>
        )}/>}
        {showLocked&&<Section label="locked" items={lockedBadges} renderItem={p=>(
          <BadgeCard key={p.badge.id} badge={p.badge} progressData={p}/>
        )}/>}
        {!currentUser&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:20}}>
          {(data.badges||[]).map(b=>(<BadgeCard key={b.id} badge={b}/>))}
        </div>}
        {currentUser&&earnedBadges.length===0&&progressBadges.length===0&&lockedBadges.length===0&&(
          <div style={{textAlign:"center",padding:"60px 0",color:"var(--t5)"}}>
            <i className="fa-solid fa-medal" style={{fontSize:28,opacity:.3,marginBottom:12,display:"block"}}/>
            No badges defined yet
          </div>
        )}
      </div>
    </div>
  );
}

// ── Admin badges panel ────────────────────────────────────────────────────────
const TRIGGER_TYPE_LABELS = {
  post_count:         "Posts created",
  reply_count:        "Replies posted",
  reactions_received: "Reactions received",
  reactions_given:    "Reactions given",
  streak_days:        "Consecutive login days",
  account_age_days:   "Account age (days)",
  spaces_covered:     "Distinct spaces posted in",
};

const BLANK_BADGE = {name:"",description:"",icon:"fa-medal",color:"#a78bfa",rarity:"common",award_type:"auto",trigger_type:"post_count",trigger_threshold:""};

function AdminBadgesPanel() {
  const [badges,  setBadges]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form,    setForm]    = useState(BLANK_BADGE);
  const [saving,  setSaving]  = useState(false);
  const [holders, setHolders] = useState(null);
  const [awardTarget, setAwardTarget] = useState(null);
  const [awardUsername, setAwardUsername] = useState("");
  const [awarding, setAwarding] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  const load = () => api.get("/admin/badges").then(d=>{ setBadges(d.badges||[]); setLoading(false); });
  useEffect(()=>{ load(); },[]);

  const openNew  = ()=>{ setForm({...BLANK_BADGE}); setEditing("new"); };
  const openEdit = b=>{ setForm({...b, trigger_threshold: b.trigger_threshold||""}); setEditing(b); };
  const closeEdit= ()=>{ setEditing(null); };

  const save = async()=>{
    setSaving(true);
    const attrs = {...form, trigger_threshold: form.trigger_threshold===""?null:parseInt(form.trigger_threshold)||null};
    if(form.award_type==="manual"){attrs.trigger_type=null;attrs.trigger_threshold=null;}
    const res = editing==="new"
      ? await api.post("/admin/badges", attrs)
      : await api.patch(`/admin/badges/${editing.id}`, attrs);
    setSaving(false);
    if(res.badge){ load(); closeEdit(); toast(editing==="new"?"Badge created":"Badge updated"); }
    else toast(res.error||JSON.stringify(res.errors)||"Failed","err");
  };

  const del = async(b)=>{
    if(!confirm(`Delete badge "${b.name}"? This will also remove it from all users.`))return;
    await api.delete(`/admin/badges/${b.id}`);
    load(); toast("Badge deleted");
  };

  const installPresets = async()=>{
    setInstalling(true);
    const res = await api.post("/admin/badges/install-presets",{});
    setInstalling(false);
    if(res.ok){ load(); toast(`${res.installed} preset${res.installed===1?"":"s"} installed`); }
    else toast(res.error||"Failed","err");
  };

  const backfill = async()=>{
    if(!confirm("This will check every member against all auto badges and award any they qualify for. For large communities this may take a while. Continue?"))return;
    setBackfilling(true);
    const res = await api.post("/admin/badges/backfill",{});
    setBackfilling(false);
    if(res.ok) toast(`Backfill started — ${res.enqueued} member${res.enqueued===1?"":"s"} queued`);
    else toast(res.error||"Failed","err");
  };

  const openHolders = async(b)=>{
    const d = await api.get(`/admin/badges/${b.id}/holders`);
    setHolders({badge:b, list:d.holders||[]});
  };

  const openAward = b=>{ setAwardTarget(b); setAwardUsername(""); };

  const submitAward = async()=>{
    if(!awardUsername.trim())return;
    setAwarding(true);
    const res = await api.post(`/admin/badges/${awardTarget.id}/award`,{username:awardUsername.trim()});
    setAwarding(false);
    if(res.ok){ setAwardTarget(null); load(); toast(`Badge awarded to ${awardUsername.trim()}`); }
    else toast(res.error||"Failed","err");
  };

  const revoke = async(badgeId, userId, username)=>{
    if(!confirm(`Revoke this badge from ${username}?`))return;
    const res = await api.delete(`/admin/badges/${badgeId}/revoke/${userId}`);
    if(res.ok){ openHolders({id:badgeId}); toast("Badge revoked"); }
    else toast(res.error||"Failed","err");
  };

  const fi = {width:"100%",background:"var(--s1)",border:"0.5px solid var(--b2)",borderRadius:8,padding:"8px 12px",fontSize:13,color:"var(--t2)",fontFamily:"inherit",outline:"none",boxSizing:"border-box"};
  const presetCount = badges.filter(b=>b.is_preset).length;
  const totalPresets = 16;

  if(loading) return <div style={{padding:"40px 0",textAlign:"center",color:"var(--t5)"}}>Loading…</div>;

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20,flexWrap:"wrap"}}>
        <div style={{flex:1}}>
          <div style={{fontSize:18,fontWeight:600,color:"var(--t1)",letterSpacing:-0.3}}>Badges</div>
          <div style={{fontSize:12,color:"var(--t4)",marginTop:2}}>{badges.length} badge{badges.length!==1?"s":""} defined</div>
        </div>
        {presetCount<totalPresets&&(
          <button className="btn-ghost" style={{fontSize:12,display:"flex",alignItems:"center",gap:6}} onClick={installPresets} disabled={installing}>
            <i className="fa-solid fa-download" style={{fontSize:11}}/>{installing?"Installing…":`Install presets (${totalPresets-presetCount} available)`}
          </button>
        )}
        <button className="btn-ghost" style={{fontSize:12,display:"flex",alignItems:"center",gap:6}} onClick={backfill} disabled={backfilling}>
          <i className="fa-solid fa-rotate" style={{fontSize:11}}/>{backfilling?"Backfilling…":"Backfill existing members"}
        </button>
        <button className="btn-primary" style={{fontSize:12,padding:"7px 16px",display:"flex",alignItems:"center",gap:6}} onClick={openNew}>
          <i className="fa-solid fa-plus" style={{fontSize:11}}/>New badge
        </button>
      </div>

      {badges.length===0
        ? <div style={{textAlign:"center",padding:"48px 0",color:"var(--t5)"}}>
            <i className="fa-solid fa-medal" style={{fontSize:28,opacity:.3,marginBottom:12,display:"block"}}/>
            No badges yet. Create one or install presets.
          </div>
        : <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {badges.map(b=>{
              const rc=RARITY_COLOR[b.rarity]||"var(--t5)";
              const rb=RARITY_BG[b.rarity]||"rgba(255,255,255,0.06)";
              return (
                <div key={b.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:"var(--s1)",border:"0.5px solid var(--b1)",borderRadius:12}}>
                  <div style={{width:36,height:36,borderRadius:10,background:`${b.color}22`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <i className={`fa-solid ${b.icon}`} style={{color:b.color,fontSize:16}}/>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div className="badge-row-pills" style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
                      <span style={{fontSize:13,fontWeight:500,color:"var(--t1)"}}>{b.name}</span>
                      <span style={{fontSize:9,fontWeight:500,padding:"2px 7px",borderRadius:20,textTransform:"uppercase",letterSpacing:"0.4px",background:rb,color:rc}}>{b.rarity}</span>
                      <span style={{fontSize:10,padding:"1px 7px",borderRadius:20,background:b.award_type==="auto"?"rgba(52,211,153,0.1)":"rgba(96,165,250,0.1)",color:b.award_type==="auto"?"#34d399":"#93c5fd",border:`0.5px solid ${b.award_type==="auto"?"rgba(52,211,153,0.2)":"rgba(96,165,250,0.2)"}`}}>
                        {b.award_type==="auto"?"auto":"manual"}
                      </span>
                      {b.is_preset&&<span style={{fontSize:10,color:"var(--t5)",opacity:0.6}}>preset</span>}
                    </div>
                    <div style={{fontSize:11,color:"var(--t5)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                      {b.award_type==="auto"
                        ? `${TRIGGER_TYPE_LABELS[b.trigger_type]||b.trigger_type} ≥ ${b.trigger_threshold}`
                        : "Manually awarded"}
                      {" · "}{b.holder_count} holder{b.holder_count!==1?"s":""}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6,flexShrink:0}}>
                    <button className="btn-ghost" style={{fontSize:11,padding:"4px 10px"}} onClick={()=>openHolders(b)}>holders</button>
                    {b.award_type==="manual"&&<button className="btn-ghost" style={{fontSize:11,padding:"4px 10px"}} onClick={()=>openAward(b)}>award</button>}
                    <button className="btn-ghost" style={{fontSize:11,padding:"4px 10px"}} onClick={()=>openEdit(b)}>edit</button>
                    <button className="btn-ghost" style={{fontSize:11,padding:"4px 10px",color:"var(--red)"}} onClick={()=>del(b)}>delete</button>
                  </div>
                </div>
              );
            })}
          </div>
      }

      {editing&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,padding:20}} onClick={e=>e.target===e.currentTarget&&closeEdit()}>
          <div style={{width:"100%",maxWidth:480,background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:16,padding:28,maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{fontSize:16,fontWeight:600,color:"var(--t1)",marginBottom:20}}>{editing==="new"?"New badge":"Edit badge"}</div>
            <div style={{marginBottom:16}}>
              <div style={{fontSize:11,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:6}}>Name</div>
              <input style={fi} value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="Badge name"/>
            </div>
            <div style={{marginBottom:16}}>
              <div style={{fontSize:11,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:6}}>Description</div>
              <textarea style={{...fi,resize:"vertical",minHeight:72}} value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} placeholder="What does a member need to do to earn this?"/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div style={{marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:6}}>Icon (Font Awesome class)</div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <input style={{...fi,flex:1}} value={form.icon} onChange={e=>setForm(p=>({...p,icon:e.target.value.trim()}))} placeholder="fa-medal"/>
                  <div style={{width:34,height:34,borderRadius:8,background:`${form.color}22`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <i className={`fa-solid ${form.icon||"fa-medal"}`} style={{color:form.color,fontSize:16}}/>
                  </div>
                </div>
              </div>
              <div style={{marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:6}}>Color</div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <input type="color" value={form.color} onChange={e=>setForm(p=>({...p,color:e.target.value}))} style={{width:36,height:36,borderRadius:8,border:"0.5px solid var(--b2)",padding:2,background:"var(--s1)",cursor:"pointer",flexShrink:0}}/>
                  <input style={{...fi,flex:1}} value={form.color} onChange={e=>setForm(p=>({...p,color:e.target.value}))} placeholder="#a78bfa"/>
                </div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div style={{marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:6}}>Rarity</div>
                <Select style={fi} value={form.rarity} onChange={v=>setForm(p=>({...p,rarity:v}))}>
                  {["common","rare","epic","legendary"].map(r=><option key={r} value={r}>{r}</option>)}
                </Select>
              </div>
              <div style={{marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:6}}>Award type</div>
                <Select style={fi} value={form.award_type} onChange={v=>setForm(p=>({...p,award_type:v}))}>
                  <option value="auto">Automatic</option>
                  <option value="manual">Manual</option>
                </Select>
              </div>
            </div>
            {form.award_type==="auto"&&<>
              <div style={{marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:6}}>Trigger condition</div>
                <Select style={fi} value={form.trigger_type} onChange={v=>setForm(p=>({...p,trigger_type:v}))}>
                  {Object.entries(TRIGGER_TYPE_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                </Select>
              </div>
              <div style={{marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:6}}>Threshold (must reach this value)</div>
                <input style={fi} type="number" min="1" value={form.trigger_threshold} onChange={e=>setForm(p=>({...p,trigger_threshold:e.target.value}))} placeholder="e.g. 100"/>
              </div>
            </>}
            <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:8}}>
              <button className="btn-ghost" onClick={closeEdit}>Cancel</button>
              <button className="btn-primary" style={{fontSize:13,padding:"7px 20px"}} onClick={save} disabled={saving}>{saving?"Saving…":"Save badge"}</button>
            </div>
          </div>
        </div>
      )}

      {holders&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,padding:20}} onClick={e=>e.target===e.currentTarget&&setHolders(null)}>
          <div style={{width:"100%",maxWidth:440,background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:16,padding:24,maxHeight:"80vh",overflowY:"auto"}}>
            <div style={{fontSize:15,fontWeight:600,color:"var(--t1)",marginBottom:4}}>{holders.badge.name}</div>
            <div style={{fontSize:12,color:"var(--t5)",marginBottom:16}}>{holders.list.length} holder{holders.list.length!==1?"s":""}</div>
            {holders.list.length===0
              ? <div style={{textAlign:"center",padding:"24px 0",color:"var(--t5)",fontSize:13}}>No one has earned this badge yet.</div>
              : holders.list.map((h,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"0.5px solid var(--b1)"}}>
                    <Av user={h.user} size={28} />
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,color:"var(--t2)"}}>{h.user?.username}</div>
                      <div style={{fontSize:11,color:"var(--t5)"}}>
                        {new Date(h.awarded_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                        {h.awarded_by&&<span> · by {h.awarded_by.username}</span>}
                      </div>
                    </div>
                    <button className="btn-ghost" style={{fontSize:11,color:"var(--red)",padding:"3px 8px"}} onClick={()=>revoke(holders.badge.id,h.user.id,h.user.username)}>revoke</button>
                  </div>
                ))
            }
            <div style={{display:"flex",justifyContent:"flex-end",marginTop:16}}>
              <button className="btn-ghost" onClick={()=>setHolders(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {awardTarget&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,padding:20}} onClick={e=>e.target===e.currentTarget&&setAwardTarget(null)}>
          <div style={{width:"100%",maxWidth:360,background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:16,padding:24}}>
            <div style={{fontSize:15,fontWeight:600,color:"var(--t1)",marginBottom:4}}>Award badge</div>
            <div style={{fontSize:12,color:"var(--t5)",marginBottom:16}}>Manually award <strong style={{color:"var(--t3)"}}>{awardTarget.name}</strong> to a user.</div>
            <input style={{...fi,marginBottom:16}} value={awardUsername} onChange={e=>setAwardUsername(e.target.value)} placeholder="Username" autoFocus onKeyDown={e=>e.key==="Enter"&&submitAward()}/>
            <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
              <button className="btn-ghost" onClick={()=>setAwardTarget(null)}>Cancel</button>
              <button className="btn-primary" style={{fontSize:13,padding:"7px 20px"}} onClick={submitAward} disabled={awarding||!awardUsername.trim()}>{awarding?"Awarding…":"Award"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Exports ──────────────────────────────────────────────────────────────────
export { RARITY_COLOR, RARITY_BG, RARITY_WEIGHT, TRIGGER_TYPE_LABELS, BLANK_BADGE,
         BadgesPageSidebar, BadgesPage, AdminBadgesPanel };
