import { useState, useEffect, useRef } from "react";

// ── Select ────────────────────────────────────────────────────────────────────
// Thin wrapper around a native <select>. Use for form fields inside admin
// settings panels. For page-level sort/filter controls, use Dropdown instead.
//
// Usage:
//   import { Select } from "../components/Select";
//   <Select value={role} onChange={setRole}>
//     <option value="member">Member</option>
//   </Select>
//   // Or with options array:
//   <Select value={x} onChange={setX} options={[{value:"a",label:"A"}]} />

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

// ── Dropdown ──────────────────────────────────────────────────────────────────
// Standard custom dropdown for page-level controls (sort, filter, etc).
// Uses the comp-type-btn / comp-dd CSS classes already defined in nexus.jsx.
//
// Usage:
//   import { Dropdown } from "../components/Select";
//
//   <Dropdown
//     value={sort}
//     onChange={setSort}
//     options={[
//       { value: "newest", label: "Newest" },
//       { value: "oldest", label: "Oldest" },
//     ]}
//   />
//
//   // With trigger icon:
//   <Dropdown value={sort} onChange={setSort} options={opts} icon="fa-arrow-down-wide-short" />
//
//   // With per-option icons:
//   <Dropdown value={type} onChange={setType} options={[
//     { value: "discussion", label: "Discussion", icon: "fa-comments" },
//     { value: "question",   label: "Question",   icon: "fa-circle-question" },
//   ]} />
//
//   // Right-aligned menu (near the right edge of the screen):
//   <Dropdown value={x} onChange={setX} options={opts} align="right" />
//
//   // Max height for long lists:
//   <Dropdown value={x} onChange={setX} options={opts} maxHeight={200} />

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

// ── Toggle ────────────────────────────────────────────────────────────────────
// Styled boolean switch used throughout admin and settings panels.
//
// Usage:
//   import { Toggle } from "../components/Select";
//   <Toggle value={enabled} onChange={setEnabled} label="Enable feature" />
//   <Toggle value={enabled} onChange={setEnabled} label="Enable" hint="Some hint text" />

export function Toggle({ value, onChange, label, hint }) {
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
