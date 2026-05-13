import { useState, useEffect, useRef, useReducer, useCallback } from "react";
import { api } from "../lib/api";
import { ago, fmtDate, userColor, spaceColor } from "../lib/utils";
import { toast } from "../components/Toasts";
import { RsAv, Av, openUserCard } from "../components/Avatar";

// Mirror of the backend/Markdown skip logic — extracts bare URLs that will
// get link preview cards, so we can pre-register them as fresh before render.
const _skipUnfurl = [
  /(?:youtube\.com\/(?:watch|embed|shorts)|youtu\.be\/)/i,
  /vimeo\.com\/(?:video\/)?[0-9]+/i,
  /(?:twitter\.com|x\.com)\/[^/]+\/status/i,
  /open\.spotify\.com\/(?:track|album|playlist|episode)\//i,
  /\.(mp4|webm|ogg|mov|mp3|wav|flac|m4a)(\?.*)?$/i,
  /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i,
];
function extractUnfurlableUrls(body) {
  if (!body) return [];
  const matches = body.match(/(?<![([![])(https?:\/\/[^\s<>")\]]+)/g) || [];
  return [...new Set(matches)]
    .filter(u => !_skipUnfurl.some(r => r.test(u)))
    .slice(0, 3);
}

import { Select } from "../components/Select";
import { Md } from "../components/Markdown";
import { ReactionsModal, ReactionButton } from "../components/Reactions";
import { RichTextArea, TB_BTNS } from "../components/RichTextArea";
import { useDraftAutosave } from "./DraftsPage";
function PostScrubber({replies, lastReadReplyId, postId, currentUser, onSavePosition}) {
  var trackRef = useRef(null);
  var saveTimer = useRef(null);
  var isDragging = useRef(false);
  var maxReadIdx = useRef(lastReadReplyId
    ? replies.findIndex(function(r){return r.id===lastReadReplyId;})
    : -1);

  // scrollPct: 0-100, reflects exact scroll position fluid and continuous
  var [scrollPct, setScrollPct] = useState(0);
  // readPct: high-water mark of how far the user has actually read
  var [readPct, setReadPct] = useState(function(){
    var idx = maxReadIdx.current;
    return idx >= 0 && replies.length > 1 ? (idx/(replies.length-1))*100 : 0;
  });

  function getContainer() {
    return document.querySelector('.post-content-wrap');
  }

  function pctFromScroll(container) {
    var max = container.scrollHeight - container.clientHeight;
    if(max <= 0) return 100;
    return Math.min(100, (container.scrollTop / max) * 100);
  }

  function replyIdxFromPct(pct) {
    return Math.round((pct/100) * (replies.length-1));
  }

  function jumpToIndex(ri) {
    ri = Math.max(0, Math.min(ri, replies.length-1));
    var reply = replies[ri];
    if(!reply) return;
    var container = getContainer();
    var el = document.getElementById('reply-'+reply.id);
    if(!el || !container) return;
    container.scrollTo({top: el.offsetTop - 20, behavior:'smooth'});
    if(ri > maxReadIdx.current) {
      maxReadIdx.current = ri;
      var pct = replies.length > 1 ? (ri/(replies.length-1))*100 : 100;
      setReadPct(pct);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(function(){
        if(currentUser && reply){
          api.post('/posts/'+postId+'/read-position',{last_reply_id:reply.id,reply_count:ri+1}).catch(function(){});
          if(onSavePosition) onSavePosition(reply.id, ri+1);
        }
      }, 500);
    }
  }

  useEffect(function(){
    var container = getContainer();
    if(!container || !replies.length) return;
    // Set initial scroll position
    setScrollPct(pctFromScroll(container));

    function onScroll() {
      var pct = pctFromScroll(container);
      setScrollPct(pct);

      // Advance read high-water mark
      var ri = replyIdxFromPct(pct);
      if(ri > maxReadIdx.current) {
        maxReadIdx.current = ri;
        var rPct = replies.length > 1 ? (ri/(replies.length-1))*100 : 100;
        setReadPct(rPct);
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(function(){
          var r = replies[ri];
          if(currentUser && r){
            api.post('/posts/'+postId+'/read-position',{last_reply_id:r.id,reply_count:ri+1}).catch(function(){});
            if(onSavePosition) onSavePosition(r.id, ri+1);
          }
        }, 1500);
      }
    }
    container.addEventListener('scroll', onScroll, {passive:true});
    return function(){ container.removeEventListener('scroll', onScroll); clearTimeout(saveTimer.current); };
  }, [replies.length, postId]);

  function onTrackClick(e) {
    if(isDragging.current || !trackRef.current) return;
    var rect = trackRef.current.getBoundingClientRect();
    var pct = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    var ri = replyIdxFromPct(pct);
    jumpToIndex(ri);
  }

  function onThumbMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    function onMove(me) {
      if(!trackRef.current) return;
      var rect = trackRef.current.getBoundingClientRect();
      var pct = Math.max(0, Math.min(100, ((me.clientY - rect.top) / rect.height) * 100));
      setScrollPct(pct);
      var ri = replyIdxFromPct(pct);
      var reply = replies[ri];
      if(!reply) return;
      var container = getContainer();
      var el = document.getElementById('reply-'+reply.id);
      if(el && container) container.scrollTop = el.offsetTop - 20;
    }
    function onUp() {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  var displayIdx = replyIdxFromPct(scrollPct);

  return (
    <div style={{width:44,flexShrink:0,borderLeft:"0.5px solid var(--b1)",display:"flex",flexDirection:"column",alignItems:"center",padding:"16px 0",gap:4,background:"var(--s1)",userSelect:"none"}}>
      <div style={{fontSize:10,color:"var(--t5)",marginBottom:2}}>{replies.length}</div>
      <div style={{fontSize:9,color:"var(--t5)",marginBottom:8}}>replies</div>
      {/* Full-width hit area — track is visual only, this div captures all clicks/drags */}
      <div ref={trackRef}
        onClick={onTrackClick}
        onMouseDown={onThumbMouseDown}
        style={{flex:1,width:"100%",position:"relative",cursor:"grab",margin:"4px 0",display:"flex",alignItems:"center",justifyContent:"center"}}>
        {/* Track background */}
        <div style={{position:"absolute",top:0,bottom:0,left:"50%",transform:"translateX(-50%)",width:4,background:"rgba(255,255,255,0.08)",borderRadius:2,pointerEvents:"none"}}/>
        {/* Read high-water fill */}
        <div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:4,borderRadius:2,background:"rgba(167,139,250,0.25)",height:readPct+"%",pointerEvents:"none"}}/>
        {/* Scroll position fill */}
        <div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:4,borderRadius:2,background:"var(--ac)",height:scrollPct+"%",pointerEvents:"none"}}/>
        {/* Pip per reply */}
        {replies.map(function(r,i){
          var topPct = replies.length > 1 ? (i/(replies.length-1))*100 : 50;
          return React.createElement('div',{key:r.id,title:"Reply "+(i+1),style:{
            position:"absolute",left:"50%",transform:"translateX(-50%)",
            top:topPct+"%",marginTop:-1,
            width:6,height:2,borderRadius:1,
            background:i <= displayIdx ? "rgba(167,139,250,0.6)" : "rgba(255,255,255,0.12)",
            pointerEvents:"none"
          }});
        })}
        {/* Thumb */}
        <div style={{
          position:"absolute",left:"50%",transform:"translate(-50%,-50%)",
          top:scrollPct+"%",width:14,height:14,borderRadius:"50%",
          background:"var(--ac)",border:"2px solid var(--s1)",
          zIndex:3,pointerEvents:"none"
        }}/>
      </div>
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
  const ops = wordDiff(before||"", after||"");
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

function PostPage({postId, currentUser, navigate, spaces, onAuthRequired, joinTopic, leaveTopic, sendEvent, openReport, scrollToReply, resumeDraft=null}) {
  const [post,setPost]=useState(null); const [replies,setReplies]=useState([]);
  const [loading,setLoading]=useState(true); const [replyBody,setReplyBody]=useState(resumeDraft?.body||"");
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
        setReplies(p=>p.some(r=>r.id===e.detail.reply.id)?p:[...p,e.detail.reply]);
        setPost(p=>p?{...p,reply_count:(p.reply_count||0)+1}:p);
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
        // Set to the saved reply ID if present, or null (= fetched, no position)
        setLastReadReplyId(rp.last_reply_id || null);
        if(rp.last_reply_id) setLastReadCount(rp.reply_count||0);
        if(currentUser){
          api.get("/saved").then(d=>{
            const saves = d.saved||[];
            setPostSaved(saves.some(s=>s.type==="post"&&s.post?.id===pd.post?.id));
          setAcceptedReplyId(pd.post?.accepted_reply_id||null);
            setSavedReplyIds(new Set(saves.filter(s=>s.type==="reply").map(s=>s.reply?.id).filter(Boolean)));
          }).catch(()=>{});
          // Load follow state — placeholder until backend is built;
          // reads from a post_follow endpoint when available
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
    try { const d=await api.post(`/posts/${postId}/replies`,{body:replyBody,compositionSignals});
      if(d.reply&&d.pending){setReplyBody("");await clearDraft();toast("Your reply is pending moderator approval");}
      else if(d.reply){
        if(window._lpRegisterFresh) window._lpRegisterFresh(extractUnfurlableUrls(d.reply.body));
        setReplies(p=>p.some(r=>r.id===d.reply.id)?p:[...p,d.reply]);
        setReplyBody("");
        await clearDraft();
        setPost(p=>({...p,reply_count:(p.reply_count||0)+1}));
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
      else toast((d.errors&&JSON.stringify(d.errors))||d.error||"Failed to submit report","err");
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
    const link = `[↩ ${username}](${anchor}) `;
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
  const col = spaceColor(post?.space||{id:postId});

  if(loading) return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)"}}>Loading...</div>;
  if(!post) return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)"}}>Post not found.</div>;

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
  },[loadMoreReplies]);

  return (
    <div className="post-shell">
      {/* Report modal */}
      {pinModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:20}} onClick={e=>e.target===e.currentTarget&&setPinModal(false)}>
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
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:20}} onClick={e=>e.target===e.currentTarget&&setReportTarget(null)}>
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
      <div className="post-content-wrap" ref={repliesContainerRef}>
          {replies.length>0&&<MobileScrubberBar replies={replies} scrollPct={0} displayIdx={0} onClick={()=>setMobSheetOpen(true)}/>}
          <MobileScrubberSheet open={mobSheetOpen} onClose={()=>setMobSheetOpen(false)} replies={replies} scrollPct={0} displayIdx={0} onJump={(ri)=>{var r=replies[ri];if(!r)return;var el=document.getElementById("reply-"+r.id);var c=repliesContainerRef.current;if(el&&c){c.scrollTo({top:el.offsetTop-20,behavior:"smooth"});setMobSheetOpen(false);}}}/>
        <div className="post-back" onClick={()=>navigate("feed")}><i className="fa-solid fa-arrow-left"></i> back to feed</div>
        <div style={{display:"flex",alignItems:"flex-start",gap:14,marginBottom:16}}>
          <div style={{width:4,alignSelf:"stretch",background:col,borderRadius:2,flexShrink:0,minHeight:60}}/>
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
              <div className="post-title" style={{marginBottom:0}}>{post.title}</div>
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
                  style={{minHeight:140,resize:"vertical",lineHeight:1.7,fontFamily:"inherit",fontSize:13}}
                  placeholder="Post body…"/>
                <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8}}>
                  <button className="btn-ghost" onClick={()=>setEditingPost(false)} style={{fontSize:12}}>Cancel</button>
                  <button className="btn-primary" style={{fontSize:12,padding:"6px 18px"}} disabled={editSaving||!editTitle.trim()||!editBody.trim()}
                    onClick={async()=>{
                      setEditSaving(true);
                      const d = await api.patch(`/posts/${post.id}`,{title:editTitle.trim(),body:editBody.trim()});
                      setEditSaving(false);
                      if(d.post){setPost(p=>({...p,title:d.post.title,body:d.post.body}));setEditingPost(false);toast("Post updated");}
                      else toast(d.error||"Failed","err");
                    }}>
                    {editSaving?"Saving…":"Save changes"}
                  </button>
                </div>
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
                    {currentUser.id===post.user?.id&&<button onClick={()=>{setPostMenuOpen(false);setEditTitle(post.title||"");setEditBody(post.body||"");setEditingPost(true);}} style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--t3)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
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
        <PostFooterSlot postId={post.id} />
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
                  ?<img src={r.user.avatar_url} className="reply-av" style={{objectFit:"cover",borderRadius:"var(--av-radius)",cursor:"pointer",marginRight:10}} alt={r.user.username} onClick={e=>{e.stopPropagation();openUserCard(r.user.username,e.currentTarget);}}/>
                  :<div className="reply-av" style={{background:userColor(r.user),color:"#fff",marginRight:10}}>{(r.user?.username||"?").slice(0,2).toUpperCase()}</div>}
                <span className="reply-author" style={{cursor:"pointer"}} onClick={()=>navigate("profile",{username:r.user?.username})}>{r.user?.username}</span>
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
        {replyHasMore&&<div ref={replySentinelRef} style={{height:40}}/>}
        {currentUser&&!post.locked&&(<>
          {typingUsers.length>0&&<div style={{padding:"4px 0 6px",fontSize:12,color:"var(--t5)",display:"flex",alignItems:"center",gap:6}}>
            <span style={{display:"flex",gap:3}}>{[0,1,2].map(i=><span key={i} style={{width:4,height:4,borderRadius:"50%",background:"var(--t4)",display:"inline-block",animation:`bounce .9s ${i*0.15}s infinite`}}/>)}</span>
            {typingUsers.length===1?"Someone is":"Multiple people are"} typing…
          </div>}
          <div className="desk-composer" style={{marginTop:20,paddingBottom:32}} ref={composerRef}>
            <div className="reply-box">
              <RichTextArea value={replyBody} onChange={v=>{const wasT=replyBodyRef.current.length>0;const isT=v.length>0;setReplyBody(v);if(isT&&!wasT)sendEvent?.(`post:${postId}`,"typing_start",{});else if(!isT&&wasT)sendEvent?.(`post:${postId}`,"typing_stop",{});if(v.trim())saveDraft({body:v});}} placeholder="Write a reply…" minHeight={120} currentUser={currentUser} toolbarItems={TB_BTNS}/>
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
        replies={replies}
        lastReadReplyId={lastReadReplyId}
        postId={postId}
        currentUser={currentUser}
        onSavePosition={(replyId,count)=>{setLastReadReplyId(replyId);setLastReadCount(count);}}
      />}</div>
      {currentUser&&!post?.locked&&<div className="mob-reply-bar" style={{bottom:"calc(54px + env(safe-area-inset-bottom))"}}>
        {!mobReplyOpen
          ? <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 14px"}}>
              <div className="mob-reply-fake" onClick={()=>setMobReplyOpen(true)}>Write a reply…</div>
              <button className="btn-primary" style={{fontSize:12,padding:"7px 16px",flexShrink:0}} onClick={()=>setMobReplyOpen(true)}>Reply</button>
            </div>
          : <div>
              <RichTextArea value={replyBody} onChange={v=>{const wasT=replyBodyRef.current.length>0;const isT=v.length>0;setReplyBody(v);if(isT&&!wasT)sendEvent?.(`post:${postId}`,"typing_start",{});else if(!isT&&wasT)sendEvent?.(`post:${postId}`,"typing_stop",{});}} placeholder="Write a reply…" minHeight={160} currentUser={currentUser} autoFocus={true} toolbarItems={TB_BTNS}/>
              <div style={{display:"flex",justifyContent:"flex-end",gap:8,padding:"6px 12px",borderTop:"0.5px solid var(--b1)"}}>
                <button className="btn-ghost" style={{fontSize:12}} onClick={()=>{setMobReplyOpen(false);setReplyBody("");}}>Cancel</button>
                <button className="btn-primary" style={{fontSize:12,padding:"6px 16px"}} disabled={submitting||!replyBody.trim()} onClick={async()=>{await submitReply();setMobReplyOpen(false);}}>Reply</button>
              </div>
            </div>}
      </div>}
    </div>
  );
}

