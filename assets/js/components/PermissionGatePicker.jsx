import { useState, useEffect, useRef } from "react";
import { api } from "../lib/api";

// ── PermissionGatePicker ──────────────────────────────────────────────────────
//
// A multi-select pill picker for permission gates. Replaces the plain <Select>
// on the permissions page for both core settings (who_can_upload) and extension
// permission keys.
//
// A gate value is either:
//   - A legacy plain string:  "member" | "moderator" | "admin" | "everyone"
//   - A structured object:    { role: "member", groups: ["donors", "supporters"] }
//
// This component always reads/writes the structured object format. On first
// render it normalises a legacy plain string into the structured format so
// existing saved values work without a data migration.
//
// Usage:
//   <PermissionGatePicker
//     value={gate}           // string or {role, groups} object
//     onChange={v => ...}    // called with {role, groups} object
//   />
//
// The picker shows:
//   - Four role pills (everyone / member / moderator / admin) — blue when selected
//   - Any loaded custom groups as amber pills — togglable independently
//   - Exactly one role is always selected (radio behaviour)
//   - Zero or more groups may be selected alongside any role

// Normalise any saved value into {role, groups}.
export function normaliseGate(raw) {
  if (!raw) return { role: "member", groups: [] };
  if (typeof raw === "string") return { role: raw, groups: [] };
  return {
    role:   raw.role   || "member",
    groups: Array.isArray(raw.groups) ? raw.groups : [],
  };
}

// Serialise back for saving. If no groups are selected we still use the
// structured format so the backend always gets a consistent type.
// (The backend handles both formats, but structured is preferred going forward.)
export function serialiseGate(gate) {
  return { role: gate.role, groups: gate.groups };
}

const ROLES = [
  { value: "everyone",  label: "Everyone" },
  { value: "member",    label: "Members" },
  { value: "moderator", label: "Moderators" },
  { value: "admin",     label: "Admins only" },
];

export function PermissionGatePicker({ value, onChange }) {
  const gate = normaliseGate(value);

  // Groups are loaded once and cached on the module so we don't re-fetch
  // for every permission row on the page.
  const [groups, setGroups] = useState(window._cachedPermGroups || null);

  useEffect(() => {
    if (window._cachedPermGroups) { setGroups(window._cachedPermGroups); return; }
    api.get("/admin/groups").then(d => {
      const g = d.groups || [];
      window._cachedPermGroups = g;
      setGroups(g);
    }).catch(() => setGroups([]));
  }, []);

  const setRole = (role) => onChange({ role, groups: gate.groups });

  const toggleGroup = (slug) => {
    const next = gate.groups.includes(slug)
      ? gate.groups.filter(s => s !== slug)
      : [...gate.groups, slug];
    onChange({ role: gate.role, groups: next });
  };

  const pillBase = {
    display: "inline-flex", alignItems: "center", gap: 5,
    fontSize: 11, fontWeight: 500, padding: "4px 10px", borderRadius: 20,
    cursor: "pointer", border: "0.5px solid", userSelect: "none",
    transition: "background .1s, color .1s",
  };

  const rolePill = (r) => {
    const active = gate.role === r.value;
    return (
      <span key={r.value} style={{
        ...pillBase,
        background: active ? "var(--ac-bg)"                 : "transparent",
        color:      active ? "var(--ac-text)"               : "var(--t4)",
        borderColor:active ? "var(--ac-border)"             : "var(--b2)",
      }} onMouseDown={e => { e.preventDefault(); setRole(r.value); }}>
        {r.label}
      </span>
    );
  };

  const groupPill = (g) => {
    const active = gate.groups.includes(g.slug);
    const color  = g.badge_color || "#fbbf24";
    return (
      <span key={g.slug} style={{
        ...pillBase,
        background:  active ? color + "1a"  : "transparent",
        color:       active ? color         : "var(--t4)",
        borderColor: active ? color + "40"  : "var(--b2)",
      }} onMouseDown={e => { e.preventDefault(); toggleGroup(g.slug); }}>
        {g.badge_icon && <i className={`fa-solid ${g.badge_icon}`} style={{ fontSize: 9 }}/>}
        {g.badge_label || g.name}
      </span>
    );
  };

  const hasGroups = groups && groups.length > 0;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {/* Role pills */}
      {ROLES.map(rolePill)}

      {/* Divider — only shown when groups exist */}
      {hasGroups && (
        <div style={{ width: "0.5px", height: 16, background: "var(--b2)", alignSelf: "center" }}/>
      )}

      {/* Group pills */}
      {hasGroups && groups.map(groupPill)}

      {/* Loading state */}
      {groups === null && (
        <span style={{ fontSize: 11, color: "var(--t5)" }}>Loading groups…</span>
      )}
    </div>
  );
}
