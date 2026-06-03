import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api";
import { toast } from "./Toasts";
import { Av } from "./Avatar";
import { Md } from "./Markdown";

// ── RichTextArea ──────────────────────────────────────────────────────────────
// The markdown composer used for posts, replies, and the compose page.
// Supports: formatting toolbar, slash commands, @mentions, image upload
// (paste, drop, or file picker), and a live preview modal.
//
// Usage:
//   <RichTextArea
//     value={body}
//     onChange={setBody}
//     placeholder="Write something…"
//     currentUser={currentUser}
//   />

// Slash command menu items
const SLASH_ITEMS = [
  {type:"image",   icon:"🖼",  label:"Image",       desc:"Upload or embed"},
  {type:"grid",    icon:"⊞",   label:"Image grid",  desc:"Mosaic image layout"},
  {type:"code",    icon:"</>", label:"Code block",  desc:"Syntax highlighted"},
  {type:"quote",   icon:'"',   label:"Blockquote",  desc:"Highlight a quote"},
  {type:"divider", icon:"—",   label:"Divider",     desc:"Horizontal rule"},
];

// Built-in toolbar button definitions
export const TB_BTNS = [
  {type:"bold",    label:"B",   tip:"Bold",          style:{fontWeight:700},                   wrap:["**","**"]},
  {type:"italic",  label:"I",   tip:"Italic",        style:{fontStyle:"italic"},               wrap:["*","*"]},
  {type:"strike",  label:"S",   tip:"Strikethrough", style:{textDecoration:"line-through"},    wrap:["~~","~~"]},
  {sep:true},
  {type:"h1",      label:"H1",  tip:"Heading 1",     style:{fontSize:12,fontWeight:700},       wrap:["# ",""]},
  {type:"h2",      label:"H2",  tip:"Heading 2",     style:{fontSize:12,fontWeight:700},       wrap:["## ",""]},
  {sep:true},
  {type:"ul",      label:"fa-solid fa-list-ul",       tip:"Bullet list",    style:{}, wrap:null, list:"ul"},
  {type:"ol",      label:"fa-solid fa-list-ol",       tip:"Numbered list",  style:{}, wrap:null, list:"ol"},
  {sep:true},
  {type:"incode",  label:"</>", tip:"Inline code",   style:{fontFamily:"monospace",fontSize:11},wrap:["`","`"]},
  {type:"code",    label:"≡",   tip:"Code block",    style:{fontFamily:"monospace"},            wrap:["```\n","\n```"]},
  {type:"link",    label:"🔗",  tip:"Link",          style:{},                                 wrap:["[","](url)"]},
  {type:"quote",   label:"❝",   tip:"Blockquote",    style:{},                                 wrap:["> ",""]},
  {type:"divider", label:"—",   tip:"Divider",       style:{},                                 wrap:["\n---\n",""]},
  {sep:true},
  {type:"spoiler", label:"👁",  tip:"Spoiler",       style:{},                                 wrap:["||","||"]},
  {sep:true},
  {type:"emoji",   label:"fa-solid fa-face-smile", tip:"Emoji", style:{},                     wrap:null},
  {sep:true},
  {type:"image",   label:"🖼",  tip:"Upload image",  style:{},                                 wrap:null},
  {type:"grid",    label:"fa-solid fa-table-cells", tip:"Image grid", style:{}, wrap:null, grid:true},
  {sep:true},
];

// Merges built-in toolbar buttons with any extension-registered ones.
// Extension entries have a stable type of "ext:<slug>:<id>" — derived from
// the explicit slug and id fields supplied at registration. Slug is also
// surfaced on the entry so admin tooling can group or label by extension.
export function getAllToolbarButtons() {
  const ext = window.NexusExtensions ? window.NexusExtensions.getToolbarButtons() : [];
  const extItems = ext.map(e => ({
    type:    "ext:" + e.config.slug + ":" + e.config.id,
    slug:    e.config.slug,
    label:   e.config.icon,
    tip:     e.config.tip || "",
    onClick: e.config.onClick,
    scope:   e.config.scope || "both",
    style:   {},
    wrap:    null,
    _ext:    true,
  }));
  return TB_BTNS.concat(extItems);
}

// Global slash menu state — singleton DOM element shared across all instances
let _slashMenu = null;
let _activeTA  = null;
let _slashIdx  = 0;

function getSm() {
  if (!_slashMenu) {
    _slashMenu = document.createElement("div");
    _slashMenu.className = "slash-menu";
    _slashMenu.style.display = "none";
    document.body.appendChild(_slashMenu);
  }
  return _slashMenu;
}

window._smPick = function(type) {
  const ta = _activeTA; if (!ta) return;
  getSm().style.display = "none";
  if (type === "image") {
    const input = document.getElementById("comp-img-input");
    if (input) input.click();
    return;
  }
  if (type === "grid") {
    const pos = ta.selectionStart;
    const cur = ta.value;
    const needsNewline = pos > 0 && cur[pos - 1] !== "\n";
    const insert = (needsNewline ? "\n" : "") + "[grid]\n\n[/grid]\n";
    ta.value = cur.slice(0, pos) + insert + cur.slice(pos);
    // Place cursor inside the grid block (on the blank line between tags)
    const innerPos = pos + (needsNewline ? 1 : 0) + "[grid]\n".length;
    ta.focus();
    ta.setSelectionRange(innerPos, innerPos);
    ta.dispatchEvent(new Event("input", {bubbles:true}));
    return;
  }
  const lines = ta.value.split("\n");
  lines[lines.length-1] =
    type==="code"    ? "```\ncode here\n```" :
    type==="quote"   ? "> "  :
    type==="divider" ? "---" : "";
  ta.value = lines.join("\n");
  ta.focus();
  ta.dispatchEvent(new Event("input", {bubbles:true}));
};

