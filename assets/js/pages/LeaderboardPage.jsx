import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { ago } from "../lib/utils";
import { toast } from "../components/Toasts";
import { RsAv } from "../components/Avatar";

// ── LeaderboardPageSidebar, LeaderboardPage ───────────────────────────────────

// ── Leaderboard page contextual sidebar ──────────────────────────────────────
function LeaderboardPageSidebar({currentUser, navigate}) {
  const [streaks,    setStreaks]    = useState(null);
  const [lbData,     setLbData]     = useState(null);

  useEffect(()=>{
    api.get("/leaderboard/streaks").then(d=>setStreaks(d.streaks||[])).catch(()=>setStreaks([]));
    api.get("/leaderboard?period=all").then(d=>setLbData(d)).catch(()=>{});
  },[]);

  const board      = lbData?.leaderboard || [];
  const myRank     = lbData?.my_rank || null;
  const pointsName = lbData?.points_name || "points";

  // Points to next rank — find person directly above current user
  const nextRankInfo = (() => {
    if(!currentUser||!myRank||!board||board.length===0) return null;
    const myPos = myRank.rank;
    if(myPos<=1) return {isFirst:true};
    const aboveUser = board[myPos-2];
    if(!aboveUser) return null;
    const gap = aboveUser.score - myRank.score;
    return {username: aboveUser.username, gap, nextRank: myPos-1};
  })();

  return (
    <>
      {/* Points to next rank */}
      {currentUser&&nextRankInfo&&(
        <div className="rw" style={{border:"0.5px solid rgba(167,139,250,0.2)",background:"rgba(167,139,250,0.04)"}}>
          <div className="rw-label">your next rank</div>
          {nextRankInfo.isFirst
            ? <div style={{fontSize:14,color:"var(--green)",fontWeight:500,display:"flex",alignItems:"center",gap:8}}>
                <i className="fa-solid fa-crown" style={{fontSize:14,color:"#fbbf24"}}/>You&apos;re #1!
              </div>
            : <>
                <div style={{fontSize:28,fontWeight:600,color:"var(--ac)",letterSpacing:-0.5,lineHeight:1,marginBottom:6}}>
                  {Number(nextRankInfo.gap).toLocaleString()}
                </div>
                <div style={{fontSize:14,color:"var(--t4)",lineHeight:1.5}}>
                  {pointsName} to pass <span style={{color:"var(--t2)",fontWeight:500}}>@{nextRankInfo.username}</span> and reach <span style={{color:"var(--ac-text)",fontWeight:500}}>#{nextRankInfo.nextRank}</span>
                </div>
              </>
          }
        </div>
      )}

      {/* Streak leaderboard */}
      <div className="rw">
        <div className="rw-label">top streaks</div>
        {streaks===null
          ?<div style={{fontSize:14,color:"var(--t5)",textAlign:"center",padding:"12px 0"}}>Loading…</div>
          :streaks.length===0
            ?<div style={{fontSize:14,color:"var(--t5)",textAlign:"center",padding:"12px 0"}}>No streaks yet</div>
            :streaks.map((u,i)=>(
              <div key={u.user_id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:i<streaks.length-1?"0.5px solid var(--b1)":"none",cursor:"pointer"}}
                onClick={()=>navigate("profile",{username:u.username})}>
                <RsAv user={{username:u.username,avatar_url:u.avatar_url,avatar_color:u.avatar_color,id:u.user_id}} size={32} noCard />
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:500,color:"var(--t2)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{u.username}</div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:5,flexShrink:0}}>
                  <i className="fa-solid fa-fire" style={{fontSize:13,color:"#fbbf24"}}/>
                  <span style={{fontSize:14,fontWeight:600,color:"#fbbf24"}}>{u.current_streak}</span>
                  <span style={{fontSize:12,color:"var(--t5)"}}>days</span>
                </div>
              </div>
            ))
        }
      </div>
    </>
  );
}




