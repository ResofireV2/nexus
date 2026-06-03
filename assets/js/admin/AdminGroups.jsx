import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { toast } from "../components/Toasts";
import { Toggle } from "../components/Select";
import { ColorPicker } from "./FormHelpers";
import { RsAv } from "../components/Avatar";
import { ago } from "../lib/utils";

// ── Icon options for group badge ──────────────────────────────────────────────
const BADGE_ICONS = [
  "fa-heart", "fa-star", "fa-crown", "fa-bolt", "fa-shield",
  "fa-gem", "fa-fire", "fa-award", "fa-trophy", "fa-certificate",
  "fa-medal", "fa-flag", "fa-rocket", "fa-handshake", "fa-leaf",
];

// ── Blank form state ──────────────────────────────────────────────────────────
const BLANK = {
  name: "", slug: "", description: "",
  public: false,
  badge_label: "", badge_color: "#4A90E2", badge_icon: "fa-star",
  show_on_profile: true, show_on_posts: false, show_on_popover: false,
};

// ── Auto-generate slug from name ──────────────────────────────────────────────
function toSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// ── Group badge preview pill ──────────────────────────────────────────────────
function BadgePreview({ label, color, icon }) {
  if (!label) return null;
  const bg     = color ? color + "1a" : "rgba(255,255,255,0.08)";
  const border = color ? color + "40" : "rgba(255,255,255,0.15)";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 11, fontWeight: 500, padding: "3px 9px", borderRadius: 20,
      background: bg, color: color || "var(--t3)",
      border: `0.5px solid ${border}`,
    }}>
      {icon && <i className={`fa-solid ${icon}`} style={{ fontSize: 9 }}/>}
      {label}
    </span>
  );
}

