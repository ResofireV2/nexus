import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { spaceColor } from "../lib/utils";
import { toast } from "../components/Toasts";

// ── TagsPage ──────────────────────────────────────────────────────────────────

function TagsPage({navigate, currentUser}) {
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => api.get("/tags").then(d=>{ setTags(d.tags||[]); setLoading(false); }).catch(()=>setLoading(false));
  useEffect(()=>{ load(); },[]);

  const toggleFollow = async(tag)=>{
    if(!currentUser){ return; }
    if(tag.subscribed){
      await api.delete(`/tags/${tag.slug}/subscribe`);
      setTags(p=>p.map(t=>t.id===tag.id?{...t,subscribed:false}:t));
      toast(`Unfollowed #${tag.name}`);
    } else {
      await api.post(`/tags/${tag.slug}/subscribe`,{});
      setTags(p=>p.map(t=>t.id===tag.id?{...t,subscribed:true}:t));
      toast(`Following #${tag.name}`);
    }
  };

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"22px 28px 0",borderBottom:"0.5px solid var(--b1)",flexShrink:0}}>
        <div style={{marginBottom:14}}>
          <div style={{fontSize:20,fontWeight:600,color:"var(--t1)",letterSpacing:-0.3,marginBottom:3}}>Tags</div>
          <div style={{fontSize:13,color:"var(--t4)"}}>Follow tags to see related posts in your Following feed.</div>
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"20px 28px"}}>
        {loading && <div style={{textAlign:"center",padding:"40px 0",color:"var(--t5)"}}>Loading…</div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
          {tags.map(tag=>(
            <div key={tag.id} style={{background:"var(--s1)",border:`0.5px solid ${tag.subscribed?"rgba(167,139,250,0.25)":"var(--b1)"}`,borderRadius:12,padding:"14px 16px",display:"flex",flexDirection:"column",gap:8,transition:"border-color .15s",cursor:"pointer"}}
              onClick={()=>navigate("feed",{space:null,tag:tag.slug})}
              onMouseEnter={e=>e.currentTarget.style.borderColor=tag.subscribed?"rgba(167,139,250,0.4)":"var(--b3)"}
              onMouseLeave={e=>e.currentTarget.style.borderColor=tag.subscribed?"rgba(167,139,250,0.25)":"var(--b1)"}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:tag.color,flexShrink:0}}/>
                  <span style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>{tag.name}</span>
                </div>
                {currentUser&&(
                  <button onClick={e=>{e.stopPropagation();toggleFollow(tag);}}
                    style={{fontSize:11,padding:"3px 10px",borderRadius:20,border:`0.5px solid ${tag.subscribed?"rgba(167,139,250,0.35)":"var(--b2)"}`,background:tag.subscribed?"rgba(167,139,250,0.12)":"transparent",color:tag.subscribed?"var(--ac-text)":"var(--t3)",cursor:"pointer",fontFamily:"inherit",fontWeight:500,transition:"all .15s",flexShrink:0}}>
                    {tag.subscribed?"✓ following":"+ follow"}
                  </button>
                )}
              </div>
              <div style={{fontSize:12,color:"var(--t5)"}}>{tag.post_count} post{tag.post_count===1?"":"s"}</div>
            </div>
          ))}
        </div>
        {!loading&&tags.length===0&&<div style={{textAlign:"center",padding:"40px 0",color:"var(--t5)"}}>No tags yet</div>}
      </div>
    </div>


export { TagsPage };
