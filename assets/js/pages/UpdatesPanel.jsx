import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { toast } from "../components/Toasts";

// ── UpdatesPanel ──────────────────────────────────────────────────────────────

}

// ── Updates panel ─────────────────────────────────────────────────────────────
// Checks GitHub Releases for a newer version of Nexus and applies it.
function UpdatesPanel() {
  const [status,   setStatus]   = useState("idle"); // idle | checking | up_to_date | update_available | applying | done | error
  const [info,     setInfo]     = useState(null);   // { current, latest, up_to_date, release }
  const [log,      setLog]      = useState([]);     // step-by-step log from apply
  const [error,    setError]    = useState(null);
  const [confirm,  setConfirm]  = useState(false);

  // Auto-check on mount
  useEffect(()=>{ check(); },[]);

  const check = async () => {
    setStatus("checking"); setError(null); setInfo(null); setLog([]);
    const d = await api.get("/admin/updates/check");
    if(d.ok) {
      setInfo(d.update);
      setStatus(d.update.up_to_date ? "up_to_date" : "update_available");
    } else {
      setError(d.error||"Could not check for updates");
      setStatus("error");
    }
  };

  const apply = async () => {
    setConfirm(false);
    setStatus("applying"); setLog([]); setError(null);
    const d = await api.post("/admin/updates/apply");
    setLog(d.log||[]);
    if(d.ok) {
      setStatus("done");
    } else {
      setError(d.error||"Update failed");
      setStatus("error");
    }
  };

  const btnStyle = (variant="ghost") => ({
    fontSize:12, padding:"7px 16px", borderRadius:8, cursor:"pointer",
    fontFamily:"inherit", fontWeight:500, display:"flex", alignItems:"center", gap:6,
    ...(variant==="primary"
      ? {background:"var(--ac)", border:"none", color:"#fff"}
      : {background:"var(--s3)", border:"0.5px solid var(--b1)", color:"var(--t2)"}),
  });

  return (
    <div style={{maxWidth:600}}>
      <div style={{fontSize:17,fontWeight:500,color:"var(--t1)",marginBottom:4}}>Nexus updates</div>
      <div style={{fontSize:13,color:"var(--t5)",marginBottom:28}}>
        Updates are pulled from tagged releases on GitHub. Your <code style={{fontSize:11}}>.env</code>,
        database, and uploads are never touched.
      </div>

      {/* Version card */}
      <div style={{padding:"18px 20px",background:"var(--s3)",border:"0.5px solid var(--b1)",
        borderRadius:12,marginBottom:20}}>

        {/* Current version row */}
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom: info?.release ? 14 : 0}}>
          <div style={{width:36,height:36,borderRadius:9,background:"rgba(167,139,250,0.1)",
            border:"0.5px solid rgba(167,139,250,0.2)",display:"flex",alignItems:"center",
            justifyContent:"center",flexShrink:0}}>
            <i className="fa-solid fa-cube" style={{fontSize:15,color:"var(--ac)"}}/>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:500,color:"var(--t1)"}}>
              Current version
              <span style={{fontSize:12,fontWeight:400,color:"var(--t5)",marginLeft:8}}>
                {info ? `v${info.current}` : "—"}
              </span>
            </div>
            <div style={{fontSize:12,color:"var(--t5)",marginTop:2}}>
              {status==="checking" && <><i className="fa-solid fa-spinner fa-spin" style={{marginRight:5}}/>Checking for updates…</>}
              {status==="up_to_date" && <><i className="fa-solid fa-circle-check" style={{marginRight:5,color:"var(--green)"}}/>You are on the latest release.</>}
              {status==="update_available" && <><i className="fa-solid fa-circle-up" style={{marginRight:5,color:"var(--ac)"}}/>Version <strong style={{color:"var(--t1)"}}>v{info.latest}</strong> is available.</>}
              {status==="applying" && <><i className="fa-solid fa-spinner fa-spin" style={{marginRight:5}}/>Applying update…</>}
              {status==="done" && <><i className="fa-solid fa-circle-check" style={{marginRight:5,color:"var(--green)"}}/>Update applied successfully.</>}
              {status==="error" && <><i className="fa-solid fa-triangle-exclamation" style={{marginRight:5,color:"var(--amber)"}}/>{error}</>}
              {status==="idle" && "—"}
            </div>
          </div>
          {/* Actions */}
          <div style={{display:"flex",gap:8,flexShrink:0}}>
            {(status==="up_to_date"||status==="error")&&(
              <button style={btnStyle()} onClick={check}>
                <i className="fa-solid fa-rotate-right" style={{fontSize:11}}/>
                Re-check
              </button>
            )}
            {status==="update_available"&&!confirm&&(
              <>
                <button style={btnStyle()} onClick={check}>
                  <i className="fa-solid fa-rotate-right" style={{fontSize:11}}/>
                  Re-check
                </button>
                <button style={btnStyle("primary")} onClick={()=>setConfirm(true)}>
                  <i className="fa-solid fa-circle-up" style={{fontSize:11}}/>
                  Update to v{info.latest}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Confirm banner */}
        {confirm&&(
          <div style={{padding:"12px 14px",background:"rgba(167,139,250,0.06)",
            border:"0.5px solid rgba(167,139,250,0.2)",borderRadius:9,
            display:"flex",alignItems:"center",gap:12,marginTop:14}}>
            <i className="fa-solid fa-triangle-exclamation" style={{color:"var(--amber)",fontSize:14,flexShrink:0}}/>
            <div style={{flex:1,fontSize:12,color:"var(--t3)",lineHeight:1.5}}>
              This will rebuild the Docker container. The forum will be briefly unavailable.
              Your <strong style={{color:"var(--t2)"}}>database and uploads are safe</strong> — only app code is updated.
            </div>
            <div style={{display:"flex",gap:8,flexShrink:0}}>
              <button style={btnStyle()} onClick={()=>setConfirm(false)}>Cancel</button>
              <button style={btnStyle("primary")} onClick={apply}>
                <i className="fa-solid fa-bolt" style={{fontSize:11}}/>
                Confirm update
              </button>
            </div>
          </div>
        )}

        {/* Release notes */}
        {info?.release?.body&&status!=="applying"&&status!=="done"&&(
          <div style={{marginTop:16,paddingTop:16,borderTop:"0.5px solid var(--b1)"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <div style={{fontSize:12,fontWeight:500,color:"var(--t2)"}}>
                {info.release.name||info.release.tag}
              </div>
              {info.release.published_at&&(
                <div style={{fontSize:11,color:"var(--t5)"}}>{new Date(info.release.published_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
              )}
              {info.release.html_url&&(
                <a href={info.release.html_url} target="_blank" rel="noopener"
                  style={{marginLeft:"auto",fontSize:11,color:"var(--t5)",
                    textDecoration:"none",display:"flex",alignItems:"center",gap:4}}>
                  <i className="fa-brands fa-github" style={{fontSize:12}}/>
                  View on GitHub
                </a>
              )}
            </div>
            <div style={{fontSize:12,color:"var(--t4)",lineHeight:1.6,
              maxHeight:160,overflowY:"auto",
              background:"rgba(255,255,255,0.02)",borderRadius:8,padding:"10px 12px"}}>
              <Md text={info.release.body}/>
            </div>
          </div>
        )}
      </div>

      {/* Update log */}
      {log.length>0&&(
        <div style={{padding:"14px 16px",background:"var(--s3)",border:"0.5px solid var(--b1)",
          borderRadius:12,fontFamily:"monospace",fontSize:12,lineHeight:1.8}}>
          <div style={{fontSize:11,fontWeight:500,color:"var(--t4)",marginBottom:8,fontFamily:"inherit"}}>
            Update log
          </div>
          {log.map((line,i)=>(
            <div key={i} style={{
              color: line.startsWith("✓") ? "var(--green)"
                   : line.startsWith("✗") ? "var(--red)"
                   : "var(--t3)"}}>
              {line}
            </div>
          ))}
          {status==="applying"&&(
            <div style={{color:"var(--t5)",marginTop:4}}>
              <i className="fa-solid fa-spinner fa-spin" style={{marginRight:6}}/>
              Working…
            </div>
          )}
        </div>
      )}
    </div>
  );


export { UpdatesPanel };
