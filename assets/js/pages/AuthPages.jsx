import { useState, useEffect } from "react";
import { api } from "../lib/api";

// ── VerifyEmailPage ──────────────────────────────────────────────────────────
// Handles the /verify-email?token=... URL that verification emails point to.
//
// Extracted from admin/AdminPage.jsx so the main bundle can render the email
// verification and magic-login routes without pulling in the entire admin panel
// tree (which is lazy-loaded from admin.js). These are small, self-contained
// auth flows that only depend on the api client.
export function VerifyEmailPage({token, navigate, onVerified}) {
  const [status, setStatus] = useState("loading");

  useEffect(()=>{
    if (!token) { setStatus("error"); return; }
    api.request("GET", `/auth/verify-email?token=${encodeURIComponent(token)}`, null, false, true)
      .then(d => { if (d.ok) setStatus("ok"); else setStatus("error"); })
      .catch(() => setStatus("error"));
  }, [token]);

  return (
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:40}}>
      <div style={{maxWidth:400,width:"100%",textAlign:"center"}}>
        {status==="loading"&&<>
          <i className="fa-solid fa-spinner fa-spin" style={{fontSize:32,color:"var(--ac)",marginBottom:16,display:"block"}}/>
          <div style={{fontSize:15,color:"var(--t3)"}}>Verifying your email…</div>
        </>}
        {status==="ok"&&<>
          <i className="fa-solid fa-circle-check" style={{fontSize:40,color:"var(--green)",marginBottom:16,display:"block"}}/>
          <div style={{fontSize:18,fontWeight:600,color:"var(--t1)",marginBottom:8}}>Email verified!</div>
          <div style={{fontSize:13,color:"var(--t3)",marginBottom:24}}>Your email has been confirmed. You can now fully participate in the forum.</div>
          <button className="btn-primary" style={{padding:"10px 28px",borderRadius:20}} onClick={()=>{onVerified?.();navigate("feed");}}>Go to forum</button>
        </>}
        {status==="error"&&<>
          <i className="fa-solid fa-circle-xmark" style={{fontSize:40,color:"var(--red)",marginBottom:16,display:"block"}}/>
          <div style={{fontSize:18,fontWeight:600,color:"var(--t1)",marginBottom:8}}>Verification failed</div>
          <div style={{fontSize:13,color:"var(--t3)",marginBottom:24}}>This link may have expired or already been used. Try registering again or contact support.</div>
          <button className="btn-primary" style={{padding:"10px 28px",borderRadius:20}} onClick={()=>navigate("feed")}>Go to forum</button>
        </>}
      </div>
    </div>
  );
}


// ── MagicLoginPage ───────────────────────────────────────────────────────────
// Handles the /magic-login?token=... URL that magic link emails point to.
// Calls the verify endpoint, issues tokens, and logs the user in.
export function MagicLoginPage({token, onLogin, navigate}) {
  const [status, setStatus] = useState("loading");

  useEffect(()=>{
    if (!token) { setStatus("error"); return; }
    api.request("GET", `/auth/magic?token=${encodeURIComponent(token)}`, null, false, true)
      .then(d => {
        if (d.access_token) {
          onLogin(d);
        } else {
          setStatus("error");
        }
      })
      .catch(() => setStatus("error"));
  }, [token]);

  return (
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:40}}>
      <div style={{maxWidth:400,width:"100%",textAlign:"center"}}>
        {status==="loading"&&<>
          <i className="fa-solid fa-spinner fa-spin" style={{fontSize:32,color:"var(--ac)",marginBottom:16,display:"block"}}/>
          <div style={{fontSize:15,color:"var(--t3)"}}>Signing you in…</div>
        </>}
        {status==="error"&&<>
          <i className="fa-solid fa-circle-xmark" style={{fontSize:40,color:"var(--red)",marginBottom:16,display:"block"}}/>
          <div style={{fontSize:18,fontWeight:600,color:"var(--t1)",marginBottom:8}}>Link expired</div>
          <div style={{fontSize:13,color:"var(--t3)",marginBottom:24}}>This magic link has expired or already been used. Magic links are valid for 15 minutes.</div>
          <button className="btn-primary" style={{padding:"10px 28px",borderRadius:20}} onClick={()=>navigate("feed")}>Go to forum</button>
        </>}
      </div>
    </div>
  );
}
