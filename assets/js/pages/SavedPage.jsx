import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { ago, spaceColor, userColor } from "../lib/utils";
import { toast } from "../components/Toasts";
import { RsAv, Av } from "../components/Avatar";
import { Md } from "../components/Markdown";
function SavedPage({navigate, currentUser}) {
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    api.get("/saved").then(d=>{ setItems(d.saved||[]); setLoading(false); }).catch(()=>setLoading(false));
  },[]);

  const unsave = async(e, item)=>{
    e.stopPropagation();
    if(item.type==="post"){
      await api.delete(`/posts/${item.post.id}/save`);
      setItems(p=>p.filter(s=>!(s.type==="post"&&s.post?.id===item.post.id)));
    } else {
      await api.delete(`/posts/${item.reply.post?.id}/replies/${item.reply.id}/save`);
      setItems(p=>p.filter(s=>!(s.type==="reply"&&s.reply?.id===item.reply.id)));
    }
  };

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{height:48,borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"center",padding:"0 24px",flexShrink:0}}>
        <span style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>Saved</span>
        {items&&items.length>0&&<span style={{fontSize:12,color:"var(--t5)",marginLeft:8}}>{items.length} item{items.length===1?"":"s"}</span>}
      </div>
      <div style={{flex:1,overflowY:"auto"}}>
        {loading && <div style={{padding:"40px",textAlign:"center",color:"var(--t5)"}}>Loading…</div>}
        {!loading && (!items||items.length===0) && (
          <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:"var(--t5)",padding:"60px 0"}}>
            <i className="fa-regular fa-bookmark" style={{fontSize:28,opacity:.3}}></i>
            <div style={{fontSize:13}}>Nothing saved yet</div>
            <div style={{fontSize:12,color:"var(--t5)"}}>Bookmark posts and replies to find them here</div>
          </div>
        )}
        {items&&items.map((item,i)=>{
          if(item.type==="post"&&item.post){
            const p = item.post;
            const col = spaceColor(p.space||{id:p.id});
            return (
              <div key={`post-${p.id}`} className="thread" style={{position:"relative"}} onClick={()=>navigate("post",{id:p.id})}>
                <div className="thread-main">
                  <div className="thread-accent" style={{background:col}}/>
                  <div style={{margin:"0 14px 0 18px",flexShrink:0,alignSelf:"center"}}><RsAv user={p.user} size={34} color={userColor(p.user)}/></div>
                  <div className="thread-body">
                    <div className="thread-top">
                      <div className="thread-title">{p.title}</div>
                      {p.space&&<div className="thread-tag" style={{background:`${col}20`,color:col}}>{p.space.name}</div>}
                    </div>
                    {p.body&&<div className="thread-preview">{p.body.replace(/!\[.*?\]\(.*?\)/g,"").replace(/[#*`>]/g,"").trim().slice(0,120)}</div>}
                    <div className="participants-row"><span className="part-label">{p.reply_count} replies · {ago(p.inserted_at)}</span></div>
                  </div>
                  <div className="thread-meta">
                    <div className="meta-block"><div className="meta-n" style={{color:col}}>{p.reaction_count||0}</div><div className="meta-l"><i className="fa-solid fa-thumbs-up" style={{fontSize:16}}/></div></div>
                  </div>
                </div>
                <button onClick={e=>unsave(e,item)} title="Remove" style={{position:"absolute",top:10,right:12,background:"none",border:"none",color:"var(--t5)",cursor:"pointer",fontSize:13,opacity:0,transition:"opacity .15s"}}
                  className="thread-save-btn saved">
                  <i className="fa-solid fa-bookmark"/>
                </button>
              </div>
            );
          }
          if(item.type==="reply"&&item.reply){
            const r = item.reply;
            const col = r.post?.space ? spaceColor(r.post.space) : "var(--ac)";
            return (
              <div key={`reply-${r.id}`} className="p-reply-card" style={{padding:"14px 28px",cursor:"pointer",borderBottom:"0.5px solid var(--b1)"}} onClick={()=>r.post&&navigate("post",{id:r.post.id})}>
                <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                  {r.user?.avatar_url
                    ?<img src={r.user.avatar_url} style={{width:28,height:28,borderRadius:"var(--av-radius)",objectFit:"cover",flexShrink:0}} alt=""/>
                    :<div style={{width:28,height:28,borderRadius:"var(--av-radius)",background:userColor(r.user),display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:500,color:"#fff",flexShrink:0}}>{(r.user?.username||"?").slice(0,2).toUpperCase()}</div>}
                  <div style={{flex:1,minWidth:0}}>
                    <div className="p-reply-body"><Md text={r.body}/></div>
                    <div className="p-reply-meta">
                      {r.post&&<><i className="fa-solid fa-arrow-right" style={{fontSize:9}}/><span style={{color:col,fontWeight:500}}>{r.post.title}</span>{r.post.space&&<><span>·</span><span>{r.post.space.name}</span></>}</>}
                      <span style={{marginLeft:"auto"}}>{ago(r.inserted_at)}</span>
                    </div>
                  </div>
                  <button onClick={e=>unsave(e,item)} title="Remove" style={{background:"none",border:"none",color:"var(--ac)",cursor:"pointer",fontSize:13,flexShrink:0}}>
                    <i className="fa-solid fa-bookmark"/>
                  </button>
                </div>
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}


export { SavedPage };
