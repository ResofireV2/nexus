// ── Select component ──────────────────────────────────────────────────────────
//
// Use this everywhere instead of a raw <select>. This is why your dropdowns
// look inconsistent — every raw <select> bypasses the styling.
//
// Usage:
//
//   import { Select } from "../components/Select";
//
//   // Basic — value + onChange, children are <option> elements
//   <Select value={sort} onChange={setSort}>
//     <option value="newest">Newest</option>
//     <option value="oldest">Oldest</option>
//   </Select>
//
//   // With options array (shorthand — no need to write <option> manually)
//   <Select value={role} onChange={setRole} options={[
//     { value: "member",    label: "Member" },
//     { value: "moderator", label: "Moderator" },
//     { value: "admin",     label: "Admin" },
//   ]} />
//
//   // With extra style overrides (use sparingly — prefer CSS vars)
//   <Select value={x} onChange={setX} style={{ maxWidth: 200 }}>
//     ...
//   </Select>
//
//   // Disabled
//   <Select value={x} onChange={setX} disabled>
//     ...
//   </Select>

export function Select({ value, onChange, options, children, style, disabled, id, className = "" }) {
  const handleChange = (e) => onChange(e.target.value);

  return (
    <select
      id={id}
      className={`fi ${className}`.trim()}
      value={value ?? ""}
      onChange={handleChange}
      disabled={disabled}
      style={style}
    >
      {options
        ? options.map(o => {
            const val   = o.value ?? o;
            const label = o.label ?? o;
            return <option key={val} value={val}>{label}</option>;
          })
        : children}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Toggle — the styled boolean switch used throughout admin and settings.
// Pulled out here because it's always defined inline and reimplemented.
//
// Usage:
//   <Toggle value={enabled} onChange={setEnabled} />
//   <Toggle value={enabled} onChange={setEnabled} label="Enable feature" />
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Dropdown — the standard custom dropdown used across pages and extensions.
// Replaces raw <select> elements and one-off inline dropdown implementations.
//
// Usage:
//   import { Dropdown } from "../components/Select";
//
//   // Array of options, value/label pairs:
//   <Dropdown
//     value={sort}
//     onChange={setSort}
//     options={[
//       { value: "newest", label: "Newest" },
//       { value: "oldest", label: "Oldest" },
//     ]}
//   />
//
//   // With a leading icon on the trigger button:
//   <Dropdown value={sort} onChange={setSort} options={opts} icon="fa-arrow-down-wide-short" />
//
//   // With icons on individual options:
//   <Dropdown value={type} onChange={setType} options={[
//     { value: "discussion", label: "Discussion", icon: "fa-comments" },
//     { value: "question",   label: "Question",   icon: "fa-circle-question" },
//   ]} />
//
//   // Right-aligned menu (for buttons near the right edge):
//   <Dropdown value={x} onChange={setX} options={opts} align="right" />
//
//   // Custom max height for long lists:
//   <Dropdown value={x} onChange={setX} options={opts} maxHeight={200} />
// ---------------------------------------------------------------------------

import { useState, useEffect, useRef } from "react";

export function Dropdown({ value, onChange, options = [], icon, align = "left", maxHeight, placeholder, style }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();

  useEffect(() => {
    const fn = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const selected = options.find(o => o.value === value);
  const label    = selected?.label ?? placeholder ?? "";
  const trigIcon = icon ?? selected?.icon ?? null;

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block", ...style }}>
      <div className="comp-type-btn" onClick={() => setOpen(p => !p)}>
        {trigIcon && <i className={`fa-solid ${trigIcon}`} style={{ fontSize: 13, color: "var(--ac-text)" }} />}
        <span style={{ color: selected ? "var(--t2)" : "var(--t4)" }}>{label}</span>
        <i className="fa-solid fa-chevron-down" style={{ fontSize: 10, color: "var(--t5)", marginLeft: 2, transition: "transform .15s", transform: open ? "rotate(180deg)" : "rotate(0deg)" }} />
      </div>
      {open && (
        <div
          className="comp-dd"
          style={{
            ...(align === "right" ? { left: "auto", right: 0 } : {}),
            ...(maxHeight ? { maxHeight, overflowY: "auto" } : {}),
          }}
        >
          {options.map(o => (
            <div
              key={o.value}
              className={`comp-dd-item${o.value === value ? " active" : ""}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.icon && <i className={`fa-solid ${o.icon}`} style={{ fontSize: 13, width: 16, textAlign: "center" }} />}
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


  return (
    <div className="toggle-row">
      {label && (
        <div>
          <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 500 }}>{label}</div>
          {hint && <div style={{ fontSize: 12, color: "var(--t5)", marginTop: 2 }}>{hint}</div>}
        </div>
      )}
      <div
        className="tgl"
        style={{ background: value ? "var(--ac)" : "var(--tgl-off)" }}
        onClick={() => onChange(!value)}
      >
        <div
          className="tgl-knob"
          style={{ left: value ? 23 : 3, background: value ? "#fff" : "var(--tgl-knob-off)" }}
        />
      </div>
    </div>
  );
}
