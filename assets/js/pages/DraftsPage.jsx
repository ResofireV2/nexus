import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api";
import { ago, spaceColor } from "../lib/utils";
import { toast } from "../components/Toasts";

// ── DraftsPage ────────────────────────────────────────────────────────────────
// Full-screen drafts panel. Accessible via the Drafts button in the topbar.
// Shows all saved drafts; clicking one resumes it in the composer or reply box.

export function DraftsPage({ currentUser, navigate }) {
  const [drafts,   setDrafts]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    api.get("/drafts").then(d => {
      setDrafts(d.drafts || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const deleteDraft = async (id) => {
    setDeleting(id);
    const d = await api.delete(`/drafts/${id}`);
    if (d.ok) {
      setDrafts(p => p.filter(x => x.id !== id));
      toast("Draft deleted");
    }
    setDeleting(null);
  };

  const deleteAll = async () => {
    if (!window.confirm(`Delete all ${drafts.length} drafts? This cannot be undone.`)) return;
    const d = await api.delete("/drafts/all");
    if (d.ok) { setDrafts([]); toast("All drafts deleted"); }
  };

  const resumeDraft = (draft) => {
    if (draft.type === "reply" && draft.post_id) {
      navigate("post", { id: draft.post_id, resumeDraft: draft });
    } else {
      navigate("compose", { resumeDraft: draft });
    }
  };

  return (
    <div style={{flex:1, display:"flex", flexDirection:"column", overflow:"hidden"}}>
      {/* Header */}
      <div style={{padding:"20px 24px 0", borderBottom:"0.5px solid var(--b1)", flexShrink:0}}>
        <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16}}>
          <div>
            <div style={{fontSize:20, fontWeight:600, color:"var(--t1)"}}>Drafts</div>
            {!loading && drafts.length > 0 && (
              <div style={{fontSize:12, color:"var(--t5)", marginTop:2}}>
                {drafts.length} draft{drafts.length !== 1 ? "s" : ""} saved
              </div>
            )}
          </div>
          {drafts.length > 0 && (
            <button
              onClick={deleteAll}
              className="btn-ghost"
              style={{fontSize:12, color:"var(--red)", borderColor:"rgba(248,113,113,0.2)", padding:"6px 14px"}}>
              Delete all
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div style={{flex:1, overflowY:"auto", padding:"16px 24px"}}>
        {loading ? (
          <div style={{textAlign:"center", color:"var(--t5)", padding:"48px 0", fontSize:13}}>
            Loading…
          </div>
        ) : drafts.length === 0 ? (
          <div style={{textAlign:"center", padding:"64px 0"}}>
            <i className="fa-solid fa-pen-to-square" style={{fontSize:32, color:"var(--t5)", marginBottom:16, display:"block"}}/>
            <div style={{fontSize:15, fontWeight:500, color:"var(--t3)", marginBottom:6}}>No drafts yet</div>
            <div style={{fontSize:13, color:"var(--t5)"}}>
              Start writing a post or reply — your work saves automatically.
            </div>
          </div>
        ) : (
          <div style={{display:"flex", flexDirection:"column", gap:8}}>
            {drafts.map(d => <DraftCard key={d.id} draft={d} onResume={resumeDraft} onDelete={deleteDraft} deleting={deleting===d.id}/>)}
          </div>
        )}
      </div>
    </div>
  );
}

function DraftCard({ draft, onResume, onDelete, deleting }) {
  const isReply = draft.type === "reply";
  const col = draft.space?.color || spaceColor({});
  const preview = (draft.body || "").replace(/[#*`_~>\[\]!]/g, "").trim().slice(0, 120);

  return (
    <div style={{
      background:"var(--s2)", border:"0.5px solid var(--b1)", borderRadius:12,
      padding:"14px 16px", display:"flex", gap:12, alignItems:"flex-start",
    }}>
      {/* Type icon */}
      <div style={{
        width:36, height:36, borderRadius:8, flexShrink:0, display:"flex",
        alignItems:"center", justifyContent:"center", fontSize:14,
        background: isReply ? "rgba(96,165,250,0.12)" : "var(--ac-bg)",
        color: isReply ? "var(--blue)" : "var(--ac)",
      }}>
        <i className={`fa-solid ${isReply ? "fa-reply" : "fa-pen-to-square"}`}/>
      </div>

      {/* Content */}
      <div style={{flex:1, minWidth:0}}>
        {/* Title / context */}
        <div style={{display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:4}}>
          {isReply ? (
            <span style={{fontSize:13, fontWeight:500, color:"var(--t2)"}}>
              Reply draft
              {draft.post?.title && (
                <span style={{color:"var(--t4)", fontWeight:400}}> · {draft.post.title}</span>
              )}
            </span>
          ) : (
            <span style={{fontSize:13, fontWeight:500, color:"var(--t1)"}}>
              {draft.title || <span style={{color:"var(--t4)", fontStyle:"italic"}}>Untitled post</span>}
            </span>
          )}
          {draft.space && (
            <span style={{
              fontSize:11, padding:"2px 7px", borderRadius:6,
              background:`${col}18`, color:col, border:`0.5px solid ${col}33`,
              flexShrink:0,
            }}>
              {draft.space.name}
            </span>
          )}
          {!isReply && draft.post_type && draft.post_type !== "discussion" && (
            <span style={{
              fontSize:11, padding:"2px 7px", borderRadius:6,
              background:"var(--s3)", color:"var(--t4)", border:"0.5px solid var(--b1)",
              flexShrink:0,
            }}>
              {draft.post_type}
            </span>
          )}
        </div>

        {/* Body preview */}
        {preview && (
          <div style={{
            fontSize:12, color:"var(--t4)", lineHeight:1.5, marginBottom:8,
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
          }}>
            {preview}
          </div>
        )}

        {/* Meta */}
        <div style={{fontSize:11, color:"var(--t5)"}}>
          Last saved {ago(draft.updated_at)}
        </div>
      </div>

      {/* Actions */}
      <div style={{display:"flex", gap:6, flexShrink:0}}>
        <button
          className="btn-ghost"
          onClick={() => onResume(draft)}
          style={{fontSize:12, padding:"5px 12px"}}>
          Resume
        </button>
        <button
          className="icon-btn"
          onClick={() => onDelete(draft.id)}
          disabled={deleting}
          style={{color:"var(--t4)", fontSize:13, width:30, height:30}}>
          <i className="fa-solid fa-trash-can" style={{fontSize:12}}/>
        </button>
      </div>
    </div>
  );
}

// ── useDraftAutosave ──────────────────────────────────────────────────────────
// Hook for auto-saving drafts while composing.
// Call in ComposePage and PostPage reply composer.
//
// Usage:
//   const { draftId, saveDraft, clearDraft } = useDraftAutosave({ type: "post" });
//
// - saveDraft(attrs) — debounced, call on every change
// - clearDraft()    — call after successful publish to delete the draft

export function useDraftAutosave({ type, postId = null, enabled = true }) {
  const [draftId, setDraftId] = useState(null);
  const debounceRef = useRef(null);
  const draftIdRef  = useRef(null);

  useEffect(() => { draftIdRef.current = draftId; }, [draftId]);

  // Cleanup on unmount — do NOT delete the draft (user may have navigated away)
  useEffect(() => () => { clearTimeout(debounceRef.current); }, []);

  const saveDraft = useCallback((attrs) => {
    if (!enabled) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const payload = { type, post_id: postId, ...attrs };
      if (draftIdRef.current) {
        // Update existing draft
        await api.patch(`/drafts/${draftIdRef.current}`, payload).catch(() => {});
      } else {
        // Create new draft
        const d = await api.post("/drafts", payload).catch(() => null);
        if (d?.ok && d.draft?.id) {
          setDraftId(d.draft.id);
          draftIdRef.current = d.draft.id;
        }
      }
    }, 2000); // 2 second debounce
  }, [type, postId, enabled]);

  const clearDraft = useCallback(async () => {
    clearTimeout(debounceRef.current);
    if (draftIdRef.current) {
      await api.delete(`/drafts/${draftIdRef.current}`).catch(() => {});
      setDraftId(null);
      draftIdRef.current = null;
    }
  }, []);

  return { draftId, saveDraft, clearDraft };
}

export { DraftsPage as default };
