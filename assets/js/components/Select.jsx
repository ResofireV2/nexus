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
