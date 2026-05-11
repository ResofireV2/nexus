import { useState, useEffect } from "react";

// ── Toast notification system ─────────────────────────────────────────────────
//
// A global singleton toast queue. Call toast() from anywhere — no need to
// thread it through props.
//
// Usage:
//   import { toast } from "../components/Toasts";
//
//   toast("Post saved!");              // green success
//   toast("Something failed", "err"); // red error
//   toast("Heads up", "warn");        // amber warning
//
// Mount <Toasts /> once at the App root. Only one instance should ever exist.

let _tid = 0;
const _listeners = new Set();

export function toast(msg, type = "ok") {
  const id = ++_tid;
  _listeners.forEach(f => f({ id, msg, type }));
  setTimeout(() => _listeners.forEach(f => f({ id, rm: true })), 3000);
}

export function Toasts() {
  const [list, setList] = useState([]);

  useEffect(() => {
    const handler = (t) => {
      if (t.rm) setList(p => p.filter(x => x.id !== t.id));
      else      setList(p => [...p, t]);
    };
    _listeners.add(handler);
    return () => _listeners.delete(handler);
  }, []);

  return (
    <div style={{
      position:      "fixed",
      bottom:        24,
      right:         24,
      display:       "flex",
      flexDirection: "column",
      gap:           6,
      zIndex:        9999,
    }}>
      {list.map(t => (
        <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>
      ))}
    </div>
  );
}
