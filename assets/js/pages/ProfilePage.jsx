import { useState, useEffect, useRef, useReducer, useCallback } from "react";
import { api } from "../lib/api";
import { ago, fmtDate, fmtBytes, userColor, spaceColor } from "../lib/utils";
import { toast } from "../components/Toasts";
import { RsAv, Av } from "../components/Avatar";
import { Md } from "../components/Markdown";
import { ReactionsModal } from "../components/Reactions";
import { Select } from "../components/Select";

import { ProfileSidebarSlot } from "./PostPage";

const openFancybox = (...args) => window._openFancybox && window._openFancybox(...args);

function ProfilePage({username, currentUser, navigate, initialTab}) {
  const [user,          setUser]          = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [tab,           setTab]           = useState(initialTab || "posts");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingCover,  setUploadingCover]  = useState(false);
  const [coverExpanded,   setCoverExpanded]   = useState(false);
  const [, forceUpdate] = React.useReducer(x => x+1, 0);
  useEffect(() => {
    // onChange fires for slot registrations (legacy profile_tab → slot path
    // is gone after piece 1.5, but other slot registrations could still
    // matter to this page). onProfileTabChange fires when extension bundles
    // register their tab components. Subscribe to both so the tab bar
    // updates regardless of which path the extension uses.
    const unsubSlot = window.NexusExtensions.onChange(() => forceUpdate());
    const unsubTabs = window.NexusExtensions.onProfileTabChange(() => forceUpdate());
    return () => { unsubSlot(); unsubTabs(); };
  }, []);

  // Per-tab data — fetched lazily on first activation
  const [posts,       setPosts]       = useState(null);
  const [replies,     setReplies]     = useState(null);
  const [reactions,   setReactions]   = useState(null);
  const [media,       setMedia]       = useState(null);
  const [mentions,    setMentions]    = useState(null);

  // Per-tab loading state
  const [tabLoading,  setTabLoading]  = useState({});

  // Per-tab cursor and hasMore for infinite scroll
  const [cursors,  setCursors]  = useState({});
  const [hasMore,  setHasMore]  = useState({});
  const loadingTabRef = useRef({});
  const cursorRef     = useRef({});
  const hasMoreRef    = useRef({});
  const sentinelRef   = useRef();

  const isOwn  = currentUser?.username === username;
  const isAdmin = currentUser?.role === "admin";

  // Load user profile stats
  useEffect(()=>{
    setLoading(true);
    setPosts(null); setReplies(null); setReactions(null); setMedia(null); setMentions(null);
    setCursors({}); setHasMore({});
    cursorRef.current={}; hasMoreRef.current={}; loadingTabRef.current={};
    setTab(initialTab || "posts");
    api.get(`/users/${username}`).then(d=>{
      setUser(d.user || {username});
      setLoading(false);
    }).catch(()=>{ setUser({username}); setLoading(false); });
  },[username, initialTab]);

  // Lazy-load tab data on first activation, with cursor pagination
  const loadTab = useCallback(async(key, url, setter, dataKey, append=false)=>{
    if(loadingTabRef.current[key]) return;
    loadingTabRef.current[key]=true;
    setTabLoading(p=>({...p,[key]:true}));
    try {
      const cur = cursorRef.current[key];
      const fullUrl = cur ? `${url}${url.includes("?")?"&":"?"}cursor=${cur}` : url;
      const d = await api.get(fullUrl);
      const items = d[dataKey]||[];
      if(append) setter(p=>[...(p||[]),...items]);
      else setter(items);
      cursorRef.current[key]=d.next_cursor||null;
      hasMoreRef.current[key]=!!d.next_cursor;
      setCursors(p=>({...p,[key]:d.next_cursor||null}));
      setHasMore(p=>({...p,[key]:!!d.next_cursor}));
    } finally {
      loadingTabRef.current[key]=false;
      setTabLoading(p=>({...p,[key]:false}));
    }
  },[]);

  useEffect(()=>{
    if(!user) return;
    if(tab==="posts"     && posts     ===null) loadTab("posts",     `/feed?sort=latest&user=${encodeURIComponent(username)}`, setPosts,     "posts");
    if(tab==="replies"   && replies   ===null) loadTab("replies",   `/users/${username}/replies`,   setReplies,   "replies");
    if(tab==="reactions" && reactions ===null) loadTab("reactions", `/users/${username}/reactions`, setReactions, "reactions");
    if(tab==="media"     && media     ===null) loadTab("media",     `/users/${username}/uploads`,   setMedia,     "uploads");
    if(tab==="mentions"  && mentions  ===null) loadTab("mentions",  `/users/${username}/mentions`,  setMentions,  "mentions");
  },[tab, user, username, loadTab]);

  // IntersectionObserver for infinite scroll on active tab
  useEffect(()=>{
    const sentinel=sentinelRef.current; if(!sentinel) return;
    const observer=new IntersectionObserver(entries=>{
      if(!entries[0].isIntersecting) return;
      if(loadingTabRef.current[tab]||!hasMoreRef.current[tab]) return;
      if(tab==="posts")     loadTab("posts",     `/feed?sort=latest&user=${encodeURIComponent(username)}`, setPosts,     "posts",     true);
      if(tab==="replies")   loadTab("replies",   `/users/${username}/replies`,   setReplies,   "replies",   true);
      if(tab==="reactions") loadTab("reactions", `/users/${username}/reactions`, setReactions, "reactions", true);
      if(tab==="media")     loadTab("media",     `/users/${username}/uploads`,   setMedia,     "uploads",   true);
      if(tab==="mentions")  loadTab("mentions",  `/users/${username}/mentions`,  setMentions,  "mentions",  true);
    },{rootMargin:"200px"});
    observer.observe(sentinel);
    return ()=>observer.disconnect();
  },[tab,username,loadTab,hasMore]);

  const col = userColor(user);

  const handleAvatarUpload = async (file) => {
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const d = await api.upload("/uploads", file, {type: "avatar"});
      if (d.upload) { setUser(p=>({...p, avatar_url: d.url})); toast("Avatar updated"); }
      else toast(d.error||"Upload failed", "err");
    } finally { setUploadingAvatar(false); }
  };

  const handleCoverUpload = async (file) => {
    if (!file) return;
    setUploadingCover(true);
    try {
      const d = await api.upload("/uploads", file, {type: "cover_image"});
      if (d.upload) { setUser(p=>({...p, cover_url: d.url})); toast("Cover updated"); }
      else toast(d.error||"Upload failed", "err");
    } finally { setUploadingCover(false); }
  };

  const startDM = async () => {
    const d = await api.post("/threads/direct", {username});
    if(d.thread) navigate("dm", {threadId:d.thread.id, threadName:username});
    else toast(d.error||"Could not start conversation","err");
  };

  const statCards = [
    {icon:"fa-pen-to-square", color:"#a78bfa", n: user?.post_count    ?? 0, label:"Posts"},
    {icon:"fa-reply",         color:"#60a5fa", n: user?.reply_count   ?? 0, label:"Replies"},
    {icon:"fa-heart",         color:"#f472b6", n: user?.reactions_received ?? 0, label:"Reactions received"},
    {icon:"fa-heart-circle-plus", color:"#34d399", n: user?.reactions_given ?? 0, label:"Reactions given"},
  ];

  // Tabs — media only shown to owner or admin (or if media_public is on,
  // but we don't have that setting client-side, so we show it and let the
  // API return 403 if needed; we hide the tab for non-owners unless admin)
  //
  // Extension tabs are first-class: declared in each extension's manifest
  // under profile_tabs[] with id, label, icon, visibility, priority, and
  // registered via NE.registerProfileTab({slug, id, component}). We merge
  // the manifest-declared metadata with the registered component, filter
  // by visibility, and sort by priority.
  const extTabs = window.NexusExtensions.getProfileTabs()
    .map(({slug, id, component}) => {
      // Look up the matching manifest entry. The manifest map is injected
      // into the page by the extension bundle plug; if it's missing for
      // some reason, we skip the tab (better than rendering with stale
      // metadata).
      const manifest = window._nexusExtensionManifests?.[slug];
      const decl = (manifest?.profile_tabs || []).find(t => t.id === id);
      if (!decl) return null;

      return {
        slug,
        id:         decl.id,
        label:      decl.label,
        icon:       decl.icon,
        visibility: decl.visibility || "always",
        priority:   decl.priority   || 50,
        component,
        isExt:      true,
      };
    })
    .filter(Boolean)
    // Visibility filter: "own_only" tabs only appear when the viewer is
    // the profile owner. "always" is unconditional. This is a UX hint —
    // extensions whose tabs need real access control must enforce it on
    // their own API endpoints; the button visibility doesn't gate data.
    .filter(t => t.visibility === "always" || (t.visibility === "own_only" && isOwn))
    .sort((a, b) => a.priority - b.priority);

  const tabs = [
    {id:"posts",     label:"Posts"},
    {id:"replies",   label:"Replies"},
    {id:"reactions", label:"Reactions"},
    ...(isOwn||isAdmin ? [{id:"media", label:"Media"}] : []),
    {id:"mentions",  label:"Mentions"},
    ...extTabs,
  ];

  const TabEmpty = ({msg}) => (
    <div style={{padding:"48px 0",textAlign:"center",color:"var(--t5)",fontSize:13}}>{msg}</div>
  );

  const TabSpinner = () => (
    <div style={{padding:"48px 0",textAlign:"center",color:"var(--t5)"}}>Loading…</div>
  );

  const PostCard = ({p}) => {
    const pc = spaceColor(p.space||{id:p.id});
    return (
      <div className="thread" onClick={()=>navigate("post",{id:p.id})}>
        <div className="thread-main">
          <div className="thread-accent" style={{background:pc}}/>
          <div style={{margin:"0 14px 0 18px",flexShrink:0,alignSelf:"center"}}><RsAv user={p.user} size={34} color={userColor(p.user)}/></div>
          <div className="thread-body">
            <div className="thread-top">
              <div className="thread-title">{p.title}</div>
              {p.space&&<div className="thread-tag" style={{background:`${pc}20`,color:pc}}>{p.space.name}</div>}
            </div>
            {p.body&&<div className="thread-preview">{p.body.replace(/!\[.*?\]\(.*?\)/g,"").replace(/\[!\[.*?\]\(.*?\)\]\(.*?\)/g,"").replace(/\[[^\]]*\]\([^)]*\)/g,"").replace(/[#*`>]/g,"").trim().slice(0,120)}</div>}
            <div className="participants-row"><span className="part-label">{p.reply_count} replies · {ago(p.inserted_at)}</span></div>
          </div>
          <div className="thread-meta">
            <div className="meta-block"><div className="meta-n" style={{color:pc}}>{p.reaction_count||0}</div><div className="meta-l"><i className="fa-solid fa-thumbs-up" style={{fontSize:16}}/></div></div>
          </div>
        </div>
      </div>
    );
  };

  const ReplyCard = ({r}) => {
    const pc = r.post ? spaceColor(r.post.space||{id:r.post.id}) : "var(--ac)";
    return (
      <div className="p-reply-card" onClick={()=>r.post&&navigate("post",{id:r.post.id})} style={{cursor:r.post?"pointer":"default"}}>
        <div className="p-reply-body"><Md text={r.body}/></div>
        <div className="p-reply-meta">
          {r.post&&<><i className="fa-solid fa-arrow-right" style={{fontSize:9}}/><span style={{color:pc,fontWeight:500}}>{r.post.title}</span>{r.post.space&&<><span>·</span><span>{r.post.space.name}</span></>}</>}
          <span style={{marginLeft:"auto"}}>{ago(r.inserted_at)}</span>
        </div>
      </div>
    );
  };

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{flex:1,overflowY:"auto"}}>
        {/* Cover */}
        <div className={`profile-cover${coverExpanded?" expanded":""}`}>
          {user?.cover_url
            ?<img src={user.cover_url} style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover"}} alt="cover"/>
            :<svg viewBox="0 0 680 160" preserveAspectRatio="xMidYMid slice" style={{position:"absolute",inset:0,width:"100%",height:"100%"}}>
              <rect width="680" height="160" fill="#13121e"/>
              {[0,40,80,120,160].map(y=><line key={y} x1="0" y1={y} x2="680" y2={y+160} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5"/>)}
              {[0,80,160,240,320,400,480,560].map(x=><line key={x} x1={x} y1="0" x2={x+160} y2="160" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5"/>)}
              <circle cx="120" cy="60" r="60" fill="none" stroke={`${col}30`} strokeWidth="0.5"/>
              <circle cx="480" cy="100" r="80" fill="none" stroke={`${col}20`} strokeWidth="0.5"/>
            </svg>}
          <div className="profile-cover-gradient"/>
          {isOwn&&<label className="profile-cover-edit" style={{opacity:uploadingCover?.5:1}}>
            <input type="file" accept="image/jpeg,image/png,image/webp" style={{display:"none"}} onChange={e=>handleCoverUpload(e.target.files[0])}/>
            {uploadingCover
              ?<><i className="fa-solid fa-spinner fa-spin" style={{marginRight:5}}></i>Uploading…</>
              :<><i className="fa-solid fa-camera" style={{marginRight:5}}></i>Edit cover</>}
          </label>}
          {user?.cover_url&&<div className="profile-cover-expand" onClick={()=>setCoverExpanded(p=>!p)}>
            <i className={`fa-solid fa-${coverExpanded?"compress":"expand"}`} style={{fontSize:10}}></i>
            {coverExpanded?"Collapse":"Expand"}
          </div>}
        </div>

        {/* Info */}
        <div className="profile-info-wrap">
          <div className="profile-av-row">
            <div style={{position:"relative",display:"inline-block"}}>
              {user?.avatar_url
                ?<img src={user.avatar_url} style={{width:96,height:96,borderRadius:"var(--av-radius)",objectFit:"cover",border:"2px solid var(--bg)",display:"block"}} alt={username}/>
                :<div className="profile-av-ring" style={{background:userColor(user)}}>{(username||"?").slice(0,2).toUpperCase()}</div>}
              {isOwn&&<label style={{position:"absolute",inset:0,borderRadius:"var(--av-radius)",background:"rgba(0,0,0,0)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",transition:"background .15s"}}
                onMouseEnter={e=>e.currentTarget.style.background="rgba(0,0,0,.45)"}
                onMouseLeave={e=>e.currentTarget.style.background="rgba(0,0,0,0)"}>
                <input type="file" accept="image/jpeg,image/png,image/webp" style={{display:"none"}} onChange={e=>handleAvatarUpload(e.target.files[0])}/>
                {uploadingAvatar
                  ?<i className="fa-solid fa-spinner fa-spin" style={{color:"#fff",fontSize:16}}></i>
                  :<i className="fa-solid fa-camera" style={{color:"#fff",fontSize:16,opacity:0,transition:"opacity .15s"}} ref={el=>{if(el){el.closest("label").onmouseenter=()=>el.style.opacity=1;el.closest("label").onmouseleave=()=>el.style.opacity=0;}}}></i>}
              </label>}
            </div>
            {!isOwn&&<div style={{display:"flex",gap:8,marginBottom:4}}>
              <button className="btn-ghost" style={{fontSize:12,padding:"6px 14px"}} onClick={startDM}>Message</button>
            </div>}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
            <div className="profile-name">{username}</div>
            {user?.role&&user.role!=="member"&&<div className="thread-tag" style={{background:`${col}20`,color:col}}>{user.role}</div>}
          </div>
          <div className="profile-handle">@{username?.toLowerCase()} · joined {fmtDate(user?.inserted_at)}</div>
          {user?.bio&&<div style={{fontSize:13,color:"var(--t3)",lineHeight:1.6,margin:"8px 0 12px",maxWidth:480}}>{user.bio}</div>}

          {/* Stat cards */}
          <div className="profile-stat-grid">
            {statCards.map(c=>(
              <div key={c.label} className="profile-stat-card">
                <div className="psc-icon" style={{background:`${c.color}18`}}>
                  <i className={`fa-solid ${c.icon}`} style={{color:c.color,fontSize:13}}/>
                </div>
                <div className="psc-n" style={{color:c.color}}>{Number(c.n).toLocaleString()}</div>
                <div className="psc-l">{c.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* profile_sidebar slot — extension components rendered here.
            Slot contract: components receive {username, current_user}. The
            navigate function previously passed here is no longer in the
            contract; extensions navigate via NE.navigate(url) instead. */}
        <ProfileSidebarSlot username={username} currentUser={currentUser}/>

        {/* Tabs — desktop: horizontal bar, mobile: dropdown */}
        <div className="profile-tabs">
          {tabs.map(t=>(
            <div key={t.id} className={`p-tab${tab===t.id?" active":""}`} onClick={()=>setTab(t.id)}>{t.label}</div>
          ))}
        </div>
        <div className="profile-tabs-mob">
          <details onToggle={e=>{
            // Close the dropdown when an item is picked by toggling it shut
            if (!e.currentTarget.open) return;
          }}>
            <summary>
              <span>{tabs.find(t=>t.id===tab)?.label ?? "Posts"}</span>
              <i className="fa-solid fa-chevron-down" style={{fontSize:11,color:"var(--t5)"}}/>
            </summary>
            <div className="ptm-menu">
              {tabs.map(t=>(
                <div key={t.id} className={`ptm-item${tab===t.id?" active":""}`}
                  onClick={e=>{setTab(t.id); e.currentTarget.closest("details").removeAttribute("open");}}>
                  {t.label}
                </div>
              ))}
            </div>
          </details>
        </div>

        {/* Tab content */}
        <div style={{padding:"0 28px"}}>

          {/* Posts */}
          {tab==="posts"&&(
            tabLoading.posts ? <TabSpinner/>
            : !posts ? null
            : posts.length===0 ? <TabEmpty msg="No posts yet"/>
            : posts.map(p=><PostCard key={p.id} p={p}/>)
          )}

          {/* Replies */}
          {tab==="replies"&&(
            tabLoading.replies ? <TabSpinner/>
            : !replies ? null
            : replies.length===0 ? <TabEmpty msg="No replies yet"/>
            : replies.map(r=><ReplyCard key={r.id} r={r}/>)
          )}

          {/* Reactions */}
          {tab==="reactions"&&(
            tabLoading.reactions ? <TabSpinner/>
            : !reactions ? null
            : reactions.length===0 ? <TabEmpty msg="No reactions yet"/>
            : reactions.map(({emoji, reacted_at, post})=>(
                <div key={post.id} style={{position:"relative"}}>
                  <div style={{position:"absolute",top:18,left:0,fontSize:16,zIndex:1,userSelect:"none"}}>{emoji}</div>
                  <div style={{paddingLeft:28}}>
                    <PostCard p={post}/>
                  </div>
                </div>
              ))
          )}

          {/* Media */}
          {tab==="media"&&(
            tabLoading.media ? <TabSpinner/>
            : !media ? null
            : media.length===0 ? <TabEmpty msg="No media uploaded yet"/>
            : <div className="p-media-grid">
                {media.map((u,i)=>(
                  <div key={u.id} style={{aspectRatio:"1",overflow:"hidden",borderRadius:8,background:"var(--s2)",cursor:"zoom-in"}}
                    onClick={()=>{
                      const items = media.map(m=>({ src: m.url, originalSrc: m.original_url||m.url }));
                      openFancybox(items, i);
                    }}>
                    <img src={u.url} alt="" style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}
                      onError={e=>e.target.style.display="none"}/>
                  </div>
                ))}
              </div>
          )}

          {/* Mentions */}
          {tab==="mentions"&&(
            tabLoading.mentions ? <TabSpinner/>
            : !mentions ? null
            : mentions.length===0 ? <TabEmpty msg={`No mentions of @${username} found`}/>
            : mentions.map((item,i)=>(
                item.type==="post"
                  ? <PostCard key={`post-${item.post.id}`} p={item.post}/>
                  : <ReplyCard key={`reply-${item.reply.id}`} r={item.reply}/>
              ))
          )}

          {/* Extension profile tabs — render the active one's component.
              The component receives ONLY the props declared in the
              profile_tab surface contract (username, current_user). To
              navigate, extensions use NE.navigate. To get the user's id,
              extensions fetch by username from their API. */}
          {extTabs.map(t => tab===t.id
            ? <t.component key={t.id}
                {...window.NexusExtensions.propsForProfileTab({
                  username,
                  current_user: currentUser,
                })}/>
            : null
          )}

          {/* Infinite scroll sentinel — always rendered, visible only when more content available */}
          <div ref={sentinelRef} style={{height:40,visibility:hasMore[tab]?"visible":"hidden"}}/>
          {tabLoading[tab]&&(posts||replies||reactions||media||mentions)&&(
            <div style={{textAlign:"center",padding:16,color:"var(--t5)",fontSize:13}}>Loading…</div>
          )}

        </div>
      </div>
    </div>
  );
}


export { ProfilePage };
