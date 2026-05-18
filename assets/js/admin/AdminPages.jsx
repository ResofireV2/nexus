import { useState, useEffect, useRef } from "react";
import { api } from "../lib/api";
import { toast } from "../components/Toasts";
import { Toggle } from "../components/Select";
import { RichTextArea } from "../components/RichTextArea";

// ── AdminPagesPanel ───────────────────────────────────────────────────────────
// Admin CRUD editor for static pages (privacy policy, guidelines, etc.).
// Pages are authored in Markdown and served publicly at /p/:slug.

const BLANK = {slug:"", title:"", body:"", published:false};

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100);
}

export function AdminPagesPanel() {
  const [pages,    setPages]    = useState(null);
  const [editing,  setEditing]  = useState(null);   // null = list, {page} = editor
  const [form,     setForm]     = useState(BLANK);
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(null);
  const slugManual = useRef(false);  // true once user has manually edited slug

  useEffect(() => {
    fetchPages();
  }, []);

  const fetchPages = () => {
    api.get("/admin/pages").then(d => setPages(d.pages || [])).catch(() => setPages([]));
  };

  const openNew = () => {
    slugManual.current = false;
    setForm(BLANK);
    setEditing("new");
  };

  const openEdit = (page) => {
    slugManual.current = true; // existing slug — don't auto-update
    setForm({
      slug:      page.slug,
      title:     page.title,
      body:      page.body || "",
      published: !!page.published,
    });
    setEditing(page);
  };

  const onTitleChange = (val) => {
    setForm(f => {
      const next = {...f, title: val};
      if (!slugManual.current) next.slug = slugify(val);
      return next;
    });
  };

  const save = async () => {
    if (!form.title.trim()) { toast("Title is required"); return; }
    if (!form.slug.trim())  { toast("Slug is required");  return; }

    setSaving(true);
    try {
      const payload = {page: form};
      const d = editing === "new"
        ? await api.post("/admin/pages", payload)
        : await api.patch(`/admin/pages/${editing.id}`, payload);

      if (d.page) {
        toast(editing === "new" ? "Page created" : "Page saved");
        fetchPages();
        setEditing(null);
      } else {
        const errs = d.errors
          ? Object.entries(d.errors).map(([k,v]) => `${k}: ${v}`).join(", ")
          : "Save failed";
        toast(errs);
      }
    } catch {
      toast("Save failed — please try again");
    } finally {
      setSaving(false);
    }
  };

  const deletePage = async (page) => {
    if (!confirm(`Delete "${page.title}"? This cannot be undone.`)) return;
    setDeleting(page.id);
    try {
      await api.delete(`/admin/pages/${page.id}`);
      toast("Page deleted");
      fetchPages();
    } catch {
      toast("Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  // ── Editor view ──────────────────────────────────────────────────────────────
  if (editing !== null) {
    return (
      <div>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24}}>
          <button className="btn-ghost" style={{fontSize:12,padding:"6px 14px"}}
            onClick={() => setEditing(null)}>
            <i className="fa-solid fa-arrow-left" style={{marginRight:6}}/>
            Back to pages
          </button>
          <div style={{flex:1,fontSize:15,fontWeight:600,color:"var(--t1)"}}>
            {editing === "new" ? "New page" : `Editing: ${editing.title}`}
          </div>
          <Toggle
            label="Published"
            value={!!form.published}
            onChange={v => setForm(f => ({...f, published: v}))}
          />
          <button className="btn-primary" style={{fontSize:13,padding:"8px 20px"}}
            disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save page"}
          </button>
        </div>

        {/* Title */}
        <div style={{marginBottom:16}}>
          <div style={{fontSize:11,fontWeight:500,letterSpacing:".07em",textTransform:"uppercase",color:"var(--t5)",marginBottom:6}}>Title</div>
          <input
            className="fi"
            style={{width:"100%",fontSize:18,fontWeight:600,padding:"10px 14px"}}
            placeholder="Page title…"
            value={form.title}
            onChange={e => onTitleChange(e.target.value)}
          />
        </div>

        {/* Slug */}
        <div style={{marginBottom:20}}>
          <div style={{fontSize:11,fontWeight:500,letterSpacing:".07em",textTransform:"uppercase",color:"var(--t5)",marginBottom:6}}>
            Slug <span style={{color:"var(--t5)",fontWeight:400,textTransform:"none",letterSpacing:0}}>— public URL: /p/<strong>{form.slug||"…"}</strong></span>
          </div>
          <input
            className="fi"
            style={{width:"100%",fontFamily:"monospace",fontSize:13}}
            placeholder="page-slug"
            value={form.slug}
            onChange={e => {
              slugManual.current = true;
              setForm(f => ({...f, slug: slugify(e.target.value)}));
            }}
          />
          <div style={{fontSize:11,color:"var(--t5)",marginTop:4}}>
            Only lowercase letters, numbers, and hyphens. Auto-generated from title.
          </div>
        </div>

        {/* Body */}
        <div style={{fontSize:11,fontWeight:500,letterSpacing:".07em",textTransform:"uppercase",color:"var(--t5)",marginBottom:6}}>Content</div>
        <div style={{border:"0.5px solid var(--b2)",borderRadius:12,overflow:"hidden"}}>
          <RichTextArea
            value={form.body}
            onChange={v => setForm(f => ({...f, body: v}))}
            placeholder="Write page content in Markdown…"
            minHeight={360}
            context="page"
          />
        </div>
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────────
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <div style={{flex:1}}>
          <div className="fgt" style={{margin:0}}>Pages</div>
          <div style={{fontSize:13,color:"var(--t4)",marginTop:2}}>
            Static pages served at <code style={{fontSize:12}}>/p/:slug</code>. Useful for privacy policy, community guidelines, and similar content.
          </div>
        </div>
        <button className="btn-primary" style={{fontSize:13,padding:"8px 18px",flexShrink:0}}
          onClick={openNew}>
          <i className="fa-solid fa-plus" style={{marginRight:6}}/>
          New page
        </button>
      </div>

      {pages === null && (
        <div style={{padding:"32px 0",textAlign:"center",color:"var(--t5)",fontSize:13}}>Loading…</div>
      )}

      {pages !== null && pages.length === 0 && (
        <div style={{padding:"40px 24px",textAlign:"center",background:"var(--s2)",border:"0.5px solid var(--b1)",borderRadius:12}}>
          <i className="fa-solid fa-file-lines" style={{fontSize:28,color:"var(--t5)",marginBottom:12,display:"block"}}/>
          <div style={{fontSize:14,fontWeight:500,color:"var(--t2)",marginBottom:6}}>No pages yet</div>
          <div style={{fontSize:13,color:"var(--t4)",marginBottom:16}}>Create your first page — a privacy policy is a good place to start.</div>
          <button className="btn-primary" style={{fontSize:13}} onClick={openNew}>Create a page</button>
        </div>
      )}

      {pages !== null && pages.length > 0 && (
        <div style={{background:"var(--s2)",border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden"}}>
          {pages.map((page, i) => (
            <div key={page.id} style={{display:"flex",alignItems:"center",gap:14,padding:"14px 18px",borderBottom:i<pages.length-1?"0.5px solid var(--b1)":"none"}}>
              <div style={{width:36,height:36,borderRadius:9,background:"var(--s3)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <i className="fa-solid fa-file-lines" style={{fontSize:15,color:"var(--t4)"}}/>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:500,color:"var(--t1)",marginBottom:2,display:"flex",alignItems:"center",gap:8}}>
                  {page.title}
                  <span style={{fontSize:10,fontWeight:500,padding:"1px 7px",borderRadius:20,
                    background: page.published ? "rgba(52,211,153,0.1)" : "rgba(255,255,255,0.05)",
                    color:      page.published ? "var(--green)"          : "var(--t5)",
                    border:     `0.5px solid ${page.published ? "rgba(52,211,153,0.25)" : "rgba(255,255,255,0.08)"}`}}>
                    {page.published ? "Published" : "Draft"}
                  </span>
                </div>
                <div style={{fontSize:11,color:"var(--t5)",fontFamily:"monospace"}}>/p/{page.slug}</div>
              </div>
              <div style={{display:"flex",gap:8,flexShrink:0}}>
                <button className="btn-ghost" style={{fontSize:12,padding:"5px 12px"}}
                  onClick={() => openEdit(page)}>
                  Edit
                </button>
                <button className="btn-ghost" style={{fontSize:12,padding:"5px 12px",color:"var(--red)",borderColor:"rgba(248,113,113,0.3)"}}
                  disabled={deleting === page.id}
                  onClick={() => deletePage(page)}>
                  {deleting === page.id ? "…" : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
