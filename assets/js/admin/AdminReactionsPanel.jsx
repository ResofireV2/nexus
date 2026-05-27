import { useState, useEffect, useRef } from "react";
import { api } from "../lib/api";
import { toast } from "../components/Toasts";
import { Toggle } from "../components/Select";

const MAX_REACTIONS = 8;
const MIN_REACTIONS = 1;

const DEFAULT_REACTIONS = [
  {emoji:"❤️", label:"Love"},
  {emoji:"👍", label:"Like"},
  {emoji:"😂", label:"Haha"},
  {emoji:"😲", label:"Wow"},
  {emoji:"😭", label:"Sad"},
  {emoji:"🔥", label:"Fire"},
  {emoji:"🎉", label:"Celebrate"},
  {emoji:"👀", label:"Eyes"},
];

// ── EmojiPickerInline ─────────────────────────────────────────────────────────
// Spawns an emoji-mart picker anchored to a button, reusing the same
// window.EmojiMart.Picker used by the post composer.
function EmojiPickerInline({ anchorRef, onSelect, onClose }) {
  useEffect(() => {
    const el = document.createElement("div");
    el.id = "nexus-react-cfg-picker";
    el.style.cssText = "position:fixed;z-index:9999;";
    document.body.appendChild(el);

    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const pickerH = 386;
      const spaceAbove = rect.top - 8;
      el.style.top  = (spaceAbove >= pickerH ? rect.top - pickerH : rect.bottom + 4) + "px";
      el.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - 324)) + "px";
    }

    const tid = setTimeout(() => {
      if (!window.EmojiMart || !document.body.contains(el)) return;
      const picker = new window.EmojiMart.Picker({
        onEmojiSelect: (e) => { onSelect(e.native); },
        theme: "dark",
        set: "native",
        previewPosition: "none",
        skinTonePosition: "none",
        autoFocus: true,
      });
      el.appendChild(picker);
    }, 0);

    const onDown = (e) => {
      if (!el.contains(e.target) && !anchorRef.current?.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", onDown);

    return () => {
      clearTimeout(tid);
      document.removeEventListener("mousedown", onDown);
      if (document.body.contains(el)) document.body.removeChild(el);
    };
  }, []);

  return null;
}