function PostFooterSlot({postId}) {
  const [, forceUpdate] = React.useReducer(x => x+1, 0);
  useEffect(() => {
    const unsub = window.NexusExtensions.onChange(() => forceUpdate());
    return unsub;
  }, []);
  const components = window.NexusExtensions.getSlot("post_footer");
  if (!components.length) return null;
  return (
    <div className="post-footer-slot">
      {components.map(({component: Comp, priority}, i) => (
        <Comp key={i} postId={postId} />
      ))}
    </div>
  );
}

function ProfileSidebarSlot({username, currentUser, navigate}) {
  const [, forceUpdate] = React.useReducer(x => x+1, 0);
  useEffect(() => {
    const unsub = window.NexusExtensions.onChange(() => forceUpdate());
    return unsub;
  }, []);
  const components = window.NexusExtensions.getSlot("profile_sidebar");
  if (!components.length) return null;
  return (
    <div style={{padding:"12px 28px 0",display:"flex",flexDirection:"column",gap:4}}>
      {components.map(({component: Comp}, i) => (
        <Comp key={i} username={username} currentUser={currentUser} navigate={navigate}/>
      ))}
    </div>
  );
}

function MobileScrubberBar({replies, scrollPct, displayIdx, onClick}) {
  return (
    <div className="mob-scrubber-bar" onClick={onClick}>
      <i className="fa-solid fa-list" style={{fontSize:11,color:"var(--t5)",flexShrink:0}}/>
      <div className="mob-scrubber-track">
        <div className="mob-scrubber-fill" style={{width:scrollPct+"%"}}/>
      </div>
      <span className="mob-scrubber-label">{displayIdx+1}/{replies.length}</span>
      <i className="fa-solid fa-chevron-up" style={{fontSize:10,color:"var(--t5)",flexShrink:0}}/>
    </div>
  );
}

