import { useState, useEffect, useRef } from "react";
import { api } from "../lib/api";
import { RsAv } from "./Avatar";

// ── Reactions ─────────────────────────────────────────────────────────────────

export const REACTIONS = [
  {emoji:"❤️", label:"Love"},
  {emoji:"👍", label:"Like"},
  {emoji:"😂", label:"Haha"},
  {emoji:"😲", label:"Wow"},
  {emoji:"😭", label:"Sad"},
  {emoji:"🔥", label:"Fire"},
  {emoji:"🎉", label:"Celebrate"},
  {emoji:"👀", label:"Eyes"},
];

// ── Reactions Modal ───────────────────────────────────────────────────────────
// Full-screen modal showing who reacted with which emoji.
// Triggered by clicking the reaction count on a post or reply.
export function ReactionsModal({postId, replyId, onClose}) {
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState("all");
  const ref = useRef();

  useEffect(() => {
    const url = postId ? `/posts/${postId}/reactions` : `/replies/${replyId}/reactions`;
    api.get(url).then(d => {
      if (d && Array.isArray(d.groups)) setData(d);
      else setData({total: 0, groups: []});
    }).catch(() => setData({total: 0, groups: []}));
  }, [postId, replyId]);

  useEffect(() => {
    const fn = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  useEffect(() => {
    const fn = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, []);

  const visibleUsers = !data ? [] :
    activeTab === "all"
      ? data.groups.flatMap(g => g.users.map(u => ({...u, emoji: g.emoji})))
      : (data.groups.find(g => g.emoji === activeTab)?.users || []).map(u => ({...u, emoji: activeTab}));

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div ref={ref} style={{background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:16,width:"100%",maxWidth:420,maxHeight:"80vh",display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 16px 64px rgba(0,0,0,.6)"}}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 18px 0"}}>
          <div style={{fontWeight:600,fontSize:15,color:"var(--t1)"}}>
            Reactions {data && <span style={{fontWeight:400,fontSize:13,color:"var(--t4)",marginLeft:6}}>{data.total}</span>}
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"var(--t4)",cursor:"pointer",fontSize:18,lineHeight:1,padding:4}}>
            <i className="fa-solid fa-xmark"/>
          </button>
        </div>

        {/* Emoji tabs */}
        {data && data.groups.length > 0 && (
          <div style={{display:"flex",gap:4,padding:"12px 18px 0",overflowX:"auto",flexShrink:0}}>
            <button
              onClick={() => setActiveTab("all")}
              style={{flexShrink:0,padding:"5px 12px",borderRadius:20,border:"0.5px solid",fontSize:12,cursor:"pointer",fontFamily:"inherit",
                borderColor: activeTab==="all" ? "var(--ac-border)" : "var(--b2)",
                background:  activeTab==="all" ? "var(--ac-bg)"    : "transparent",
                color:       activeTab==="all" ? "var(--ac-text)"  : "var(--t3)"}}>
              All <span style={{opacity:.6}}>{data.total}</span>
            </button>
            {data.groups.map(g => (
              <button key={g.emoji}
                onClick={() => setActiveTab(g.emoji)}
                style={{flexShrink:0,padding:"5px 10px",borderRadius:20,border:"0.5px solid",fontSize:13,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:5,
                  borderColor: activeTab===g.emoji ? "var(--ac-border)" : "var(--b2)",
                  background:  activeTab===g.emoji ? "var(--ac-bg)"    : "transparent",
                  color:       activeTab===g.emoji ? "var(--ac-text)"  : "var(--t3)"}}>
                <span style={{fontSize:16,lineHeight:1}}>{g.emoji}</span>
                <span style={{opacity:.7}}>{g.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* User list */}
        <div style={{overflowY:"auto",flex:1,padding:"10px 18px 18px"}}>
          {!data ? (
            <div style={{display:"flex",justifyContent:"center",padding:"32px 0"}}>
              <div style={{width:20,height:20,border:"2px solid var(--b2)",borderTopColor:"var(--ac)",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
            </div>
          ) : data.total === 0 ? (
            <div style={{textAlign:"center",color:"var(--t5)",fontSize:13,padding:"32px 0"}}>No reactions yet</div>
          ) : visibleUsers.length === 0 ? (
            <div style={{textAlign:"center",color:"var(--t5)",fontSize:13,padding:"32px 0"}}>No reactions with this emoji</div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:2,marginTop:8}}>
              {visibleUsers.map((u, i) => (
                <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 4px",borderRadius:8}}>
                  <RsAv user={u} size={32} noCard />
                  <span style={{fontSize:13,color:"var(--t2)",fontWeight:500,flex:1}}>{u.username}</span>
                  {activeTab === "all" && <span style={{fontSize:18,lineHeight:1}}>{u.emoji}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ReactionButton ─────────────────────────────────────────────────────────────
// The emoji picker trigger + reaction count pills shown on every post and reply.
export function ReactionButton({postId, replyId, initialReactions=[], initialUserReaction=null, currentUser, authorId=null, onAuthRequired}) {
  const [open, setOpen] = useState(false);
  const [postCfgLoaded, setPostCfgLoaded] = useState(!!window._postCfg);
  useEffect(()=>{
    if(window._postCfg){ setPostCfgLoaded(true); return; }
    const t = setInterval(()=>{ if(window._postCfg){ setPostCfgLoaded(true); clearInterval(t); } }, 100);
    return ()=>clearInterval(t);
  },[]);
  const [reactions, setReactions] = useState(initialReactions);
  const [userReaction, setUserReaction] = useState(initialUserReaction);
  const ref = useRef();

  useEffect(()=>{ setReactions(initialReactions); },[JSON.stringify(initialReactions)]);
  useEffect(()=>{ setUserReaction(initialUserReaction); },[initialUserReaction]);

  useEffect(()=>{
    if(!open) return;
    const fn=e=>{ if(ref.current&&!ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown",fn);
    return ()=>document.removeEventListener("mousedown",fn);
  },[open]);

  const react = async(emoji) => {
    if(!currentUser){ onAuthRequired?.("login"); setOpen(false); return; }
    setOpen(false);
    const body = {emoji, ...(postId?{post_id:postId}:{reply_id:replyId})};
    if(userReaction===emoji){
      const d = await api.delete("/reactions", body);
      if(d.ok){ setReactions(d.reactions||[]); setUserReaction(null); }
    } else {
      const d = await api.post("/reactions", body);
      if(d.ok){ setReactions(d.reactions||[]); setUserReaction(d.user_reaction); }
    }
  };

  const totalCount = reactions.reduce((s,r)=>s+(r.count||0),0);
  const isSelf = currentUser && authorId && currentUser.id === authorId;
  const selfReactionsAllowed = postCfgLoaded ? window._postCfg.allow_self_reactions !== false : false;
  const canReact = !isSelf || selfReactionsAllowed;

  return (
    <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
      {canReact && <div className={`rx-trigger ${userReaction?"reacted":""}`} ref={ref} onClick={()=>setOpen(p=>!p)}>
        {userReaction
          ? <span style={{fontSize:16,lineHeight:1}}>{userReaction}</span>
          : <i className="fa-solid fa-heart" style={{fontSize:14,color:"inherit"}}/>}
        {totalCount>0&&<span>{totalCount}</span>}
        {open&&(
          <div className="rx-picker" onClick={e=>e.stopPropagation()}>
            {REACTIONS.map(({emoji,label})=>(
              <div key={emoji} className={`rx-pick-btn ${userReaction===emoji?"selected":""}`}
                title={label} onClick={e=>{e.stopPropagation();react(emoji);}}>
                {emoji}
              </div>
            ))}
          </div>
        )}
      </div>}
      {reactions.filter(r=>r.count>0).map(r=>(
        <div key={r.emoji} className={`rx-pill ${userReaction===r.emoji?"mine":""}`}
          onClick={()=>react(r.emoji)} title={REACTIONS.find(x=>x.emoji===r.emoji)?.label||r.emoji}>
          <span style={{fontSize:14}}>{r.emoji}</span>
          <span>{r.count}</span>
        </div>
      ))}
    </div>
  );
}