window._smHover = function(idx) {
  _slashIdx = idx;
  getSm().querySelectorAll(".slash-item").forEach((el, i) => {
    el.classList.toggle("sel", i === idx);
  });
};

// Active toolbar items — set separately for post and reply composers
export let _activePostToolbar  = null;
export let _activeReplyToolbar = null;
export function setActivePostToolbar(items)  { _activePostToolbar  = items; }
export function setActiveReplyToolbar(items) { _activeReplyToolbar = items; }

// Renders the emoji-mart picker into a portal div appended to document.body,
// positioned above the anchor button on desktop and as a bottom sheet on mobile.
//
// onSelectRef is a React ref (not the callback directly) so the picker always
// calls the latest version of insertEmoji without needing to re-mount when
// the parent re-renders with a new `value` closure.
// Overflow toolbar menu — appends a fixed-position div to document.body so it
// escapes the overflow:hidden on composer-shell and composer-inner.
// Receives pre-resolved callbacks from RichTextArea to avoid prop drilling.
function OverflowMenuPortal({
  overflowBtnRef, toolbarItems, overflowIdx,
  emojiAnchorRef, emojiOpen, uploading,
  onClose, onEmoji, onFormat, onList, onGrid, onExt,
}) {
  useEffect(() => {
    // Create portal div if it doesn't exist.
    let el = document.getElementById("nexus-tb-overflow-portal");
    if (!el) {
      el = document.createElement("div");
      el.id = "nexus-tb-overflow-portal";
      el.style.cssText = [
        "position:fixed",
        "z-index:400",
        "background:var(--s2)",
        "border:0.5px solid var(--b2)",
        "border-radius:10px",
        "padding:4px",
        "box-shadow:0 4px 20px rgba(0,0,0,0.4)",
        "display:flex",
        "flex-direction:column",
        "gap:2px",
        "min-width:180px",
      ].join(";");
      document.body.appendChild(el);
    }

    // Position below the ⋯ button, clamped to viewport right edge.
    if (overflowBtnRef.current) {
      const rect = overflowBtnRef.current.getBoundingClientRect();
      el.style.top  = (rect.bottom + 4) + "px";
      el.style.left = Math.max(4, rect.right - 184) + "px";
    }

    return () => {
      if (document.body.contains(el)) document.body.removeChild(el);
    };
  }, []);

  // Build the overflow button list from definitions.
  const canUploadImages = (()=>{
    const gate = window._postCfg?.who_can_upload;
    if (!gate) return true;
    const role   = typeof gate === "string" ? gate : (gate.role || "member");
    const groups = typeof gate === "object"  ? (gate.groups || []) : [];
    const LEVELS = {everyone:0, member:1, moderator:2, admin:3};
    // In the portal we don't have currentUser in scope, so we optimistically show
    // if groups are set (backend will enforce). Portal is only shown to logged-in users.
    return (LEVELS["member"]||1) >= (LEVELS[role]||1) || groups.length > 0;
  })();

  const allBtns = (toolbarItems || getAllToolbarButtons())
    .filter(b => !b.hidden)
    .filter(b => !(b._ext && typeof b.onClick !== "function"))
    .filter(b => canUploadImages || (b.type !== "image" && b.type !== "grid"));
  const overflowBtns = overflowIdx !== null ? allBtns.slice(overflowIdx) : [];
  while (overflowBtns.length > 0 && overflowBtns[0].sep) overflowBtns.shift();
  if (!overflowBtns.length) return null;

  const ROW = {justifyContent:"flex-start",gap:10,width:"100%",padding:"0 10px"};
  const ICO = {fontSize:16,width:20,textAlign:"center"};

  const items = overflowBtns.map((b, i) => {
    if (b.sep) return <div key={i} style={{height:"0.5px",background:"var(--b1)",margin:"2px 4px"}}/>;
    if (b._ext) return (
      <button key={b.type} className="comp-tb-btn" title={b.tip} style={ROW}
        onMouseDown={e=>{e.preventDefault();onExt(b);}}>
        <i className={b.label} style={ICO}/>
        <span style={{fontSize:13}}>{b.tip}</span>
      </button>
    );
    if (b.type==="emoji") return (
      <button key="emoji" ref={emojiAnchorRef} className={`comp-tb-btn${emojiOpen?" comp-tb-btn--active":""}`} title="Emoji" style={ROW}
        onMouseDown={e=>{e.preventDefault();onEmoji();}}>
        <i className="fa-solid fa-face-smile" style={ICO}/>
        <span style={{fontSize:13}}>Emoji</span>
      </button>
    );
    if (b.type==="image") return (
      <label key="image" className="comp-tb-btn" htmlFor="comp-img-input" title="Upload image" style={{...ROW,cursor:"pointer"}}
        onMouseDown={onClose}>
        {uploading
          ? <i className="fa-solid fa-spinner fa-spin" style={ICO}/>
          : <i className="fa-solid fa-image" style={ICO}/>}
        <span style={{fontSize:13}}>Upload image</span>
      </label>
    );
    if (b.list) return (
      <button key={b.type} className="comp-tb-btn" title={b.tip} style={ROW}
        onMouseDown={e=>{e.preventDefault();onList(b.list);}}>
        <i className={b.label} style={ICO}/>
        <span style={{fontSize:13}}>{b.tip}</span>
      </button>
    );
    if (b.grid) return (
      <button key={b.type} className="comp-tb-btn" title={b.tip} style={ROW}
        onMouseDown={e=>{e.preventDefault();onGrid();}}>
        <i className="fa-solid fa-table-cells" style={ICO}/>
        <span style={{fontSize:13}}>{b.tip}</span>
      </button>
    );
    return (
      <button key={b.type} className="comp-tb-btn" title={b.tip} style={ROW}
        onMouseDown={e=>{e.preventDefault();onFormat(b.wrap);}}>
        <span style={{...b.style,fontSize:16,width:20,textAlign:"center",display:"inline-block"}}>{b.label}</span>
        <span style={{fontSize:13}}>{b.tip}</span>
      </button>
    );
  });

  // Render items into the portal div using a mini React root.
  // We reuse window.ReactDOM (exposed by nexus.jsx) for createRoot.
  useEffect(() => {
    const el = document.getElementById("nexus-tb-overflow-portal");
    if (!el || !window.ReactDOM) return;
    const root = window.ReactDOM.createRoot(el);
    root.render(<>{items}</>);
    return () => root.unmount();
  });

  return null;
}

