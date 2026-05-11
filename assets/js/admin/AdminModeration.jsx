import { useState, useEffect, useRef } from "react";
import { api } from "../lib/api";
import { ago, fmtDate } from "../lib/utils";
import { toast } from "../components/Toasts";
import { Select } from "../components/Select";
import { RsAv, Av } from "../components/Avatar";
import { Md } from "../components/Markdown";

// ── ReportCard, ModerationPage, AdminModerationPanel ─────────────────────────

// ── Shared report card component ─────────────────────────────────────────────
function ReportCard({r, onAction, isAdmin}) {
  const urgent = r.status === "pending" && (r._count || 1) >= 3;
  const resolved = r.status !== "pending";
  const typeColor = {post:"#f87171", reply:"#93c5fd", user:"#fbbf24"}[r.content_type] || "var(--t4)";
  const typeBg = {post:"rgba(248,113,113,0.15)", reply:"rgba(96,165,250,0.12)", user:"rgba(251,191,36,0.12)"}[r.content_type] || "rgba(255,255,255,0.06)";

  return (
    <div style={{background:urgent?"rgba(248,113,113,0.03)":"rgba(255,255,255,0.025)",
      border:`0.5px solid ${urgent?"rgba(248,113,113,0.25)":resolved?"var(--b1)":"rgba(255,255,255,0.07)"}`,
      borderRadius:12,padding:"14px 16px",marginBottom:10,display:"flex",gap:14,
      alignItems:"flex-start",opacity:resolved?0.55:1}}>
      <div style={{flex:1,minWidth:0}}>
        {/* Header row — type badge + reason */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
          {resolved
            ? <span style={{fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:20,background:"rgba(52,211,153,0.1)",color:"#34d399",textTransform:"uppercase",letterSpacing:"0.4px"}}>resolved</span>
            : <span style={{fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:20,background:typeBg,color:typeColor,textTransform:"uppercase",letterSpacing:"0.4px"}}>{r.content_type}</span>
          }
          <span style={{fontSize:13,fontWeight:500,color:"var(--t2)"}}>{r.reason}</span>
        </div>

        {/* Post title if available */}
        {r.post_title&&(
          <div style={{fontSize:13,fontWeight:500,color:"var(--t2)",marginBottom:6}}>
            {r.post_title}
          </div>
        )}

        {/* Content excerpt — the actual text being reported */}
        {r.excerpt&&(
          <div style={{fontSize:13,color:"var(--t3)",lineHeight:1.6,marginBottom:8,
            background:"var(--s2)",border:"0.5px solid var(--b1)",
            borderRadius:8,padding:"8px 12px",fontStyle:"italic"}}>
            {r.excerpt.length > 240 ? r.excerpt.slice(0,240)+"…" : r.excerpt}
          </div>
        )}

        {/* Reporter's additional notes */}
        {r.notes&&(
          <div style={{fontSize:12,color:"var(--t4)",lineHeight:1.55,marginBottom:8,
            display:"flex",alignItems:"flex-start",gap:6}}>
            <i className="fa-solid fa-comment-dots" style={{fontSize:10,color:"var(--t5)",marginTop:2,flexShrink:0}}/>
            <span style={{fontStyle:"italic"}}>{r.notes}</span>
          </div>
        )}

        {/* Meta row — author, space, reporter, time */}
        <div style={{display:"flex",alignItems:"center",gap:8,fontSize:11,color:"var(--t5)",flexWrap:"wrap"}}>
          {r.content_user&&<>
            <div style={{width:18,height:18,borderRadius:5,background:"var(--ac)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,fontWeight:500,color:"var(--ac-on)",flexShrink:0}}>
              {(r.content_user.username||"?").slice(0,2).toUpperCase()}
            </div>
            <span>by {r.content_user.username}</span>
            <span>·</span>
          </>}
          {r.space_name&&<><span>in {r.space_name}</span><span>·</span></>}
          <span>reported by {r.reporter?.username}</span>
          <span>·</span>
          <span>{ago(r.inserted_at)}</span>
          {resolved&&r.reviewer&&<><span>·</span><span>resolved by {r.reviewer.username}</span></>}
        </div>
      </div>
      {!resolved&&<div style={{display:"flex",flexDirection:"column",gap:6,flexShrink:0,alignItems:"flex-end"}}>
        <div style={{fontSize:11,color:"var(--t5)",textAlign:"center"}}>
          <span style={{display:"block",fontSize:16,fontWeight:600,color:"rgba(248,113,113,0.8)",lineHeight:1}}>{r._count||1}</span>
          report{(r._count||1)!==1?"s":""}
        </div>
        {r.post_id&&<button onClick={()=>onAction?.("view",r)} style={{fontSize:11,fontWeight:500,padding:"5px 13px",borderRadius:20,cursor:"pointer",background:"rgba(167,139,250,0.15)",color:"#c4b5fd",border:"0.5px solid rgba(167,139,250,0.25)"}}>view post</button>}
        <button onClick={()=>onAction?.("remove",r)} style={{fontSize:11,fontWeight:500,padding:"5px 13px",borderRadius:20,cursor:"pointer",background:"rgba(248,113,113,0.15)",color:"#f87171",border:"0.5px solid rgba(248,113,113,0.25)"}}>remove</button>
        <button onClick={()=>onAction?.("dismiss",r)} style={{fontSize:11,fontWeight:500,padding:"5px 13px",borderRadius:20,cursor:"pointer",background:"rgba(255,255,255,0.05)",color:"var(--t4)",border:"0.5px solid var(--b1)"}}>dismiss</button>
      </div>}
      {resolved&&<div style={{fontSize:11,color:"var(--t5)",textAlign:"center",flexShrink:0}}>
        <span style={{display:"block",fontSize:16,color:"rgba(52,211,153,0.7)",lineHeight:1}}>✓</span>done
      </div>}
    </div>
  );
}

// ── Forum-facing ModerationPage (mods + admins, no audit log) ─────────────────
function ModerationPage({currentUser, navigate}) {
  const [tab, setTab] = useState("reports");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [sort, setSort] = useState("newest");
  const [reports, setReports] = useState([]);
  const [hidden, setHidden] = useState([]);
  const [banned, setBanned] = useState([]);
  const [loading, setLoading] = useState(false);

  const isMod = currentUser?.role === "moderator" || currentUser?.role === "admin";
  if (!isMod) return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)"}}>Access denied</div>;

  const load = useCallback(async() => {
    setLoading(true);
    try {
      if (tab === "reports") {
        const d = await api.get(`/reports?status=${statusFilter}&sort=${sort}`);
        setReports(d.reports || []);
      } else if (tab === "flagged") {
        const d = await api.get("/moderation/hidden");
        setHidden(d.items || []);
      } else if (tab === "banned") {
        const d = await api.get("/admin/users?status=banned");
        setBanned(d.users || []);
      }
    } finally { setLoading(false); }
  }, [tab, statusFilter, sort]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (action, r) => {
    if (action === "view") {
      if (r.post_id) navigate("post", {id: r.post_id});
      return;
    }
    const status = action === "remove" ? "actioned" : "dismissed";
    if (action === "remove") {
      if (!confirm("Remove this content?")) return;
      if (r.post_id) await api.post(`/posts/${r.post_id}/hide`, {});
      else if (r.reply_id) await api.post(`/posts/${r.post_id}/replies/${r.reply_id}/hide`, {});
    }
    await api.patch(`/reports/${r.id}`, {status});
    setReports(p => p.map(x => x.id === r.id ? {...x, status} : x));
    toast(action === "remove" ? "Content removed" : "Report dismissed");
  };

  const pendingCount = reports.filter(r => r.status === "pending").length;
  const tabs = [
    {k:"reports",  icon:"fa-flag",              label:"reports",         badge:pendingCount, badgeColor:"red"},
    {k:"flagged",  icon:"fa-triangle-exclamation", label:"flagged posts", badge:hidden.length, badgeColor:"amber"},
    {k:"banned",   icon:"fa-user-slash",         label:"banned members", badge:null},
  ];

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* Header */}
      <div style={{padding:"22px 28px 0",borderBottom:"0.5px solid var(--b1)",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:4}}>
          <div>
            <div style={{fontSize:20,fontWeight:600,color:"var(--t1)",letterSpacing:-0.3}}>Moderation</div>
            <div style={{fontSize:13,color:"var(--t4)",marginBottom:14}}>Review reports and flagged content across all spaces.</div>
          </div>
          <div style={{fontSize:11,fontWeight:500,background:"rgba(167,139,250,0.12)",color:"#c4b5fd",border:"0.5px solid rgba(167,139,250,0.25)",borderRadius:20,padding:"4px 11px",display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
            <i className="fa-solid fa-shield-halved" style={{fontSize:10}}/>
            {currentUser?.role}
          </div>
        </div>
        <div style={{display:"flex",gap:0}}>
          {tabs.map(t=>(
            <div key={t.k} onClick={()=>setTab(t.k)}
              style={{fontSize:13,color:tab===t.k?"var(--ac)":"var(--t4)",padding:"0 18px 12px",cursor:"pointer",
                borderBottom:`1.5px solid ${tab===t.k?"var(--ac)":"transparent"}`,marginBottom:-0.5,
                display:"flex",alignItems:"center",gap:7}}>
              <i className={`fa-solid ${t.icon}`} style={{fontSize:11}}/>
              {t.label}
              {t.badge>0&&<span style={{fontSize:10,fontWeight:500,borderRadius:20,padding:"1px 7px",
                background:t.badgeColor==="red"?"rgba(248,113,113,0.2)":"rgba(251,191,36,0.15)",
                color:t.badgeColor==="red"?"#f87171":"#fbbf24"}}>{t.badge}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Body */}
      <div style={{flex:1,overflowY:"auto",padding:"20px 28px"}}>
        {tab==="reports"&&<>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,flexWrap:"wrap"}}>
            {["pending","actioned","dismissed"].map(s=>(
              <div key={s} onClick={()=>setStatusFilter(s)}
                style={{fontSize:11,padding:"5px 13px",borderRadius:20,cursor:"pointer",
                  background:statusFilter===s?"rgba(167,139,250,0.1)":"transparent",
                  border:`0.5px solid ${statusFilter===s?"rgba(167,139,250,0.3)":"rgba(255,255,255,0.1)"}`,
                  color:statusFilter===s?"#c4b5fd":"var(--t4)"}}>
                {s} <span style={{opacity:0.6}}>{statusFilter===s?reports.length:""}</span>
              </div>
            ))}
            <Select value={sort} onChange={setSort}
              style={{marginLeft:"auto",fontSize:12,color:"var(--t4)",background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:8,padding:"5px 10px",fontFamily:"inherit",outline:"none"}}>
              <option value="newest">newest first</option>
              <option value="oldest">oldest first</option>
            </Select>
          </div>
          {loading?<div style={{color:"var(--t5)",fontSize:13,padding:"20px 0"}}>Loading…</div>
            :reports.length===0?<div style={{textAlign:"center",padding:"40px 0",color:"var(--t5)",fontSize:13}}>
              <i className="fa-solid fa-check-circle" style={{fontSize:28,display:"block",marginBottom:10,opacity:0.3}}/>
              No {statusFilter} reports
            </div>
            :reports.map(r=><ReportCard key={r.id} r={r} onAction={handleAction} isAdmin={currentUser?.role==="admin"}/>)
          }
        </>}

        {tab==="flagged"&&<>
          {loading?<div style={{color:"var(--t5)",fontSize:13,padding:"20px 0"}}>Loading…</div>
            :hidden.length===0?<div style={{textAlign:"center",padding:"40px 0",color:"var(--t5)",fontSize:13}}>
              <i className="fa-solid fa-check-circle" style={{fontSize:28,display:"block",marginBottom:10,opacity:0.3}}/>
              No hidden content
            </div>
            :hidden.map((item,i)=>(
              <div key={`${item.type}-${item.id}`} style={{background:"rgba(255,255,255,0.025)",border:"0.5px solid var(--b1)",borderRadius:12,padding:"14px 16px",marginBottom:10,display:"flex",gap:14,alignItems:"flex-start"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",gap:8,marginBottom:6,alignItems:"center"}}>
                    <span style={{fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:20,textTransform:"uppercase",letterSpacing:"0.4px",
                      background:item.type==="post"?"rgba(248,113,113,0.15)":"rgba(96,165,250,0.12)",
                      color:item.type==="post"?"#f87171":"#93c5fd"}}>{item.type}</span>
                    {item.space_name&&<span style={{fontSize:11,color:"var(--t5)"}}>in {item.space_name}</span>}
                  </div>
                  <div style={{fontSize:13,color:"var(--t3)",lineHeight:1.6,fontStyle:"italic",borderLeft:"2px solid rgba(255,255,255,0.1)",paddingLeft:10,marginBottom:8}}>
                    "{item.body?.slice(0,140)}{(item.body?.length||0)>140?"…":""}"
                  </div>
                  <div style={{fontSize:11,color:"var(--t5)"}}>by {item.user?.username} · hidden {ago(item.hidden_at)}</div>
                </div>
              </div>
            ))}
        </>}

        {tab==="banned"&&<>
          {loading?<div style={{color:"var(--t5)",fontSize:13,padding:"20px 0"}}>Loading…</div>
            :banned.length===0?<div style={{textAlign:"center",padding:"40px 0",color:"var(--t5)",fontSize:13}}>
              <i className="fa-solid fa-check-circle" style={{fontSize:28,display:"block",marginBottom:10,opacity:0.3}}/>
              No banned members
            </div>
            :<div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden"}}>
              {banned.map((u,i)=>(
                <div key={u.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 16px",borderBottom:i<banned.length-1?"0.5px solid var(--b1)":"none"}}>
                  <div style={{width:32,height:32,borderRadius:`${22}%`,background:"var(--red)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:600,color:"#fff",flexShrink:0}}>
                    {(u.username||"?").slice(0,2).toUpperCase()}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:500,color:"var(--t1)"}}>{u.username}</div>
                    <div style={{fontSize:11,color:"var(--t5)"}}>{u.email}</div>
                  </div>
                  <div style={{fontSize:11,color:"var(--t5)"}}>banned {ago(u.updated_at||u.inserted_at)}</div>
                  {(currentUser?.role==="admin")&&<span style={{fontSize:11,color:"var(--green)",cursor:"pointer",marginLeft:8}}
                    onClick={async()=>{await api.delete(`/moderation/users/${u.username}/ban`);setBanned(p=>p.filter(x=>x.id!==u.id));toast("User unbanned");}}>
                    unban
                  </span>}
                </div>
              ))}
            </div>}
        </>}
      </div>
    </div>
  );
}

function AdminModerationPanel({reports, setReports, modLogs, users, setUsers, currentUser, navigate}) {
  const [tab, setTab] = useState("reports");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [sort, setSort] = useState("newest");
  const [hidden, setHidden] = useState([]);
  const [loadingHidden, setLoadingHidden] = useState(false);

  useEffect(()=>{
    if(tab==="flagged"&&hidden.length===0){
      setLoadingHidden(true);
      api.get("/moderation/hidden").then(d=>{setHidden(d.items||[]);}).finally(()=>setLoadingHidden(false));
    }
  },[tab]);

  const filtered = reports.filter(r=>statusFilter==="all"?true:r.status===statusFilter);
  const sorted = [...filtered].sort((a,b)=>sort==="oldest"
    ?new Date(a.inserted_at)-new Date(b.inserted_at)
    :new Date(b.inserted_at)-new Date(a.inserted_at));

  const pendingCount = reports.filter(r=>r.status==="pending").length;
  const bannedUsers = users.filter(u=>u.status==="banned");

  const handleAction = async(action, r) => {
    if(action==="view"){if(r.post_id)navigate("post",{id:r.post_id});return;}
    const status = action==="remove"?"actioned":"dismissed";
    if(action==="remove"){
      if(!confirm("Remove this content?"))return;
      if(r.post_id) await api.post(`/posts/${r.post_id}/hide`,{});
    }
    await api.patch(`/reports/${r.id}`,{status});
    setReports(p=>p.map(x=>x.id===r.id?{...x,status}:x));
    toast(action==="remove"?"Content removed":"Report dismissed");
  };

  const tabs = [
    {k:"reports",  icon:"fa-flag",              label:"reports",      badge:pendingCount},
    {k:"flagged",  icon:"fa-triangle-exclamation",label:"flagged posts",badge:null},
    {k:"banned",   icon:"fa-user-slash",         label:"banned members",badge:bannedUsers.length||null},
    {k:"audit",    icon:"fa-clock-rotate-left",  label:"audit log",   badge:null},
  ];

  return (
    <div>
      <div style={{display:"flex",gap:0,borderBottom:"0.5px solid var(--b1)",marginBottom:20}}>
        {tabs.map(t=>(
          <div key={t.k} onClick={()=>setTab(t.k)}
            style={{fontSize:13,color:tab===t.k?"var(--ac)":"var(--t4)",padding:"0 16px 10px",cursor:"pointer",
              borderBottom:`1.5px solid ${tab===t.k?"var(--ac)":"transparent"}`,marginBottom:-0.5,
              display:"flex",alignItems:"center",gap:6}}>
            <i className={`fa-solid ${t.icon}`} style={{fontSize:11}}/>
            {t.label}
            {t.badge>0&&<span style={{fontSize:10,fontWeight:500,borderRadius:20,padding:"1px 6px",background:"rgba(248,113,113,0.2)",color:"#f87171"}}>{t.badge}</span>}
          </div>
        ))}
      </div>

      {tab==="reports"&&<>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,flexWrap:"wrap"}}>
          {["pending","actioned","dismissed"].map(s=>(
            <div key={s} onClick={()=>setStatusFilter(s)}
              style={{fontSize:11,padding:"5px 13px",borderRadius:20,cursor:"pointer",
                background:statusFilter===s?"rgba(167,139,250,0.1)":"transparent",
                border:`0.5px solid ${statusFilter===s?"rgba(167,139,250,0.3)":"rgba(255,255,255,0.1)"}`,
                color:statusFilter===s?"#c4b5fd":"var(--t4)"}}>
              {s}
            </div>
          ))}
          <Select value={sort} onChange={setSort}
            style={{marginLeft:"auto",fontSize:12,color:"var(--t4)",background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:8,padding:"5px 10px",fontFamily:"inherit",outline:"none"}}>
            <option value="newest">newest first</option>
            <option value="oldest">oldest first</option>
          </Select>
        </div>
        {sorted.length===0
          ?<div style={{padding:"24px 0",color:"var(--t5)",fontSize:13}}>✓ No {statusFilter} reports</div>
          :sorted.map(r=><ReportCard key={r.id} r={r} onAction={handleAction} isAdmin={true}/>)
        }
      </>}

      {tab==="flagged"&&<>
        {loadingHidden?<div style={{color:"var(--t5)",fontSize:13,padding:"20px 0"}}>Loading…</div>
          :hidden.length===0?<div style={{padding:"24px 0",color:"var(--t5)",fontSize:13}}>✓ No hidden content</div>
          :hidden.map(item=>(
            <div key={`${item.type}-${item.id}`} style={{background:"rgba(255,255,255,0.025)",border:"0.5px solid var(--b1)",borderRadius:12,padding:"14px 16px",marginBottom:10,display:"flex",gap:14}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",gap:8,marginBottom:6}}>
                  <span style={{fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:20,textTransform:"uppercase",
                    background:item.type==="post"?"rgba(248,113,113,0.15)":"rgba(96,165,250,0.12)",
                    color:item.type==="post"?"#f87171":"#93c5fd"}}>{item.type}</span>
                  {item.space_name&&<span style={{fontSize:11,color:"var(--t5)"}}>in {item.space_name}</span>}
                </div>
                <div style={{fontSize:13,color:"var(--t3)",lineHeight:1.6,fontStyle:"italic",borderLeft:"2px solid rgba(255,255,255,0.1)",paddingLeft:10,marginBottom:6}}>
                  "{item.body?.slice(0,160)}{(item.body?.length||0)>160?"…":""}"
                </div>
                <div style={{fontSize:11,color:"var(--t5)"}}>by {item.user?.username} · hidden {ago(item.hidden_at)}</div>
              </div>
            </div>
          ))}
      </>}

      {tab==="banned"&&<>
        {bannedUsers.length===0
          ?<div style={{padding:"24px 0",color:"var(--t5)",fontSize:13}}>✓ No banned members</div>
          :<div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden"}}>
            {bannedUsers.map((u,i)=>(
              <div key={u.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderBottom:i<bannedUsers.length-1?"0.5px solid var(--b1)":"none"}}>
                <div style={{width:30,height:30,borderRadius:"22%",background:"var(--red)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:600,color:"#fff",flexShrink:0}}>
                  {(u.username||"?").slice(0,2).toUpperCase()}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:500,color:"var(--t1)"}}>{u.username}</div>
                  <div style={{fontSize:11,color:"var(--t5)"}}>{u.email}</div>
                </div>
                <div style={{fontSize:11,color:"var(--t5)"}}>joined {fmtDate(u.inserted_at)}</div>
                <span style={{fontSize:11,color:"var(--green)",cursor:"pointer"}}
                  onClick={async()=>{await api.delete(`/moderation/users/${u.username}/ban`);setUsers(p=>p.map(x=>x.id===u.id?{...x,status:"active"}:x));toast("User unbanned");}}>
                  unban
                </span>
              </div>
            ))}
          </div>}
      </>}

      {tab==="audit"&&<>
        <div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden"}}>
          {modLogs.length===0
            ?<div style={{padding:"16px 14px",color:"var(--t5)",fontSize:13}}>No actions yet</div>
            :modLogs.slice(0,50).map(l=>(
              <div key={l.id} style={{display:"flex",alignItems:"baseline",gap:10,padding:"9px 14px",borderBottom:"0.5px solid var(--b1)"}}>
                <div style={{fontSize:11,color:"var(--t5)",minWidth:70,flexShrink:0}}>{ago(l.inserted_at)}</div>
                <div style={{fontSize:12,color:"var(--ac-text)",minWidth:90,flexShrink:0}}>{l.moderator?.username}</div>
                <div style={{fontSize:12,color:"var(--t3)",flex:1}}>{l.action}{l.reason&&` — ${l.reason}`}</div>
                {l.target_user&&<div style={{fontSize:11,color:"var(--t5)",flexShrink:0}}>→ {l.target_user.username}</div>}
              </div>
            ))}
        </div>
      </>}
    </div>
  );
}



// ── Exports ──────────────────────────────────────────────────────────────────
export { ReportCard, ModerationPage, AdminModerationPanel };
