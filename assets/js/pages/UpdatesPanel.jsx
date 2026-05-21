import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { toast } from "../components/Toasts";
import { Md } from "../components/Markdown";

// ── UpdatesPanel ──────────────────────────────────────────────────────────────
//
// Check-only updater UI. Applying an update is the job of the host-side
// `nexus-update` command (installed by install.sh). When an update is
// available, we surface it here with a copy-to-clipboard field so the
// admin can paste it into an SSH session.
//
// Background: a previous version of this panel called a POST endpoint
// that tried to download/extract/rebuild from inside the container.
// That can't work — the container doesn't have tar/rsync/docker and
// can't restart the host's compose stack. The check half is safe inside
// the container (just an HTTP call to the GitHub API), so it stays.

// The exact command shown for updating production. Kept as a constant so
// it can't drift between the displayed text and the clipboard payload.
const UPDATE_COMMAND = "sudo nexus-update";

function UpdatesPanel() {
  const [status, setStatus] = useState("idle"); // idle | checking | up_to_date | update_available | error
  const [info,   setInfo]   = useState(null);   // { current, latest, up_to_date, release }
  const [error,  setError]  = useState(null);

  // Auto-check on mount so the admin sees status without clicking.
  useEffect(()=>{ check(); },[]);

  const check = async () => {
    setStatus("checking"); setError(null); setInfo(null);
    const d = await api.get("/admin/updates/check");
    if(d.ok) {
      setInfo(d.update);
      setStatus(d.update.up_to_date ? "up_to_date" : "update_available");
    } else {
      setError(d.error||"Could not check for updates");
      setStatus("error");
    }
  };

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(UPDATE_COMMAND);
      toast("Copied to clipboard");
    } catch {
      // navigator.clipboard can fail on insecure origins or older browsers.
      // Fall back to a select-and-copy hint rather than crashing.
      toast("Could not copy — select the command manually", "err");
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
        Updates are released as tags on GitHub. To apply an update, SSH into
        the server hosting Nexus and run the command shown below.
        Your <code style={{fontSize:11}}>.env</code>, database, and uploads
        are never touched.
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
              {status==="error" && <><i className="fa-solid fa-triangle-exclamation" style={{marginRight:5,color:"var(--amber)"}}/>{error}</>}
              {status==="idle" && "—"}
            </div>
          </div>
          {/* Re-check button — always available when not actively checking */}
          {status!=="checking"&&(
            <div style={{display:"flex",gap:8,flexShrink:0}}>
              <button style={btnStyle()} onClick={check}>
                <i className="fa-solid fa-rotate-right" style={{fontSize:11}}/>
                Re-check
              </button>
            </div>
          )}
        </div>

        {/* Update instructions — only shown when an update is available.
            Click-to-copy field with the exact CLI command. */}
        {status==="update_available"&&(
          <div style={{marginTop:14,paddingTop:14,borderTop:"0.5px solid var(--b1)"}}>
            <div style={{fontSize:12,color:"var(--t3)",marginBottom:8,lineHeight:1.6}}>
              SSH into the server and run:
            </div>
            <button
              onClick={copyCommand}
              style={{
                width:"100%", display:"flex", alignItems:"center", gap:10,
                padding:"10px 14px",
                background:"rgba(0,0,0,0.25)",
                border:"0.5px solid var(--b1)",
                borderRadius:8,
                cursor:"pointer",
                fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize:13, color:"var(--t1)",
                textAlign:"left",
              }}
              title="Click to copy"
            >
              <i className="fa-solid fa-terminal" style={{fontSize:12,color:"var(--t5)",flexShrink:0}}/>
              <span style={{flex:1}}>{UPDATE_COMMAND}</span>
              <i className="fa-regular fa-copy" style={{fontSize:12,color:"var(--t5)",flexShrink:0}}/>
            </button>
            <div style={{fontSize:11,color:"var(--t5)",marginTop:8,lineHeight:1.5}}>
              The forum will be briefly unavailable during the rebuild
              (typically a few minutes). Your database and uploads are safe —
              only application code is updated.
            </div>
          </div>
        )}

        {/* Release notes */}
        {info?.release?.body&&(
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
    </div>
  );
}

export { UpdatesPanel };
