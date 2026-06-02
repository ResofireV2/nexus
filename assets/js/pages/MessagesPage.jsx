import { useState, useEffect, useRef } from "react";
import { api } from "../lib/api";
import { ago, fmtMsgTime, fmtDaySep, userColor } from "../lib/utils";
import { toast } from "../components/Toasts";
import { RsAv, Av } from "../components/Avatar";
import { Md } from "../components/Markdown";

// ── Messages ──────────────────────────────────────────────────────────────────

function DMInboxPage({currentUser, navigate, onOpen}) {
  const [threads,setThreads]=useState([]); const [loading,setLoading]=useState(true);
  const [readIds,setReadIds]=useState(new Set());
  const [dmSearch,setDmSearch]=useState("");
  useEffect(()=>{
    setLoading(true);
    api.get("/threads").then(d=>{setThreads(d.threads||[]);setLoading(false);});
  },[]);
  const tname=t=>{ if(t.kind==="group") return t.name||"Group"; const o=t.members?.find(m=>m.user_id!==currentUser?.id); return o?.user?.username||"Unknown"; };
  const openThread=t=>{
    setReadIds(p=>new Set([...p,t.id]));
    api.post(`/threads/${t.id}/read`,{}).catch(()=>{});
    navigate("dm",{threadId:t.id,threadName:tname(t),threadImage:t.kind==="group"?t.image_url:null});
  };
  const filtered = dmSearch ? threads.filter(t=>tname(t).toLowerCase().includes(dmSearch.toLowerCase())) : threads;
  const unread=filtered.filter(t=>t.unread_count>0&&!readIds.has(t.id));
  const read=filtered.filter(t=>!t.unread_count||t.unread_count===0||readIds.has(t.id));
  const ThreadRow=({t})=>{
    const otherMember = t.kind!=="group" ? t.members?.find(m=>m.user_id!==currentUser?.id) : null;
    const otherUser = otherMember?.user;
    return (
    <div className="thread-row" onClick={()=>openThread(t)}>
      {t.kind==="group"&&t.image_url
        ?<div className="thr-av" style={{backgroundImage:`url(${t.image_url})`,backgroundSize:"cover",backgroundPosition:"center"}}></div>
        :otherUser
          ?<RsAv user={otherUser} size={38} noCard={true}/>
          :<div className="thr-av" style={{background:userColor({id:t.id}),color:"#fff"}}>{tname(t).slice(0,2).toUpperCase()}</div>
      }
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:2}}>
          <div className="thr-name" style={{fontWeight:t.unread_count&&!readIds.has(t.id)?500:400}}>{tname(t)}</div>
          <div style={{fontSize:11,color:"var(--t5)",whiteSpace:"nowrap",marginLeft:8}}>{ago(t.last_message_at||t.inserted_at)}</div>
        </div>
        <div className="thr-preview">{t.last_message||"Start a conversation…"}</div>
      </div>
      {t.unread_count>0&&!readIds.has(t.id)&&<div className="thr-unread">{t.unread_count}</div>}
    </div>
  );};
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{height:48,borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"center",padding:"0 24px",flexShrink:0}}>
        <button className="mob-icon-btn mob-only" onClick={()=>window.history.back()} style={{marginRight:4}}><i className="fa-solid fa-arrow-left"/></button>
        <span style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>Messages</span>
        <button className="btn-ghost" style={{marginLeft:"auto",fontSize:12,padding:"5px 14px"}} onClick={()=>navigate("dm-new")}>+ New</button>
      </div>
      <div className="dm-shell">
        <div className="dm-sidebar">
          <div className="dm-search">
            <div className="dm-search-inner">
              <i className="fa-solid fa-magnifying-glass" style={{fontSize:11,color:"var(--t4)"}}></i>
              <input placeholder="Search messages…" value={dmSearch} onChange={e=>setDmSearch(e.target.value)}/>
            </div>
          </div>
          <div style={{flex:1,overflowY:"auto"}}>
            {loading?<div style={{padding:"20px",textAlign:"center",color:"var(--t5)"}}>Loading…</div>
              :threads.length===0?<div style={{padding:"40px 20px",textAlign:"center",color:"var(--t5)"}}>No messages yet</div>
              :<>
                {unread.length>0&&<><div style={{padding:"8px 14px 4px",fontSize:10,color:"var(--t5)",letterSpacing:".06em",textTransform:"uppercase"}}>Unread</div>{unread.map(t=><ThreadRow key={t.id} t={t}/>)}</>}
                {read.length>0&&<><div style={{padding:"8px 14px 4px",fontSize:10,color:"var(--t5)",letterSpacing:".06em",textTransform:"uppercase",marginTop:unread.length?6:0}}>{unread.length>0?"Earlier":"All"}</div>{read.map(t=><ThreadRow key={t.id} t={t}/>)}</>}
              </>}
          </div>
        </div>

      </div>
    </div>
  );
}

