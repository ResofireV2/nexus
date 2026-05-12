import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { ago, userColor, spaceColor } from "../lib/utils";
import { RsAv } from "../components/Avatar";
import { Md } from "../components/Markdown";

// ── SearchPage ────────────────────────────────────────────────────────────────

function SearchPage({navigate, tags, initialQ=""}) {
  const [q,setQ]=useState(initialQ); const [results,setResults]=useState(null); const [loading,setLoading]=useState(false);
  const debounceRef=useRef();
  const search=useCallback(async(val)=>{
    if(!val.trim()){setResults(null);return;}
    setLoading(true);
    try{const d=await api.get(`/search?q=${encodeURIComponent(val)}`);setResults(d);}
    finally{setLoading(false);}
  },[]);
  const onChange=e=>{
    const val=e.target.value; setQ(val);
    clearTimeout(debounceRef.current);
    if(!val.trim()){setResults(null);return;}
    debounceRef.current=setTimeout(()=>search(val),300);
  };
  useEffect(()=>{if(initialQ)search(initialQ);},[]);
  const hasResults = results && ((results.posts?.length||0) + (results.replies?.length||0)) > 0;
  return (
    <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
      <div style={{height:48,borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"center",padding:"0 24px",flexShrink:0}}>
        <span style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>Search</span>
      </div>
      <div className="search-wrap">
        <div className="search-bar">
          <i className="fa-solid fa-magnifying-glass" style={{fontSize:14,color:loading?"var(--ac)":"rgba(255,255,255,0.25)",transition:"color .2s",flexShrink:0}}></i>
          <input className="fi" style={{flex:1,border:"none",background:"transparent",paddingLeft:0}} placeholder="Search threads and replies…" value={q} onChange={onChange} autoFocus/>
          {loading&&<span style={{fontSize:12,color:"var(--t5)",flexShrink:0}}>searching…</span>}
        </div>
        {loading&&<div style={{textAlign:"center",color:"var(--t5)",padding:"40px 0"}}>Searching…</div>}
        {results&&!hasResults&&<div style={{textAlign:"center",color:"var(--t5)",padding:"40px 0"}}>No results for "{q}"</div>}
        {hasResults&&<>
          {results.posts?.length>0&&<>
            <div style={{fontSize:10,fontWeight:500,color:"var(--t5)",letterSpacing:".07em",textTransform:"uppercase",padding:"14px 0 8px"}}>Threads</div>
            {results.posts.map(p=>{
              const col=spaceColor(p.space||{id:p.id});
              return (
                <div key={p.id} className="thread" onClick={()=>navigate("post",{id:p.id})}>
                  <div className="thread-main">
                    <div className="thread-accent" style={{background:col}}/>
                    <RsAv user={p.user} size={34} color={userColor(p.user)}/>
                    <div className="thread-body">
                      <div className="thread-top">
                        <div className="thread-title">{p.title}</div>
                        {p.space&&<div className="thread-tag" style={{background:`${col}20`,color:col}}>{p.space.name}</div>}
                      </div>
                      <div className="participants-row"><span className="part-label">{p.user?.username} · {ago(p.inserted_at)}</span></div>
                    </div>
                  </div>
                </div>
              );
            })}
          </>}
          {results.replies?.length>0&&<>
            <div style={{fontSize:10,fontWeight:500,color:"var(--t5)",letterSpacing:".07em",textTransform:"uppercase",padding:"14px 0 8px"}}>Replies</div>
            {results.replies.map(r=>{
              const col=userColor(r.user);
              return (
                <div key={r.id} className="thread" onClick={()=>navigate("post",{id:r.post_id})}>
                  <div className="thread-main">
                    <div className="thread-accent" style={{background:col}}/>
                    <RsAv user={r.user} size={34} color={userColor(r.user)}/>
                    <div className="thread-body">
                      <div className="thread-top">
                        <div className="thread-title" style={{fontSize:13,fontWeight:400}}>{r.body?.replace(/!?\[[[^\]]*\]\([^)]*\)/g,"").replace(/[#*`>]/g,"").slice(0,120)}</div>
                        {r.post&&<div className="thread-tag" style={{background:"rgba(255,255,255,0.05)",color:"var(--t3)"}}>in: {r.post.title?.slice(0,30)}</div>}
                      </div>
                      <div className="participants-row"><span className="part-label">{r.user?.username} · {ago(r.inserted_at)}</span></div>
                    </div>
                  </div>
                </div>
              );
            })}
          </>}
        </>}
      </div>
    </div>


export { SearchPage };
