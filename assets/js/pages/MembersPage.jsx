import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { userColor } from "../lib/utils";
import { RsAv } from "../components/Avatar";
import { Select } from "../components/Select";

// ── MembersPage ───────────────────────────────────────────────────────────────

function MemberCard({m, navigate, currentUser}) {
  const col = userColor(m);
  const ROLE_COLOR = {admin:"var(--amber)", moderator:"var(--ac)", member:"var(--t5)"};
  const ROLE_BG    = {admin:"rgba(251,191,36,.15)", moderator:"var(--ac-bg)", member:"var(--s3)"};
  const [fullUser, setFullUser] = useState(null);
  const stats = fullUser ? {post_count:fullUser.post_count||0,reply_count:fullUser.reply_count||0,reactions_received:fullUser.reactions_received||0} : null;

  useEffect(()=>{
    api.get(`/users/${m.username}`).then(d=>{
      if(d.user) setFullUser(d.user);
    });
  },[m.username]);

  const cover_url = fullUser?.cover_url || m.cover_url;
  const bio = fullUser?.bio || m.bio;

  const startDM = async e => {
    e.stopPropagation();
    const d = await api.post("/threads/direct",{username:m.username});
    if(d.thread) navigate("dm",{threadId:d.thread.id,threadName:m.username});
    else toast(d.error||"Could not start conversation","err");
  };

  return (
    <div style={{background:"var(--s2)",border:"0.5px solid var(--b1)",borderRadius:16,overflow:"hidden",
      cursor:"pointer",transition:"border-color .15s, box-shadow .15s",boxShadow:"none"}}
      onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--b2)";e.currentTarget.style.boxShadow="0 6px 24px rgba(0,0,0,.3)";}}
      onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--b1)";e.currentTarget.style.boxShadow="none";}}>
      {/* Cover */}
      <div style={{height:90,position:"relative",background:cover_url?`url(${cover_url}) center/cover`:"var(--s3)"}}>
        <div style={{position:"absolute",bottom:-36,left:16}}>
          <RsAv user={m} size={72} noCard />
        </div>
      </div>
      {/* Body */}
      <div style={{padding:"10px 16px 16px",paddingTop:44}}>
        {/* Name + role */}
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:4}}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:15,fontWeight:500,color:"var(--t1)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
              onClick={()=>navigate("profile",{username:m.username})}>{m.username}</div>
            <div style={{fontSize:12,color:"var(--t5)",marginTop:2}}>Joined {fmtDate(m.inserted_at)}</div>
          </div>
          {m.role&&m.role!=="member"&&<div style={{fontSize:11,padding:"3px 8px",borderRadius:6,background:ROLE_BG[m.role],color:ROLE_COLOR[m.role],border:`0.5px solid ${ROLE_COLOR[m.role]}44`,flexShrink:0}}>{m.role}</div>}
        </div>
        {/* Bio */}
        {bio&&<p style={{fontSize:13,color:"var(--t3)",margin:"0 0 10px",lineHeight:1.5,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{bio}</p>}
        {/* Stats */}
        <div style={{display:"flex",gap:6,marginBottom:10}}>
          <div className="ucard-stat"><div className="ucard-stat-n">{stats?stats.post_count:"·"}</div><div className="ucard-stat-l">posts</div></div>
          <div className="ucard-stat"><div className="ucard-stat-n">{stats?stats.reply_count:"·"}</div><div className="ucard-stat-l">replies</div></div>
          <div className="ucard-stat"><div className="ucard-stat-n" style={{color:"var(--ac)"}}>{stats?stats.reactions_received:"·"}</div><div className="ucard-stat-l">reactions</div></div>
        </div>
        {/* Last seen */}
        {m.last_seen_at&&<div style={{fontSize:12,color:"var(--t5)",marginBottom:10,display:"flex",alignItems:"center",gap:5}}>
          <i className="fa-solid fa-clock" style={{fontSize:10}}/>Active {ago(m.last_seen_at)}
        </div>}
        {/* Actions */}
        <div style={{display:"flex",gap:7}}>
          {currentUser&&currentUser.username!==m.username&&<button className="btn-ghost" style={{flex:1,fontSize:13,padding:"8px 0",borderRadius:8}} onClick={startDM}>
            <i className="fa-solid fa-message" style={{fontSize:11,marginRight:5}}/>Message
          </button>}
          <button className="btn-ghost" style={{flex:1,fontSize:13,padding:"8px 0",borderRadius:8}} onClick={()=>navigate("profile",{username:m.username})}>
            <i className="fa-solid fa-user" style={{fontSize:11,marginRight:5}}/>Profile
          </button>
        </div>
      </div>
    </div>
  );
}

function MembersPage({navigate, currentUser}) {
  const [members,setMembers]=useState([]); const [loading,setLoading]=useState(true); const [q,setQ]=useState("");
  const [sort,setSort]=useState("newest");

  useEffect(()=>{
    setLoading(true);
    const endpoint = `/users?sort=${sort}`;
    api.get(endpoint).then(d=>{
      setMembers(d.users || d.members || []);
      setLoading(false);
    }).catch(()=>setLoading(false));
  },[currentUser, sort]);

  const filtered = members.filter(m=>!q||m.username?.toLowerCase().includes(q.toLowerCase()));

  const SORTS = [
    {v:"newest",        label:"Newest"},
    {v:"oldest",        label:"Oldest"},
    {v:"most_posts",    label:"Most posts"},
    {v:"most_replies",  label:"Most replies"},
    {v:"most_reactions",label:"Most reactions"},
  ];

  const fi = {background:"var(--s1)",border:"0.5px solid var(--b1)",borderRadius:20,padding:"7px 14px",fontSize:13,color:"var(--t2)",fontFamily:"inherit",outline:"none",cursor:"pointer"};

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* Header */}
      <div style={{padding:"18px 24px 14px",borderBottom:"0.5px solid var(--b1)",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <div>
            <div style={{fontSize:18,fontWeight:600,color:"var(--t1)",letterSpacing:-0.3}}>Members</div>
            <div style={{fontSize:12,color:"var(--t5)",marginTop:2}}>{members.length} total</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <div style={{background:"rgba(255,255,255,0.04)",border:"0.5px solid var(--b1)",borderRadius:20,display:"flex",alignItems:"center",padding:"7px 14px",gap:8,flex:1,maxWidth:360}}>
            <i className="fa-solid fa-magnifying-glass" style={{fontSize:11,color:"var(--t5)"}}/>
            <input style={{background:"transparent",border:"none",outline:"none",fontSize:13,color:"var(--t2)",fontFamily:"inherit",flex:1}} placeholder="Search members…" value={q} onChange={e=>setQ(e.target.value)}/>
          </div>
          <Select style={fi} value={sort} onChange={setSort}>
            {SORTS.map(s=><option key={s.v} value={s.v}>{s.label}</option>)}
          </Select>
        </div>
      </div>
      {/* Grid */}
      <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>
        {loading
          ?<div style={{padding:"40px",textAlign:"center",color:"var(--t5)"}}>Loading…</div>
          :filtered.length===0
            ?<div style={{padding:"40px",textAlign:"center",color:"var(--t5)"}}>No members found</div>
            :<div className="members-grid">
              {filtered.map(m=><MemberCard key={m.id} m={m} navigate={navigate} currentUser={currentUser}/>)}
            </div>}
      </div>
    </div>


export { MemberCard, MembersPage };
