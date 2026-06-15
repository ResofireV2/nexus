import { useState, useEffect, useRef } from "react";
import { api } from "../lib/api";
import { toast } from "../components/Toasts";
import { Toggle } from "../components/Select";
import { RichTextArea } from "../components/RichTextArea";

// ── AdminPagesPanel ───────────────────────────────────────────────────────────
// Admin CRUD editor for static pages and the Page Widgets that surface them
// in the right sidebar.
//
// Layout:
//   PAGES section  — list of all pages with edit/delete, "+ New page" button
//   WIDGETS section — list of all page widgets with rename/delete, "+ New widget" button
//
// Page editor:
//   Title, slug (auto-generated), body (RichTextArea), Published toggle,
//   Widget selector (which sidebar widget this page appears in).

const BLANK_PAGE = { slug: "", title: "", body: "", published: false, widget_id: null };

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100);
}

export function AdminPagesPanel() {
  const [pages,   setPages]   = useState(null);
  const [widgets, setWidgets] = useState(null);

  // Page editor state
  const [editing,  setEditing]  = useState(null); // null=list, "new"=new, {page}=edit
  const [form,     setForm]     = useState(BLANK_PAGE);
  const [saving,   setSaving]   = useState(false);
  const slugManual = useRef(false);

  // Widget modal state
  const [widgetModal,  setWidgetModal]  = useState(null); // null | "new" | {widget} for rename
  const [widgetName,   setWidgetName]   = useState("");
  const [widgetSaving, setWidgetSaving] = useState(false);

  // Delete widget confirmation state
  const [deleteWidgetTarget,  setDeleteWidgetTarget]  = useState(null); // {widget, assignedPages}
  const [deleteWidgetLoading, setDeleteWidgetLoading] = useState(false);

  // Page delete state
  const [deletingPage, setDeletingPage] = useState(null);

  useEffect(() => {
    fetchPages();
    fetchWidgets();
  }, []);

  const fetchPages = () =>
    api.get("/admin/pages").then(d => setPages(d.pages || [])).catch(() => setPages([]));

  const fetchWidgets = () =>
    api.get("/admin/page-widgets").then(d => setWidgets(d.widgets || [])).catch(() => setWidgets([]));

  // ── Page editor ─────────────────────────────────────────────────────────────

  const openNewPage = () => {
    slugManual.current = false;
    setForm(BLANK_PAGE);
    setEditing("new");
  };

  const openEditPage = (page) => {
    slugManual.current = true;
    setForm({
      slug:      page.slug,
      title:     page.title,
      body:      page.body || "",
      published: !!page.published,
      widget_id: page.widget_id || null,
    });
    setEditing(page);
  };

  const onTitleChange = (val) => {
    setForm(f => {
      const next = { ...f, title: val };
      if (!slugManual.current) next.slug = slugify(val);
      return next;
    });
  };

  const savePage = async () => {
    if (!form.title.trim()) { toast("Title is required"); return; }
    if (!form.slug.trim())  { toast("Slug is required");  return; }

    setSaving(true);
    try {
      const payload = { page: form };
      const d = editing === "new"
        ? await api.post("/admin/pages", payload)
        : await api.patch(`/admin/pages/${editing.id}`, payload);

      if (d.page) {
        toast(editing === "new" ? "Page created" : "Page saved");
        fetchPages();
        setEditing(null);
      } else {
        const errs = d.errors
          ? Object.entries(d.errors).map(([k, v]) => `${k}: ${v}`).join(", ")
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
    setDeletingPage(page.id);
    try {
      await api.delete(`/admin/pages/${page.id}`);
      toast("Page deleted");
      fetchPages();
    } catch {
      toast("Delete failed");
    } finally {
      setDeletingPage(null);
    }
  };

  // ── Widget management ────────────────────────────────────────────────────────

  const openNewWidget = () => {
    setWidgetName("");
    setWidgetModal("new");
  };

  const openRenameWidget = (widget) => {
    setWidgetName(widget.name);
    setWidgetModal(widget);
  };

  const saveWidget = async () => {
    const name = widgetName.trim();
    if (!name) { toast("Widget name is required"); return; }
    setWidgetSaving(true);
    try {
      const d = widgetModal === "new"
        ? await api.post("/admin/page-widgets", { widget: { name } })
        : await api.patch(`/admin/page-widgets/${widgetModal.id}`, { widget: { name } });

      if (d.widget) {
        toast(widgetModal === "new" ? "Widget created" : "Widget renamed");
        fetchWidgets();
        setWidgetModal(null);
      } else {
        const errs = d.errors
          ? Object.entries(d.errors).map(([k, v]) => `${k}: ${v}`).join(", ")
          : "Save failed";
        toast(errs);
      }
    } catch {
      toast("Save failed — please try again");
    } finally {
      setWidgetSaving(false);
    }
  };

  // Initiate widget delete: fetch assigned pages first to decide modal type
  const initiateDeleteWidget = async (widget) => {
    setDeleteWidgetLoading(true);
    try {
      const d = await api.get(`/admin/page-widgets/${widget.id}/pages`);
      const assignedPages = d.pages || [];
      setDeleteWidgetTarget({ widget, assignedPages });
    } catch {
      toast("Could not load widget details");
    } finally {
      setDeleteWidgetLoading(false);
    }
  };

  const confirmDeleteWidget = async (onPages) => {
    if (!deleteWidgetTarget) return;
    const { widget } = deleteWidgetTarget;
    try {
      await api.delete(`/admin/page-widgets/${widget.id}`, { on_pages: onPages });
      toast("Widget deleted");
      fetchWidgets();
      fetchPages(); // page widget_ids may have changed
      setDeleteWidgetTarget(null);
    } catch {
      toast("Delete failed");
    }
  };

  // ── Widget name for display ──────────────────────────────────────────────────
  const widgetName_ = (id) => {
    if (!id || !widgets) return null;
    const w = widgets.find(w => w.id === id);
    return w ? w.name : null;
  };

  // ── Editor view ──────────────────────────────────────────────────────────────
  if (editing !== null) {
    return (
      <div>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <button className="btn-ghost" style={{ fontSize: 12, padding: "6px 14px" }}
            onClick={() => setEditing(null)}>
            <i className="fa-solid fa-arrow-left" style={{ marginRight: 6 }} />
            Back to pages
          </button>
          <div style={{ flex: 1, fontSize: 15, fontWeight: 600, color: "var(--t1)" }}>
            {editing === "new" ? "New page" : `Editing: ${editing.title}`}
          </div>

          {/* Widget selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--t4)", whiteSpace: "nowrap" }}>Widget</span>
            <select
              className="fi"
              style={{ fontSize: 12, padding: "5px 10px", minWidth: 140 }}
              value={form.widget_id || ""}
              onChange={e => setForm(f => ({ ...f, widget_id: e.target.value || null }))}
            >
              <option value="">None</option>
              {(widgets || []).map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>

          <Toggle
            label="Published"
            value={!!form.published}
            onChange={v => setForm(f => ({ ...f, published: v }))}
          />
          <button className="btn-primary" style={{ fontSize: 13, padding: "8px 20px" }}
            disabled={saving} onClick={savePage}>
            {saving ? "Saving…" : "Save page"}
          </button>
        </div>

        {/* Title */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--t5)", marginBottom: 6 }}>Title</div>
          <input
            className="fi"
            style={{ width: "100%", fontSize: 18, fontWeight: 600, padding: "10px 14px" }}
            placeholder="Page title…"
            value={form.title}
            onChange={e => onTitleChange(e.target.value)}
          />
        </div>

        {/* Slug */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--t5)", marginBottom: 6 }}>
            Slug <span style={{ color: "var(--t5)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— public URL: /p/<strong>{form.slug || "…"}</strong></span>
          </div>
          <input
            className="fi"
            style={{ width: "100%", fontFamily: "monospace", fontSize: 13 }}
            placeholder="page-slug"
            value={form.slug}
            onChange={e => {
              slugManual.current = true;
              setForm(f => ({ ...f, slug: slugify(e.target.value) }));
            }}
          />
          <div style={{ fontSize: 11, color: "var(--t5)", marginTop: 4 }}>
            Only lowercase letters, numbers, and hyphens. Auto-generated from title.
          </div>
        </div>

        {/* Body */}
        <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--t5)", marginBottom: 6 }}>Content</div>
        <div style={{ border: "0.5px solid var(--b2)", borderRadius: 12, overflow: "hidden" }}>
          <RichTextArea
            value={form.body}
            onChange={v => setForm(f => ({ ...f, body: v }))}
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

      {/* ── Pages section ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <div className="fgt" style={{ margin: 0 }}>Pages</div>
          <div style={{ fontSize: 13, color: "var(--t4)", marginTop: 2 }}>
            Static pages served at <code style={{ fontSize: 12 }}>/p/:slug</code>. Assign each page to a widget to surface it in the right sidebar.
          </div>
        </div>
        <button className="btn-primary" style={{ fontSize: 13, padding: "8px 18px", flexShrink: 0 }}
          onClick={openNewPage}>
          <i className="fa-solid fa-plus" style={{ marginRight: 6 }} />
          New page
        </button>
      </div>

      {pages === null && (
        <div style={{ padding: "32px 0", textAlign: "center", color: "var(--t5)", fontSize: 13 }}>Loading…</div>
      )}

      {pages !== null && pages.length === 0 && (
        <div style={{ padding: "40px 24px", textAlign: "center", background: "var(--s2)", border: "0.5px solid var(--b1)", borderRadius: 12, marginBottom: 40 }}>
          <i className="fa-solid fa-file-lines" style={{ fontSize: 28, color: "var(--t5)", marginBottom: 12, display: "block" }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--t2)", marginBottom: 6 }}>No pages yet</div>
          <div style={{ fontSize: 13, color: "var(--t4)", marginBottom: 16 }}>Create your first page — a privacy policy is a good place to start.</div>
          <button className="btn-primary" style={{ fontSize: 13 }} onClick={openNewPage}>Create a page</button>
        </div>
      )}

      {pages !== null && pages.length > 0 && (
        <div style={{ background: "var(--s2)", border: "0.5px solid var(--b1)", borderRadius: 12, overflow: "hidden", marginBottom: 40 }}>
          {pages.map((page, i) => (
            <div key={page.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", borderBottom: i < pages.length - 1 ? "0.5px solid var(--b1)" : "none" }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: "var(--s3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <i className="fa-solid fa-file-lines" style={{ fontSize: 15, color: "var(--t4)" }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--t1)", marginBottom: 2, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {page.title}
                  <span style={{
                    fontSize: 10, fontWeight: 500, padding: "1px 7px", borderRadius: 20,
                    background: page.published ? "rgba(52,211,153,0.1)" : "rgba(255,255,255,0.05)",
                    color:      page.published ? "var(--green)"          : "var(--t5)",
                    border:     `0.5px solid ${page.published ? "rgba(52,211,153,0.25)" : "rgba(255,255,255,0.08)"}`
                  }}>
                    {page.published ? "Published" : "Draft"}
                  </span>
                  {page.widget_id && widgetName_(page.widget_id) && (
                    <span style={{ fontSize: 10, fontWeight: 500, padding: "1px 7px", borderRadius: 20, background: "var(--ac-bg)", color: "var(--ac)", border: "0.5px solid var(--ac-border)", display: "flex", alignItems: "center", gap: 4 }}>
                      <i className="fa-solid fa-layer-group" style={{ fontSize: 9 }} />
                      {widgetName_(page.widget_id)}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--t5)", fontFamily: "monospace" }}>/p/{page.slug}</div>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button className="btn-ghost" style={{ fontSize: 12, padding: "5px 12px" }}
                  onClick={() => openEditPage(page)}>
                  Edit
                </button>
                <button className="btn-ghost" style={{ fontSize: 12, padding: "5px 12px", color: "var(--red)", borderColor: "rgba(248,113,113,0.3)" }}
                  disabled={deletingPage === page.id}
                  onClick={() => deletePage(page)}>
                  {deletingPage === page.id ? "…" : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Widgets section ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <div className="fgt" style={{ margin: 0 }}>Page Widgets</div>
          <div style={{ fontSize: 13, color: "var(--t4)", marginTop: 2 }}>
            Named right sidebar widgets that group and display pages. Widgets can be positioned in the Layout panel.
          </div>
        </div>
        <button className="btn-primary" style={{ fontSize: 13, padding: "8px 18px", flexShrink: 0 }}
          onClick={openNewWidget}>
          <i className="fa-solid fa-plus" style={{ marginRight: 6 }} />
          New widget
        </button>
      </div>

      {widgets === null && (
        <div style={{ padding: "32px 0", textAlign: "center", color: "var(--t5)", fontSize: 13 }}>Loading…</div>
      )}

      {widgets !== null && widgets.length === 0 && (
        <div style={{ padding: "40px 24px", textAlign: "center", background: "var(--s2)", border: "0.5px solid var(--b1)", borderRadius: 12 }}>
          <i className="fa-solid fa-layer-group" style={{ fontSize: 28, color: "var(--t5)", marginBottom: 12, display: "block" }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--t2)", marginBottom: 6 }}>No widgets yet</div>
          <div style={{ fontSize: 13, color: "var(--t4)", marginBottom: 16 }}>Create a widget to start grouping pages in the right sidebar.</div>
          <button className="btn-primary" style={{ fontSize: 13 }} onClick={openNewWidget}>Create a widget</button>
        </div>
      )}

      {widgets !== null && widgets.length > 0 && (
        <div style={{ background: "var(--s2)", border: "0.5px solid var(--b1)", borderRadius: 12, overflow: "hidden" }}>
          {widgets.map((widget, i) => {
            const assignedCount = (pages || []).filter(p => p.widget_id === widget.id).length;
            return (
              <div key={widget.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", borderBottom: i < widgets.length - 1 ? "0.5px solid var(--b1)" : "none" }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: "var(--s3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <i className="fa-solid fa-layer-group" style={{ fontSize: 15, color: "var(--ac)" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--t1)", marginBottom: 2 }}>{widget.name}</div>
                  <div style={{ fontSize: 11, color: "var(--t5)" }}>
                    {assignedCount === 0 ? "No pages assigned" : `${assignedCount} page${assignedCount === 1 ? "" : "s"} assigned`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button className="btn-ghost" style={{ fontSize: 12, padding: "5px 12px" }}
                    onClick={() => openRenameWidget(widget)}>
                    Rename
                  </button>
                  <button className="btn-ghost"
                    style={{ fontSize: 12, padding: "5px 12px", color: "var(--red)", borderColor: "rgba(248,113,113,0.3)" }}
                    disabled={deleteWidgetLoading}
                    onClick={() => initiateDeleteWidget(widget)}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Widget name modal (new / rename) ── */}
      {widgetModal !== null && (
        <WidgetNameModal
          title={widgetModal === "new" ? "New widget" : "Rename widget"}
          value={widgetName}
          onChange={setWidgetName}
          saving={widgetSaving}
          onSave={saveWidget}
          onClose={() => setWidgetModal(null)}
        />
      )}

      {/* ── Widget delete confirmation modal ── */}
      {deleteWidgetTarget !== null && (
        <WidgetDeleteModal
          widget={deleteWidgetTarget.widget}
          assignedPages={deleteWidgetTarget.assignedPages}
          onConfirm={confirmDeleteWidget}
          onClose={() => setDeleteWidgetTarget(null)}
        />
      )}
    </div>
  );
}

// ── WidgetNameModal ───────────────────────────────────────────────────────────
function WidgetNameModal({ title, value, onChange, saving, onSave, onClose }) {
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const onKeyDown = (e) => {
    if (e.key === "Enter") onSave();
    if (e.key === "Escape") onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--s1)", border: "0.5px solid var(--b2)", borderRadius: 16, padding: 28, width: "100%", maxWidth: 420 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--t1)", marginBottom: 20 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--t4)", marginBottom: 6 }}>Widget name</div>
        <input
          ref={inputRef}
          className="fi"
          style={{ width: "100%", marginBottom: 20 }}
          placeholder="e.g. Legal & Info, Resources, About"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn-ghost" style={{ fontSize: 13 }} onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ fontSize: 13 }} disabled={saving} onClick={onSave}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── WidgetDeleteModal ─────────────────────────────────────────────────────────
function WidgetDeleteModal({ widget, assignedPages, onConfirm, onClose }) {
  const hasPages = assignedPages.length > 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--s1)", border: "0.5px solid var(--b2)", borderRadius: 16, padding: 28, width: "100%", maxWidth: 460 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--t1)", marginBottom: 8 }}>
          Delete "{widget.name}"?
        </div>

        {!hasPages && (
          <div style={{ fontSize: 13, color: "var(--t4)", marginBottom: 24 }}>
            This widget has no pages assigned. It will be permanently deleted.
          </div>
        )}

        {hasPages && (
          <>
            <div style={{ fontSize: 13, color: "var(--t4)", marginBottom: 12 }}>
              This widget has {assignedPages.length} page{assignedPages.length === 1 ? "" : "s"} assigned. What would you like to do with them?
            </div>
            <div style={{ background: "var(--s2)", border: "0.5px solid var(--b1)", borderRadius: 10, marginBottom: 20, overflow: "hidden" }}>
              {assignedPages.map((page, i) => (
                <div key={page.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: i < assignedPages.length - 1 ? "0.5px solid var(--b1)" : "none" }}>
                  <i className="fa-solid fa-file-lines" style={{ fontSize: 12, color: "var(--t5)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 500 }}>{page.title}</div>
                    <div style={{ fontSize: 11, color: "var(--t5)", fontFamily: "monospace" }}>/p/{page.slug}</div>
                  </div>
                  <span style={{
                    fontSize: 10, padding: "1px 7px", borderRadius: 20,
                    background: page.published ? "rgba(52,211,153,0.1)" : "rgba(255,255,255,0.05)",
                    color:      page.published ? "var(--green)"          : "var(--t5)",
                    border:     `0.5px solid ${page.published ? "rgba(52,211,153,0.25)" : "rgba(255,255,255,0.08)"}`
                  }}>
                    {page.published ? "Published" : "Draft"}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button className="btn-ghost" style={{ fontSize: 13 }} onClick={onClose}>Cancel</button>
          {hasPages && (
            <>
              <button className="btn-ghost" style={{ fontSize: 13 }}
                onClick={() => onConfirm("unassign")}>
                Unassign pages &amp; delete widget
              </button>
              <button className="btn-ghost" style={{ fontSize: 13, color: "var(--red)", borderColor: "rgba(248,113,113,0.3)" }}
                onClick={() => onConfirm("delete")}>
                Delete pages &amp; widget
              </button>
            </>
          )}
          {!hasPages && (
            <button className="btn-ghost" style={{ fontSize: 13, color: "var(--red)", borderColor: "rgba(248,113,113,0.3)" }}
              onClick={() => onConfirm("unassign")}>
              Delete widget
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