// ── Create / Edit modal ───────────────────────────────────────────────────────
function GroupModal({ group, onClose, onSaved }) {
  const isNew = !group;
  const [form, setForm] = useState(isNew ? { ...BLANK } : {
    name:            group.name,
    slug:            group.slug,
    description:     group.description || "",
    public:          group.public,
    badge_label:     group.badge_label  || "",
    badge_color:     group.badge_color  || "#4A90E2",
    badge_icon:      group.badge_icon   || "fa-star",
    show_on_profile: group.show_on_profile,
    show_on_posts:   group.show_on_posts,
    show_on_popover: group.show_on_popover,
  });
  const [slugEdited, setSlugEdited] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleName = (v) => {
    set("name", v);
    if (!slugEdited) set("slug", toSlug(v));
  };

  const handleSlug = (v) => {
    setSlugEdited(true);
    set("slug", v.toLowerCase().replace(/[^a-z0-9_]/g, ""));
  };

  const save = async () => {
    setSaving(true);
    const attrs = {
      name:        form.name.trim(),
      slug:        form.slug.trim(),
      description: form.description.trim() || null,
      public:      form.public,
      badge_label:    form.public ? (form.badge_label.trim() || null)  : null,
      badge_color:    form.public ? (form.badge_color  || null)        : null,
      badge_icon:     form.public ? (form.badge_icon   || null)        : null,
      show_on_profile: form.public ? form.show_on_profile : true,
      show_on_posts:   form.public ? form.show_on_posts   : false,
      show_on_popover: form.public ? form.show_on_popover : false,
    };
    const res = isNew
      ? await api.post("/admin/groups", attrs)
      : await api.patch(`/admin/groups/${group.id}`, attrs);
    setSaving(false);
    if (res.group) { onSaved(res.group); toast(isNew ? "Group created" : "Group updated"); }
    else toast(res.error || JSON.stringify(res.errors) || "Failed", "err");
  };

  const fi = {
    width: "100%", background: "var(--s1)", border: "0.5px solid var(--b2)",
    borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "var(--t2)",
    fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  };
  const fieldLabel = {
    fontSize: 11, fontWeight: 500, color: "var(--t5)",
    textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: 6, display: "block",
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex",
               alignItems: "center", justifyContent: "center", zIndex: 500, padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        width: "100%", maxWidth: 500, background: "var(--s2)",
        border: "0.5px solid var(--b2)", borderRadius: 16, padding: 28,
        maxHeight: "90vh", overflowY: "auto",
      }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--t1)", marginBottom: 20 }}>
          {isNew ? "New group" : `Edit — ${group.name}`}
        </div>

        {/* Name */}
        <div style={{ marginBottom: 14 }}>
          <label style={fieldLabel}>Name</label>
          <input style={fi} value={form.name} onChange={e => handleName(e.target.value)}
            placeholder="e.g. Donors, Super Members, Beta Testers"/>
        </div>

        {/* Slug */}
        <div style={{ marginBottom: 14 }}>
          <label style={fieldLabel}>
            Slug
            <span style={{ fontSize: 10, color: "var(--t5)", marginLeft: 6, textTransform: "none", letterSpacing: 0 }}>
              — used in permissions and extension APIs
            </span>
          </label>
          <input style={{ ...fi, fontFamily: "monospace", fontSize: 12 }}
            value={form.slug} onChange={e => handleSlug(e.target.value)}
            placeholder="auto-generated from name"/>
        </div>

        {/* Description */}
        <div style={{ marginBottom: 14 }}>
          <label style={fieldLabel}>
            Description
            <span style={{ fontSize: 10, color: "var(--t5)", marginLeft: 6, textTransform: "none", letterSpacing: 0 }}>
              optional
            </span>
          </label>
          <textarea style={{ ...fi, resize: "vertical", minHeight: 64 }}
            value={form.description} onChange={e => set("description", e.target.value)}
            placeholder="What is this group for?"/>
        </div>

        {/* Public toggle */}
        <div style={{ marginBottom: 14 }}>
          <Toggle
            label="Public group"
            hint="Show a badge on members' profiles, posts, and user cards"
            value={form.public}
            onChange={v => set("public", v)}
          />
        </div>

        {/* Public display settings */}
        {form.public && (
          <div style={{
            background: "var(--s3)", border: "0.5px solid var(--b1)",
            borderRadius: 12, padding: 16, marginBottom: 14,
          }}>
            <div style={{
              fontSize: 11, fontWeight: 600, color: "var(--t4)",
              textTransform: "uppercase", letterSpacing: ".5px",
              marginBottom: 14, display: "flex", alignItems: "center", gap: 6,
            }}>
              <i className="fa-solid fa-eye" style={{ fontSize: 10 }}/>
              Public display
            </div>

            {/* Badge label */}
            <div style={{ marginBottom: 12 }}>
              <label style={fieldLabel}>Badge label</label>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input style={{ ...fi, flex: 1 }}
                  value={form.badge_label} onChange={e => set("badge_label", e.target.value)}
                  placeholder="e.g. Donor, Supporter"/>
                {form.badge_label && (
                  <BadgePreview label={form.badge_label} color={form.badge_color} icon={form.badge_icon}/>
                )}
              </div>
            </div>

            {/* Badge color */}
            <div style={{ marginBottom: 12 }}>
              <label style={fieldLabel}>Badge color</label>
              <ColorPicker value={form.badge_color} onChange={v => set("badge_color", v)}/>
            </div>

            {/* Badge icon */}
            <div style={{ marginBottom: 12 }}>
              <label style={fieldLabel}>
                Badge icon
                <span style={{ fontSize: 10, color: "var(--t5)", marginLeft: 6, textTransform: "none", letterSpacing: 0 }}>
                  optional
                </span>
              </label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {BADGE_ICONS.map(icon => (
                  <button key={icon}
                    style={{
                      width: 32, height: 32, borderRadius: 7, cursor: "pointer",
                      background: form.badge_icon === icon ? "var(--ac-bg)" : "var(--s2)",
                      border: `0.5px solid ${form.badge_icon === icon ? "var(--ac-border)" : "var(--b1)"}`,
                      color: form.badge_icon === icon ? "var(--ac-text)" : "var(--t4)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                    onMouseDown={e => { e.preventDefault(); set("badge_icon", icon); }}>
                    <i className={`fa-solid ${icon}`} style={{ fontSize: 13 }}/>
                  </button>
                ))}
                <button
                  style={{
                    height: 32, padding: "0 10px", borderRadius: 7, cursor: "pointer",
                    background: form.badge_icon === null ? "var(--ac-bg)" : "var(--s2)",
                    border: `0.5px solid ${form.badge_icon === null ? "var(--ac-border)" : "var(--b1)"}`,
                    color: form.badge_icon === null ? "var(--ac-text)" : "var(--t5)",
                    fontSize: 11, fontFamily: "inherit",
                  }}
                  onMouseDown={e => { e.preventDefault(); set("badge_icon", null); }}>
                  none
                </button>
              </div>
            </div>

            {/* Show on */}
            <div>
              <label style={fieldLabel}>Show badge on</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { key: "show_on_profile", label: "Profile page" },
                  { key: "show_on_posts",   label: "Posts and replies" },
                  { key: "show_on_popover", label: "User card popover" },
                ].map(({ key, label }) => (
                  <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input type="checkbox" checked={form[key]}
                      onChange={e => set(key, e.target.checked)}
                      style={{ accentColor: "var(--ac)", width: 14, height: 14 }}/>
                    <span style={{ fontSize: 13, color: "var(--t3)" }}>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ fontSize: 13, padding: "7px 20px" }}
            onClick={save} disabled={saving || !form.name.trim() || !form.slug.trim()}>
            {saving ? "Saving…" : isNew ? "Create group" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Members modal ─────────────────────────────────────────────────────────────
function MembersModal({ group, onClose }) {
  const [members,  setMembers]  = useState(null);
  const [username, setUsername] = useState("");
  const [adding,   setAdding]   = useState(false);

  const load = () => {
    api.get(`/admin/groups/${group.id}/members`)
      .then(d => setMembers(d.members || []));
  };

  useEffect(() => { load(); }, [group.id]);

  const add = async () => {
    if (!username.trim()) return;
    setAdding(true);
    const res = await api.post(`/admin/groups/${group.id}/members`, { username: username.trim() });
    setAdding(false);
    if (res.ok) { setUsername(""); load(); toast(`${username.trim()} added`); }
    else toast(res.error || "Failed", "err");
  };

  const remove = async (member) => {
    if (!confirm(`Remove ${member.username} from ${group.name}?`)) return;
    const res = await api.delete(`/admin/groups/${group.id}/members/${member.user_id}`);
    if (res.ok) { load(); toast(`${member.username} removed`); }
    else toast(res.error || "Failed", "err");
  };

  const fi = {
    flex: 1, background: "var(--s1)", border: "0.5px solid var(--b2)",
    borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "var(--t2)",
    fontFamily: "inherit", outline: "none",
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex",
               alignItems: "center", justifyContent: "center", zIndex: 500, padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        width: "100%", maxWidth: 440, background: "var(--s2)",
        border: "0.5px solid var(--b2)", borderRadius: 16, padding: 24,
        maxHeight: "80vh", display: "flex", flexDirection: "column",
      }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--t1)", marginBottom: 2 }}>
          {group.name}
        </div>
        <div style={{ fontSize: 12, color: "var(--t5)", marginBottom: 16 }}>
          {members === null ? "Loading…" : `${members.length} member${members.length !== 1 ? "s" : ""}`}
        </div>

        {/* Add member */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input style={fi} value={username} onChange={e => setUsername(e.target.value)}
            placeholder="Username" onKeyDown={e => e.key === "Enter" && add()}/>
          <button className="btn-primary" style={{ fontSize: 12, padding: "7px 14px", flexShrink: 0 }}
            onClick={add} disabled={adding || !username.trim()}>
            {adding ? "Adding…" : "Add"}
          </button>
        </div>

        {/* Member list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {members === null ? (
            <div style={{ textAlign: "center", padding: "24px 0", color: "var(--t5)", fontSize: 13 }}>
              Loading…
            </div>
          ) : members.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 0", color: "var(--t5)", fontSize: 13 }}>
              No members yet. Add one above.
            </div>
          ) : members.map((m, i) => (
            <div key={m.user_id} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 0",
              borderBottom: i < members.length - 1 ? "0.5px solid var(--b1)" : "none",
            }}>
              <RsAv user={{ id: m.user_id, username: m.username, avatar_url: m.avatar_url, avatar_color: m.avatar_color }} size={32} noCard/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--t2)" }}>{m.username}</div>
                <div style={{ fontSize: 11, color: "var(--t5)" }}>Added {ago(m.added_at)}</div>
              </div>
              <button
                style={{
                  fontSize: 11, color: "var(--t4)", cursor: "pointer", padding: "4px 8px",
                  borderRadius: 6, background: "transparent", border: "none", fontFamily: "inherit",
                }}
                onMouseEnter={e => { e.currentTarget.style.color = "var(--red)"; e.currentTarget.style.background = "rgba(248,113,113,0.08)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "var(--t4)";  e.currentTarget.style.background = "transparent"; }}
                onClick={() => remove(m)}>
                Remove
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Main admin panel ──────────────────────────────────────────────────────────
export function AdminGroupsPanel() {
  const [groups,  setGroups]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);  // null | "new" | group object
  const [members, setMembers] = useState(null);  // null | group object
  const [deleting, setDeleting] = useState(null);

  const load = () => {
    api.get("/admin/groups").then(d => {
      setGroups(d.groups || []);
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, []);

  const handleSaved = (group) => {
    load();
    setEditing(null);
  };

  const del = async (g) => {
    if (!confirm(`Delete group "${g.name}"? All memberships will be removed.`)) return;
    setDeleting(g.id);
    await api.delete(`/admin/groups/${g.id}`);
    setDeleting(null);
    load();
    toast("Group deleted");
  };

  if (loading) return (
    <div style={{ padding: "40px 0", textAlign: "center", color: "var(--t5)" }}>Loading…</div>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: "var(--t1)", letterSpacing: -0.3 }}>Groups</div>
          <div style={{ fontSize: 12, color: "var(--t4)", marginTop: 2 }}>
            {groups.length} group{groups.length !== 1 ? "s" : ""} defined
          </div>
        </div>
        <button className="btn-primary" style={{ fontSize: 12, padding: "7px 16px", display: "flex", alignItems: "center", gap: 6 }}
          onClick={() => setEditing("new")}>
          <i className="fa-solid fa-plus" style={{ fontSize: 11 }}/>New group
        </button>
      </div>

      {/* Empty state */}
      {groups.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--t5)" }}>
          <i className="fa-solid fa-user-group" style={{ fontSize: 28, opacity: .3, marginBottom: 12, display: "block" }}/>
          No groups yet. Create one to get started.
        </div>
      )}

      {/* Group list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {groups.map(g => (
          <div key={g.id} style={{
            background: "var(--s1)", border: "0.5px solid var(--b1)",
            borderRadius: 12, overflow: "hidden",
          }}>
            {/* Color accent bar */}
            {g.public && g.badge_color && (
              <div style={{ height: 2, background: g.badge_color }}/>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
              {/* Icon */}
              <div style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: g.public && g.badge_color ? g.badge_color + "1a" : "rgba(255,255,255,0.05)",
                border: `0.5px solid ${g.public && g.badge_color ? g.badge_color + "30" : "var(--b1)"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <i className={`fa-solid ${g.badge_icon || "fa-user-group"}`}
                  style={{ fontSize: 15, color: g.public && g.badge_color ? g.badge_color : "var(--t4)" }}/>
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: "var(--t1)" }}>{g.name}</span>
                  <span style={{ fontSize: 10, color: "var(--t5)", fontFamily: "monospace" }}>{g.slug}</span>
                  {g.public ? (
                    <span style={{
                      fontSize: 10, fontWeight: 500, padding: "1px 7px", borderRadius: 20,
                      background: "rgba(74,222,128,0.10)", color: "var(--green)",
                      border: "0.5px solid rgba(74,222,128,0.25)",
                      display: "flex", alignItems: "center", gap: 4,
                    }}>
                      <i className="fa-solid fa-eye" style={{ fontSize: 8 }}/>public
                    </span>
                  ) : (
                    <span style={{
                      fontSize: 10, fontWeight: 500, padding: "1px 7px", borderRadius: 20,
                      background: "rgba(255,255,255,0.05)", color: "var(--t4)",
                      border: "0.5px solid var(--b2)",
                      display: "flex", alignItems: "center", gap: 4,
                    }}>
                      <i className="fa-solid fa-eye-slash" style={{ fontSize: 8 }}/>backend only
                    </span>
                  )}
                  {g.public && g.badge_label && (
                    <BadgePreview label={g.badge_label} color={g.badge_color} icon={g.badge_icon}/>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--t5)", display: "flex", alignItems: "center", gap: 10 }}>
                  <span><i className="fa-solid fa-user" style={{ fontSize: 9, marginRight: 4 }}/>{g.member_count} member{g.member_count !== 1 ? "s" : ""}</span>
                  {g.description && (
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 300 }}>
                      {g.description}
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button className="btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }}
                  onClick={() => setMembers(g)}>
                  members
                </button>
                <button className="btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }}
                  onClick={() => setEditing(g)}>
                  edit
                </button>
                <button className="btn-ghost"
                  style={{ fontSize: 11, padding: "4px 10px", color: "var(--red)", opacity: deleting === g.id ? 0.5 : 1 }}
                  onClick={() => del(g)} disabled={deleting === g.id}>
                  delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modals */}
      {editing && (
        <GroupModal
          group={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
      {members && (
        <MembersModal
          group={members}
          onClose={() => { setMembers(null); load(); }}
        />
      )}
    </div>
  );
}
