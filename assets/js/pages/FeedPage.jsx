import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api";
import { ago, fmtDate, userColor, spaceColor } from "../lib/utils";
import { toast } from "../components/Toasts";
import { RsAv, Av } from "../components/Avatar";
import { Md } from "../components/Markdown";
import { Select } from "../components/Select";
import { RichTextArea } from "../components/RichTextArea";

const _brandingState   = () => (window._getBrandingState && window._getBrandingState()) || {};
const onBrandingChange = (fn) => window._onBrandingChange ? window._onBrandingChange(fn) : () => {};
function FeedPage({spaces, tags, currentUser, navigate, notifCount=0, msgCount=0, onLogout, spaceFilter, sortOverride, followingOnly=false, livePosts=[], liveEvents=[], onAuthRequired}) {
  const [sort,setSort]=useState(sortOverride||"latest");
  useEffect(()=>{setSort(sortOverride||"latest");},[sortOverride]);
  const [posts,setPosts]=useState([]); const [loading,setLoading]=useState(true);
  const [cursor,setCursor]=useState(null); const [hasMore,setHasMore]=useState(false);
  const [liveCount,setLiveCount]=useState(0);
  const [hoveredPost,setHoveredPost]=useState(null);
  const [openPostMenu,setOpenPostMenu]=useState(null);
  const [subscribed,setSubscribed]=useState(false);
  const [subLoading,setSubLoading]=useState(false);
  const [savedPostIds,setSavedPostIds]=useState(new Set());
  useEffect(()=>{
    if(currentUser) api.get("/saved").then(d=>{
      const ids = new Set((d.saved||[]).filter(s=>s.type==="post").map(s=>s.post?.id).filter(Boolean));
      setSavedPostIds(ids);
    }).catch(()=>{});
  },[currentUser]);
  const toggleSavePost = async(e,postId)=>{ e.stopPropagation(); if(!currentUser){onAuthRequired?.("login");return;}
    if(savedPostIds.has(postId)){ await api.delete(`/posts/${postId}/save`); setSavedPostIds(p=>{const n=new Set(p);n.delete(postId);return n;}); }
    else { await api.post(`/posts/${postId}/save`,{}); setSavedPostIds(p=>new Set([...p,postId])); }
  };
  useEffect(()=>{ if(livePosts.length>0) setLiveCount(livePosts.length); },[livePosts]);
  const activeSpace = spaces.find(s=>s.slug===spaceFilter);

  const load=useCallback(async(reset=true,cur=null)=>{
    setLoading(true);
    try {
      let url=`/feed?sort=${sort}`;
      if(spaceFilter) url+=`&space=${spaceFilter}`;
      if(followingOnly) url+=`&following=true`;
      if(!reset&&cur) url+=`&cursor=${cur}`;
      const d=await api.get(url);
      if(d.error==="Please log in to view this forum"){onAuthRequired?.("login");return;}
      const np=d.posts||[];
      if(reset) setPosts(np); else setPosts(p=>[...p,...np]);
      setCursor(d.next_cursor); setHasMore(!!d.next_cursor);
    } finally { setLoading(false); }
  },[sort,spaceFilter,followingOnly]);

  useEffect(()=>{
    if(!spaceFilter) { setSubscribed(false); return; }
    api.get(`/spaces/${spaceFilter}`).then(d=>{ if(d.space) setSubscribed(d.space.subscribed||false); }).catch(()=>{});
  },[spaceFilter]);

  useEffect(()=>{setPosts([]);setLiveCount(0);load(true);},[sort,spaceFilter,followingOnly]);

  const toggleSubscribe = async () => {
    if (!spaceFilter || subLoading) return;
    setSubLoading(true);
    try {
      if (subscribed) {
        await api.delete(`/spaces/${spaceFilter}/subscribe`);
        setSubscribed(false); toast("Unfollowed");
      } else {
        await api.post(`/spaces/${spaceFilter}/subscribe`, {});
        setSubscribed(true); toast("Following!");
      }
    } finally { setSubLoading(false); }
  };

  const feedTitle = followingOnly ? "following" : activeSpace ? activeSpace.name : "everything";

  const [hero, setHero] = useState(_brandingState);
  useEffect(()=>{ return onBrandingChange(b=>setHero({...b})); },[]);

  return (
    <div className="feed-wrap">
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          {currentUser&&currentUser.email_verified===false&&currentUser.role==="member"&&(
            <div style={{background:"rgba(251,191,36,0.08)",borderBottom:"0.5px solid rgba(251,191,36,0.2)",padding:"9px 20px",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
              <i className="fa-solid fa-triangle-exclamation" style={{color:"#fbbf24",fontSize:12,flexShrink:0}}/>
              <span style={{fontSize:12,color:"rgba(251,191,36,0.85)",flex:1}}>
                Please verify your email address to post, reply, and react. Check your inbox for a verification link.
              </span>
            </div>
          )}
          {!spaceFilter&&!followingOnly&&hero.hero_enabled&&(hero.hero_title||hero.hero_body)&&(
            <div style={{padding:"32px 28px",borderBottom:"0.5px solid var(--b1)",background:"linear-gradient(180deg, var(--s2) 0%, transparent 100%)",flexShrink:0}}>
              {hero.hero_title&&<div style={{fontSize:22,fontWeight:600,color:"var(--t1)",letterSpacing:-0.4,marginBottom:hero.hero_body?8:0,lineHeight:1.3}}>{hero.hero_title}</div>}
              {hero.hero_body&&<div style={{fontSize:14,color:"var(--t3)",lineHeight:1.7,maxWidth:600}}>{hero.hero_body}</div>}
            </div>
          )}
          <div className="feed-header">
            <div className="feed-title">{feedTitle}</div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {spaceFilter && activeSpace && (
                <button onClick={toggleSubscribe} disabled={subLoading} style={{fontSize:13,padding:"6px 16px",borderRadius:20,border:`0.5px solid ${subscribed?"rgba(255,255,255,0.2)":"var(--ac-border)"}`,background:subscribed?"rgba(255,255,255,0.06)":"var(--ac-bg)",color:subscribed?"var(--t2)":"var(--ac-text)",cursor:"pointer",fontFamily:"inherit",transition:"all .15s",fontWeight:500}}>
                  {subscribed ? "✓ following" : "+ follow"}
                </button>
              )}
              <div className="sort-pills">
                {["latest","rising","top"].map(s=><div key={s} className={`sort-pill ${sort===s?"active":""}`} onClick={()=>setSort(s)}>{s}</div>)}
              </div>
            </div>
          </div>
          <div className="feed-list">
            {liveCount>0&&!spaceFilter&&(
              <div style={{padding:"10px 18px",background:"var(--ac-bg)",borderBottom:"0.5px solid var(--ac-border)",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}} onClick={()=>{setLiveCount(0);load(true);}}>
                <span style={{fontSize:12,color:"var(--ac-text)"}}><i className="fa-solid fa-arrow-up" style={{fontSize:10,marginRight:6}}></i>{liveCount} new {liveCount===1?"post":"posts"} — click to load</span>
              </div>
            )}
            {loading&&!posts.length?<div style={{padding:"40px",textAlign:"center",color:"var(--t5)"}}>Loading...</div>
              :posts.length===0?<div style={{padding:"60px 20px",textAlign:"center",color:"var(--t5)"}}>
                  {followingOnly
                    ?<><div style={{fontSize:28,marginBottom:12,opacity:.3}}>👀</div>
                      <div style={{fontSize:14,fontWeight:500,color:"var(--t2)",marginBottom:8}}>Nothing in your feed yet</div>
                      <div style={{fontSize:13,marginBottom:20}}>Follow some spaces to see posts here</div>
                      <button className="btn-primary" onClick={()=>navigate("feed")}>Browse everything</button></>
                    :<><div style={{fontSize:13,marginBottom:12}}>No posts yet</div>
                      <button className="btn-primary" onClick={()=>navigate("compose")}>Start the conversation</button></>}
                </div>
              :posts.map(p=>{
                const col = spaceColor(p.space||{id:p.id});
                return (
                  <div key={p.id} className="thread" style={{position:"relative"}}
                    onMouseEnter={()=>setHoveredPost(p.id)}
                    onMouseLeave={()=>{setHoveredPost(null);if(openPostMenu===p.id)setOpenPostMenu(null);}}
                    onClick={e=>{if(e.target.closest(".feed-post-menu"))return;navigate("post",{id:p.id});}}>
                    {/* Bookmark button */}
                    <button className={`thread-save-btn${savedPostIds.has(p.id)?" saved":""}`}
                      title={savedPostIds.has(p.id)?"Saved":"Save"}
                      onClick={e=>toggleSavePost(e,p.id)}>
                      <i className={`fa-${savedPostIds.has(p.id)?"solid":"regular"} fa-bookmark`}/>
                    </button>
                    <div className="thread-main">
                      <div className="thread-accent" style={{background:col}}/>
                      <div style={{margin:"0 14px 0 18px",flexShrink:0,alignSelf:"center"}}><RsAv user={p.user} size={44} color={userColor(p.user)}/></div>
                      <div className="thread-body">
                        <div className="thread-top">
                          <div className="thread-title">{p.title}</div>
                        </div>
                        <div className="thread-tags-row">
                          {p.type==="question"&&<div className="thread-tag" style={{background:p.accepted_reply_id?"rgba(52,211,153,0.15)":"rgba(96,165,250,0.15)",color:p.accepted_reply_id?"#34d399":"#60a5fa",display:"flex",alignItems:"center",gap:4}}>
                            <i className={`fa-solid ${p.accepted_reply_id?"fa-circle-check":"fa-circle-question"}`} style={{fontSize:14}}/>{p.accepted_reply_id?"Answered":"Question"}
                          </div>}
                          {p.space&&<div className="thread-tag" style={{background:`${col}20`,color:col}}>{p.space.name}</div>}
                        </div>
                        {p.body&&<div className="thread-preview">{p.body.replace(/!\[.*?\]\(.*?\)/g,"").replace(/\[!\[.*?\]\(.*?\)\]\(.*?\)/g,"").replace(/\[[^\]]*\]\([^)]*\)/g,"").replace(/[#*`>]/g,"").trim().slice(0,120)}</div>}
                        <div className="participants-row">
                          <div className="av-stack">
                            {/* OP avatar */}
                            <div className="av-tip" data-tip={p.user?.username||""}>
                              {p.user?.avatar_url
                                ?<img src={p.user.avatar_url} style={{width:26,height:26,borderRadius:"var(--av-radius)",objectFit:"cover",border:"2px solid var(--bg)",marginRight:-8,flexShrink:0}} alt={p.user.username}/>
                                :<div className="pav" style={{background:userColor(p.user)}}>{(p.user?.username||"?").slice(0,2).toUpperCase()}</div>}
                            </div>
                            {/* Recent participant avatars — up to 3, deduplicated against OP */}
                            {(p.recent_users||[])
                              .filter(u=>u.id!==p.user?.id)
                              .slice(0,3)
                              .map(u=>(
                                <div key={u.id} className="av-tip" data-tip={u.username||""}>
                                  {u.avatar_url
                                    ?<img src={u.avatar_url} style={{width:26,height:26,borderRadius:"var(--av-radius)",objectFit:"cover",border:"2px solid var(--bg)",marginRight:-8,flexShrink:0}} alt={u.username}/>
                                    :<div className="pav" style={{background:userColor(u)}}>{(u.username||"?").slice(0,2).toUpperCase()}</div>}
                                </div>
                              ))
                            }
                            {/* +N overflow pill */}
                            {p.reply_count>(1+(p.recent_users||[]).filter(u=>u.id!==p.user?.id).length)&&(
                              <div className="pav pav-more">+{Math.min(p.reply_count-1,9)}</div>
                            )}
                          </div>
                          <span className="part-label">{p.reply_count} {p.reply_count===1?"reply":"replies"}</span>
                        </div>
                      </div>
                      {/* Tags column — centered vertically, desktop only */}
                      <div className="thread-tags-col">
                        
                        {p.space&&<div className="thread-tag" style={{background:`${col}20`,color:col}}>{p.space.name}</div>}
                      </div>
                      <div className="thread-meta">
                        <div className="meta-block">
                          <div className="meta-n" style={{color:col}}>{p.reaction_count||0}</div>
                          <div className="meta-l"><i className="fa-solid fa-thumbs-up" style={{fontSize:16}}/></div>
                        </div>
                        <div className="meta-div"/>
                        <div className="thread-last">
                          {(()=>{
                            const lastUser = p.reply_count > 0 && p.last_reply_user ? p.last_reply_user : p.user;
                            return lastUser?.avatar_url
                              ? <img src={lastUser.avatar_url} style={{width:26,height:26,borderRadius:"var(--av-radius)",objectFit:"cover",border:"2px solid var(--bg)"}} alt={lastUser.username}/>
                              : <div className="last-av" style={{background:userColor(lastUser)}}>{(lastUser?.username||"?").slice(0,2).toUpperCase()}</div>;
                          })()}
                          <div className="last-ago">{ago(p.last_reply_at||p.inserted_at)}</div>
                        </div>
                      </div>
                    </div>
                    {/* 3-dot menu — visible on hover, author or mod only */}
                    {currentUser&&(currentUser.id===p.user?.id||(currentUser.role==="admin"||currentUser.role==="moderator"))&&(
                      <div className="feed-post-menu" style={{position:"absolute",top:10,right:12,zIndex:10}}
                        onClick={e=>e.stopPropagation()}>
                        <button
                          style={{width:26,height:26,borderRadius:"50%",background:openPostMenu===p.id?"var(--s3)":"transparent",border:`0.5px solid ${openPostMenu===p.id?"var(--b2)":"transparent"}`,color:"var(--t4)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,opacity:hoveredPost===p.id||openPostMenu===p.id?1:0,transition:"opacity .15s"}}
                          onClick={e=>{e.stopPropagation();setOpenPostMenu(v=>v===p.id?null:p.id);}}>
                          <i className="fa-solid fa-ellipsis"/>
                        </button>
                        {openPostMenu===p.id&&(
                          <div style={{position:"absolute",top:30,right:0,background:"var(--s3)",border:"0.5px solid var(--b2)",borderRadius:10,padding:"4px 0",minWidth:148,boxShadow:"0 4px 20px rgba(0,0,0,.4)",zIndex:20}}>
                            {currentUser.id!==p.user?.id&&(
                              <button onClick={e=>{e.stopPropagation();setOpenPostMenu(null);
                                // Report modal lives in PostPage — navigate there with report intent
                                navigate("post",{id:p.id,openReport:true});}}
                                style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--t3)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                                onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                                onMouseLeave={e=>e.currentTarget.style.background="none"}>
                                <i className="fa-solid fa-flag" style={{fontSize:11,color:"var(--t4)",width:14}}/>Report
                              </button>
                            )}
                        {(currentUser.role==="admin"||currentUser.role==="moderator")&&(
                              <button onClick={async e=>{e.stopPropagation();setOpenPostMenu(null);await api.post(`/posts/${p.id}/hide`,{});setPosts(ps=>ps.filter(x=>x.id!==p.id));toast("Post hidden");}}
                                style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                                onMouseEnter={e=>e.currentTarget.style.background="rgba(248,113,113,0.06)"}
                                onMouseLeave={e=>e.currentTarget.style.background="none"}>
                                <i className="fa-solid fa-eye-slash" style={{fontSize:11,width:14}}/>Hide post
                              </button>
                            )}
                            {(currentUser.id===p.user?.id||(currentUser.role==="admin"||currentUser.role==="moderator"))&&(
                              <button onClick={async e=>{e.stopPropagation();setOpenPostMenu(null);if(!confirm(`Delete "${p.title}"?`))return;await api.delete(`/posts/${p.id}`);setPosts(ps=>ps.filter(x=>x.id!==p.id));toast("Post deleted");}}
                                style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                                onMouseEnter={e=>e.currentTarget.style.background="rgba(248,113,113,0.06)"}
                                onMouseLeave={e=>e.currentTarget.style.background="none"}>
                                <i className="fa-solid fa-trash" style={{fontSize:11,width:14}}/>Delete post
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            {hasMore&&<div style={{textAlign:"center",padding:16}}><button className="btn-ghost" onClick={()=>load(false,cursor)} disabled={loading}>Load more</button></div>}
          </div>
      </div>
    </div>
  );
}


export { FeedPage };