function EmojiPickerPortal({isMobile, anchorRef, onSelectRef}) {
  useEffect(() => {
    const el = document.createElement("div");
    el.id = "nexus-emoji-picker-wrap";
    el.className = isMobile ? "emoji-picker-sheet" : "emoji-picker-popup";
    // Hide until positioned to avoid flash at default bottom:0 left:0
    if (!isMobile) el.style.visibility = "hidden";
    document.body.appendChild(el);

    if (isMobile) {
      const handle = document.createElement("div");
      handle.className = "emoji-picker-handle";
      el.appendChild(handle);
    }

    // Defer construction by one task so the browser finishes registering the
    // em-emoji-picker custom element before we try to instantiate it.
    // customElements.define() runs synchronously inside browser.js but the
    // upgrade is microtask-queued; setTimeout(0) clears that queue safely.
    const tid = setTimeout(() => {
      if (!window.EmojiMart || !document.body.contains(el)) return;
      const picker = new window.EmojiMart.Picker({
        // Wrap in a stable function so the picker always invokes the current
        // insertEmoji without the portal needing to remount on every keystroke.
        onEmojiSelect: (emoji) => { if (onSelectRef.current) onSelectRef.current(emoji); },
        theme: "dark",
        set: "native",
        previewPosition: "bottom",
        skinTonePosition: "none",
        autoFocus: !isMobile,
      });
      el.appendChild(picker);
      // Position after picker is in DOM so we have accurate dimensions.
      // Anchor to the toolbar button, flipping above/below as needed.
      if (!isMobile && anchorRef.current) {
        const rect = anchorRef.current.getBoundingClientRect();
        const pickerH = 386;
        const spaceAbove = rect.top - 8;
        el.style.top    = (spaceAbove >= pickerH ? rect.top - pickerH : rect.bottom + 8) + "px";
        el.style.left   = Math.max(4, Math.min(rect.left, window.innerWidth - 324)) + "px";
        el.style.bottom = "auto";
        el.style.visibility = "visible";
      }
    }, 0);

    return () => {
      clearTimeout(tid);
      if (document.body.contains(el)) document.body.removeChild(el);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export function RichTextArea({value, onChange, placeholder, minHeight=200, autoFocus=false, currentUser=null, toolbarItems=null, attachments=null, setAttachments=null, context=null}) {
  // Resolve toolbar:
  //   1. Explicit `toolbarItems` prop wins (used by AdminLayout for the
  //      drag-to-reorder preview).
  //   2. context === "post"  → the admin's saved post toolbar config,
  //      including extension buttons declared with scope "posts" or "both".
  //   3. context === "reply" → same for reply, scope "replies" or "both".
  //   4. context === "page" or any other value → built-in buttons ONLY.
  //      Extension toolbar buttons declare scope as posts/replies/both via
  //      registerToolbarButton — none of those include the pages editor or
  //      any future non-composer surface. Extensions never opted in, so
  //      they don't appear here.
  if(!toolbarItems) {
    if(context === "post")  toolbarItems = _activePostToolbar  || getAllToolbarButtons();
    else if(context === "reply") toolbarItems = _activeReplyToolbar || getAllToolbarButtons();
    else toolbarItems = TB_BTNS;
  }

  // Piece 4: generic compose attachments. Extensions call `attach({kind, data})`
  // from their toolbar button onClick to attach structured data to the
  // composition. The page consuming this component reads `attachments` state
  // and includes it in the submit request body.
  const composerAttachments = attachments || [];
  const setComposerAttachments = setAttachments || (() => {});
  const attach = (a) => {
    if (!a || typeof a !== "object" || typeof a.kind !== "string" || !a.kind) {
      console.error("[RichTextArea] attach() requires {kind: string, data: object}, got:", a);
      return;
    }
    setComposerAttachments(prev => [...(prev || []), {kind: a.kind, data: a.data ?? {}}]);
  };

  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const unsub = window.NexusExtensions.onToolbarChange(() => forceUpdate(n => n+1));
    return unsub;
  }, []);

  const taRef      = useRef();
  const wrapRef    = useRef();
  const imgInputRef = useRef();
  const toolbarRef  = useRef();
  const [toolbarH,  setToolbarH]  = useState(44); // tracks actual toolbar height for placeholder offset
  const [overflowIdx, setOverflowIdx] = useState(null); // null = no overflow, N = first hidden item index
  const [overflowOpen, setOverflowOpen] = useState(false); // whether the ⋯ dropdown is open
  const overflowBtnRef = useRef(); // ref for the ⋯ button (for dropdown positioning)
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({done:0, total:0}); // {done, total} while uploading

  // Compute which toolbar items overflow the available width (desktop only).
  // On mobile (≤767px) the toolbar wraps via CSS — no JS measurement needed.
  //
  // Uses fixed item widths from the button definitions rather than reading
  // DOM children, which avoids the circular problem of measuring the ⋯
  // wrapper div as if it were a button.
  //
  // Item widths (matching CSS):
  //   comp-tb-btn: min-width 32px + 2px gap = 34px
  //   comp-tb-sep: 0.5px width + 3px margin each side + 2px gap = 9px
  //   ⋯ button:    34px (same as a regular button)
  //   Preview btn: 34px — always pinned right, reserved from available width
  //   Toolbar padding: 8px each side = 16px total
  const BTN_W  = 34; // button width + gap
  const SEP_W  = 9;  // separator width + margins + gap
  const MORE_W = 34; // ⋯ button width + gap
  const TB_PAD = 16; // toolbar left+right padding

  const measureOverflow = useCallback(() => {
    const el = toolbarRef.current;
    if (!el || window.innerWidth <= 767) {
      setOverflowIdx(null);
      setToolbarH(el ? el.offsetHeight : 44);
      return;
    }

    const items = (toolbarItems || getAllToolbarButtons())
      .filter(b => !b.hidden)
      .filter(b => !(b._ext && typeof b.onClick !== "function"));

    // Available width: toolbar width minus padding and the pinned preview button.
    const available = el.clientWidth - TB_PAD - BTN_W;

    let used = 0;
    let cutAt = null;
    for (let i = 0; i < items.length; i++) {
      const w = items[i].sep ? SEP_W : BTN_W;
      // Reserve room for the ⋯ button from the point where overflow first occurs.
      if (used + w + MORE_W > available) {
        // Walk back to skip any trailing separators before the cut point.
        let cut = i;
        while (cut > 0 && items[cut - 1].sep) cut--;
        cutAt = cut;
        break;
      }
      used += w;
    }
    setOverflowIdx(cutAt);
    setToolbarH(el.offsetHeight);
  }, [toolbarItems]);

  // Track toolbar height and overflow on resize or when toolbar items change.
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measureOverflow);
    ro.observe(el);
    measureOverflow();
    return () => ro.disconnect();
  }, [measureOverflow]);

  // Close overflow dropdown on outside click.
  useEffect(() => {
    if (!overflowOpen) return;
    const handler = (e) => {
      if (overflowBtnRef.current && !overflowBtnRef.current.contains(e.target)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [overflowOpen]);

  // ── Emoji picker ──────────────────────────────────────────────────────────
  const [emojiOpen,   setEmojiOpen]   = useState(false);
  const emojiAnchorRef                = useRef();   // toolbar button ref for positioning
  const savedSelRef                   = useRef({s:0, e:0}); // last known cursor position
  const emojiMartLoadedRef            = useRef(false);
  const emojiMartLoadingRef           = useRef(false);
  // Stable ref to insertEmoji — updated every render so the portal always
  // calls the latest closure without needing to remount.
  const onSelectRef                   = useRef(null);

  // Detect mobile: bottom sheet when viewport ≤ 767px
  const isMobile = () => window.innerWidth <= 767;

  // Load emoji-mart + its data from CDN on first open, then open the picker
  const loadEmojiMart = (cb) => {
    if (emojiMartLoadedRef.current) { cb(); return; }
    if (emojiMartLoadingRef.current) {
      const poll = setInterval(() => {
        if (emojiMartLoadedRef.current) { clearInterval(poll); cb(); }
      }, 50);
      return;
    }
    emojiMartLoadingRef.current = true;
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/emoji-mart@5.6.0/dist/browser.js";
    script.onload = () => {
      // emoji-mart browser build needs its data initialised before the picker renders
      fetch("https://cdn.jsdelivr.net/npm/@emoji-mart/data@1.2.0/sets/15/native.json")
        .then(r => r.json())
        .then(data => {
          if (window.EmojiMart) window.EmojiMart.init({ data });
          emojiMartLoadedRef.current = true;
          emojiMartLoadingRef.current = false;
          cb();
        })
        .catch(() => { emojiMartLoadingRef.current = false; });
    };
    script.onerror = () => { emojiMartLoadingRef.current = false; };
    document.head.appendChild(script);
  };

  // Save cursor position whenever the textarea loses focus (picker click steals focus)
  const saveCursor = () => {
    const ta = taRef.current;
    if (ta) savedSelRef.current = { s: ta.selectionStart, e: ta.selectionEnd };
  };

  // Insert emoji at saved cursor position; keep picker open
  const insertEmoji = (emoji) => {
    const ta = taRef.current; if (!ta) return;
    const native = emoji.native || "";
    if (!native) return;
    const { s } = savedSelRef.current;
    const cur = value;
    const newVal = cur.slice(0, s) + native + cur.slice(s);
    onChange(newVal);
    // Advance saved cursor past inserted emoji (native emoji can be multi-codepoint)
    const newPos = s + native.length;
    savedSelRef.current = { s: newPos, e: newPos };
    // Restore focus + cursor in textarea without closing picker
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newPos, newPos);
    });
  };
  // Keep onSelectRef pointed at the current insertEmoji on every render so the
  // portal (which only mounts once) always calls the up-to-date closure.
  onSelectRef.current = insertEmoji;

  const toggleEmoji = () => {
    const ta = taRef.current;
    if (ta && !emojiOpen) saveCursor();
    if (!emojiOpen) {
      loadEmojiMart(() => setEmojiOpen(true));
    } else {
      setEmojiOpen(false);
    }
  };

  // Close picker on Escape key or click outside
  useEffect(() => {
    if (!emojiOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setEmojiOpen(false); };
    const onClickOutside = (e) => {
      const anchor  = emojiAnchorRef.current;
      const wrapper = document.getElementById("nexus-emoji-picker-wrap");
      // anchor check handled by onMouseDown toggle; wrapper check guards against
      // shadow-DOM clicks inside the picker (e.target is the host element).
      if (anchor  && anchor.contains(e.target))  return;
      if (wrapper && wrapper.contains(e.target)) return;
      setEmojiOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("touchstart", onClickOutside, {passive: true});
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("touchstart", onClickOutside);
    };
  }, [emojiOpen]);

  // ── end emoji picker ──────────────────────────────────────────────────────

  // Apply a format wrap to the current selection or insert at cursor
  const applyFormat = (wrap) => {
    const ta = taRef.current; if (!ta) return;
    const [before, after] = wrap;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e) || "text";
    const newVal = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e);
    onChange(newVal);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(s + before.length, s + before.length + sel.length);
    }, 0);
  };

  // Prefixes each selected line with a bullet or numbered list marker.
  // If nothing is selected, inserts a starter item at the cursor position.
  const applyList = (kind) => {
    const ta = taRef.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const before = ta.value.slice(0, s);
    const sel    = ta.value.slice(s, e);
    const after  = ta.value.slice(e);
    if (sel) {
      // Prefix every selected line
      let n = 0;
      const prefixed = sel.replace(/^(.*)$/gm, (line) => {
        if (!line.trim()) return line; // leave blank lines alone
        n++;
        return (kind === "ol" ? `${n}. ` : "- ") + line;
      });
      const newVal = before + prefixed + after;
      ta.value = newVal;
      onChange(newVal);
      setTimeout(() => { ta.focus(); ta.setSelectionRange(s, s + prefixed.length); }, 0);
    } else {
      // No selection — insert a single starter item on a new line
      const prefix = kind === "ol" ? "1. " : "- ";
      const needsNewline = before.length > 0 && !before.endsWith("\n");
      const insert = (needsNewline ? "\n" : "") + prefix;
      const newVal = before + insert + after;
      ta.value = newVal;
      onChange(newVal);
      const pos = s + insert.length;
      setTimeout(() => { ta.focus(); ta.setSelectionRange(pos, pos); }, 0);
    }
  };

  // Wraps selected image markdown in [grid]...[/grid] or inserts an empty
  // grid block at the cursor if nothing relevant is selected.
  const applyGrid = () => {
    const ta = taRef.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e).trim();
    const before = ta.value.slice(0, s);
    const after  = ta.value.slice(e);
    const needsLeadingNewline = s > 0 && ta.value[s - 1] !== "\n";
    if (sel) {
      // Wrap the selection
      const insert = (needsLeadingNewline ? "\n" : "") + "[grid]\n" + sel + "\n[/grid]\n";
      const newVal = before + insert + after;
      ta.value = newVal;
      onChange(newVal);
      setTimeout(() => { ta.focus(); ta.setSelectionRange(s, s + insert.length); }, 0);
    } else {
      // Insert empty grid block with cursor placed inside
      const insert = (needsLeadingNewline ? "\n" : "") + "[grid]\n\n[/grid]\n";
      const newVal = before + insert + after;
      ta.value = newVal;
      onChange(newVal);
      const innerPos = s + (needsLeadingNewline ? 1 : 0) + "[grid]\n".length;
      setTimeout(() => { ta.focus(); ta.setSelectionRange(innerPos, innerPos); }, 0);
    }
  };

  // @mention state
  const [mentionDrop, setMentionDrop] = useState(null);
  const [isFocused,   setIsFocused]   = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const mentionDebounce = useRef();

  const mentionSearch = async (q, caretPos, x, y) => {
    if (q.length === 0) { setMentionDrop(null); return; }
    const d = await api.get(`/users?q=${encodeURIComponent(q)}`).catch(() => null);
    const users = (d?.members||[]).slice(0, 6);
    if (users.length === 0) { setMentionDrop(null); return; }
    setMentionDrop({users, query:q, pos:caretPos, x, y, selIdx:0});
  };

  const insertMention = (username) => {
    const ta = taRef.current; if (!ta) return;
    const val  = ta.value;
    const before = val.slice(0, mentionDrop.pos);
    const atIdx  = before.lastIndexOf("@");
    if (atIdx === -1) return;
    const after  = val.slice(mentionDrop.pos);
    const newVal = val.slice(0, atIdx) + `@${username} ` + after;
    onChange(newVal);
    setMentionDrop(null);
    const newPos = atIdx + username.length + 2;
    setTimeout(() => { ta.focus(); ta.setSelectionRange(newPos, newPos); }, 0);
  };

  const buildSm = () => {
    const sm = getSm();
    sm.innerHTML = SLASH_ITEMS.map((item, i) =>
      `<div class="slash-item${i===0?" sel":""}" onmousedown="event.preventDefault();_smPick('${item.type}')" onmouseenter="_smHover(${i})">
        <div class="slash-icon">${item.icon}</div>
        <div><div>${item.label}</div><div class="slash-desc">${item.desc}</div></div>
      </div>`
    ).join("");
    _slashIdx = 0;
  };

  const handleChange = e => {
    onChange(e.target.value);
    const ta  = e.target;
    const val = ta.value;
    const caret = ta.selectionStart;

    // @mention detection
    const textBefore   = val.slice(0, caret);
    const mentionMatch = textBefore.match(/@([a-zA-Z0-9_]*)$/);
    if (mentionMatch) {
      const q = mentionMatch[1];
      clearTimeout(mentionDebounce.current);
      const rect = ta.getBoundingClientRect();
      mentionDebounce.current = setTimeout(() => mentionSearch(q, caret, rect.left+16, rect.top-8), 200);
    } else {
      setMentionDrop(null);
    }

    // Slash command detection
    const last = val.split("\n").pop();
    const sm   = getSm();
    if (/^\/([icbde])?$/.test(last) || last==="/") {
      _activeTA = taRef.current;
      buildSm();
      const rect = ta.getBoundingClientRect();
      sm.style.cssText = `display:block;position:fixed;left:${rect.left}px;top:${rect.top-200}px;`;
    } else {
      sm.style.display = "none";
    }
  };

  const handleKeyDown = e => {
    if (mentionDrop) {
      if (e.key==="ArrowDown")  { e.preventDefault(); setMentionDrop(p=>({...p,selIdx:(p.selIdx+1)%p.users.length})); return; }
      if (e.key==="ArrowUp")    { e.preventDefault(); setMentionDrop(p=>({...p,selIdx:(p.selIdx-1+p.users.length)%p.users.length})); return; }
      if (e.key==="Enter"||e.key==="Tab") { e.preventDefault(); insertMention(mentionDrop.users[mentionDrop.selIdx].username); return; }
      if (e.key==="Escape")     { setMentionDrop(null); return; }
    }
    const sm = getSm();
    if (sm.style.display==="none") return;
    const items = SLASH_ITEMS.length;
    if      (e.key==="ArrowDown") { e.preventDefault(); window._smHover((_slashIdx+1)%items); }
    else if (e.key==="ArrowUp")   { e.preventDefault(); window._smHover((_slashIdx-1+items)%items); }
    else if (e.key==="Enter")     { e.preventDefault(); window._smPick(SLASH_ITEMS[_slashIdx].type); }
    else if (e.key==="Escape")    { sm.style.display="none"; }
  };

  const handleBlur = () => {
    setTimeout(() => { getSm().style.display="none"; setMentionDrop(null); }, 200);
  };

  const insertImageMarkdown = (webpUrl, originalUrl, filename) => {
    const ta  = taRef.current; if (!ta) return;
    const alt = filename.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
    const pos = ta.selectionStart;
    const cur = ta.value;
    // Only prepend a newline if the cursor isn't already at the start of a
    // line — prevents a blank line appearing above the first uploaded image.
    const needsLeadingNewline = pos > 0 && cur[pos - 1] !== "\n";
    const md  = `${needsLeadingNewline ? "\n" : ""}[![${alt}](${webpUrl})](${originalUrl})\n`;
    const newVal = cur.slice(0, pos) + md + cur.slice(pos);
    ta.value = newVal;
    onChange(newVal);
    setTimeout(() => { ta.focus(); ta.setSelectionRange(pos+md.length, pos+md.length); }, 0);
  };

  const handleImageFiles = async (files) => {
    if (!files || files.length === 0) return;
    if (!currentUser) { toast("Sign in to upload images", "err"); return; }
    setUploading(true);
    setUploadProgress({done: 0, total: files.length});
    let succeeded = 0;
    let failed = 0;
    try {
      for (const file of files) {
        try {
          const d = await api.upload("/uploads", file, {type: "post_image"});
          if (d.upload) {
            insertImageMarkdown(d.url, d.original_url, file.name);
            succeeded++;
          } else {
            failed++;
            toast(d.error || `Upload failed: ${file.name}`, "err");
          }
        } catch {
          failed++;
          toast(`Upload failed: ${file.name}`, "err");
        }
        setUploadProgress(p => ({...p, done: p.done + 1}));
      }
      if (succeeded > 0 && failed === 0) {
        toast(succeeded === 1 ? "Image uploaded" : `${succeeded} images uploaded`);
      }
    } finally {
      setUploading(false);
      setUploadProgress({done: 0, total: 0});
      if (imgInputRef.current) imgInputRef.current.value = "";
    }
  };

  return (
    <div ref={wrapRef} style={{position:"relative",display:"flex",flexDirection:"column",flex:1,height:"100%"}}>
      {/* Toolbar */}
      <div className="comp-toolbar" ref={toolbarRef}>
        {(()=>{
          // Determine if the current user can upload images (UX hint only — backend enforces the real gate).
          // Reads window._postCfg.who_can_upload which is set from the public branding endpoint.
          const canUploadImages = (()=>{
            const gate = window._postCfg?.who_can_upload;
            if (!gate || !currentUser) return !!currentUser; // default: any logged-in user
            const role   = typeof gate === "string" ? gate : (gate.role || "member");
            const groups = typeof gate === "object"  ? (gate.groups || []) : [];
            const uRole  = currentUser.role || "member";
            const LEVELS = {everyone:0, member:1, moderator:2, admin:3};
            const rolePasses = (LEVELS[uRole]||1) >= (LEVELS[role]||1);
            // Group check: currentUser doesn't carry group slugs in the auth token,
            // so we can only grant via role client-side. The backend is authoritative.
            return rolePasses || groups.length > 0; // if groups exist, optimistically show button
          })();

          const allBtns = (toolbarItems||getAllToolbarButtons())
            .filter(b => !b.hidden)
            .filter(b => !(b._ext && typeof b.onClick !== "function"))
            .filter(b => canUploadImages || (b.type !== "image" && b.type !== "grid"));

          // On desktop, split into visible and overflow sets.
          // overflowIdx===null means everything fits; otherwise items from
          // overflowIdx onward go into the ⋯ dropdown.
          const isMobileView = window.innerWidth <= 767;
          const visibleBtns  = (!isMobileView && overflowIdx !== null) ? allBtns.slice(0, overflowIdx) : allBtns;
          const overflowBtns = (!isMobileView && overflowIdx !== null) ? allBtns.slice(overflowIdx)    : [];

          // Strip trailing separators from the visible set and leading
          // separators from the overflow set.
          while (visibleBtns.length > 0 && visibleBtns[visibleBtns.length - 1].sep) visibleBtns.pop();
          while (overflowBtns.length > 0 && overflowBtns[0].sep) overflowBtns.shift();

          const renderBtn = (b, i, inOverflow=false) => {
            if (b.sep) return <div key={i} className={inOverflow ? undefined : "comp-tb-sep"}
              style={inOverflow ? {height:"0.5px",background:"var(--b1)",margin:"2px 4px"} : undefined}/>;
            if (b._ext) return (
              <button key={b.type} className="comp-tb-btn" title={b.tip}
                onMouseDown={e=>{
                  e.preventDefault();
                  if (inOverflow) setOverflowOpen(false);
                  // Toolbar button onClick is called with a single context
                  // object: { attach, currentUser, context }. Extensions
                  // destructure what they need.
                  //   - attach({kind, data}) — attach side-data to the
                  //     in-flight composition. The kind must match an
                  //     entry in the extension's manifest side_data.
                  //   - currentUser — the logged-in user, or null
                  //   - context — "post" | "reply" | null
                  b.onClick && b.onClick({ attach, currentUser, context });
                }}>
                <i className={b.label} style={{fontSize:16}}/>
              </button>
            );
            if (b.type==="emoji") return (
              <button key="emoji" ref={emojiAnchorRef} className={`comp-tb-btn${emojiOpen?" comp-tb-btn--active":""}`} title="Emoji"
                onMouseDown={e=>{e.preventDefault(); if(inOverflow)setOverflowOpen(false); toggleEmoji();}}>
                <i className="fa-solid fa-face-smile" style={{fontSize:16}}/>
              </button>
            );
            if (b.type==="image") return (
              <label key="image" className="comp-tb-btn" htmlFor="comp-img-input" title="Upload image" style={{cursor:"pointer"}}
                onMouseDown={inOverflow ? ()=>setOverflowOpen(false) : undefined}>
                {uploading
                  ? <i className="fa-solid fa-spinner fa-spin" style={{fontSize:16}}/>
                  : <i className="fa-solid fa-image" style={{fontSize:16}}/>}
              </label>
            );
            if (b.list) return (
              <button key={b.type} className="comp-tb-btn" title={b.tip}
                onMouseDown={e=>{e.preventDefault(); if(inOverflow)setOverflowOpen(false); applyList(b.list);}}>
                <i className={b.label} style={{fontSize:16}}/>
              </button>
            );
            if (b.grid) return (
              <button key={b.type} className="comp-tb-btn" title={b.tip}
                onMouseDown={e=>{e.preventDefault(); if(inOverflow)setOverflowOpen(false); applyGrid();}}>
                <i className={b.label} style={{fontSize:16}}/>
              </button>
            );
            return (
              <button key={b.type} className="comp-tb-btn" title={b.tip}
                style={b.style} onMouseDown={e=>{e.preventDefault(); if(inOverflow)setOverflowOpen(false); applyFormat(b.wrap);}}>
                {b.label}
              </button>
            );
          };

          return (
            <>
              {visibleBtns.map((b,i) => renderBtn(b, i, false))}
              {overflowBtns.length > 0 && (
                <button
                  ref={overflowBtnRef}
                  className={`comp-tb-btn${overflowOpen?" comp-tb-btn--active":""}`}
                  title="More"
                  onMouseDown={e=>{e.preventDefault();setOverflowOpen(o=>!o);}}>
                  <i className="fa-solid fa-ellipsis" style={{fontSize:14}}/>
                </button>
              )}
            </>
          );
        })()}
        <div style={{flex:1}}/>
        <button className="comp-tb-btn" title="Preview"
          onMouseDown={e=>{e.preventDefault();setShowPreview(p=>!p);}}
          style={{color:showPreview?"var(--ac)":"inherit",opacity:showPreview?1:0.6}}>
          <i className="fa-regular fa-eye" style={{fontSize:16}}/>
        </button>
      </div>

      {/* Upload progress bar — visible only while uploading multiple images */}
      {uploading && uploadProgress.total > 1 && (
        <div style={{height:2, background:"var(--b1)", flexShrink:0, overflow:"hidden"}}>
          <div style={{
            height:"100%",
            background:"var(--ac)",
            width: uploadProgress.total > 0
              ? `${Math.round((uploadProgress.done / uploadProgress.total) * 100)}%`
              : "0%",
            transition:"width .2s ease",
          }}/>
        </div>
      )}

      {/* Placeholder */}
      {!value && !isFocused && (
        <div className="comp-placeholder" style={{position:"absolute",top:toolbarH,left:0,fontSize:15,color:"var(--t4)",pointerEvents:"none",lineHeight:1.75,padding:"8px 4px"}}>
          {placeholder}
        </div>
      )}

      {/* Textarea */}
      <textarea
        ref={taRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={()=>setIsFocused(true)}
        onBlur={e=>{saveCursor();handleBlur(e);setIsFocused(false);}}
        autoFocus={autoFocus}
        className="comp-ta"
        style={{minHeight, paddingTop:12, paddingBottom:12}}
        onPaste={e=>{
          const files = Array.from(e.clipboardData?.files||[]).filter(f=>f.type.startsWith("image/"));
          if (files.length > 0) { e.preventDefault(); handleImageFiles(files); }
        }}
        onDrop={e=>{
          const files = Array.from(e.dataTransfer?.files||[]).filter(f=>f.type.startsWith("image/"));
          if (files.length > 0) { e.preventDefault(); handleImageFiles(files); }
        }}
        onDragOver={e=>e.preventDefault()}
      />

      {/* Preview modal */}
      {showPreview && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,padding:20}}
          onClick={e=>{if(e.target===e.currentTarget)setShowPreview(false);}}>
          <div style={{background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:16,width:"100%",maxWidth:680,maxHeight:"80vh",display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 8px 40px rgba(0,0,0,0.5)"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 20px",borderBottom:"0.5px solid var(--b1)",flexShrink:0}}>
              <span style={{fontSize:13,fontWeight:500,color:"var(--t2)"}}>Preview</span>
              <button onClick={()=>setShowPreview(false)} style={{background:"none",border:"none",color:"var(--t4)",fontSize:18,cursor:"pointer",lineHeight:1}}>✕</button>
            </div>
            <div style={{overflowY:"auto",padding:"20px 24px",flex:1}}>
              {value.trim()
                ? <div className="md-body"><Md text={value}/></div>
                : <div style={{color:"var(--t5)",fontSize:13,fontStyle:"italic"}}>Nothing to preview yet.</div>}
            </div>
          </div>
        </div>
      )}

      {/* @mention dropdown */}
      {mentionDrop && (
        <div className="mention-drop" style={{left:mentionDrop.x, top:mentionDrop.y, transform:"translateY(-100%)"}}>
          {mentionDrop.users.map((u,i)=>(
            <div key={u.id} className={`mention-item ${i===mentionDrop.selIdx?"sel":""}`}
              onMouseDown={e=>{e.preventDefault();insertMention(u.username);}}>
              <Av user={u} size={28} />
              <span className="mention-name">@{u.username}</span>
            </div>
          ))}
        </div>
      )}

      {/* Overflow toolbar menu — React component that renders a body-appended DOM portal
           to escape the overflow:hidden ancestors (composer-shell, composer-inner).
           Positioned via getBoundingClientRect on the ⋯ button each time it opens. */}
      {overflowOpen && <OverflowMenuPortal
        overflowBtnRef={overflowBtnRef}
        toolbarItems={toolbarItems}
        overflowIdx={overflowIdx}
        emojiAnchorRef={emojiAnchorRef}
        emojiOpen={emojiOpen}
        uploading={uploading}
        onClose={()=>setOverflowOpen(false)}
        onEmoji={()=>{setOverflowOpen(false);toggleEmoji();}}
        onFormat={wrap=>{setOverflowOpen(false);applyFormat(wrap);}}
        onList={list=>{setOverflowOpen(false);applyList(list);}}
        onGrid={()=>{setOverflowOpen(false);applyGrid();}}
        onExt={(b)=>{setOverflowOpen(false);b.onClick&&b.onClick({attach,currentUser,context});}}
        attach={attach}
        currentUser={currentUser}
        context={context}
      />}

      {/* Emoji picker popup (desktop) / bottom sheet (mobile) */}
      {emojiOpen && <EmojiPickerPortal isMobile={isMobile()} anchorRef={emojiAnchorRef} onSelectRef={onSelectRef}/>}

      {/* Hidden file input */}
      <input
        id="comp-img-input"
        ref={imgInputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
        style={{display:"none"}}
        onChange={e=>handleImageFiles(Array.from(e.target.files||[]).filter(f=>f.type.startsWith("image/")))}
      />
    </div>
  );
}