function DMPage({threadId, threadName, threadImage, currentUser, navigate, joinTopic, leaveTopic, sendEvent, onRead}) {
  const [messages,setMessages]=useState([]); const [text,setText]=useState(""); const [sending,setSending]=useState(false); const [uploading,setUploading]=useState(false); const [typing,setTyping]=useState(false); const [dmError,setDmError]=useState(null); const endRef=useRef(); const imgRef=useRef(); const typingRef=useRef();
  const [resolvedName,setResolvedName]=useState(threadName||"");
  const [resolvedImage,setResolvedImage]=useState(threadImage||null);
  const [thread,setThread]=useState(null);
  const [showSettings,setShowSettings]=useState(false);
  const [showThreadMenu,setShowThreadMenu]=useState(false);
  useEffect(()=>{
    wasTypingRef.current = false;
    api.get(`/threads/${threadId}/messages`).then(d=>{setMessages(d.messages||[]);setTimeout(()=>endRef.current?.scrollIntoView(),50)});
    api.post(`/threads/${threadId}/read`,{}).then(()=>{ onRead?.(); }).catch(()=>{});
    api.post(`/notifications/mark-read-by-thread`, {thread_id: threadId}).catch(()=>{});
    // Fetch thread metadata to get name and image_url (covers refresh case where props are missing)
    api.get(`/threads/${threadId}`).then(d=>{
      if(d.thread){
        const t=d.thread;
        const name = t.kind==="group" ? (t.name||"Group") : (t.members?.find(m=>m.user_id!==currentUser?.id)?.user?.username||threadName||"");
        setResolvedName(name);
        if(t.image_url) setResolvedImage(t.image_url);
        setThread(t);
      }
    }).catch(()=>{});
    joinTopic?.(`dm:${threadId}`);
    return ()=>{
      // Send typing_stop when leaving a thread so the indicator clears for the other user
      if (wasTypingRef.current) sendEvent?.(`dm:${threadId}`, "typing_stop", {});
      wasTypingRef.current = false;
      leaveTopic?.(`dm:${threadId}`);
    };
  },[threadId]);

  useEffect(()=>{
    const fn = e => {
      if(String(e.detail.threadId)===String(threadId) && e.detail.message) {
        const msg = e.detail.message;
        setMessages(p=>{
          // Deduplicate by id (compare as strings to handle int/string mismatch)
          if(p.some(m=>String(m.id)===String(msg.id))) return p;
          return [...p, msg];
        });
        setTimeout(()=>endRef.current?.scrollIntoView(),50);
      }
    };
    const typingFn = e => {
      if(e.detail.channel===`dm:${threadId}` && e.detail.userId!==currentUser?.id) {
        setTyping(e.detail.started === true);
      }
    };
    window.addEventListener("nexus:dm_message", fn);
    window.addEventListener("nexus:typing", typingFn);
    return ()=>{ window.removeEventListener("nexus:dm_message", fn); window.removeEventListener("nexus:typing", typingFn); };
  },[threadId,currentUser]);

  const wasTypingRef = useRef(false);
  const onTextChange = e => {
    const val = e.target.value;
    setText(val);
    if (val.length > 0 && !wasTypingRef.current) {
      wasTypingRef.current = true;
      sendEvent?.(`dm:${threadId}`, "typing_start", {});
    } else if (val.length === 0 && wasTypingRef.current) {
      wasTypingRef.current = false;
      sendEvent?.(`dm:${threadId}`, "typing_stop", {});
    }
  };
  const send=async e=>{e.preventDefault();if(!text.trim())return;setSending(true);const body=text;setText("");wasTypingRef.current=false;sendEvent?.(`dm:${threadId}`,"typing_stop",{});try{const d=await api.post(`/threads/${threadId}/messages`,{body});if(d?.dm_lockout){setDmError(d);setText(body);}else{setDmError(null);setTimeout(()=>endRef.current?.scrollIntoView(),50);}}catch{setText(body);}finally{setSending(false);}};
  const sendImage=async file=>{
    if(!file)return;
    setUploading(true);
    try{
      const up=await api.upload("/uploads",file,{type:"post_image"});
      if(up.url){
        const body=`[![image](${up.url})](${up.original_url||up.url})`;
        await api.post(`/threads/${threadId}/messages`,{body});
        setTimeout(()=>endRef.current?.scrollIntoView(),50);
      } else toast(up.error||"Upload failed","err");
    }catch{toast("Upload failed","err");}
    finally{setUploading(false);if(imgRef.current)imgRef.current.value="";}
  };
  return (
    <>
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{height:48,borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"center",padding:"0 24px",gap:10,flexShrink:0}}>
        <span style={{fontSize:12,color:"var(--t4)",cursor:"pointer"}} onClick={()=>navigate("messages")}>← Messages</span>
        {resolvedImage&&<div style={{width:28,height:28,borderRadius:"50%",backgroundImage:`url(${resolvedImage})`,backgroundSize:"cover",backgroundPosition:"center",flexShrink:0}}/>}
        <span style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>{resolvedName}</span>
        {thread?.kind==="group"&&(String(thread?.creator_id)===String(currentUser?.id)||!thread?.creator_id)&&(
          <button onClick={()=>setShowSettings(true)} style={{marginLeft:"auto",width:30,height:30,borderRadius:"50%",background:"transparent",border:"none",cursor:"pointer",color:"var(--t4)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}} title="Group settings">
            <i className="fa-solid fa-gear" style={{fontSize:14}}/>
          </button>
        )}
        {thread&&<div style={{position:"relative",marginLeft:thread?.kind==="group"&&(String(thread?.creator_id)===String(currentUser?.id)||!thread?.creator_id)?0:"auto"}}>
          <button onClick={()=>setShowThreadMenu(p=>!p)} style={{width:30,height:30,borderRadius:"50%",background:"transparent",border:"none",cursor:"pointer",color:"var(--t4)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}} title="More options">
            <i className="fa-solid fa-ellipsis" style={{fontSize:14}}/>
          </button>
          {showThreadMenu&&<>
            <div style={{position:"fixed",inset:0,zIndex:99}} onClick={()=>setShowThreadMenu(false)}/>
            <div style={{position:"absolute",top:"calc(100% + 6px)",right:0,background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:10,padding:4,zIndex:100,minWidth:170,boxShadow:"0 8px 24px rgba(0,0,0,0.4)"}}>
              {thread?.kind==="group"&&String(thread?.creator_id)!==String(currentUser?.id)&&(
                <div style={{padding:"8px 12px",fontSize:13,color:"var(--red)",cursor:"pointer",borderRadius:7,display:"flex",alignItems:"center",gap:8}}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(248,113,113,0.08)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                  onClick={async()=>{
                    setShowThreadMenu(false);
                    if(!confirm("Leave this group?")) return;
                    await api.delete(`/threads/${thread.id}/members/${currentUser.id}`).catch(()=>{});
                    navigate("messages");
                  }}>
                  <i className="fa-solid fa-right-from-bracket" style={{fontSize:12}}/>Leave group
                </div>
              )}
              <div style={{padding:"8px 12px",fontSize:13,color:"var(--red)",cursor:"pointer",borderRadius:7,display:"flex",alignItems:"center",gap:8}}
                onMouseEnter={e=>e.currentTarget.style.background="rgba(248,113,113,0.08)"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                onClick={async()=>{
                  setShowThreadMenu(false);
                  const label=thread?.kind==="group"?"Delete this group and all messages?":"Delete this conversation?";
                  if(!confirm(label)) return;
                  await api.delete(`/threads/${thread.id}`).catch(()=>{});
                  navigate("messages");
                }}>
                <i className="fa-solid fa-trash" style={{fontSize:12}}/>
                {thread?.kind==="group"?"Delete group":"Delete conversation"}
              </div>
            </div>
          </>}
        </div>}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px",display:"flex",flexDirection:"column",gap:2}}>
        {messages.map((m,i)=>{
          const mine=m.user?.id===currentUser?.id;
          const prev=messages[i-1];
          const prevDay=prev?new Date(prev.inserted_at):null;
          const thisDay=m.inserted_at?new Date(m.inserted_at):null;
          const showDaySep=!prev||(thisDay&&prevDay&&(thisDay.getFullYear()!==prevDay.getFullYear()||thisDay.getMonth()!==prevDay.getMonth()||thisDay.getDate()!==prevDay.getDate()));
          return (
            <React.Fragment key={m.id}>
              {showDaySep&&<div style={{display:"flex",alignItems:"center",gap:10,margin:"12px 0 8px"}}>
                <div style={{flex:1,height:"0.5px",background:"var(--b1)"}}></div>
                <div style={{fontSize:11,color:"var(--t5)",fontWeight:500,whiteSpace:"nowrap"}}>{fmtDaySep(m.inserted_at)}</div>
                <div style={{flex:1,height:"0.5px",background:"var(--b1)"}}></div>
              </div>}
              <div className={mine?"mine":"theirs"} style={{display:"flex",flexDirection:"column",gap:2,marginBottom:4,alignItems:mine?"flex-end":"flex-start"}}>
                <div style={{display:"flex",alignItems:"flex-end",gap:6,flexDirection:mine?"row-reverse":"row",maxWidth:"72vw"}}>
                  <div className="bubble"><Md text={m.body}/></div>
                </div>
                <div style={{fontSize:10,color:"var(--t5)",paddingLeft:mine?0:4,paddingRight:mine?4:0}}>{fmtMsgTime(m.inserted_at)}</div>
              </div>
            </React.Fragment>
          );
        })}
        <div ref={endRef}/>
      </div>
      {typing&&<div className="theirs" style={{display:"flex",flexDirection:"column",gap:2,marginBottom:4,alignItems:"flex-start",padding:"0 20px"}}>
        <div style={{display:"flex",alignItems:"flex-end",gap:6}}>
          <div className="bubble" style={{display:"flex",alignItems:"center",gap:5,padding:"10px 16px",minWidth:56}}>
            {[0,1,2].map(i=><span key={i} style={{width:7,height:7,borderRadius:"50%",background:"var(--t3)",display:"inline-block",animation:`bounce 1.2s ${i*0.2}s infinite`}}/>)}
          </div>
        </div>
      </div>}
      {dmError
        ? <div style={{borderTop:"0.5px solid var(--b1)",padding:"14px 20px",display:"flex",alignItems:"center",gap:12,flexShrink:0,background:"rgba(251,191,36,0.04)"}}>
            <i className="fa-solid fa-clock" style={{fontSize:14,color:"var(--amber)",flexShrink:0}}/>
            <div style={{fontSize:13,color:"var(--t3)",lineHeight:1.5}}>
              <span style={{fontWeight:500,color:"var(--t2)"}}>DMs are temporarily restricted.</span>
              {dmError.hours_remaining > 0
                ? <span> You can send messages in {dmError.hours_remaining} hour{dmError.hours_remaining===1?"":"s"}.</span>
                : <span> You'll be able to send messages shortly.</span>}
            </div>
          </div>
        : <form onSubmit={send} style={{borderTop:"0.5px solid var(--b1)",padding:"10px 20px",display:"flex",alignItems:"flex-end",gap:8,flexShrink:0}}>
            <input ref={imgRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" style={{display:"none"}} onChange={e=>sendImage(e.target.files[0])}/>
            <button type="button" title="Attach image" onClick={()=>imgRef.current?.click()}
              style={{width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,0.05)",border:"0.5px solid var(--b2)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,color:"var(--t4)"}}>
              {uploading
                ?<i className="fa-solid fa-spinner fa-spin" style={{fontSize:12}}/>
                :<i className="fa-solid fa-image" style={{fontSize:13}}/>}
            </button>
            <div style={{flex:1,background:"rgba(255,255,255,0.04)",border:"0.5px solid var(--b2)",borderRadius:20,padding:"8px 16px"}}>
              <input style={{width:"100%",background:"transparent",border:"none",outline:"none",fontSize:13,color:"var(--t2)",fontFamily:"inherit"}} placeholder={`Message ${resolvedName||"…"}`} value={text} onChange={onTextChange}/>
            </div>
            <button type="submit" style={{width:36,height:36,borderRadius:"50%",background:"var(--ac)",border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}} disabled={!text.trim()||sending}>
              <i className="fa-solid fa-paper-plane" style={{fontSize:12,color:"var(--ac-on)"}}></i>
            </button>
          </form>
      }
    </div>        {showSettings&&thread&&<GroupSettingsModal
      thread={thread}
      currentUser={currentUser}
      onClose={()=>setShowSettings(false)}
      onUpdate={(updates)=>{
        if(updates.name) setResolvedName(updates.name);
        if(updates.image_url) setResolvedImage(updates.image_url);
        setThread(t=>({...t,...updates}));
      }}
    />}
    </>
  );
}

function GroupSettingsModal({thread, currentUser, onClose, onUpdate}) {
  const [name,setName]=useState(thread.name||"");
  const [members,setMembers]=useState(thread.members||[]);
  const [addUsername,setAddUsername]=useState("");
  const [addResults,setAddResults]=useState([]);
  const [searching,setSearching]=useState(false);
  const [saving,setSaving]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [previewImage,setPreviewImage]=useState(thread.image_url||null);
  const [imageFile,setImageFile]=useState(null);
  const imgRef=useRef();
  const debounceRef=useRef();

  const searchUsers=val=>{
    setAddUsername(val);
    clearTimeout(debounceRef.current);
    if(!val.trim()){setAddResults([]);return;}
    setSearching(true);
    debounceRef.current=setTimeout(async()=>{
      try{
        const d=await api.get(`/users?q=${encodeURIComponent(val)}`);
        const existing=new Set(members.map(m=>m.user_id));
        setAddResults((d.members||[]).filter(u=>!existing.has(u.id)&&u.id!==currentUser?.id));
      }finally{setSearching(false);}
    },200);
  };

  const addMember=async user=>{
    const d=await api.post(`/threads/${thread.id}/members`,{username:user.username});
    if(d.ok){
      setMembers(p=>[...p,{user_id:user.id,user:{id:user.id,username:user.username,avatar_url:user.avatar_url}}]);
      setAddUsername("");setAddResults([]);
    } else toast(d.error||"Failed","err");
  };

  const removeMember=async userId=>{
    const d=await api.delete(`/threads/${thread.id}/members/${userId}`);
    if(d.ok) setMembers(p=>p.filter(m=>m.user_id!==userId));
    else toast(d.error||"Failed","err");
  };

  const save=async()=>{
    setSaving(true);
    try{
      // Update name if changed
      if(name.trim()&&name!==thread.name){
        const d=await api.patch(`/threads/${thread.id}`,{name:name.trim()});
        if(d.thread) onUpdate({name:name.trim()});
        else{toast(d.error||"Failed","err");return;}
      }
      // Upload new image if selected
      if(imageFile){
        setUploading(true);
        const upData=await api.upload("/uploads",imageFile,{type:"group_image",thread_id:String(thread.id)});
        setUploading(false);
        if(upData.url) onUpdate({image_url:upData.url});
        else{toast("Image upload failed","err");return;}
      }
      toast("Group updated");
      onClose();
    }finally{setSaving(false);setUploading(false);}
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:400,padding:20}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:16,padding:24,width:"100%",maxWidth:440,display:"flex",flexDirection:"column",gap:16}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{fontSize:15,fontWeight:600,color:"var(--t1)"}}>Group settings</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"var(--t4)",fontSize:18,cursor:"pointer",lineHeight:1}}>✕</button>
        </div>

        {/* Avatar */}
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <input ref={imgRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" style={{display:"none"}}
            onChange={e=>{const f=e.target.files[0];if(f){setImageFile(f);setPreviewImage(URL.createObjectURL(f));}}}/>
          <div onClick={()=>imgRef.current?.click()} style={{width:64,height:64,borderRadius:"50%",flexShrink:0,cursor:"pointer",
            background:previewImage?`url(${previewImage}) center/cover`:"rgba(255,255,255,0.06)",
            border:"1.5px dashed var(--b2)",
            display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
            {!previewImage&&<i className="fa-solid fa-camera" style={{fontSize:18,color:"var(--t5)"}}/>}
          </div>
          <div>
            <div style={{fontSize:13,fontWeight:500,color:"var(--t2)"}}>Group photo</div>
            <div style={{fontSize:11,color:"var(--t5)",marginTop:2}}>Click to change</div>
          </div>
        </div>

        {/* Name */}
        <div>
          <label style={{fontSize:12,color:"var(--t4)",display:"block",marginBottom:6}}>Group name</label>
          <input className="fi" value={name} onChange={e=>setName(e.target.value)} placeholder="Group name…"/>
        </div>

        {/* Members */}
        <div>
          <label style={{fontSize:12,color:"var(--t4)",display:"block",marginBottom:6}}>Members</label>
          <div style={{border:"0.5px solid var(--b1)",borderRadius:10,overflow:"hidden",marginBottom:8}}>
            {members.map((m,i)=>(
              <div key={m.user_id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderBottom:i<members.length-1?"0.5px solid var(--b1)":"none"}}>
                <Av user={m.user} size={28}/>
                <span style={{flex:1,fontSize:13,color:"var(--t2)"}}>{m.user?.username}</span>
                {m.user_id===thread.creator_id
                  ?<span style={{fontSize:10,color:"var(--ac-text)",background:"var(--ac-bg)",border:"0.5px solid var(--ac-border)",borderRadius:20,padding:"2px 8px"}}>owner</span>
                  :<span style={{fontSize:11,color:"var(--red)",cursor:"pointer"}} onClick={()=>removeMember(m.user_id)}>Remove</span>
                }
              </div>
            ))}
          </div>
          {/* Add member search */}
          <div style={{position:"relative"}}>
            <input className="fi" placeholder="Add by username…" value={addUsername} onChange={e=>searchUsers(e.target.value)}
              style={{fontSize:12,padding:"7px 12px"}}/>
            {searching&&<i className="fa-solid fa-spinner fa-spin" style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",color:"var(--t5)",fontSize:11}}/>}
          </div>
          {addResults.length>0&&(
            <div style={{border:"0.5px solid var(--b1)",borderRadius:8,overflow:"hidden",marginTop:4}}>
              {addResults.map((u,i)=>(
                <div key={u.id} onClick={()=>addMember(u)}
                  style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px",cursor:"pointer",
                    borderBottom:i<addResults.length-1?"0.5px solid var(--b1)":"none",
                    background:"transparent"}}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.04)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <Av user={u} size={24}/>
                  <span style={{fontSize:12,color:"var(--t1)"}}>{u.username}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:4}}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{fontSize:13,padding:"7px 20px"}} onClick={save} disabled={saving||uploading||!name.trim()}>
            {saving||uploading?"Saving…":"Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DMNewPage({navigate, currentUser}) {
  const [mode,setMode]=useState("direct");
  const [query,setQuery]=useState("");
  const [results,setResults]=useState([]);
  const [searching,setSearching]=useState(false);
  const [selected,setSelected]=useState([]);
  const [groupName,setGroupName]=useState("");
  const [groupImage,setGroupImage]=useState(null); // {url, file} preview before thread exists
  const [loading,setLoading]=useState(false);
  const groupImgRef=useRef();
  const debounceRef=useRef();

  const search=val=>{
    setQuery(val);
    clearTimeout(debounceRef.current);
    if(!val.trim()){setResults([]);return;}
    setSearching(true);
    debounceRef.current=setTimeout(async()=>{
      try{const d=await api.get(`/users?q=${encodeURIComponent(val)}`);setResults((d.members||[]).filter(u=>u.id!==currentUser?.id));}
      finally{setSearching(false);}
    },200);
  };

  const startDirect=async user=>{
    setLoading(true);
    try{const d=await api.post("/threads/direct",{username:user.username});if(d.thread)navigate("dm",{threadId:d.thread.id,threadName:user.username});else toast(d.error||"Failed","err");}
    finally{setLoading(false);}
  };

  const toggleSelect=user=>setSelected(p=>p.find(u=>u.id===user.id)?p.filter(u=>u.id!==user.id):[...p,user]);

  const startGroup=async()=>{
    if(!groupName.trim()||selected.length===0)return;
    setLoading(true);
    try{
      const d=await api.post("/threads/group",{name:groupName,members:selected.map(u=>u.username)});
      if(!d.thread){toast(d.error||"Failed","err");return;}
      // Upload the group image if one was selected
      let serverImageUrl = null;
      if(groupImage?.file && d.thread?.id){
        const upData=await api.upload("/uploads",groupImage.file,{type:"group_image",thread_id:String(d.thread.id)});
        serverImageUrl = upData.url || null;
      }
      navigate("dm",{threadId:d.thread.id,threadName:groupName,threadImage:serverImageUrl||groupImage?.url||null});
    }finally{setLoading(false);}
  };

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column"}}>
      <div style={{height:48,borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"center",padding:"0 24px",gap:12,flexShrink:0}}>
        <span style={{fontSize:12,color:"var(--t4)",cursor:"pointer"}} onClick={()=>navigate("messages")}>← Messages</span>
        <span style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>New message</span>
      </div>
      <div style={{maxWidth:480,width:"100%",margin:"0 auto",padding:"24px 20px",display:"flex",flexDirection:"column",gap:16}}>
        <div style={{display:"flex",background:"rgba(255,255,255,0.04)",border:"0.5px solid var(--b1)",borderRadius:10,padding:3,gap:3}}>
          {["direct","group"].map(m=>(
            <button key={m} onClick={()=>{setMode(m);setQuery("");setResults([]);setSelected([]);}}
              style={{flex:1,padding:"7px 0",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:500,
                background:mode===m?"var(--s2)":"transparent",color:mode===m?"var(--t1)":"var(--t4)",
                boxShadow:mode===m?"0 1px 3px rgba(0,0,0,.3)":"none",transition:"all .15s"}}>
              {m==="direct"?"Direct message":"Group chat"}
            </button>
          ))}
        </div>

        {mode==="group"&&<input className="fi" placeholder="Group name…" value={groupName} onChange={e=>setGroupName(e.target.value)} autoFocus/>}

        {mode==="group"&&(
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <input ref={groupImgRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" style={{display:"none"}}
              onChange={e=>{const f=e.target.files[0];if(f)setGroupImage({file:f,url:URL.createObjectURL(f)});}}/>
            <div onClick={()=>groupImgRef.current?.click()} style={{width:56,height:56,borderRadius:"50%",flexShrink:0,cursor:"pointer",
              background:groupImage?.url?`url(${groupImage.url}) center/cover`:"rgba(255,255,255,0.06)",
              border:"1.5px dashed var(--b2)",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
              {!groupImage?.url&&<i className="fa-solid fa-camera" style={{fontSize:16,color:"var(--t5)"}}/>}
            </div>
            <div>
              <div style={{fontSize:13,color:"var(--t2)",fontWeight:500}}>Group photo</div>
              <div style={{fontSize:11,color:"var(--t5)",marginTop:2}}>{groupImage?.url?"Click to change":"Optional"}</div>
            </div>
            {groupImage?.url&&<span style={{fontSize:11,color:"var(--t4)",cursor:"pointer",marginLeft:"auto"}} onClick={()=>setGroupImage(null)}>Remove</span>}
          </div>
        )}

        <div style={{position:"relative"}}>
          <input className="fi" placeholder={mode==="direct"?"Search by username…":"Add people…"}
            value={query} onChange={e=>search(e.target.value)} autoFocus={mode==="direct"}/>
          {searching&&<i className="fa-solid fa-spinner fa-spin" style={{position:"absolute",right:14,top:"50%",transform:"translateY(-50%)",color:"var(--t5)",fontSize:12}}/>}
        </div>

        {mode==="group"&&selected.length>0&&(
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {selected.map(u=>(
              <div key={u.id} style={{display:"flex",alignItems:"center",gap:6,background:"var(--ac-bg)",border:"0.5px solid var(--ac-border)",borderRadius:20,padding:"4px 10px 4px 6px"}}>
                <span style={{fontSize:12,color:"var(--t2)"}}>{u.username}</span>
                <span style={{fontSize:11,color:"var(--t5)",cursor:"pointer"}} onClick={()=>toggleSelect(u)}>✕</span>
              </div>
            ))}
          </div>
        )}

        {results.length>0&&(
          <div style={{border:"0.5px solid var(--b1)",borderRadius:10,overflow:"hidden"}}>
            {results.map((u,i)=>{
              const isSel=!!selected.find(s=>s.id===u.id);
              return (
                <div key={u.id} onClick={()=>mode==="direct"?startDirect(u):toggleSelect(u)}
                  style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",cursor:"pointer",
                    background:isSel?"var(--ac-bg)":"transparent",
                    borderBottom:i<results.length-1?"0.5px solid var(--b1)":"none"}}>
                  <Av user={u} size={32}/>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:500,color:"var(--t1)"}}>{u.username}</div>
                    {u.role&&u.role!=="member"&&<div style={{fontSize:11,color:"var(--t4)"}}>{u.role}</div>}
                  </div>
                  {mode==="group"&&(
                    <div style={{width:18,height:18,borderRadius:"50%",border:`1.5px solid ${isSel?"var(--ac)":"var(--b2)"}`,background:isSel?"var(--ac)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      {isSel&&<i className="fa-solid fa-check" style={{fontSize:9,color:"var(--ac-on)"}}/>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {results.length===0&&query.length>0&&!searching&&(
          <div style={{textAlign:"center",padding:"24px 0",color:"var(--t5)",fontSize:13}}>No users found</div>
        )}

        {mode==="group"&&(
          <button className="btn-primary" style={{width:"100%",borderRadius:10,padding:10}}
            disabled={loading||selected.length===0||!groupName.trim()} onClick={startGroup}>
            {loading?"…":`Create group with ${selected.length} member${selected.length!==1?"s":""}`}
          </button>
        )}
      </div>
    </div>
  );
}


// ── Exports ───────────────────────────────────────────────────────────────────
export { DMInboxPage, DMPage, GroupSettingsModal, DMNewPage };
