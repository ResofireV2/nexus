import { useRef } from "react";

// ── Shared form helpers ───────────────────────────────────────────────────────
// F() is used throughout admin and settings pages.
// ColorPicker and formatUptime are used in several admin panels.

export function F({label, hint, children}) {
  return <div style={{marginBottom:14}}><label className="f-label">{label}</label>{children}{hint&&<div className="f-hint">{hint}</div>}</div>;
}

export function ColorPicker({value, onChange}) {
  const inputRef = useRef();
  const isValid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div style={{display:"flex",alignItems:"center",gap:10}}>
      <div style={{position:"relative",width:36,height:36,flexShrink:0}}>
        <div style={{width:36,height:36,borderRadius:8,background:isValid?value:"rgba(255,255,255,0.1)",border:"0.5px solid var(--b2)",cursor:"pointer"}}
          onClick={()=>inputRef.current?.click()}/>
        <input ref={inputRef} type="color" value={isValid?value:"#a78bfa"}
          onChange={e=>onChange(e.target.value)}
          style={{position:"absolute",opacity:0,width:0,height:0,pointerEvents:"none"}}/>
      </div>
      <input className="fi" value={value||""} onChange={e=>onChange(e.target.value)}
        placeholder="#a78bfa" style={{fontFamily:"monospace",maxWidth:160}}/>
    </div>
  );
}

export function formatUptime(seconds) {
  if (!seconds) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
