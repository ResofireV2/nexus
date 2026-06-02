import { useState, useEffect, useRef } from "react";
import { api } from "../lib/api";
import { spaceColor, extractUnfurlableUrls } from "../lib/utils";
import { toast } from "../components/Toasts";
import { Select } from "../components/Select";

import { RichTextArea } from "../components/RichTextArea";
import { useDraftAutosave } from "./DraftsPage";

// ── ComposePage ───────────────────────────────────────────────────────────────

function ComposePage({spaces, tags, navigate, currentUser, pageProps={}}) {
  const resumeDraft = pageProps?.resumeDraft || null;
  const [title,setTitle]=useState(resumeDraft?.title||""); const [body,setBody]=useState(resumeDraft?.body||"");
  const [spaceId,setSpaceId]=useState(resumeDraft?.space_id||spaces.find(s=>!s.parent_id)?.id||"");
  const [subSpaceId,setSubSpaceId]=useState("");
  const [postType,setPostType]=useState(resumeDraft?.post_type||"discussion");
  const [postBody,setPostBody]=useState("");
  const [selTags,setSelTags]=useState(resumeDraft?.tag_ids||[]);
  const [showTagModal,setShowTagModal]=useState(false);
  const [tagModalSel,setTagModalSel]=useState([]);
  const [showTypeDd,setShowTypeDd]=useState(false);
  const [showSpaceDd,setShowSpaceDd]=useState(false);
  const [loading,setLoading]=useState(false);
  const [attachments,setAttachments]=useState([]);  // piece 4: generic compose attachments
  const typeDdRef=useRef(); const spaceDdRef=useRef();
  const submittingRef=useRef(false); // true while submit is in flight — suppresses autosave
  const toggleTag=id=>setSelTags(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);

  // Separate top-level spaces from sub-spaces
  const topLevelSpaces = spaces.filter(s => !s.parent_id);
  const selectedParentSpace = spaces.find(s => String(s.id) === String(spaceId));
  const childSpaces = spaces.filter(s => String(s.parent_id) === String(spaceId));
  // The effective space to post to: the chosen sub-space if one is selected,
  // otherwise the parent space itself
  const effectiveSpaceId = subSpaceId || spaceId;
  const selectedSpace = spaces.find(s => String(s.id) === String(effectiveSpaceId));

  // Attach composition tracker to the textarea once it mounts
  useEffect(()=>{
    const el = document.querySelector(".comp-ta");
    if (el && window.CompositionTracker) {
      window._composeTracker = new window.CompositionTracker(el);
    }
    return () => { window._composeTracker?.destroy(); window._composeTracker = null; };
  }, []);
  const TYPE_OPTS=[{v:"discussion",label:"Discussion",icon:"fa-comments"},{v:"question",label:"Question",icon:"fa-circle-question"}];
  const selectedType=TYPE_OPTS.find(t=>t.v===postType)||TYPE_OPTS[0];

  // Auto-save draft — if resuming, seed with existing draft ID so we PATCH not POST
  const { draftId, lastSaved, saveDraft, clearDraft } = useDraftAutosave({
    type: "post",
    enabled: !!currentUser,
    initialDraftId: resumeDraft?.id || null,
  });

  const triggerSave = () => {
    saveDraft({
      title, body, post_type: postType,
      space_id: effectiveSpaceId ? parseInt(effectiveSpaceId) : null,
      tag_ids: selTags,
    });
  };

  useEffect(()=>{
    const fn=e=>{
      if(typeDdRef.current&&!typeDdRef.current.contains(e.target))setShowTypeDd(false);
      if(spaceDdRef.current&&!spaceDdRef.current.contains(e.target))setShowSpaceDd(false);
    };
    document.addEventListener("mousedown",fn); return ()=>document.removeEventListener("mousedown",fn);
  },[]);

  // Trigger autosave whenever content changes — but never while submit is in flight
  useEffect(()=>{ if((title||body) && !submittingRef.current) triggerSave(); },[title,body,postType,spaceId,subSpaceId,selTags]);

  const submit=async()=>{
    if(!title.trim()){toast("Title required","err");return;}
    if(!effectiveSpaceId){toast("Select a space","err");return;}
    submittingRef.current = true;
    setLoading(true);
    const compositionSignals = window._composeTracker ? window._composeTracker.snapshot() : null;
    try { const d=await api.post("/posts",{title,body,type:postType,space_id:parseInt(effectiveSpaceId),tag_ids:selTags,compositionSignals,attachments});
      if(d.post&&d.pending){await clearDraft();toast("Your post is pending moderator approval","ok");navigate("feed");}
      else if(d.post){
        await clearDraft();
        if(window._lpRegisterFresh) window._lpRegisterFresh(extractUnfurlableUrls(body));
        toast("Post published!");navigate("post",{id:d.post.id});
      }
      else toast(d.error||"Failed","err"); }
    finally { setLoading(false); }
  };
  return (
    <div className="composer-shell">
      <div style={{height:48,borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"center",padding:"0 28px",flexShrink:0}}>
        <span style={{fontSize:12,color:"var(--t4)",cursor:"pointer",display:"flex",alignItems:"center",gap:6}} onClick={()=>navigate("feed")}>
          <i className="fa-solid fa-arrow-left"></i> back to feed
        </span>
      </div>
      <div className="composer-inner">
        <input className="comp-title-input" placeholder="Thread title…" value={title} onChange={e=>setTitle(e.target.value)} autoFocus/>
        <div className="comp-meta-row">
          {/* Post type dropdown */}
          {window._postCfg?.questions_enabled&&(
            <div ref={typeDdRef} style={{position:"relative"}}>
              <div className="comp-type-btn" onClick={()=>setShowTypeDd(p=>!p)}>
                <i className={`fa-solid ${selectedType.icon}`} style={{fontSize:14,color:"var(--ac-text)"}}/>
                {selectedType.label}
                <i className="fa-solid fa-chevron-down" style={{fontSize:10,color:"var(--t5)",marginLeft:2}}/>
              </div>
              {showTypeDd&&(
                <div className="comp-dd">
                  {TYPE_OPTS.map(opt=>(
                    <div key={opt.v} className={`comp-dd-item${postType===opt.v?" active":""}`}
                      onClick={()=>{setPostType(opt.v);setShowTypeDd(false);}}>
                      <i className={`fa-solid ${opt.icon}`} style={{fontSize:14,width:18,textAlign:"center"}}/>
                      {opt.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Space dropdown */}
          <div ref={spaceDdRef} style={{position:"relative"}}>
            <div className="comp-type-btn" onClick={()=>setShowSpaceDd(p=>!p)}>
              {selectedParentSpace
                ?<><i className={`fa-solid ${selectedParentSpace.icon||"fa-layer-group"}`} style={{fontSize:14,color:selectedParentSpace.color||"var(--ac)"}}/>
                  {selectedParentSpace.name}</>
                :<><i className="fa-solid fa-layer-group" style={{fontSize:14,color:"var(--t5)"}}/>Select space…</>
              }
              <i className="fa-solid fa-chevron-down" style={{fontSize:10,color:"var(--t5)",marginLeft:2}}/>
            </div>
            {showSpaceDd&&(
              <div className="comp-dd" style={{maxHeight:280,overflowY:"auto"}}>
                {topLevelSpaces.map(s=>{
                  const sc=s.color||spaceColor(s);
                  return (
                    <div key={s.id} className={`comp-dd-item${String(spaceId)===String(s.id)?" active":""}`}
                      onClick={()=>{setSpaceId(s.id);setSubSpaceId("");setShowSpaceDd(false);}}>
                      <i className={`fa-solid ${s.icon||"fa-layer-group"}`} style={{fontSize:14,color:sc,width:18,textAlign:"center"}}/>
                      {s.name}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {/* Sub-space step — only shown when selected parent has sub-spaces */}
          {childSpaces.length > 0 && (
            <select className="comp-type-btn"
              value={subSpaceId}
              onChange={e=>setSubSpaceId(e.target.value)}
              style={{background:"transparent",border:"0.5px solid var(--b2)",outline:"none",
                color:subSpaceId?"var(--t1)":"var(--t4)",fontFamily:"inherit",
                fontSize:"inherit",cursor:"pointer",borderRadius:20,padding:"5px 12px"}}>
              <option value="">Post to {selectedParentSpace?.name}…</option>
              {childSpaces.map(sub=>(
                <option key={sub.id} value={String(sub.id)}>{sub.name}</option>
              ))}
            </select>
          )}
          {/* Selected tags */}
          {selTags.map(id=>{const t=tags.find(x=>x.id===id);return t?(
            <span key={id} className="comp-tag-pill" onClick={()=>toggleTag(id)}
              style={{background:t.color?`${t.color}22`:"var(--ac-bg)",color:t.color||"var(--ac-text)",borderColor:t.color?`${t.color}44`:"var(--ac-border)"}}>
              #{t.name}<i className="fa-solid fa-xmark" style={{fontSize:11}}/>
            </span>
          ):null;})}
          {/* Tags button */}
          {tags.length>0&&(
            <div className="comp-tag-add" onClick={()=>{setTagModalSel([...selTags]);setShowTagModal(true);}}>
              <i className="fa-solid fa-tag" style={{fontSize:13}}/>
              {selTags.length>0?`${selTags.length} tag${selTags.length>1?"s":""}`:"+ tags"}
            </div>
          )}
        </div>
        {/* Tag modal */}
        {showTagModal&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:9000,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
            <div style={{background:"var(--s1)",border:"0.5px solid var(--b2)",borderRadius:16,width:"100%",maxWidth:560,boxShadow:"0 8px 48px rgba(0,0,0,.6)"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"18px 24px",borderBottom:"0.5px solid var(--b1)"}}>
                <span style={{fontSize:16,fontWeight:500,color:"var(--t1)"}}>Select tags</span>
                <button onClick={()=>setShowTagModal(false)} style={{background:"none",border:"none",color:"var(--t4)",fontSize:20,cursor:"pointer",lineHeight:1}}>×</button>
              </div>
              <div style={{padding:"16px 24px",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:10,maxHeight:360,overflowY:"auto"}}>
                {tags.map(t=>{
                  const sel=tagModalSel.includes(t.id);
                  const tc=t.color||"var(--ac)";
                  return (
                    <div key={t.id} onClick={()=>setTagModalSel(p=>sel?p.filter(x=>x!==t.id):[...p,t.id])}
                      style={{padding:"10px 14px",borderRadius:10,cursor:"pointer",border:`1.5px solid ${sel?tc:"var(--b1)"}`,
                        background:sel?`${tc}18`:"var(--s2)",color:sel?tc:"var(--t3)",transition:"all .1s",
                        display:"flex",alignItems:"center",gap:8,fontSize:14,fontWeight:sel?500:400}}>
                      {sel&&<i className="fa-solid fa-check" style={{fontSize:12,flexShrink:0}}/>}
                      #{t.name}
                    </div>
                  );
                })}
              </div>
              <div style={{padding:"16px 24px",borderTop:"0.5px solid var(--b1)",display:"flex",justifyContent:"flex-end",gap:10}}>
                <button className="btn-ghost" style={{fontSize:14}} onClick={()=>{setTagModalSel([]);setShowTagModal(false);}}>Clear</button>
                <button className="btn-primary" style={{fontSize:14,padding:"8px 20px"}} onClick={()=>{setSelTags(tagModalSel);setShowTagModal(false);}}>
                  {tagModalSel.length>0?`Add ${tagModalSel.length} tag${tagModalSel.length>1?"s":""}`:"Add tags"}
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="comp-body-area">
          <RichTextArea value={body} onChange={setBody} placeholder="What's on your mind…" minHeight={240} autoFocus={false} currentUser={currentUser} attachments={attachments} setAttachments={setAttachments} context="post"/>
        </div>
        <ComposeAttachmentsSlot attachments={attachments} setAttachments={setAttachments}/>
        <div className="comp-footer">
          <span className="comp-char">{body.length} characters</span>
          {lastSaved && (
            <span style={{fontSize:12, color:"var(--t5)", display:"flex", alignItems:"center", gap:5, marginLeft:12}}>
              <i className="fa-solid fa-cloud-arrow-up" style={{fontSize:11, color:"var(--green)"}}/>
              Draft saved
            </span>
          )}
          <button className="btn-primary" style={{marginLeft:"auto"}} onClick={submit} disabled={loading||!title.trim()}>{loading?"Publishing…":"Publish"}</button>
        </div>
      </div>
    </div>

  );
}

// Renders the compose_attachments slot — extension components displayed below
// the post body, above the footer. Each extension receives the live attachments
// array and setAttachments so it can display and remove its linked items.
// Returns null when no extensions have registered for this slot.
function ComposeAttachmentsSlot({attachments, setAttachments}) {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const unsub = window.NexusExtensions.onToolbarChange(() => forceUpdate(n => n+1));
    return unsub;
  }, []);
  const components = window.NexusExtensions.getSlot("compose_attachments");
  if (!components.length) return null;
  const slotProps = window.NexusExtensions.propsForSlot("compose_attachments", {
    attachments,
    setAttachments,
  });
  return (
    <div className="compose-attachments-slot">
      {components.map(({component: Comp}, i) => (
        <Comp key={i} {...slotProps}/>
      ))}
    </div>
  );
}

export { ComposePage };