function MobileScrubberSheet({open, onClose, replies, scrollPct, displayIdx, onJump}) {
  const trackRef = React.useRef();
  function handleTrack(e) {
    if(!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const pct = Math.max(0,Math.min(100,((e.clientY-rect.top)/rect.height)*100));
    onJump(Math.round((pct/100)*(replies.length-1)));
  }
  return (
    <div className={`mob-sheet ${open?"open":""}`}>
      <div className="mob-sheet-handle" onClick={onClose}/>
      <div style={{padding:"0 20px 8px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontSize:13,fontWeight:500,color:"var(--t1)"}}>Jump to reply</span>
        <span style={{fontSize:12,color:"var(--t4)"}}>{displayIdx+1} of {replies.length}</span>
      </div>
      <div style={{display:"flex",gap:16,padding:"0 20px 20px",alignItems:"stretch"}}>
        {/* Vertical track */}
        <div ref={trackRef} onClick={handleTrack}
          style={{width:44,background:"rgba(255,255,255,0.04)",border:"0.5px solid var(--b1)",borderRadius:10,position:"relative",cursor:"pointer",minHeight:200}}>
          <div style={{position:"absolute",left:"50%",top:0,bottom:0,width:4,transform:"translateX(-50%)",background:"rgba(255,255,255,0.08)",borderRadius:2}}/>
          <div style={{position:"absolute",left:"50%",top:0,width:4,transform:"translateX(-50%)",background:"var(--ac)",height:scrollPct+"%",borderRadius:2,transition:"height .2s"}}/>
          <div style={{position:"absolute",left:"50%",transform:"translate(-50%,-50%)",top:scrollPct+"%",width:16,height:16,borderRadius:"50%",background:"var(--ac)",border:"2px solid var(--bg)"}}/>
        </div>
        {/* Reply list */}
        <div style={{flex:1,overflow:"auto",maxHeight:260}}>
          {replies.map(function(r,i){
            var isActive = i===displayIdx;
            return React.createElement('div',{
              key:r.id, onClick:function(){onJump(i);},
              style:{padding:"10px 12px",borderRadius:8,marginBottom:4,cursor:"pointer",
                background:isActive?"var(--ac-bg)":"rgba(255,255,255,0.03)",
                border:"0.5px solid "+(isActive?"var(--ac-border)":"transparent")}
            },
              React.createElement('div',{style:{fontSize:12,fontWeight:500,color:isActive?"var(--ac-text)":"var(--t2)"}},
                (r.user?.username||"?")),
              React.createElement('div',{style:{fontSize:11,color:"var(--t5)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}},
                r.body?.slice(0,50)||"")
            );
          })}
        </div>
      </div>
    </div>
  );
}


export { PostScrubber, PostPage, PostFooterSlot, ProfileSidebarSlot,
         EditHistoryModal, lcs, wordDiff, DiffView,
         MobileScrubberBar, MobileScrubberSheet };