// ── AdminReactionsPanel ───────────────────────────────────────────────────────
export function AdminReactionsPanel({ reactionsCfg, setReactionsCfg, setIsDirty }) {
  const enabled  = reactionsCfg.enabled !== false;
  const list     = reactionsCfg.list && reactionsCfg.list.length > 0
    ? reactionsCfg.list
    : DEFAULT_REACTIONS;

  const [pickerOpen, setPickerOpen] = useState(false);
  const addBtnRef  = useRef(null);
  const dragIdx    = useRef(null);

  const update = (patch) => {
    setReactionsCfg(p => ({ ...p, ...patch }));
    setIsDirty(true);
  };

  const setList = (newList) => {
    update({ list: newList });
  };

  // ── Drag and drop ────────────────────────────────────────────────────────────
  const onDragStart = (e, i) => {
    dragIdx.current = i;
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver  = (e) => { e.preventDefault(); };
  const onDrop      = (e, i) => {
    e.preventDefault();
    const from = dragIdx.current;
    if (from === null || from === i) return;
    const next = list.slice();
    const [item] = next.splice(from, 1);
    next.splice(i, 0, item);
    dragIdx.current = null;
    setList(next);
  };
  const onDragEnd   = () => { dragIdx.current = null; };

  // ── Label editing ────────────────────────────────────────────────────────────
  const updateLabel = (i, label) => {
    const next = list.map((r, idx) => idx === i ? { ...r, label } : r);
    setList(next);
  };

  // ── Remove ───────────────────────────────────────────────────────────────────
  const remove = (i) => {
    if (list.length <= MIN_REACTIONS) { toast(`At least ${MIN_REACTIONS} reaction is required`); return; }
    setList(list.filter((_, idx) => idx !== i));
  };

  // ── Add via emoji picker ──────────────────────────────────────────────────────
  const onEmojiSelect = (native) => {
    setPickerOpen(false);
    if (list.some(r => r.emoji === native)) { toast("That emoji is already in the list"); return; }
    if (list.length >= MAX_REACTIONS) { toast(`Maximum ${MAX_REACTIONS} reactions reached`); return; }
    setList([...list, { emoji: native, label: native }]);
  };

  return (
    <div>
      <div className="fgt" style={{ marginBottom: 4 }}>Reactions</div>
      <div style={{ fontSize: 13, color: "var(--t4)", marginBottom: 24 }}>
        Configure which emoji reactions are available on posts and replies.
        Drag to reorder. Click a label to rename it.
      </div>

      {/* Master enable toggle */}
      <Toggle
        label="Reactions enabled"
        hint="Allow users to react to posts and replies. Disabling this hides all reaction controls site-wide."
        value={enabled}
        onChange={v => update({ enabled: v })}
      />

      {enabled && (
        <div style={{ marginTop: 28 }}>
          {/* Count indicator + Add button */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{ flex: 1, fontSize: 13, color: "var(--t4)" }}>
              {list.length} of {MAX_REACTIONS} reactions configured
            </div>
            {list.length < MAX_REACTIONS && (
              <button
                ref={addBtnRef}
                className="btn-primary"
                style={{ fontSize: 13, padding: "7px 18px" }}
                onClick={() => setPickerOpen(p => !p)}>
                <i className="fa-solid fa-plus" style={{ marginRight: 6 }}/>
                Add reaction
              </button>
            )}
            {pickerOpen && (
              <EmojiPickerInline
                anchorRef={addBtnRef}
                onSelect={onEmojiSelect}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </div>

          {/* Reaction list */}
          <div style={{ background: "var(--s2)", border: "0.5px solid var(--b1)", borderRadius: 12, overflow: "hidden" }}>
            {list.map((r, i) => (
              <div
                key={r.emoji + i}
                draggable
                onDragStart={e => onDragStart(e, i)}
                onDragOver={onDragOver}
                onDrop={e => onDrop(e, i)}
                onDragEnd={onDragEnd}
                style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "12px 16px",
                  borderBottom: i < list.length - 1 ? "0.5px solid var(--b1)" : "none",
                  cursor: "grab",
                }}>
                {/* Drag handle */}
                <i className="fa-solid fa-grip-vertical" style={{ fontSize: 11, color: "var(--t5)", flexShrink: 0 }}/>
                {/* Emoji */}
                <span style={{ fontSize: 24, lineHeight: 1, flexShrink: 0, userSelect: "none" }}>{r.emoji}</span>
                {/* Label — inline editable */}
                <input
                  className="fi"
                  style={{ flex: 1, fontSize: 13, padding: "5px 10px" }}
                  value={r.label}
                  placeholder="Label…"
                  onChange={e => updateLabel(i, e.target.value)}
                  onMouseDown={e => e.stopPropagation()}
                />
                {/* Remove button — disabled at minimum */}
                <button
                  className="btn-ghost"
                  style={{
                    fontSize: 12, padding: "5px 10px", flexShrink: 0,
                    color: list.length <= MIN_REACTIONS ? "var(--t5)" : "var(--red)",
                    borderColor: list.length <= MIN_REACTIONS ? "var(--b1)" : "rgba(248,113,113,0.3)",
                    cursor: list.length <= MIN_REACTIONS ? "not-allowed" : "pointer",
                  }}
                  disabled={list.length <= MIN_REACTIONS}
                  onClick={() => remove(i)}>
                  <i className="fa-solid fa-xmark"/>
                </button>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 12, color: "var(--t5)", marginTop: 8 }}>
            Minimum {MIN_REACTIONS} · Maximum {MAX_REACTIONS} · Drag rows to reorder
          </div>
        </div>
      )}
    </div>
  );
}
