import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { ago } from "../lib/utils";
import { RsAv } from "../components/Avatar";
import { Md } from "../components/Markdown";

// ── NotificationsPage ─────────────────────────────────────────────────────────

function NotificationsPage({navigate, onCountChange}) {
  const [notifs,setNotifs]=useState([]); const [loading,setLoading]=useState(true);

  const updateCount = (list) => {
    const unread = list.filter(n=>!n.read).length;
    onCountChange?.(unread);
  };

  useEffect(()=>{
    api.get("/notifications").then(d=>{
      const list = d.notifications||[];
      setNotifs(list);
      setLoading(false);
      updateCount(list);
    });
  },[]);

  const markAll=async()=>{
    await api.post("/notifications/read-all",{});
    const next = notifs.map(n=>({...n,read:true}));
    setNotifs(next);
    updateCount(next);
    toast("All marked as read");
  };
  const deleteAll=async()=>{if(!confirm("Delete all notifications?"))return;await api.delete("/notifications");setNotifs([]);onCountChange?.(0);toast("Notifications cleared");};
  const deleteOne=async(e,id)=>{
    e.stopPropagation();
    // Remove optimistically so the badge updates immediately
    setNotifs(p=>{const next=p.filter(n=>n.id!==id);updateCount(next);return next;});
    api.delete(`/notifications/${id}`).catch(()=>{});
  };
  const TYPE={reply:"replied to your post",mention:"mentioned you",reaction:"reacted to your post",dm:"sent you a message",announcement:"posted an announcement",badge:"you earned a badge"};
  const ICON={reply:"fa-reply",mention:"fa-at",reaction:"fa-heart",dm:"fa-message",announcement:"fa-bullhorn",badge:"fa-medal"};
  const ICON_COLOR={reply:"var(--ac)",mention:"var(--blue)",reaction:"var(--red)",dm:"var(--green)",announcement:"var(--amber)",badge:"var(--amber)"};

  const getIcon      = n => window.NexusExtensions.getNotifType(n.type)?.icon      || ICON[n.type]      || "fa-bell";
  const getIconColor = n => window.NexusExtensions.getNotifType(n.type)?.iconColor || ICON_COLOR[n.type]|| "var(--ac)";
  const renderBody   = n => {
    const extType = window.NexusExtensions.getNotifType(n.type);
    if (extType?.renderBody) return extType.renderBody(n);
    if (n.type==="badge") return <><strong style={{color:"var(--t1)"}}>{n.data?.badge_name||"A badge"}</strong> <span style={{color:"var(--t3)"}}>was awarded to you</span></>;
    return <><strong style={{color:"var(--t1)"}}>{n.actor?.username||"Someone"}</strong> <span style={{color:"var(--t3)"}}>{TYPE[n.type]||n.type}</span></>;
  };
  const handleClick  = async n => {
    if(!n.read){
      // Update count and mark as read optimistically — before the API call
      // and before navigating away, so the badge decrements immediately.
      setNotifs(p=>{const next=p.map(x=>x.id===n.id?{...x,read:true}:x);updateCount(next);return next;});
      // Fire-and-forget — we don't need to wait for this
      api.patch(`/notifications/${n.id}/read`,{}).catch(()=>{});
    }
    const extType = window.NexusExtensions.getNotifType(n.type);
    if (extType?.onClick) { extType.onClick({ n, navigate }); return; }
    if(n.type==="dm"&&n.data?.thread_id) navigate("dm",{threadId:n.data.thread_id,threadName:n.actor?.username||"DM"});
    else if(n.type==="badge") { navigate("badges"); }
    else if(n.post_id) navigate("post",{id:n.post_id, scrollToReply:n.reply_id||null});
    else if(n.reply_id) api.get(`/posts/by-reply/${n.reply_id}`).then(d=>{ if(d.post_id) navigate("post",{id:d.post_id, scrollToReply:n.reply_id}); }).catch(()=>{});
  };
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{height:48,display:"flex",alignItems:"center",padding:"0 24px",gap:10,flexShrink:0,borderBottom:"0.5px solid var(--b1)"}}>
        <button className="mob-icon-btn" onClick={()=>window.history.back()} style={{marginRight:4}}><i className="fa-solid fa-arrow-left"/></button>
        <span style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>Notifications</span>
        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
          {notifs.some(n=>!n.read)&&<button className="btn-ghost" style={{fontSize:11}} onClick={markAll}>Mark all read</button>}
          {notifs.length>0&&<button className="btn-ghost" style={{fontSize:11,color:"var(--red)"}} onClick={deleteAll}>Clear all</button>}
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",width:"100%"}}>
        {loading?<div style={{padding:"40px",textAlign:"center",color:"var(--t5)"}}>Loading…</div>
          :notifs.length===0?<div style={{padding:"60px",textAlign:"center",color:"var(--t5)"}}>No notifications yet</div>
          :notifs.map(n=>(
            <div key={n.id} className={`notif-item ${n.read?"":"unread"}`} onClick={()=>handleClick(n)} style={{position:"relative"}}>
              <div className="notif-pip" style={{background:n.read?"transparent":"var(--ac)"}}/>
              <div style={{width:32,height:32,borderRadius:"50%",background:`${getIconColor(n)}18`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <i className={`fa-solid ${getIcon(n)}`} style={{fontSize:12,color:getIconColor(n)}}></i>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:13}}>{renderBody(n)}</div>
                <div style={{fontSize:12,color:"var(--t5)",marginTop:3}}>{ago(n.inserted_at)}</div>
              </div>
              <div onClick={e=>deleteOne(e,n.id)} title="Delete"
                style={{opacity:0,transition:"opacity .15s",fontSize:12,color:"var(--t5)",cursor:"pointer",padding:"4px 8px",borderRadius:6,flexShrink:0}}
                onMouseEnter={e=>{e.currentTarget.style.opacity=1;e.currentTarget.style.color="var(--red)";}}
                onMouseLeave={e=>{e.currentTarget.style.opacity=0;}}>
                <i className="fa-solid fa-xmark"/>
              </div>
            </div>
          ))}
      </div>
    </div>


export { NotificationsPage };
