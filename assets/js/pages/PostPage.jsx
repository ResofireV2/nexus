import { useState, useEffect, useRef, useReducer, useCallback, useMemo } from "react";
import { api } from "../lib/api";
import { ago, fmtDate, userColor, spaceColor, formatApiErrors, extractUnfurlableUrls } from "../lib/utils";
import { toast } from "../components/Toasts";
import { RsAv, Av, openUserCard } from "../components/Avatar";


import { Select } from "../components/Select";
import { Md } from "../components/Markdown";
import { ReactionsModal, ReactionButton } from "../components/Reactions";
import { RichTextArea } from "../components/RichTextArea";
import { useDraftAutosave } from "./DraftsPage";
import { useScrubberModel, pctFromPointer, thinPips, keyboardTargetIndex, PIP_BUDGET } from "../lib/scrubber";
// Debounce before persisting the read position. One value for every path —
// the old code used 500ms on jump and 1500ms on scroll for no clear reason.
const SAVE_DEBOUNCE_MS = 1000;

function PostScrubber({replies, lastReadReplyId, postId, currentUser, onSavePosition, scrubber, firstUnreadIdx}) {
  const trackRef   = useRef(null);
  const saveTimer  = useRef(null);
  const maxReadIdx = useRef(lastReadReplyId
    ? replies.findIndex(r => r.id === lastReadReplyId)
    : -1);
  const [readIdx, setReadIdx] = useState(maxReadIdx.current);

  const { scrollPct, index: displayIdx, pips, jumpTo, dragStart, dragTo, dragEnd, indexAtPct } = scrubber;
  // Track position the pointer is hovering (or dragging), for the preview card.
  const [hoverPct, setHoverPct] = useState(null);

  // Advance the read high-water mark from the measured index, so a reply is
  // only marked read once it has actually been on screen. The old percentage
  // math marked replies read that the user never saw.
  useEffect(() => {
    if (displayIdx <= maxReadIdx.current) return;
    maxReadIdx.current = displayIdx;
    setReadIdx(displayIdx);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const r = replies[displayIdx];
      if (currentUser && r) {
        api.post('/posts/' + postId + '/read-position', {last_reply_id: r.id, reply_count: displayIdx + 1}).catch(() => {});
        if (onSavePosition) onSavePosition(r.id, displayIdx + 1);
      }
    }, SAVE_DEBOUNCE_MS);
  }, [displayIdx, postId]);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // Thin the pips on very long threads so we aren't positioning hundreds of
  // overlapping 2px divs.
  const shownPips = useMemo(
    () => replies.length > PIP_BUDGET ? thinPips(pips, 0.8) : pips.map((pct, i) => ({pct, i})),
    [pips, replies.length]
  );

  // Two static pip layers. Only the clip on the lit layer changes as you
  // scroll, so scrolling never re-renders the pips themselves.
  const pipStyle = (pct, colour) => ({
    position: "absolute", left: "50%", transform: "translateX(-50%)",
    top: pct + "%", marginTop: -1, width: 6, height: 2, borderRadius: 1,
    background: colour, pointerEvents: "none",
  });
  const dimPips = useMemo(() => shownPips.map(p => (
    <div key={p.i} title={"Reply " + (p.i + 1)} style={pipStyle(p.pct, "rgba(255,255,255,0.12)")}/>
  )), [shownPips]);
  const litPips = useMemo(() => shownPips.map(p => (
    <div key={p.i} style={pipStyle(p.pct, "var(--ac-text)")}/>
  )), [shownPips]);

  const readPct = pips.length && readIdx >= 0 ? pips[Math.min(readIdx, pips.length - 1)] : 0;

  // Pointer events rather than mouse events: one code path covers mouse and
  // touch, and pointer capture keeps the drag alive outside the track without
  // document-level listeners.
  function pointerDown(e) {
    const el = trackRef.current;
    if (!el) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    dragStart();
    dragTo(pctFromPointer(el, e.clientY));
  }
  function pointerMove(e) {
    const el = trackRef.current;
    if (!el) return;
    const pct = pctFromPointer(el, e.clientY);
    setHoverPct(pct);
    // While the pointer is captured this is a drag; otherwise it's just hover.
    if (el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) dragTo(pct);
  }
  function pointerLeave(e) {
    const el = trackRef.current;
    // Pointer capture keeps the drag alive outside the track — don't drop the
    // preview mid-drag.
    if (el && el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) return;
    setHoverPct(null);
  }
  function pointerUp(e) {
    const el = trackRef.current;
    if (el && el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) {
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    dragEnd();
  }

  const previewIdx = hoverPct === null ? null : indexAtPct(hoverPct);
  const hasUnread  = firstUnreadIdx >= 0 && firstUnreadIdx < replies.length;

  const jumpBtnStyle = {
    background:"none", border:"none", padding:"2px 4px", cursor:"pointer",
    color:"var(--t4)", fontSize:11, lineHeight:1, fontFamily:"inherit",
  };

  function onKeyDown(e) {
    const next = keyboardTargetIndex(e.key, displayIdx, replies.length);
    if (next === null) return;
    e.preventDefault();
    jumpTo(next);
  }

  return (
    <div className="desk-scrubber-panel" style={{width:44,flexShrink:0,borderLeft:"0.5px solid var(--b1)",display:"flex",flexDirection:"column",alignItems:"center",padding:"16px 0",gap:4,background:"var(--s1)",userSelect:"none"}}>
      <div style={{fontSize:10,color:"var(--t5)",marginBottom:2}}>{replies.length}</div>
      <div style={{fontSize:9,color:"var(--t5)",marginBottom:8}}>replies</div>
      {hasUnread && (
        <button type="button" onClick={()=>jumpTo(firstUnreadIdx)}
          title="Jump to first unread" aria-label="Jump to first unread reply"
          style={{...jumpBtnStyle, color:"var(--green)", marginBottom:2}}>
          <i className="fa-solid fa-circle-dot"/>
        </button>
      )}
      {/* Full-width hit area — the track is visual only, this div captures all pointer input */}
      <div ref={trackRef}
        className="scrubber-track"
        role="slider" tabIndex={0}
        aria-label="Thread position"
        aria-orientation="vertical"
        aria-controls="post-replies"
        aria-valuemin={1} aria-valuemax={replies.length} aria-valuenow={displayIdx+1}
        aria-valuetext={`Reply ${displayIdx+1} of ${replies.length}`}
        onKeyDown={onKeyDown}
        onPointerDown={pointerDown} onPointerMove={pointerMove}
        onPointerUp={pointerUp} onPointerCancel={pointerUp}
        onPointerLeave={pointerLeave}
        style={{flex:1,width:"100%",position:"relative",cursor:"grab",margin:"4px 0",display:"flex",alignItems:"center",justifyContent:"center",touchAction:"none"}}>
        {/* Track background */}
        <div style={{position:"absolute",top:0,bottom:0,left:"50%",transform:"translateX(-50%)",width:4,background:"rgba(255,255,255,0.08)",borderRadius:2,pointerEvents:"none"}}/>
        {/* Read high-water fill */}
        <div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:4,borderRadius:2,background:"var(--ac-bg)",height:readPct+"%",pointerEvents:"none"}}/>
        {/* Scroll position fill */}
        <div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:4,borderRadius:2,background:"var(--ac)",height:scrollPct+"%",pointerEvents:"none"}}/>
        {dimPips}
        <div style={{position:"absolute",inset:0,pointerEvents:"none",clipPath:"inset(0 0 "+(100-scrollPct)+"% 0)"}}>{litPips}</div>
        {/* Where you left off last visit — captured once, so it doesn't creep
            forward as you read */}
        {hasUnread && firstUnreadIdx < pips.length && (
          <div title="First unread" style={{
            position:"absolute",left:"50%",transform:"translateX(-50%)",
            top:pips[firstUnreadIdx]+"%",marginTop:-1,
            width:14,height:2,borderRadius:1,
            background:"var(--green)",pointerEvents:"none",zIndex:2
          }}/>
        )}
        {/* Hover / drag preview of the reply at that position */}
        {previewIdx !== null && replies[previewIdx] && (
          <div style={{
            position:"absolute",right:"100%",marginRight:10,
            top:hoverPct+"%",transform:"translateY(-50%)",
            width:210,padding:"8px 10px",borderRadius:8,
            background:"var(--s2)",border:"0.5px solid var(--b2)",
            boxShadow:"0 4px 16px rgba(0,0,0,0.35)",
            pointerEvents:"none",zIndex:5,textAlign:"left"
          }}>
            <div style={{fontSize:11,fontWeight:500,color:"var(--ac-text)",marginBottom:3}}>
              {replies[previewIdx].user?.username||"?"} · {previewIdx+1}/{replies.length}
            </div>
            <div style={{fontSize:11,color:"var(--t3)",lineHeight:1.4,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>
              {replies[previewIdx].body?.slice(0,90)||""}
            </div>
          </div>
        )}
        {/* Thumb */}
        <div style={{
          position:"absolute",left:"50%",transform:"translate(-50%,-50%)",
          top:scrollPct+"%",width:14,height:14,borderRadius:"50%",
          background:"var(--ac)",border:"2px solid var(--s1)",
          zIndex:3,pointerEvents:"none"
        }}/>
      </div>
      <button type="button" onClick={()=>jumpTo(replies.length-1)}
        title="Jump to latest reply" aria-label="Jump to latest reply"
        style={{...jumpBtnStyle, marginTop:2}}>
        <i className="fa-solid fa-angles-down"/>
      </button>
      <div style={{fontSize:10,color:"var(--t4)",marginTop:4}}>{displayIdx+1}/{replies.length}</div>
    </div>
  );
}

function lcs(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length:m+1}, ()=>new Array(n+1).fill(0));
  for(let i=1;i<=m;i++) for(let j=1;j<=n;j++)
    dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1]+1 : Math.max(dp[i-1][j],dp[i][j-1]);
  const ops = [];
  let i=m,j=n;
  while(i>0||j>0){
    if(i>0&&j>0&&a[i-1]===b[j-1]){ops.unshift({t:'eq',v:a[i-1]});i--;j--;}
    else if(j>0&&(i===0||dp[i][j-1]>=dp[i-1][j])){ops.unshift({t:'add',v:b[j-1]});j--;}
    else{ops.unshift({t:'del',v:a[i-1]});i--;}
  }
  return ops;
}

function wordDiff(before, after) {
  // Diff line by line first, then word-level within changed lines.
  // This prevents words that exist in both versions from being matched
  // across line boundaries, which causes false highlighting.
  const aLines = (before||"").split("\n");
  const bLines = (after||"").split("\n");
  const lineOps = lcs(aLines, bLines);
  const result = [];
  lineOps.forEach((op, li) => {
    if(op.t === 'eq') {
      result.push({t:'eq', v: op.v + (li < lineOps.length-1 ? "\n" : "")});
    } else if(op.t === 'add') {
      result.push({t:'add', v: op.v + (li < lineOps.length-1 ? "\n" : "")});
    } else {
      // For deleted lines, do word-level diff against the next added line if adjacent
      const nextOp = lineOps[li+1];
      if(nextOp && nextOp.t === 'add') {
        // word-level diff between this deleted line and the paired added line
        const wordOps = lcs(op.v.split(" "), nextOp.v.split(" "));
        wordOps.forEach(wo => result.push(wo));
        result.push({t:'eq', v:"\n"});
      } else {
        result.push({t:'del', v: op.v + "\n"});
      }
    }
  });
  return result;
}