// ── LeaderboardPage ───────────────────────────────────────────────────────────
function LeaderboardPage({currentUser, navigate}) {
  const [period,   setPeriod]   = useState("all");
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(()=>{
    setLoading(true);
    api.get(`/leaderboard?period=${period}`).then(d=>{
      setData(d);
      setLoading(false);
    }).catch(()=>setLoading(false));
  },[period]);

  const pointsName = data?.points_name || "points";
  const board      = data?.leaderboard || [];
  const myRank     = data?.my_rank;
  const top3       = board.slice(0,3);
  const rest       = board.slice(3);

  // Podium order: 2nd left, 1st centre, 3rd right
  const podiumOrder = top3.length === 3
    ? [top3[1], top3[0], top3[2]]
    : top3;

  const podiumStyle = {
    1: {avSize:100, blockH:80, blockBg:"rgba(251,191,36,0.12)", blockBorder:"rgba(251,191,36,0.2)", scoreColor:"#fbbf24"},
    2: {avSize:86,  blockH:60, blockBg:"rgba(176,184,200,0.08)", blockBorder:"rgba(176,184,200,0.15)", scoreColor:"#b0b8c8"},
    3: {avSize:72,  blockH:44, blockBg:"rgba(200,121,65,0.08)", blockBorder:"rgba(200,121,65,0.15)", scoreColor:"#c87941"},
  };
  const rankBadgeStyle = {
    1:{bg:"#fbbf24",color:"#412402"},
    2:{bg:"#b0b8c8",color:"#1a1e2a"},
    3:{bg:"#c87941",color:"#fff"},
  };

  const periodLabels = [{id:"week",label:"This week"},{id:"month",label:"This month"},{id:"all",label:"All time"}];

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* Header */}
      <div style={{padding:"22px 28px 0",borderBottom:"0.5px solid var(--b1)",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:16}}>
          <div>
            <div style={{fontSize:20,fontWeight:600,color:"var(--t1)",letterSpacing:-0.3,marginBottom:3}}>Leaderboard</div>
            <div style={{fontSize:13,color:"var(--t4)"}}>The most active and celebrated voices in the community.</div>
          </div>
          <div style={{display:"flex",gap:4}}>
            {periodLabels.map(p=>(
              <button key={p.id} onClick={()=>setPeriod(p.id)}
                style={{fontSize:11,padding:"5px 14px",borderRadius:20,border:`0.5px solid ${period===p.id?"rgba(167,139,250,0.3)":"var(--b2)"}`,background:period===p.id?"rgba(167,139,250,0.1)":"transparent",color:period===p.id?"var(--ac-text)":"var(--t4)",cursor:"pointer",fontFamily:"inherit"}}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{flex:1,overflowY:"auto",padding:"24px 28px"}}>
        {loading ? <div style={{textAlign:"center",padding:"60px 0",color:"var(--t5)"}}>Loading…</div> : <>

          {/* Podium */}
          {podiumOrder.length > 0 && (<>
            {/* Desktop podium */}
            <div className="podium-desktop" style={{display:"flex",alignItems:"flex-end",justifyContent:"center",gap:16,marginBottom:32,padding:"0 20px"}}>
              {podiumOrder.map((u, idx)=>{
                const rank = podiumOrder.length === 3 ? [2,1,3][idx] : idx+1;
                const ps   = podiumStyle[rank] || podiumStyle[3];
                const rbs  = rankBadgeStyle[rank] || rankBadgeStyle[3];
                return (
                  <div key={u.user_id} style={{display:"flex",flexDirection:"column",alignItems:"center",flex:1,maxWidth:160,cursor:"pointer"}} onClick={()=>navigate("profile",{username:u.username})}>
                    <div style={{position:"relative",marginBottom:10}}>
                      {rank===1 && <div style={{position:"absolute",top:-20,left:"50%",transform:"translateX(-50%)",fontSize:22,lineHeight:1}}>👑</div>}
                      <RsAv user={u} size={ps.avSize} noCard={true}/>
                      <div style={{position:"absolute",bottom:-6,right:-6,width:22,height:22,borderRadius:"50%",background:rbs.bg,color:rbs.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:600,border:"2px solid var(--bg)"}}>{rank}</div>
                    </div>
                    <div style={{fontSize:14,fontWeight:500,color:"var(--t1)",marginBottom:2,textAlign:"center"}}>{u.username}</div>
                    <div style={{fontSize:12,color:"var(--t5)",marginBottom:8,textAlign:"center"}}>@{u.username}</div>
                    <div style={{fontSize:20,fontWeight:600,letterSpacing:-0.5,color:ps.scoreColor,textAlign:"center",marginBottom:2}}>{Number(u.score).toLocaleString()}</div>
                    <div style={{fontSize:11,color:"var(--t5)",marginBottom:10,textAlign:"center"}}>{pointsName}</div>
                    <div style={{height:ps.blockH,width:"100%",background:ps.blockBg,border:`0.5px solid ${ps.blockBorder}`,borderRadius:"12px 12px 0 0"}}/>
                  </div>
                );
              })}
            </div>
            {/* Mobile podium — single column, ranked 1→2→3 */}
            <div className="podium-mobile" style={{display:"none",flexDirection:"column",gap:10,marginBottom:24}}>
              {top3.map((u, idx)=>{
                const rank = idx+1;
                const ps   = podiumStyle[rank] || podiumStyle[3];
                const rbs  = rankBadgeStyle[rank] || rankBadgeStyle[3];
                return (
                  <div key={u.user_id} onClick={()=>navigate("profile",{username:u.username})}
                    style={{display:"flex",alignItems:"center",gap:14,padding:"14px 16px",borderRadius:14,
                      border:`0.5px solid ${ps.blockBorder}`,background:ps.blockBg,cursor:"pointer"}}>
                    <div style={{position:"relative",flexShrink:0}}>
                      {rank===1&&<div style={{position:"absolute",top:-12,left:"50%",transform:"translateX(-50%)",fontSize:16,lineHeight:1}}>👑</div>}
                      <RsAv user={u} size={52} noCard={true}/>
                      <div style={{position:"absolute",bottom:-4,right:-4,width:20,height:20,borderRadius:"50%",background:rbs.bg,color:rbs.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:600,border:"2px solid var(--bg)"}}>{rank}</div>
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:16,fontWeight:600,color:"var(--t1)",marginBottom:2}}>{u.username}</div>
                      <div style={{fontSize:14,color:"var(--t5)"}}>{Number(u.score).toLocaleString()} {pointsName}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>)}

          {/* Your rank banner */}
          {currentUser && myRank && (
            <div style={{background:"rgba(167,139,250,0.07)",border:"0.5px solid rgba(167,139,250,0.15)",borderRadius:12,padding:"12px 16px",marginBottom:20,display:"flex",alignItems:"center",gap:12}}>
              <RsAv user={currentUser} size={36} noCard={true}/>
              <div style={{flex:1}}>
                <div style={{fontSize:11,color:"var(--t5)",marginBottom:2}}>your ranking — {periodLabels.find(p=>p.id===period)?.label?.toLowerCase()}</div>
                <div style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>{Number(myRank.score).toLocaleString()} {pointsName}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:22,fontWeight:600,color:"#a78bfa",letterSpacing:-0.5,lineHeight:1}}>#{myRank.rank}</div>
                <div style={{fontSize:11,color:"var(--t5)"}}>top {myRank.pct}%</div>
              </div>
            </div>
          )}

          {/* Rank table */}
          {rest.length > 0 && <>
            <div style={{display:"grid",gridTemplateColumns:"40px 1fr 100px 80px",gap:0,padding:"0 16px 8px",fontSize:10,fontWeight:500,color:"var(--t5)",textTransform:"uppercase",letterSpacing:"0.8px",borderBottom:"0.5px solid var(--b1)",marginBottom:4}}>
              <div>#</div><div>member</div><div style={{textAlign:"right"}}>{pointsName}</div><div style={{textAlign:"right"}}>streak</div>
            </div>
            {rest.map((u, idx)=>{
              const rank  = idx + 4;
              const isMe  = currentUser?.username === u.username;
              return (
                <div key={u.user_id}
                  style={{display:"grid",gridTemplateColumns:"40px 1fr 100px 80px",gap:0,padding:"10px 16px",borderRadius:10,cursor:"pointer",alignItems:"center",marginBottom:2,background:isMe?"rgba(167,139,250,0.07)":"transparent",border:isMe?"0.5px solid rgba(167,139,250,0.15)":"0.5px solid transparent"}}
                  onMouseEnter={e=>{ if(!isMe) e.currentTarget.style.background=document.documentElement.getAttribute("data-theme")==="light"?"rgba(26,20,80,0.04)":"rgba(255,255,255,0.03)"; }}
                  onMouseLeave={e=>{ if(!isMe) e.currentTarget.style.background="transparent"; }}
                  onClick={()=>navigate("profile",{username:u.username})}>
                  <div style={{fontSize:14,fontWeight:500,color:isMe?"var(--ac)":"var(--t4)"}}>{rank}</div>
                  <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
                    <RsAv user={u} size={34} noCard={true}/>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:500,color:isMe?"var(--t1)":"var(--t2)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                        {u.username}{isMe&&<span style={{fontSize:11,color:"rgba(167,139,250,0.6)",fontWeight:400,marginLeft:6}}>you</span>}
                      </div>
                      {u.badges && u.badges.length > 0 && (
                        <div style={{display:"flex",gap:4,marginTop:2}}>
                          {u.badges.map((b,i)=>(
                            <span key={i} style={{fontSize:9,padding:"1px 6px",borderRadius:20,background:`${b.color}20`,color:b.color}}>{b.name}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{fontSize:13,fontWeight:500,color:isMe?"var(--ac-text)":"var(--t3)",textAlign:"right"}}>{Number(u.score).toLocaleString()}</div>
                  <div style={{fontSize:12,color:"var(--t5)",textAlign:"right"}}>—</div>
                </div>
              );
            })}
          </>}

          {board.length === 0 && (
            <div style={{textAlign:"center",padding:"60px 0",color:"var(--t5)"}}>
              <i className="fa-solid fa-trophy" style={{fontSize:28,opacity:.3,marginBottom:12,display:"block"}}/>
              No scores yet. Activity will appear here once members start posting.
            </div>
          )}
        </>}
      </div>
    </div>
  );
}



// ── Exports ──────────────────────────────────────────────────────────────────
export { LeaderboardPageSidebar, LeaderboardPage };