function DiffView({before, after, mode}) {
  // mode="plain"  — no highlighting, just render the text as-is
  // mode="after"  — highlight additions (green) and removals (red strikethrough)
  if(mode==="plain") {
    return <div style={{fontSize:"var(--fs-body)",lineHeight:1.75,color:"var(--t2)",whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{before}</div>;
  }
  // wordDiff is O(m×n) LCS — memoize so it only re-runs when the text changes
  const ops = useMemo(() => wordDiff(before||"", after||""), [before, after]);
  return (
    <div style={{fontSize:"var(--fs-body)",lineHeight:1.75,color:"var(--t2)",whiteSpace:"pre-wrap",wordBreak:"break-word"}}>
      {ops.map((op,i)=>(
        op.t==="eq"  ? <span key={i}>{op.v}</span> :
        op.t==="add" ? <span key={i} style={{background:"rgba(52,211,153,0.2)",color:"var(--green)",borderRadius:2}}>{op.v}</span> :
                       <span key={i} style={{background:"rgba(248,113,113,0.15)",color:"var(--red)",textDecoration:"line-through",borderRadius:2}}>{op.v}</span>
      ))}
    </div>
  );
}

function EditHistoryModal({postId, replyId, editCount, onClose}) {
  const [edits, setEdits] = useState(null);
  const [loading, setLoading] = useState(true);
  const ref = useRef();

  useEffect(()=>{
    const url = postId ? `/posts/${postId}/edits` : `/posts/${replyId?.postId}/replies/${replyId?.id}/edits`;
    api.get(url).then(d=>{ setEdits(d.edits||[]); setLoading(false); }).catch(()=>setLoading(false));
  },[postId, replyId]);

  useEffect(()=>{
    const fn = e=>{ if(ref.current&&!ref.current.contains(e.target)) onClose(); };
    const esc = e=>{ if(e.key==="Escape") onClose(); };
    document.addEventListener("mousedown",fn);
    document.addEventListener("keydown",esc);
    return ()=>{ document.removeEventListener("mousedown",fn); document.removeEventListener("keydown",esc); };
  },[]);

  // Build pairs: each edit shows [that edit's old content] vs [next edit's old content or current]
  const buildPairs = (edits, currentBody, currentTitle) => {
    if(!edits||edits.length===0) return [];
    // edits are newest-first. pairs[0] = most recent edit: before=edits[0].old, after=current
    return edits.map((e,i)=>({
      edit: e,
      before_title: e.old_title,
      before_body:  e.old_body,
      after_title:  i===0 ? currentTitle : edits[i-1].old_title,
      after_body:   i===0 ? currentBody  : edits[i-1].old_body,
    }));
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:9000,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"24px 16px",overflowY:"auto"}}>
      <div ref={ref} style={{background:"var(--s1)",border:"0.5px solid var(--b2)",borderRadius:16,width:"100%",maxWidth:900,boxShadow:"0 8px 48px rgba(0,0,0,.6)",flexShrink:0}}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"18px 24px",borderBottom:"0.5px solid var(--b1)"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <i className="fa-solid fa-clock-rotate-left" style={{fontSize:16,color:"var(--t3)"}}/>
            <span style={{fontSize:16,fontWeight:500,color:"var(--t1)"}}>Edit history</span>
            <span style={{fontSize:13,color:"var(--t5)"}}>{editCount} edit{editCount!==1?"s":""}</span>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"var(--t4)",fontSize:20,cursor:"pointer",lineHeight:1,padding:"0 4px"}}>×</button>
        </div>
        {/* Body */}
        <div style={{padding:"20px 24px"}}>
          {loading&&<div style={{textAlign:"center",color:"var(--t5)",padding:"40px 0",fontSize:"var(--fs-body)"}}>Loading…</div>}
          {!loading&&edits&&edits.length===0&&<div style={{textAlign:"center",color:"var(--t5)",padding:"40px 0",fontSize:"var(--fs-body)"}}>No edit history found.</div>}
          {!loading&&edits&&edits.length>0&&(
            <EditHistoryPairs edits={edits} postId={postId} replyId={replyId}/>
          )}
        </div>
      </div>
    </div>
  );
}

function EditHistoryPairs({edits, postId, replyId}) {
  // Fetch current content once
  const [current, setCurrent] = useState(null);
  useEffect(()=>{
    if(postId) api.get(`/posts/${postId}`).then(d=>setCurrent(d.post)).catch(()=>{});
  },[postId]);

  const currentBody  = current?.body  || "";
  const currentTitle = current?.title || null;

  const pairs = edits.map((e,i)=>({
    edit:         e,
    before_title: e.old_title,
    before_body:  e.old_body,
    after_title:  i===0 ? currentTitle        : edits[i-1].old_title,
    after_body:   i===0 ? currentBody         : edits[i-1].old_body,
    label:        i===0 ? "Current version"   : `After edit ${edits.length - i}`,
  }));

  return (
    <div style={{display:"flex",flexDirection:"column",gap:24}}>
      {pairs.map((pair,i)=>(
        <div key={pair.edit.id} style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden"}}>
          {/* Edit header */}
          <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",background:"var(--s2)",borderBottom:"0.5px solid var(--b1)"}}>
            <span style={{fontSize:"var(--fs-body)",fontWeight:500,color:"var(--t2)"}}>Edit {edits.length - i}</span>
            <span style={{fontSize:13,color:"var(--t5)"}}>·</span>
            <span style={{fontSize:13,color:"var(--t4)"}}>{pair.edit.editor?.username}</span>
            <span style={{fontSize:13,color:"var(--t5)"}}>·</span>
            <span style={{fontSize:13,color:"var(--t5)"}}>{ago(pair.edit.edited_at)}</span>
          </div>
          {/* Title diff if changed */}
          {pair.before_title&&pair.after_title&&pair.before_title!==pair.after_title&&(
            <div style={{padding:"12px 16px",borderBottom:"0.5px solid var(--b1)",background:"var(--bg)"}}>
              <div style={{fontSize:12,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:".5px",marginBottom:8}}>Title</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div>
                  <div style={{fontSize:12,color:"var(--red)",marginBottom:6,fontWeight:500}}>Before</div>
                  <div style={{fontSize:"var(--fs-body)",color:"var(--t2)",fontWeight:500,background:"rgba(248,113,113,0.08)",padding:"8px 12px",borderRadius:8}}>{pair.before_title}</div>
                </div>
                <div>
                  <div style={{fontSize:12,color:"var(--green)",marginBottom:6,fontWeight:500}}>After</div>
                  <div style={{fontSize:"var(--fs-body)",color:"var(--t2)",fontWeight:500,background:"rgba(52,211,153,0.08)",padding:"8px 12px",borderRadius:8}}>{pair.after_title}</div>
                </div>
              </div>
            </div>
          )}
          {/* Body diff */}
          <div style={{padding:"16px",background:"var(--bg)"}}>
            <div style={{fontSize:12,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:".5px",marginBottom:12}}>Content</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
              <div>
                <div style={{fontSize:13,color:"var(--t4)",marginBottom:8,fontWeight:500}}>Before</div>
                <div style={{background:"var(--s2)",border:"0.5px solid var(--b1)",borderRadius:10,padding:"14px 16px"}}>
                  <DiffView before={pair.before_body} after={pair.after_body} mode="plain"/>
                </div>
              </div>
              <div>
                <div style={{fontSize:13,color:"var(--green)",marginBottom:8,fontWeight:500}}>After</div>
                <div style={{background:"rgba(52,211,153,0.05)",border:"0.5px solid rgba(52,211,153,0.2)",borderRadius:10,padding:"14px 16px"}}>
                  <DiffView before={pair.before_body} after={pair.after_body} mode="after"/>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PostPage({postId, currentUser, navigate, spaces, tags=[], onAuthRequired, joinTopic, leaveTopic, sendEvent, openReport, scrollToReply, resumeDraft=null}) {
  const [post,setPost]=useState(null); const [replies,setReplies]=useState([]);
  const [loading,setLoading]=useState(true); const [replyBody,setReplyBody]=useState(resumeDraft?.body||"");
  // Piece 4: generic compose attachments. Toolbar buttons in the reply
  // composer call attach({kind, data}); these get serialized into the
  // POST /replies request body and dispatched to declaring extensions.
  const [replyAttachments,setReplyAttachments]=useState([]);
  const [submitting,setSubmitting]=useState(false);
  const [replyCursor,setReplyCursor]=useState(null);
  const [replyHasMore,setReplyHasMore]=useState(false);
  const replyLoadingRef=useRef(false);
  const replyCursorRef=useRef(null);
  const replyHasMoreRef=useRef(false);
  const replySentinelRef=useRef();
  const [userReaction,setUserReaction]=useState(null);
  const [reportTarget,setReportTarget]=useState(null);
  const [reportReason,setReportReason]=useState("");
  const [reportNotes,setReportNotes]=useState("");
  const [reporting,setReporting]=useState(false);
  const [quoteTooltip,setQuoteTooltip]=useState(null);
  const [typingUsers,setTypingUsers]=useState([]);
  const [lastReadReplyId, setLastReadReplyId] = useState(undefined);
  const [lastReadCount, setLastReadCount] = useState(0);
  const repliesContainerRef = useRef(null);
  // One shared scrubber model for the desktop panel, the mobile pill and the
  // jump sheet — previously each derived its own position independently, with
  // two separate scroll listeners on the same container.
  const scrubber = useScrubberModel(repliesContainerRef, replies);
  // "Where you left off" — captured the first time both the replies and the
  // saved read position are available, then frozen. Recomputing it as you read
  // would make the marker creep forward instead of marking the spot.
  const firstUnreadRef = useRef(null);
  if (firstUnreadRef.current === null && replies.length && lastReadReplyId) {
    const i = replies.findIndex(r => r.id === lastReadReplyId);
    firstUnreadRef.current = (i >= 0 && i + 1 < replies.length) ? i + 1 : -1;
  }
  const firstUnreadIdx = firstUnreadRef.current === null ? -1 : firstUnreadRef.current;
  const [mobSheetOpen, setMobSheetOpen] = useState(false);
  const [mobReplyOpen, setMobReplyOpen] = useState(false);
  const composerRef = useRef();
  const replyBodyRef = useRef(replyBody);
  const typingTimers = useRef({});
  const [postSaved, setPostSaved] = useState(false);
  const [postFollowed, setPostFollowed] = useState(false);
  const [savedReplyIds, setSavedReplyIds] = useState(new Set());
  useEffect(()=>{ replyBodyRef.current = replyBody; },[replyBody]);

  // Reply draft autosave
  const { lastSaved: draftLastSaved, saveDraft, clearDraft } = useDraftAutosave({
    type: "reply",
    postId: parseInt(postId),
    enabled: !!currentUser,
    initialDraftId: resumeDraft?.id || null,
  });

  useEffect(()=>{
    if (post) {
      _refDataMap[`#post-${post.id}`] = {
        username: post.user?.username,
        avatar_url: post.user?.avatar_url,
        userId: post.user?.id,
        body: post.body,
        inserted_at: post.inserted_at
      };
    }
    replies.forEach(r => {
      _refDataMap[`#reply-${r.id}`] = {
        username: r.user?.username,
        avatar_url: r.user?.avatar_url,
        userId: r.user?.id,
        body: r.body,
        inserted_at: r.inserted_at
      };
    });
  }, [post, replies]);

  // Join post channel for realtime replies + typing
  useEffect(()=>{
    if(!postId) return;
    joinTopic?.(`post:${postId}`);
    return ()=>{ leaveTopic?.(`post:${postId}`); };
  },[postId]);

  // Listen for realtime events
  useEffect(()=>{
    const replyFn = e => {
      if(String(e.detail.postId)===String(postId) && e.detail.reply) {
        if(window._lpRegisterFresh) window._lpRegisterFresh(extractUnfurlableUrls(e.detail.reply.body));
        setReplies(p => {
          // If we already have this reply (posted by the current user and added
          // optimistically in submitReply), do not add it again and do not
          // increment reply_count a second time.
          if(p.some(r => r.id === e.detail.reply.id)) return p;
          // Genuinely new reply (from another user) — add it and bump the count.
          setPost(q => q ? {...q, reply_count: (q.reply_count||0)+1} : q);
          return [...p, e.detail.reply];
        });
      }
    };
    const typingFn = e => {
      if(e.detail.channel===`post:${postId}` && e.detail.userId!==currentUser?.id) {
        const uid = String(e.detail.userId);
        if(e.detail.started === true) {
          setTypingUsers(p=>p.includes(uid)?p:[...p,uid]);
        } else {
          setTypingUsers(p=>p.filter(u=>u!==uid));
        }
      }
    };
    window.addEventListener("nexus:new_reply", replyFn);
    window.addEventListener("nexus:typing", typingFn);
    return ()=>{ window.removeEventListener("nexus:new_reply", replyFn); window.removeEventListener("nexus:typing", typingFn); };
  },[postId,currentUser]);

  useEffect(()=>{
    (async()=>{ setLoading(true);
      setLastReadReplyId(undefined); // reset to "not yet fetched" for new post
      try { const [pd,rd,rp]=await Promise.all([
          api.get(`/posts/${postId}`),
          api.get(`/posts/${postId}/replies`),
          currentUser?api.get(`/posts/${postId}/read-position`):Promise.resolve({})
        ]);
        setPost(pd.post);
        setReplies(rd.replies||[]);
        setReplyCursor(rd.next_cursor||null);
        setReplyHasMore(!!rd.next_cursor);
        replyCursorRef.current=rd.next_cursor||null;
        replyHasMoreRef.current=!!rd.next_cursor;
        setUserReaction(pd.post?.user_reaction||null);
        // acceptedReplyId comes from the post payload — set it here directly,
        // not inside the saves callback where it was previously misplaced.
        setAcceptedReplyId(pd.post?.accepted_reply_id||null);
        // Set to the saved reply ID if present, or null (= fetched, no position)
        setLastReadReplyId(rp.last_reply_id || null);
        if(rp.last_reply_id) setLastReadCount(rp.reply_count||0);
        if(currentUser){
          // Mark the post as seen immediately on open. This ensures posts with
          // 0 replies get a post_reads row, and updates the stored reply_count
          // to the current total so +N on the feed reflects only truly new
          // replies added after this visit. Only write when the stored count
          // is behind the current total (or no row exists yet).
          const storedCount = rp.reply_count || 0;
          const currentCount = pd.post?.reply_count || 0;
          if(!rp.last_reply_id && currentCount === 0) {
            // 0-reply post — create/update the row so seen=true on the feed.
            api.post(`/posts/${postId}/read-position`, {last_reply_id: null, reply_count: 0}).catch(()=>{});
          } else if(currentCount > storedCount) {
            // Post has more replies than stored — advance the high-water mark
            // to current total so +N only fires for replies after this visit.
            const lastReply = (rd.replies||[]).length > 0 ? rd.replies[(rd.replies||[]).length-1] : null;
            const lastReplyId = lastReply ? lastReply.id : (rp.last_reply_id || null);
            api.post(`/posts/${postId}/read-position`, {last_reply_id: lastReplyId, reply_count: currentCount}).catch(()=>{});
          }

          // Two focused requests instead of fetching all saved items just to
          // check one post. GET /posts/:id/saved → {saved: bool},
          // GET /posts/:id/replies/saved → {saved_reply_ids: [...]}.
          api.get(`/posts/${postId}/saved`).then(d=>{
            if(d.saved !== undefined) setPostSaved(d.saved);
          }).catch(()=>{});
          api.get(`/posts/${postId}/replies/saved`).then(d=>{
            setSavedReplyIds(new Set(d.saved_reply_ids||[]));
          }).catch(()=>{});
          // Load follow state
          api.get(`/posts/${postId}/follow`).then(d=>{
            if(d.followed !== undefined) setPostFollowed(d.followed);
          }).catch(()=>{}); // silently ignore until endpoint exists

          // Mark any unread notifications for this post as read —
          // the user is reading the content, no need to notify them again.
          api.post(`/notifications/mark-read-by-post`, {post_id: postId}).catch(()=>{});
        }
      }
      finally { setLoading(false); }
    })();
  },[postId]);

  // Track whether we've done the initial position restore for this post.
  // Prevents re-running when replies update after new replies arrive via WS.
  const didInitialScroll = useRef(false);

  useEffect(()=>{
    if(!replies.length) return;
    // Reset when navigating to a different post
    didInitialScroll.current = false;
  },[postId]);

  useEffect(()=>{
    if(!replies.length) return;
    if(didInitialScroll.current) return;

    if(scrollToReply){
      // From notification — instant jump to that specific reply, no animation
      const el = document.getElementById(`reply-${scrollToReply}`);
      if(el){
        didInitialScroll.current = true;
        const container = repliesContainerRef.current;
        if(container) container.scrollTop = el.offsetTop - 20;
      }
    } else if(lastReadReplyId !== null){
      // Returning to a post with a saved read position.
      // Jump instantly to the first unread reply (the one after last read).
      const lastReadIdx = replies.findIndex(r=>r.id===lastReadReplyId);
      const nextUnreadIdx = lastReadIdx >= 0 ? lastReadIdx + 1 : 0;
      const targetReply = replies[nextUnreadIdx] || replies[replies.length - 1];
      if(targetReply){
        const el = document.getElementById(`reply-${targetReply.id}`);
        if(el){
          didInitialScroll.current = true;
          const container = repliesContainerRef.current;
          if(container) container.scrollTop = el.offsetTop - 20;
        }
      }
    } else if(lastReadReplyId === undefined){
      // Still waiting for the read-position API response — don't scroll yet
      return;
    } else {
      // Fetched — no saved position (lastReadReplyId is null). Stay at top.
      didInitialScroll.current = true;
    }
  },[replies.length, scrollToReply, lastReadReplyId]);

  // Attach composition tracker when the reply textarea becomes visible
  useEffect(()=>{
    const el = document.querySelector(".comp-ta");
    if (el && window.CompositionTracker) {
      window._replyTracker?.destroy();
      window._replyTracker = new window.CompositionTracker(el);
    }
    return () => { window._replyTracker?.destroy(); window._replyTracker = null; };
  }, []);


  const submitReply=async()=>{
    if(!replyBody.trim())return; setSubmitting(true);
    sendEvent?.(`post:${postId}`,"typing_stop",{});
    const compositionSignals = window._replyTracker ? window._replyTracker.snapshot() : null;
    try { const d=await api.post(`/posts/${postId}/replies`,{body:replyBody,compositionSignals,attachments:replyAttachments});
      if(d.reply&&d.pending){setReplyBody("");setReplyAttachments([]);await clearDraft();toast("Your reply is pending moderator approval");}
      else if(d.reply){
        if(window._lpRegisterFresh) window._lpRegisterFresh(extractUnfurlableUrls(d.reply.body));
        setReplies(p=>p.some(r=>r.id===d.reply.id)?p:[...p,d.reply]);
        setReplyBody("");
        setReplyAttachments([]);
        await clearDraft();
        // reply_count is incremented by the replyFn WebSocket handler which
        // fires for all viewers including the poster — do not increment here.
        // Save read-position with the new reply so the feed doesn't show this
        // reply as unread when the user returns to the feed.
        setPost(q => {
          if(q && currentUser) {
            const newCount = (q.reply_count||0) + 1;
            api.post(`/posts/${postId}/read-position`, {last_reply_id: d.reply.id, reply_count: newCount}).catch(()=>{});
          }
          return q;
        });
      }
      else toast(d.error||"Failed","err"); }
    finally { setSubmitting(false); }
  };
  const submitReport=async()=>{
    if(!reportReason.trim())return; setReporting(true);
    try {
      const reasonMap = {"Spam":"spam","Harassment":"harassment","Misinformation":"misinformation","Off topic":"off_topic","Other":"other"};
      const reasonValue = reasonMap[reportReason] || "other";
      const payload = reportTarget.type==="post"
        ? {post_id:reportTarget.id, reason:reasonValue, notes:reportNotes||undefined}
        : {reply_id:reportTarget.id, reason:reasonValue, notes:reportNotes||undefined};
      const d = await api.post("/reports", payload);
      if(d.ok){setReportTarget(null); setReportReason(""); setReportNotes(""); toast("Report submitted");}
      else toast(formatApiErrors(d, "Failed to submit report"), "err");
    } finally { setReporting(false); }
  };

  // ── Quote on selection ────────────────────────────────────────────────────
  useEffect(()=>{
    const onMouseUp = ()=>{
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        setQuoteTooltip(null); return;
      }
      // Only show tooltip if selection is inside .md-body
      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const mdBody = container.nodeType===1
        ? container.closest?.(".md-body")
        : container.parentElement?.closest?.(".md-body");
      if (!mdBody) { setQuoteTooltip(null); return; }

      const rect = range.getBoundingClientRect();
      // If selection is near the top of the viewport, show tooltip below instead
      const above = rect.top > 60;
      setQuoteTooltip({
        x: rect.left + rect.width/2,
        y: above ? rect.top : rect.bottom,
        below: !above,
        text: sel.toString().trim()
      });
    };
    const onMouseDown = e=>{
      // Hide tooltip unless clicking it
      if (!e.target.closest(".quote-tooltip")) setQuoteTooltip(null);
    };
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mousedown", onMouseDown);
    return ()=>{
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousedown", onMouseDown);
    };
  },[]);

  const insertQuote = (text)=>{
    const lines = text.split("\n").map(l=>"> "+l).join("\n");
    const quote = lines + "\n\n";
    setReplyBody(prev => prev ? prev + "\n" + quote : quote);
    setQuoteTooltip(null);
    window.getSelection()?.removeAllRanges();
    // Scroll to and focus composer
    setTimeout(()=>{
      composerRef.current?.scrollIntoView({behavior:"smooth", block:"center"});
      composerRef.current?.querySelector("textarea")?.focus();
    }, 50);
  };
  const insertReply = (username, anchor)=>{
    const link = `[${username}](${anchor}) `;
    setReplyBody(prev => prev ? prev + link : link);
    setQuoteTooltip(null);
    setTimeout(()=>{
      composerRef.current?.scrollIntoView({behavior:"smooth", block:"center"});
      composerRef.current?.querySelector("textarea")?.focus();
    }, 50);
  };
  const toggleSavePost = async()=>{
    if(!currentUser){onAuthRequired?.("login");return;}
    if(postSaved){ await api.delete(`/posts/${post.id}/save`); setPostSaved(false); }
    else { await api.post(`/posts/${post.id}/save`,{}); setPostSaved(true); }
  };
  const toggleFollowPost = async()=>{
    if(!currentUser){onAuthRequired?.("login");return;}
    if(postFollowed){
      await api.delete(`/posts/${post.id}/follow`).catch(()=>{});
      setPostFollowed(false);
      toast("Unfollowed");
    } else {
      await api.post(`/posts/${post.id}/follow`,{}).catch(()=>{});
      setPostFollowed(true);
      toast("Following — you'll be notified of new replies");
    }
  };
  const toggleSaveReply = async(replyId)=>{
    if(!currentUser){onAuthRequired?.("login");return;}
    if(savedReplyIds.has(replyId)){ await api.delete(`/posts/${post.id}/replies/${replyId}/save`); setSavedReplyIds(p=>{const n=new Set(p);n.delete(replyId);return n;}); }
    else { await api.post(`/posts/${post.id}/replies/${replyId}/save`,{}); setSavedReplyIds(p=>new Set([...p,replyId])); }
  };
  const modAction=async(action)=>{
    await api.post(`/posts/${post.id}/${action}`,{});
    setPost(p=>({...p, [action]:!p[action]}));
    toast(action.charAt(0).toUpperCase()+action.slice(1)+"d");
  };

  const [pinModal,setPinModal]=useState(false);
  const [pinScope,setPinScope]=useState("global");
  const openPinModal=()=>{ setPinScope(post.pin_scope||"global"); setPostMenuOpen(false); setPinModal(true); };
  const submitPin=async()=>{
    const d = await api.post(`/posts/${post.id}/pin`,{scope:post.pinned&&pinScope===post.pin_scope?undefined:pinScope});
    if(d.error){toast(d.error,"err");return;}
    setPost(p=>({...p,pinned:d.post.pinned,pin_scope:d.post.pin_scope}));
    setPinModal(false);
    toast(d.post.pinned?"Post pinned":"Post unpinned");
  };
  const submitUnpin=async()=>{
    const d = await api.post(`/posts/${post.id}/pin`,{});
    if(d.error){toast(d.error,"err");return;}
    setPost(p=>({...p,pinned:false,pin_scope:null}));
    setPinModal(false);
    toast("Post unpinned");
  };


  const isMod = currentUser?.role==="admin"||currentUser?.role==="moderator";
  const [showPostMenu, setShowPostMenu] = useState(false);
  // Re-render when extension bundles register new post actions
  const [, forcePostActionUpdate] = useState(0);
  useEffect(()=>{
    const unsub = window.NexusExtensions.onPostActionChange(()=>forcePostActionUpdate(n=>n+1));
    return unsub;
  },[]);
  // Auto-open report modal if navigated here with openReport flag
  useEffect(()=>{
    if(openReport&&post) { setReportTarget({type:"post",id:post.id}); setReportReason(""); }
  },[openReport, post]);
  const [postMenuOpen, setPostMenuOpen] = useState(false);
  const [reactionsModal, setReactionsModal] = useState(null);
  const [editingReplyId, setEditingReplyId] = useState(null);
  const [editingReplyBody, setEditingReplyBody] = useState("");
  const [editingReplySaving, setEditingReplySaving] = useState(false); // {postId} or {replyId}
  const [openReplyMenu, setOpenReplyMenu] = useState(null);
  const [hoveredReply, setHoveredReply] = useState(null);
  const [editingPost, setEditingPost] = useState(false);
  const [acceptedReplyId, setAcceptedReplyId] = useState(post?.accepted_reply_id||null);
  const [editHistoryOpen, setEditHistoryOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  // Mod/admin only — space and tag editing
  const [editSpaceId, setEditSpaceId] = useState("");
  const [editTagIds, setEditTagIds] = useState([]);
  const [showEditTagModal, setShowEditTagModal] = useState(false);
  const [editTagModalSel, setEditTagModalSel] = useState([]);
  const col = spaceColor(post?.space||{id:postId});

  const loadMoreReplies = useCallback(async()=>{
    if(replyLoadingRef.current||!replyHasMoreRef.current) return;
    replyLoadingRef.current=true;
    try {
      const rd=await api.get(`/posts/${postId}/replies?cursor=${replyCursorRef.current}`);
      setReplies(p=>[...p,...(rd.replies||[])]);
      setReplyCursor(rd.next_cursor||null);
      setReplyHasMore(!!rd.next_cursor);
      replyCursorRef.current=rd.next_cursor||null;
      replyHasMoreRef.current=!!rd.next_cursor;
    } finally { replyLoadingRef.current=false; }
  },[postId]);

  useEffect(()=>{
    const sentinel=replySentinelRef.current; if(!sentinel) return;
    const observer=new IntersectionObserver(entries=>{
      if(entries[0].isIntersecting) loadMoreReplies();
    },{rootMargin:"300px"});
    observer.observe(sentinel);
    return ()=>observer.disconnect();
  },[loadMoreReplies,replyHasMore]);

  if(loading) return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)"}}>Loading...</div>;
  if(!post) return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)"}}>Post not found.</div>;

  return (
    <div className="post-shell">
      {/* Report modal */}
      {pinModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:20}} onMouseDown={e=>e.target===e.currentTarget&&setPinModal(false)}>
          <div style={{background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:12,padding:24,width:"100%",maxWidth:420}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <i className="fa-solid fa-thumbtack" style={{fontSize:16,color:"var(--t4)"}}/>
                <span style={{fontSize:15,fontWeight:500,color:"var(--t1)"}}>Pin post</span>
              </div>
              <button onClick={()=>setPinModal(false)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--t4)",padding:4}}><i className="fa-solid fa-xmark" style={{fontSize:15}}/></button>
            </div>
            <div style={{fontSize:12,color:"var(--t3)",marginBottom:16,padding:"9px 12px",background:"var(--bg2)",borderRadius:8}}>
              <strong style={{color:"var(--t1)",fontWeight:500}}>{post.title}</strong>
              <span style={{color:"var(--t5)"}}> · {post.user?.username}</span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:4}}>
              {["global","space"].map(s=>{
                const isAdmin = currentUser?.role==="admin";
                const disabled = s==="global"&&!isAdmin;
                return (
                  <div key={s} onClick={()=>!disabled&&setPinScope(s)}
                    style={{display:"flex",alignItems:"flex-start",gap:14,padding:14,borderRadius:8,
                      border:pinScope===s?"1.5px solid var(--ac-border)":"0.5px solid var(--b2)",
                      background:pinScope===s?"var(--ac-bg)":"transparent",
                      cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.45:1}}>
                    <div style={{width:16,height:16,borderRadius:"50%",border:`1.5px solid ${pinScope===s?"var(--ac)":"var(--b2)"}`,flexShrink:0,marginTop:2,display:"flex",alignItems:"center",justifyContent:"center",background:pinScope===s?"var(--ac-bg)":"none"}}>
                      {pinScope===s&&<div style={{width:7,height:7,borderRadius:"50%",background:"var(--ac)"}}/>}
                    </div>
                    <div style={{width:36,height:36,borderRadius:"50%",background:pinScope===s?"var(--ac-bg)":"var(--bg2)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>
                      <i className={`fa-solid ${s==="global"?"fa-globe":"fa-layer-group"}`} style={{fontSize:16,color:pinScope===s?"var(--ac)":"var(--t4)"}}/>
                    </div>
                    <div>
                      <div style={{fontSize:14,fontWeight:500,color:pinScope===s?"var(--ac-text)":"var(--t1)",marginBottom:3}}>
                        {s==="global"?"Pin globally":"Pin to space"}
                        {s==="global"&&!isAdmin&&<span style={{fontSize:11,color:"var(--t5)",fontWeight:400,marginLeft:6}}>(admin only)</span>}
                      </div>
                      <div style={{fontSize:12,color:pinScope===s?"var(--ac-text)":"var(--t3)",lineHeight:1.5,opacity:pinScope===s?0.85:1}}>
                        {s==="global"
                          ?"Appears at the top of all feeds. Best for site-wide announcements."
                          :`Appears at the top of the ${post.space?.name||"space"} feed only.`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:20}}>
              <button onClick={()=>setPinModal(false)} style={{fontSize:13,padding:"7px 16px",background:"var(--bg2)",color:"var(--t3)",border:"0.5px solid var(--b2)"}}>Cancel</button>
              {post.pinned&&(
                <button onClick={submitUnpin} style={{fontSize:13,padding:"7px 16px",background:"rgba(248,113,113,0.1)",color:"var(--red)",border:"0.5px solid var(--red)"}}>
                  <i className="fa-solid fa-thumbtack" style={{fontSize:12,marginRight:5}}/>Unpin
                </button>
              )}
              <button onClick={submitPin} style={{fontSize:13,padding:"7px 16px",background:"var(--ac-bg)",color:"var(--ac-text)",border:"0.5px solid var(--ac-border)"}}>
                <i className="fa-solid fa-thumbtack" style={{fontSize:12,marginRight:5}}/>{post.pinned?"Update pin":"Pin post"}
              </button>
            </div>
            {post.pinned&&(
              <div style={{borderTop:"0.5px solid var(--b1)",marginTop:16,paddingTop:12,fontSize:12,color:"var(--t5)"}}>
                Currently pinned {post.pin_scope==="global"?"globally":`to ${post.space?.name||"space"}`}
              </div>
            )}
          </div>
        </div>
      )}
      {reportTarget&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:20}} onMouseDown={e=>e.target===e.currentTarget&&setReportTarget(null)}>
          <div style={{background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:12,padding:24,width:"100%",maxWidth:400}}>
            <div style={{fontSize:15,fontWeight:600,color:"var(--t1)",marginBottom:4}}>Report content</div>
            <div style={{fontSize:12,color:"var(--t4)",marginBottom:14}}>Select a reason — this will be sent to moderators for review.</div>
            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12}}>
              {["Spam","Harassment","Misinformation","Off topic","Other"].map(r=>(
                <div key={r} onClick={()=>setReportReason(r)} style={{padding:"8px 12px",borderRadius:8,cursor:"pointer",fontSize:13,
                  background:reportReason===r?"var(--ac-bg)":"rgba(255,255,255,0.04)",
                  border:`0.5px solid ${reportReason===r?"var(--ac-border)":"rgba(255,255,255,0.08)"}`,
                  color:reportReason===r?"var(--ac-text)":"var(--t2)",
                  display:"flex",alignItems:"center",gap:8}}>
                  <i className={`fa-solid ${reportReason===r?"fa-circle-dot":"fa-circle"}`} style={{fontSize:11,color:reportReason===r?"var(--ac)":"var(--t5)"}}/>
                  {r}
                </div>
              ))}
            </div>
            <textarea className="fi" style={{resize:"vertical",minHeight:60,borderRadius:8,fontSize:12}} placeholder="Add more detail (optional)…" value={reportNotes} onChange={e=>setReportNotes(e.target.value)}/>
            <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}>
              <button className="btn-ghost" onClick={()=>setReportTarget(null)}>Cancel</button>
              <button className="btn-primary" onClick={submitReport} disabled={reporting||!reportReason.trim()}>{reporting?"Submitting…":"Submit report"}</button>
            </div>
          </div>
        </div>
      )}
      <div className="post-content-wrap" id="post-replies" ref={repliesContainerRef}>
          {replies.length>0&&<MobileScrubberBar replies={replies} displayIdx={scrubber.index} onClick={()=>setMobSheetOpen(true)}/>}
          <MobileScrubberSheet open={mobSheetOpen} onClose={()=>setMobSheetOpen(false)} replies={replies} scrubber={scrubber} firstUnreadIdx={firstUnreadIdx}/>
        <div className="post-back" onClick={()=>navigate("feed")}><i className="fa-solid fa-arrow-left"></i> back to feed</div>
        <div className="post-header" style={{display:"flex",alignItems:"flex-start",gap:14,marginBottom:16}}>
          <div className="post-space-bar" style={{width:4,alignSelf:"stretch",background:col,borderRadius:2,flexShrink:0,minHeight:60}}/>
          <div style={{flex:1}}>
            {/* Avatar + meta row */}
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
              <RsAv user={post.user} size={56} color={userColor(post.user)}/>
              <div className="post-meta" style={{marginBottom:0,flex:1}}>
                {post.space&&<div className="thread-tag" style={{background:`${col}20`,color:col}}>{post.space.name}</div>}
                {post.tags?.map(t=><div key={t.id} className="thread-tag" style={{background:"rgba(255,255,255,0.05)",color:"var(--t3)"}}>{t.name}</div>)}
                <span style={{fontSize:16,color:"var(--t4)",cursor:"pointer"}} onClick={()=>navigate("profile",{username:post.user?.username})}>{post.user?.username}</span>
                <span style={{fontSize:14,color:"var(--t5)"}}>{ago(post.inserted_at)}</span>
              </div>
              {currentUser&&<button title={postFollowed?"Unfollow":"Follow"}
                onClick={toggleFollowPost}
                style={{background:"none",border:"none",cursor:"pointer",
                  color:postFollowed?"var(--ac)":"var(--t5)",fontSize:15,flexShrink:0,
                  padding:"2px 4px",transition:"color .15s"}}>
                <i className={`fa-${postFollowed?"solid":"regular"} fa-bell`}/>
              </button>}
              {currentUser&&<button title={postSaved?"Saved":"Save"} onClick={toggleSavePost}
                style={{background:"none",border:"none",cursor:"pointer",color:postSaved?"var(--ac)":"var(--t5)",fontSize:15,flexShrink:0,padding:"2px 4px",transition:"color .15s"}}>
                <i className={`fa-${postSaved?"solid":"regular"} fa-bookmark`}/>
              </button>}
              {(post.edit_count||0)>0&&(
                <button title="Edit history" onClick={()=>setEditHistoryOpen(true)}
                  style={{background:"none",border:"none",cursor:"pointer",color:"var(--t5)",fontSize:14,flexShrink:0,padding:"2px 4px",transition:"color .15s",display:"flex",alignItems:"center",gap:3}}>
                  <i className="fa-solid fa-clock-rotate-left" style={{fontSize:14}}/>
                  <span style={{fontSize:12,color:"var(--t5)"}}>{post.edit_count}</span>
                </button>
              )}
            </div>
            {/* Title full-width */}
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
              <div className="post-title">{post.title}</div>
              {post.type==="question"&&<span style={{fontSize:11,fontWeight:500,padding:"2px 8px",borderRadius:20,background:acceptedReplyId?"rgba(52,211,153,0.15)":"rgba(96,165,250,0.15)",color:acceptedReplyId?"#34d399":"#60a5fa",display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
                <i className={`fa-solid ${acceptedReplyId?"fa-circle-check":"fa-circle-question"}`} style={{fontSize:14}}/>{acceptedReplyId?"Answered":"Question"}
              </span>}
            </div>
            {editHistoryOpen&&<EditHistoryModal postId={post.id} editCount={post.edit_count||0} onClose={()=>setEditHistoryOpen(false)}/>}
            {editingPost
              ?<div style={{marginTop:12}}>
                <input className="fi" value={editTitle} onChange={e=>setEditTitle(e.target.value)}
                  style={{fontWeight:600,fontSize:17,marginBottom:10}} placeholder="Title"/>
                <textarea className="fi" value={editBody} onChange={e=>setEditBody(e.target.value)}
                  style={{minHeight:320,resize:"vertical",lineHeight:1.7,fontFamily:"inherit",fontSize:14}}
                  placeholder="Post body…"/>
                {/* Space + tag editing — mod/admin only */}
                {isMod&&(
                  <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:10}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                      {/* Space picker */}
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <label style={{fontSize:12,color:"var(--t4)",flexShrink:0}}>Space</label>
                        <select value={editSpaceId} onChange={e=>setEditSpaceId(e.target.value)}
                          style={{fontSize:13,padding:"5px 10px",borderRadius:8,border:"0.5px solid var(--b2)",
                            background:"var(--s2)",color:"var(--t1)",cursor:"pointer",outline:"none"}}>
                          <option value="">— no space —</option>
                          {spaces.map(s=>(
                            <option key={s.id} value={String(s.id)}>{s.name}</option>
                          ))}
                        </select>
                      </div>
                      {/* Tag picker trigger */}
                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                        <label style={{fontSize:12,color:"var(--t4)",flexShrink:0}}>Tags</label>
                        {editTagIds.map(id=>{
                          const t=tags.find(x=>x.id===id);
                          return t?<span key={id}
                            onClick={()=>setEditTagIds(p=>p.filter(x=>x!==id))}
                            style={{fontSize:12,padding:"3px 9px",borderRadius:99,cursor:"pointer",
                              background:t.color?`${t.color}22`:"var(--ac-bg)",
                              color:t.color||"var(--ac-text)",
                              border:`0.5px solid ${t.color?`${t.color}44`:"var(--ac-border)"}`}}>
                            #{t.name} ×
                          </span>:null;
                        })}
                        {tags.length>0&&<button type="button"
                          onClick={()=>{setEditTagModalSel([...editTagIds]);setShowEditTagModal(true);}}
                          style={{fontSize:12,padding:"4px 10px",borderRadius:99,border:"0.5px solid var(--b2)",
                            background:"transparent",color:"var(--t3)",cursor:"pointer"}}>
                          <i className="fa-solid fa-tag" style={{fontSize:11,marginRight:5}}/>
                          {editTagIds.length>0?`${editTagIds.length} tag${editTagIds.length>1?"s":""}`:"+  tags"}
                        </button>}
                      </div>
                    </div>
                  </div>
                )}
                <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:12}}>
                  <button className="btn-ghost" onClick={()=>setEditingPost(false)} style={{fontSize:12}}>Cancel</button>
                  <button className="btn-primary" style={{fontSize:12,padding:"6px 18px"}} disabled={editSaving||!editTitle.trim()||!editBody.trim()}
                    onClick={async()=>{
                      setEditSaving(true);
                      const payload={title:editTitle.trim(),body:editBody.trim()};
                      if(isMod){
                        if(editSpaceId) payload.space_id=parseInt(editSpaceId);
                        payload.tag_ids=editTagIds;
                      }
                      const d = await api.patch(`/posts/${post.id}`,payload);
                      setEditSaving(false);
                      if(d.post){
                        setPost(p=>({...p,title:d.post.title,body:d.post.body,space:d.post.space,tags:d.post.tags}));
                        setEditingPost(false);
                        toast("Post updated");
                      } else toast(d.error||"Failed","err");
                    }}>
                    {editSaving?"Saving…":"Save changes"}
                  </button>
                </div>
                {/* Tag selection modal */}
                {showEditTagModal&&(
                  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:9000,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
                    <div style={{background:"var(--s1)",border:"0.5px solid var(--b2)",borderRadius:16,width:"100%",maxWidth:560,boxShadow:"0 8px 48px rgba(0,0,0,.6)"}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"18px 24px",borderBottom:"0.5px solid var(--b1)"}}>
                        <span style={{fontSize:16,fontWeight:500,color:"var(--t1)"}}>Select tags</span>
                        <button onClick={()=>setShowEditTagModal(false)} style={{background:"none",border:"none",color:"var(--t4)",fontSize:20,cursor:"pointer",lineHeight:1}}>×</button>
                      </div>
                      <div style={{padding:"16px 24px",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:10,maxHeight:360,overflowY:"auto"}}>
                        {tags.map(t=>{
                          const sel=editTagModalSel.includes(t.id);
                          const tc=t.color||"var(--ac)";
                          return (
                            <div key={t.id} onClick={()=>setEditTagModalSel(p=>sel?p.filter(x=>x!==t.id):[...p,t.id])}
                              style={{padding:"10px 14px",borderRadius:10,cursor:"pointer",
                                border:`1.5px solid ${sel?tc:"var(--b1)"}`,
                                background:sel?`${tc}18`:"var(--s2)",color:sel?tc:"var(--t3)",
                                transition:"all .1s",display:"flex",alignItems:"center",gap:8,
                                fontSize:14,fontWeight:sel?500:400}}>
                              {sel&&<i className="fa-solid fa-check" style={{fontSize:12,flexShrink:0}}/>}
                              #{t.name}
                            </div>
                          );
                        })}
                      </div>
                      <div style={{padding:"16px 24px",borderTop:"0.5px solid var(--b1)",display:"flex",justifyContent:"flex-end",gap:10}}>
                        <button className="btn-ghost" style={{fontSize:14}} onClick={()=>{setEditTagModalSel([]);setShowEditTagModal(false);}}>Clear</button>
                        <button className="btn-primary" style={{fontSize:14,padding:"8px 20px"}}
                          onClick={()=>{setEditTagIds(editTagModalSel);setShowEditTagModal(false);}}>
                          {editTagModalSel.length>0?`Add ${editTagModalSel.length} tag${editTagModalSel.length>1?"s":""}` :"Add tags"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              :<div className="post-body"><Md text={post.body}/></div>}
            <div className="reaction-row" style={{justifyContent:"flex-end",position:"relative"}} onMouseEnter={()=>setShowPostMenu(true)} onMouseLeave={()=>setShowPostMenu(false)}>
              {currentUser&&!post.locked&&(
                <button className="post-reply-btn" style={{marginRight:"auto"}} onClick={()=>insertReply(post.user?.username,`#post-${post.id}`)}>
                  <i className="fa-solid fa-reply" style={{fontSize:9,marginRight:4}}/>Reply
                </button>
              )}
              <ReactionButton postId={post.id} initialReactions={post.reactions||[]} initialUserReaction={userReaction} currentUser={currentUser} authorId={post.user?.id} onAuthRequired={onAuthRequired}/>
              {currentUser&&(currentUser.id===post.user?.id||isMod||currentUser.id!==post.user?.id)&&(
                <div style={{position:"relative"}}>
                  <button
                    className="row-menu-btn"
                    onClick={e=>{e.stopPropagation();setPostMenuOpen(p=>!p);}}>
                    <i className="fa-solid fa-ellipsis"/>
                  </button>
                  {postMenuOpen&&<div style={{position:"absolute",bottom:36,right:0,background:"var(--s3)",border:"0.5px solid var(--b2)",borderRadius:10,padding:"4px 0",minWidth:140,zIndex:200,boxShadow:"0 4px 20px rgba(0,0,0,.4)"}}
                    onMouseLeave={()=>{setPostMenuOpen(false);setShowPostMenu(false);}}>
                    {/* Report */}
                    {currentUser.id!==post.user?.id&&<button onClick={()=>{setPostMenuOpen(false);setReportTarget({type:"post",id:post.id});setReportReason("");}} style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--t3)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                      onMouseLeave={e=>e.currentTarget.style.background="none"}>
                      <i className="fa-solid fa-flag" style={{fontSize:11,color:"var(--t4)",width:14}}/>Report
                    </button>}
                    {/* View reactions */}
                    {(post.reaction_count||0)>0&&<button onClick={()=>{setPostMenuOpen(false);setReactionsModal({postId:post.id});}} style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--t3)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                      onMouseLeave={e=>e.currentTarget.style.background="none"}>
                      <i className="fa-solid fa-face-smile-beam" style={{fontSize:11,color:"var(--t4)",width:14}}/>View reactions
                    </button>}
                    {/* Mod actions */}
                    {isMod&&<>
                      <button onClick={openPinModal} style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:post.pinned?"var(--ac-text)":"var(--t3)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                        onMouseLeave={e=>e.currentTarget.style.background="none"}>
                        <i className={`fa-solid ${post.pinned?"fa-thumbtack fa-rotate-90":"fa-thumbtack"}`} style={{fontSize:11,color:"var(--t4)",width:14}}/>{post.pinned?"Edit pin":"Pin"}
                      </button>
                      <button onClick={()=>{setPostMenuOpen(false);modAction("lock");}} style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:post.locked?"var(--amber)":"var(--t3)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                        onMouseLeave={e=>e.currentTarget.style.background="none"}>
                        <i className={`fa-solid ${post.locked?"fa-lock-open":"fa-lock"}`} style={{fontSize:11,color:"var(--t4)",width:14}}/>{post.locked?"Unlock":"Lock"}
                      </button>
                      <button onClick={()=>{setPostMenuOpen(false);modAction("hide");}} style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(248,113,113,0.06)"}
                        onMouseLeave={e=>e.currentTarget.style.background="none"}>
                        <i className={`fa-solid ${post.hidden?"fa-eye":"fa-eye-slash"}`} style={{fontSize:11,color:"var(--red)",width:14}}/>{post.hidden?"Unhide":"Hide"}
                      </button>
                    </>}
                    {/* Edit — author only */}
                    {currentUser.id===post.user?.id&&<button onClick={()=>{setPostMenuOpen(false);setEditTitle(post.title||"");setEditBody(post.body||"");setEditSpaceId(String(post.space?.id||""));setEditTagIds(post.tags?.map(t=>t.id)||[]);setEditingPost(true);}} style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--t3)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                      onMouseLeave={e=>e.currentTarget.style.background="none"}>
                      <i className="fa-solid fa-pen" style={{fontSize:11,color:"var(--t4)",width:14}}/>Edit post
                    </button>}
                    {/* Edit — mod/admin (includes space + tag editing) */}
                    {isMod&&currentUser.id!==post.user?.id&&<button onClick={()=>{setPostMenuOpen(false);setEditTitle(post.title||"");setEditBody(post.body||"");setEditSpaceId(String(post.space?.id||""));setEditTagIds(post.tags?.map(t=>t.id)||[]);setEditingPost(true);}} style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--t3)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                      onMouseLeave={e=>e.currentTarget.style.background="none"}>
                      <i className="fa-solid fa-pen" style={{fontSize:11,color:"var(--t4)",width:14}}/>Edit post
                    </button>}
                    {/* Extension-registered post actions */}
                    {window.NexusExtensions.getPostActions()
                      .filter(a => !a.visible || a.visible({ post, currentUser }))
                      .map(a => (
                        <button key={a.id}
                          onClick={()=>a.onClick({ post, currentUser, navigate, closeMenu:()=>setPostMenuOpen(false) })}
                          style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--t3)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                          onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                          onMouseLeave={e=>e.currentTarget.style.background="none"}>
                          <i className={`fa-solid ${a.icon}`} style={{fontSize:11,color:"var(--t4)",width:14}}/>
                          {a.label}
                        </button>
                      ))
                    }
                    {/* Delete */}
                    {(currentUser.id===post.user?.id||isMod)&&<>
                      <div style={{height:"0.5px",background:"var(--b1)",margin:"4px 0"}}/>
                      <button onClick={async()=>{setPostMenuOpen(false);if(!confirm("Delete this post?"))return;await api.delete(`/posts/${post.id}`);navigate("feed");toast("Post deleted");}} style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(248,113,113,0.06)"}
                        onMouseLeave={e=>e.currentTarget.style.background="none"}>
                        <i className="fa-solid fa-trash" style={{fontSize:11,color:"var(--red)",width:14}}/>Delete post
                      </button>
                    </>}
                  </div>}
                </div>
              )}
            </div>
          </div>
        </div>
        {/* post_footer slot — extension components rendered here */}
        <PostFooterSlot post={post} />
        {reactionsModal && <ReactionsModal {...reactionsModal} onClose={()=>setReactionsModal(null)}/>}
        <div className="replies-header">
          <span className="replies-count">{post.reply_count} {post.reply_count===1?"reply":"replies"}</span>
          <span style={{marginLeft:"auto",fontSize:14,color:"var(--t5)"}}>oldest first</span>
        </div>
        {/* Accepted answer pinned below OP */}
        {acceptedReplyId&&(()=>{
          const ar = replies.find(r=>r.id===acceptedReplyId);
          if(!ar) return null;
          return (
            <div style={{background:"rgba(52,211,153,0.06)",border:"1px solid rgba(52,211,153,0.25)",borderRadius:12,padding:"16px 18px",marginBottom:16}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                <i className="fa-solid fa-circle-check" style={{fontSize:16,color:"var(--green)"}}/>
                <span style={{fontSize:14,fontWeight:600,color:"var(--green)"}}>Accepted answer</span>
                <span style={{fontSize:13,color:"var(--t5)",marginLeft:"auto"}}>by {ar.user?.username} · {ago(ar.inserted_at)}</span>
              </div>
              <div className="md-body"><Md text={ar.body}/></div>
              <a href={`#reply-${ar.id}`} onClick={e=>{e.preventDefault();document.getElementById(`reply-${ar.id}`)?.scrollIntoView({behavior:"smooth",block:"center"});}}
                style={{display:"inline-flex",alignItems:"center",gap:6,marginTop:12,fontSize:13,color:"var(--t4)",textDecoration:"none",cursor:"pointer"}}>
                <i className="fa-solid fa-arrow-down" style={{fontSize:12}}/>Jump to reply
              </a>
            </div>
          );
        })()}
        {replies.map(r=>(
          <div key={r.id} id={`reply-${r.id}`} className="reply-item"
            onMouseEnter={()=>setHoveredReply(r.id)}
            onMouseLeave={()=>{setHoveredReply(null);if(openReplyMenu===r.id)setOpenReplyMenu(null);}}>
            <div className="reply-body-wrap">
              {r.id===acceptedReplyId&&<div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,fontWeight:500,color:"var(--green)",marginBottom:6}}>
                <i className="fa-solid fa-circle-check" style={{fontSize:14}}/>Accepted answer
              </div>}
              {r._historyOpen&&<EditHistoryModal replyId={{id:r.id,postId:postId}} editCount={r.edit_count||0} onClose={()=>setReplies(p=>p.map(x=>x.id===r.id?{...x,_historyOpen:false}:x))}/>}
              <div className="reply-meta">
                {r.user?.avatar_url
                  ?<img src={r.user.avatar_url} className="reply-av" style={{objectFit:"cover",cursor:"pointer"}} alt={r.user.username} onClick={e=>{e.stopPropagation();openUserCard(r.user.username,e.currentTarget);}}/>
                  :<div className="reply-av" style={{background:userColor(r.user),color:"#fff"}}>{(r.user?.username||"?").slice(0,2).toUpperCase()}</div>}
                <span className="reply-author" style={{cursor:"pointer"}} onClick={()=>navigate("profile",{username:r.user?.username})}>{r.user?.username}</span>
                {(r.user?.groups||[]).map(g=>(
                  <span key={g.slug} style={{
                    display:"inline-flex",alignItems:"center",gap:4,
                    fontSize:10,fontWeight:500,padding:"2px 7px",borderRadius:20,
                    background:g.badge_color?g.badge_color+"1a":"var(--b1)",
                    color:g.badge_color||"var(--t3)",
                    border:`0.5px solid ${g.badge_color?g.badge_color+"40":"var(--b2)"}`,
                    flexShrink:0,
                  }}>
                    {g.badge_icon&&<i className={`fa-solid ${g.badge_icon}`} style={{fontSize:8}}/>}
                    {g.badge_label||g.name}
                  </span>
                ))}
                <span className="reply-time">{ago(r.inserted_at)}</span>
                {currentUser&&!post.locked&&<span className="reply-quote-btn" onClick={()=>insertQuote(r.body.trim())}><i className="fa-solid fa-quote-left" style={{fontSize:9}}></i>quote</span>}
                {(r.edit_count||0)>0&&(
                  <span className="reply-quote-btn" title="Edit history" onClick={()=>setReplies(p=>p.map(x=>x.id===r.id?{...x,_historyOpen:!x._historyOpen}:x))} style={{opacity:1,display:"inline-flex",alignItems:"center",gap:3}}>
                    <i className="fa-solid fa-clock-rotate-left" style={{fontSize:14}}/>
                    <span style={{fontSize:12}}>{r.edit_count}</span>
                  </span>
                )}
                {post.type==="question"&&(currentUser?.id===post.user?.id||isMod)&&(
                  <span className="reply-quote-btn" title={acceptedReplyId===r.id?"Unmark answer":"Mark as answer"} onClick={async()=>{
                    if(acceptedReplyId===r.id){
                      const d=await api.delete(`/posts/${post.id}/accept`);
                      if(d.ok) setAcceptedReplyId(null);
                    } else {
                      const d=await api.post(`/posts/${post.id}/accept/${r.id}`,{});
                      if(d.ok) setAcceptedReplyId(r.id);
                    }
                  }} style={{opacity:1,color:acceptedReplyId===r.id?"var(--green)":"var(--t5)"}}>
                    <i className={`fa-${acceptedReplyId===r.id?"solid":"regular"} fa-circle-check`} style={{fontSize:14}}/>
                  </span>
                )}
              </div>
              {editingReplyId===r.id
                ?<div style={{marginTop:8}}>
                  <textarea className="fi" value={editingReplyBody} onChange={e=>setEditingReplyBody(e.target.value)}
                    style={{minHeight:100,resize:"vertical",lineHeight:1.7,fontFamily:"inherit",fontSize:13,marginBottom:8}}
                    autoFocus/>
                  <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                    <button className="btn-ghost" onClick={()=>{setEditingReplyId(null);setEditingReplyBody("");}} style={{fontSize:12}}>Cancel</button>
                    <button className="btn-primary" style={{fontSize:12,padding:"6px 18px"}}
                      disabled={editingReplySaving||!editingReplyBody.trim()}
                      onClick={async()=>{
                        setEditingReplySaving(true);
                        const d = await api.patch(`/posts/${postId}/replies/${r.id}`,{body:editingReplyBody.trim()});
                        setEditingReplySaving(false);
                        if(d.reply){
                          setReplies(p=>p.map(x=>x.id===r.id?{...x,body:d.reply.body}:x));
                          setEditingReplyId(null);setEditingReplyBody("");
                          toast("Reply updated");
                        } else toast(d.error||"Failed","err");
                      }}>
                      {editingReplySaving?"Saving…":"Save"}
                    </button>
                  </div>
                </div>
                :<div className="reply-text"><Md text={r.body}/></div>}
              <div className="reaction-row" style={{marginTop:6,justifyContent:"flex-end",position:"relative"}}>
                {currentUser&&!post.locked&&(
                  <button className="post-reply-btn" style={{marginRight:"auto"}} onClick={()=>insertReply(r.user?.username,`#reply-${r.id}`)}>
                    <i className="fa-solid fa-reply" style={{fontSize:9,marginRight:4}}/>Reply
                  </button>
                )}
                <ReactionButton replyId={r.id} initialReactions={r.reactions||[]} initialUserReaction={r.user_reaction||null} currentUser={currentUser} authorId={r.user?.id} onAuthRequired={onAuthRequired}/>
                {currentUser&&<button title={savedReplyIds.has(r.id)?"Saved":"Save"} onClick={()=>toggleSaveReply(r.id)}
                  className="row-menu-btn"
                  style={{color:savedReplyIds.has(r.id)?"var(--ac)":"var(--t4)",opacity:savedReplyIds.has(r.id)?1:undefined}}>
                  <i className={`fa-${savedReplyIds.has(r.id)?"solid":"regular"} fa-bookmark`} style={{fontSize:11}}/>
                </button>}
                {currentUser&&(
                  <div style={{position:"relative"}} onClick={e=>e.stopPropagation()}>
                    <button
                      className="row-menu-btn"
                      onClick={e=>{e.stopPropagation();setOpenReplyMenu(v=>v===r.id?null:r.id);}}>
                      <i className="fa-solid fa-ellipsis"/>
                    </button>
                    {openReplyMenu===r.id&&(
                      <div style={{position:"absolute",bottom:32,right:0,background:"var(--s3)",border:"0.5px solid var(--b2)",borderRadius:10,padding:"4px 0",minWidth:140,zIndex:200,boxShadow:"0 4px 20px rgba(0,0,0,.4)"}}
                        onMouseLeave={()=>setOpenReplyMenu(null)}>
                        {currentUser.id!==r.user?.id&&<button onClick={()=>{setOpenReplyMenu(null);setReportTarget({type:"reply",id:r.id});setReportReason("");}}
                          style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--t3)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                          onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                          onMouseLeave={e=>e.currentTarget.style.background="none"}>
                          <i className="fa-solid fa-flag" style={{fontSize:11,color:"var(--t4)",width:14}}/>Report
                        </button>}
                        {(r.reaction_count||0)>0&&<button onClick={()=>{setOpenReplyMenu(null);setReactionsModal({replyId:r.id});}}
                          style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--t3)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                          onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                          onMouseLeave={e=>e.currentTarget.style.background="none"}>
                          <i className="fa-solid fa-face-smile-beam" style={{fontSize:11,color:"var(--t4)",width:14}}/>View reactions
                        </button>}
                        {(currentUser.id===r.user?.id||isMod)&&<>
                          {currentUser.id===r.user?.id&&<button onClick={()=>{setOpenReplyMenu(null);setEditingReplyId(r.id);setEditingReplyBody(r.body||"");}}
                            style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--t3)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                            onMouseLeave={e=>e.currentTarget.style.background="none"}>
                            <i className="fa-solid fa-pen" style={{fontSize:11,color:"var(--t4)",width:14}}/>Edit reply
                          </button>}
                          <div style={{height:"0.5px",background:"var(--b1)",margin:"4px 0"}}/>
                          <button onClick={async()=>{setOpenReplyMenu(null);if(!confirm("Delete this reply?"))return;await api.delete(`/posts/${postId}/replies/${r.id}`);setReplies(p=>p.filter(x=>x.id!==r.id));setPost(p=>({...p,reply_count:p.reply_count-1}));toast("Reply deleted");}}
                            style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                            onMouseEnter={e=>e.currentTarget.style.background="rgba(248,113,113,0.06)"}
                            onMouseLeave={e=>e.currentTarget.style.background="none"}>
                            <i className="fa-solid fa-trash" style={{fontSize:11,color:"var(--red)",width:14}}/>Delete reply
                          </button>
                        </>}
                        {isMod&&<>
                          <div style={{height:"0.5px",background:"var(--b1)",margin:"4px 0"}}/>
                          <button onClick={async()=>{setOpenReplyMenu(null);await api.post(`/posts/${postId}/replies/${r.id}/hide`,{});setReplies(p=>p.filter(x=>x.id!==r.id));toast("Reply hidden");}}
                            style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                            onMouseEnter={e=>e.currentTarget.style.background="rgba(248,113,113,0.06)"}
                            onMouseLeave={e=>e.currentTarget.style.background="none"}>
                            <i className="fa-solid fa-eye-slash" style={{fontSize:11,color:"var(--red)",width:14}}/>Hide reply
                          </button>
                        </>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        {quoteTooltip&&(
          <div className="quote-tooltip"
            style={{
              left: quoteTooltip.x,
              top: quoteTooltip.below ? quoteTooltip.y+8 : quoteTooltip.y-8,
              transform: quoteTooltip.below ? "translate(-50%,0)" : "translate(-50%,-100%)"
            }}
            onMouseDown={e=>{e.preventDefault();insertQuote(quoteTooltip.text);}}>
            <i className="fa-solid fa-quote-left" style={{fontSize:10}}></i> Quote
          </div>
        )}
        <div ref={replySentinelRef} style={{height:40,visibility:replyHasMore?"visible":"hidden"}}/>
        {currentUser&&!post.locked&&(<>
          {typingUsers.length>0&&<div style={{padding:"4px 0 6px",fontSize:12,color:"var(--t5)",display:"flex",alignItems:"center",gap:6}}>
            <span style={{display:"flex",gap:3}}>{[0,1,2].map(i=><span key={i} style={{width:4,height:4,borderRadius:"50%",background:"var(--t4)",display:"inline-block",animation:`bounce .9s ${i*0.15}s infinite`}}/>)}</span>
            {typingUsers.length===1?"Someone is":"Multiple people are"} typing…
          </div>}
          <div className="desk-composer" style={{marginTop:20,paddingBottom:32}} ref={composerRef}>
            <div className="reply-box">
              <RichTextArea value={replyBody} onChange={v=>{const wasT=replyBodyRef.current.length>0;const isT=v.length>0;setReplyBody(v);if(isT&&!wasT)sendEvent?.(`post:${postId}`,"typing_start",{});else if(!isT&&wasT)sendEvent?.(`post:${postId}`,"typing_stop",{});if(v.trim())saveDraft({body:v});}} placeholder="Write a reply…" minHeight={120} currentUser={currentUser} attachments={replyAttachments} setAttachments={setReplyAttachments} context="reply"/>
              <div className="reply-box-foot">
                {draftLastSaved && (
                  <span style={{fontSize:11, color:"var(--t5)", display:"flex", alignItems:"center", gap:4}}>
                    <i className="fa-solid fa-cloud-arrow-up" style={{fontSize:10, color:"var(--green)"}}/>
                    Draft saved
                  </span>
                )}
                <button className="btn-primary" style={{marginLeft:"auto",fontSize:13,padding:"7px 20px"}} onClick={submitReply} disabled={submitting||!replyBody.trim()}>{submitting?"…":"Reply"}</button>
              </div>
            </div>
          </div>
        </>)}
      </div>
      <div className="desk-scrubber">{replies.length>0&&currentUser&&<PostScrubber
        scrubber={scrubber}
        firstUnreadIdx={firstUnreadIdx}
        replies={replies}
        lastReadReplyId={lastReadReplyId}
        postId={postId}
        currentUser={currentUser}
        onSavePosition={(replyId,count)=>{setLastReadReplyId(replyId);setLastReadCount(count);}}
      />}</div>
      {currentUser&&!post?.locked&&currentUser?.status!=="pending_deletion"&&<div className="mob-reply-bar" style={{bottom:"calc(54px + env(safe-area-inset-bottom))"}}>
        {!mobReplyOpen
          ? <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 14px"}}>
              <div className="mob-reply-fake" onClick={()=>setMobReplyOpen(true)}>Write a reply…</div>
              <button className="btn-primary" style={{fontSize:12,padding:"7px 16px",flexShrink:0}} onClick={()=>setMobReplyOpen(true)}>Reply</button>
            </div>
          : <div>
              <RichTextArea value={replyBody} onChange={v=>{const wasT=replyBodyRef.current.length>0;const isT=v.length>0;setReplyBody(v);if(isT&&!wasT)sendEvent?.(`post:${postId}`,"typing_start",{});else if(!isT&&wasT)sendEvent?.(`post:${postId}`,"typing_stop",{});}} placeholder="Write a reply…" minHeight={180} currentUser={currentUser} autoFocus={true} attachments={replyAttachments} setAttachments={setReplyAttachments} context="reply"/>
              <div style={{display:"flex",justifyContent:"flex-end",gap:8,padding:"6px 12px",borderTop:"0.5px solid var(--b1)"}}>
                <button className="btn-ghost" style={{fontSize:12}} onClick={()=>{setMobReplyOpen(false);setReplyBody("");}}>Cancel</button>
                <button className="btn-primary" style={{fontSize:12,padding:"6px 16px"}} disabled={submitting||!replyBody.trim()} onClick={async()=>{await submitReply();setMobReplyOpen(false);}}>Reply</button>
              </div>
            </div>}
      </div>}
    </div>
  );
}

function PostFooterSlot({post}) {
  const [, forceUpdate] = React.useReducer(x => x+1, 0);
  useEffect(() => {
    const unsub = window.NexusExtensions.onChange(() => forceUpdate());
    return unsub;
  }, []);
  const components = window.NexusExtensions.getSlot("post_footer");
  if (!components.length) return null;
  // Slot contract: post_footer slotted components receive {post_id}.
  // Anything else this render site has in scope stays out of the props bag.
  const slotProps = window.NexusExtensions.propsForSlot("post_footer", {post});
  return (
    <div className="post-footer-slot">
      {components.map(({component: Comp}, i) => (
        <Comp key={i} {...slotProps} />
      ))}
    </div>
  );
}

function ProfileSidebarSlot({username, currentUser}) {
  const [, forceUpdate] = React.useReducer(x => x+1, 0);
  useEffect(() => {
    const unsub = window.NexusExtensions.onChange(() => forceUpdate());
    return unsub;
  }, []);
  const components = window.NexusExtensions.getSlot("profile_sidebar");
  if (!components.length) return null;
  // Slot contract: profile_sidebar slotted components receive {username,
  // current_user}. The `navigate` function previously passed here is now
  // out of scope — extensions navigate via window.NexusExtensions.navigate.
  const slotProps = window.NexusExtensions.propsForSlot("profile_sidebar", {
    username,
    current_user: currentUser,
  });
  return (
    <div style={{padding:"12px 28px 0",display:"flex",flexDirection:"column",gap:4}}>
      {components.map(({component: Comp}, i) => (
        <Comp key={i} {...slotProps}/>
      ))}
    </div>
  );
}

function MobileScrubberBar({replies, displayIdx, onClick}) {
  return (
    // mob-scrubber-bar is hidden at >=768px by app.css alongside the other
    // mobile-only chrome (mob-topbar, mob-tabbar, mob-reply-bar, mob-sheet).
    // Without it this pill rendered at every width and bled into the desktop
    // post view, which has the desk-scrubber panel instead.
    <div className="mob-scrubber-bar" style={{display:"flex",justifyContent:"center",padding:"10px 0 2px",flexShrink:0}}>
      <button type="button" onClick={onClick}
        aria-label={`Jump to reply. Currently reply ${displayIdx+1} of ${replies.length}`}
        style={{
        display:"flex",alignItems:"center",gap:6,
        padding:"5px 14px",borderRadius:20,
        background:"var(--s2)",border:"0.5px solid var(--b2)",
        cursor:"pointer",WebkitTapHighlightColor:"transparent",
        fontSize:12,fontWeight:500,color:"var(--t2)",
        fontFamily:"inherit",userSelect:"none"
      }}>
        <span>{displayIdx+1} of {replies.length} {replies.length===1?"reply":"replies"}</span>
        <span style={{display:"flex",flexDirection:"column",gap:1,lineHeight:1}}>
          <i className="fa-solid fa-chevron-up"   style={{fontSize:8,color:"var(--t4)",display:"block"}}/>
          <i className="fa-solid fa-chevron-down" style={{fontSize:8,color:"var(--t4)",display:"block"}}/>
        </span>
      </button>
    </div>
  );
}

function MobileScrubberSheet({open, onClose, replies, scrubber, firstUnreadIdx}) {
  const trackRef = useRef(null);
  const listRef  = useRef(null);
  const dragRef  = useRef({});
  const [scrubbing, setScrubbing] = useState(false);

  const { scrollPct, index, pips, jumpTo, dragStart, dragTo, dragEnd } = scrubber;
  const hasUnread = firstUnreadIdx >= 0 && firstUnreadIdx < replies.length;

  // Escape closes the sheet — expected for anything modal, and the only way out
  // for a keyboard user once focus is inside it.
  useEffect(() => {
    if (!open) return undefined;
    const onEsc = (e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  // Scroll the active row into view as the position changes
  useEffect(() => {
    const list = listRef.current;
    if (!list || !open) return;
    const active = list.querySelector("[data-active='true']");
    if (active) active.scrollIntoView({block: "nearest", behavior: "smooth"});
  }, [index, open]);

  // The track is now a real scrubber: dragging scrolls the thread live behind
  // the sheet. Previously it was tap-only, and scrolling the sheet's own list
  // moved the track, which measured the wrong thing entirely.
  function pointerDown(e) {
    const el = trackRef.current;
    if (!el) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    setScrubbing(true);
    dragStart();
    dragTo(pctFromPointer(el, e.clientY));
  }
  function pointerMove(e) {
    const el = trackRef.current;
    if (!el || !el.hasPointerCapture || !el.hasPointerCapture(e.pointerId)) return;
    dragTo(pctFromPointer(el, e.clientY));
  }
  function pointerUp(e) {
    const el = trackRef.current;
    if (el && el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) {
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    setScrubbing(false);
    dragEnd();
  }

  function onKeyDown(e) {
    const next = keyboardTargetIndex(e.key, index, replies.length);
    if (next === null) return;
    e.preventDefault();
    jumpTo(next);
  }

  // Drag the handle down to close
  function onHandleTouchStart(e){ dragRef.current={startY:e.touches[0].clientY,dy:0}; }
  function onHandleTouchMove(e){ dragRef.current.dy=e.touches[0].clientY-dragRef.current.startY; }
  function onHandleTouchEnd(){ if(dragRef.current.dy>60) onClose(); dragRef.current={}; }

  // Transitions are removed while scrubbing, or the fill and thumb visibly lag
  // behind the finger.
  const fillTransition  = scrubbing ? "none" : "height .15s";
  const thumbTransition = scrubbing ? "none" : "top .15s";

  return (<>
    {open&&<div onClick={onClose} style={{position:"fixed",inset:0,zIndex:979,background:"rgba(0,0,0,0.4)"}}/>}
    <div className={`mob-sheet ${open?"open":""}`}>
      <div className="mob-sheet-handle" style={{cursor:"pointer"}}
        role="button" tabIndex={open?0:-1} aria-label="Close"
        onKeyDown={(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); onClose(); } }}
        onTouchStart={onHandleTouchStart} onTouchMove={onHandleTouchMove} onTouchEnd={onHandleTouchEnd}
        onClick={onClose}/>
      <div style={{padding:"0 20px 8px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontSize:13,fontWeight:500,color:"var(--t1)"}}>Jump to reply</span>
        <span style={{display:"flex",alignItems:"center",gap:10}}>
          {hasUnread && (
            <button type="button" tabIndex={open?0:-1}
              onClick={()=>{ jumpTo(firstUnreadIdx); onClose(); }}
              aria-label="Jump to first unread reply"
              style={{background:"none",border:"none",padding:2,cursor:"pointer",color:"var(--green)",fontSize:13,fontFamily:"inherit"}}>
              <i className="fa-solid fa-circle-dot"/>
            </button>
          )}
          <button type="button" tabIndex={open?0:-1}
            onClick={()=>{ jumpTo(replies.length-1); onClose(); }}
            aria-label="Jump to latest reply"
            style={{background:"none",border:"none",padding:2,cursor:"pointer",color:"var(--t4)",fontSize:13,fontFamily:"inherit"}}>
            <i className="fa-solid fa-angles-down"/>
          </button>
          <span style={{fontSize:12,color:"var(--t4)"}}>{index+1} of {replies.length}</span>
        </span>
      </div>
      <div style={{display:"flex",gap:16,padding:"0 20px 20px",alignItems:"stretch"}}>
        <div ref={trackRef}
          className="scrubber-track"
          role="slider" tabIndex={open?0:-1}
          aria-label="Thread position"
          aria-orientation="vertical"
          aria-valuemin={1} aria-valuemax={replies.length} aria-valuenow={index+1}
          aria-valuetext={`Reply ${index+1} of ${replies.length}`}
          onKeyDown={onKeyDown}
          onPointerDown={pointerDown} onPointerMove={pointerMove}
          onPointerUp={pointerUp} onPointerCancel={pointerUp}
          style={{width:44,background:"rgba(255,255,255,0.04)",border:"0.5px solid var(--b1)",borderRadius:10,position:"relative",cursor:"pointer",minHeight:200,touchAction:"none"}}>
          <div style={{position:"absolute",left:"50%",top:0,bottom:0,width:4,transform:"translateX(-50%)",background:"rgba(255,255,255,0.08)",borderRadius:2}}/>
          <div style={{position:"absolute",left:"50%",top:0,width:4,transform:"translateX(-50%)",background:"var(--ac)",height:scrollPct+"%",borderRadius:2,transition:fillTransition}}/>
          {hasUnread && firstUnreadIdx < pips.length && (
            <div title="First unread" style={{position:"absolute",left:"50%",transform:"translateX(-50%)",top:pips[firstUnreadIdx]+"%",marginTop:-1,width:18,height:2,borderRadius:1,background:"var(--green)",pointerEvents:"none"}}/>
          )}
          <div style={{position:"absolute",left:"50%",transform:"translate(-50%,-50%)",top:scrollPct+"%",width:16,height:16,borderRadius:"50%",background:"var(--ac)",border:"2px solid var(--bg)",transition:thumbTransition}}/>
        </div>
        <div ref={listRef} style={{flex:1,overflow:"auto",maxHeight:260}}>
          {replies.map((r,i)=>{
            const isActive = i===index;
            return (
              <button key={r.id} type="button" data-active={isActive?"true":"false"}
                aria-current={isActive?"true":undefined}
                tabIndex={open?0:-1}
                onClick={()=>{ jumpTo(i); onClose(); }}
                style={{padding:"10px 12px",borderRadius:8,marginBottom:4,cursor:"pointer",
                  display:"block",width:"100%",textAlign:"left",fontFamily:"inherit",
                  background:isActive?"var(--ac-bg)":"rgba(255,255,255,0.03)",
                  border:"0.5px solid "+(isActive?"var(--ac-border)":"transparent")}}>
                <div style={{fontSize:12,fontWeight:500,color:isActive?"var(--ac-text)":"var(--t2)"}}>{r.user?.username||"?"}</div>
                <div style={{fontSize:11,color:"var(--t5)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.body?.slice(0,50)||""}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  </>);
}


export { PostScrubber, PostPage, PostFooterSlot, ProfileSidebarSlot,
         EditHistoryModal, lcs, wordDiff, DiffView,
         MobileScrubberBar, MobileScrubberSheet };
