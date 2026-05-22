import { useState, useEffect, useRef } from "react";
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
function EmojiPickerPortal({isMobile, anchorRef, onSelectRef}) {
  useEffect(() => {
    const el = document.createElement("div");
    el.id = "nexus-emoji-picker-wrap";
    el.className = isMobile ? "emoji-picker-sheet" : "emoji-picker-popup";
    document.body.appendChild(el);

    // Desktop: position above the toolbar button, clamped to viewport
    if (!isMobile && anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const pickerH = 386;
      const spaceAbove = rect.top - 8;
      el.style.top    = (spaceAbove >= pickerH ? rect.top - pickerH : 8) + "px";
      el.style.left   = Math.max(4, Math.min(rect.left, window.innerWidth - 324)) + "px";
      el.style.bottom = "auto";
    }

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
    }, 0);

    return () => {
      clearTimeout(tid);
      if (document.body.contains(el)) document.body.removeChild(el);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export function RichTextArea({value, onChange, placeholder, minHeight=200, autoFocus=false, currentUser=null, toolbarItems=null, linkedGames=null, setLinkedGames=null, context=null}) {
  // Resolve toolbar: explicit prop > context-specific active toolbar > getAllToolbarButtons()
  if(!toolbarItems) {
    if(context === "post")  toolbarItems = _activePostToolbar  || getAllToolbarButtons();
    else if(context === "reply") toolbarItems = _activeReplyToolbar || getAllToolbarButtons();
    else toolbarItems = _activePostToolbar || getAllToolbarButtons();
  }
  const toolbarLinkedGames     = linkedGames || [];
  const toolbarSetLinkedGames  = setLinkedGames || (() => {});

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
  const [uploading, setUploading] = useState(false);

  // Track toolbar height so the placeholder stays below it even when the
  // toolbar wraps to multiple rows on narrow screens.
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setToolbarH(el.offsetHeight));
    ro.observe(el);
    setToolbarH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

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
    script.src = "https://cdn.jsdelivr.net/npm/emoji-mart@latest/dist/browser.js";
    script.onload = () => {
      // emoji-mart browser build needs its data initialised before the picker renders
      fetch("https://cdn.jsdelivr.net/npm/@emoji-mart/data")
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
    const md  = `\n[![${alt}](${webpUrl})](${originalUrl})\n`;
    const pos = ta.selectionStart;
    const newVal = value.slice(0, pos) + md + value.slice(pos);
    onChange(newVal);
    setTimeout(() => { ta.focus(); ta.setSelectionRange(pos+md.length, pos+md.length); }, 0);
  };

  const handleImageFile = async (file) => {
    if (!file) return;
    if (!currentUser) { toast("Sign in to upload images", "err"); return; }
    setUploading(true);
    try {
      const fd  = new FormData();
      fd.append("file", file);
      fd.append("type", "post_image");
      const token = localStorage.getItem("nexus_token");
      const r = await fetch("/api/v1/uploads", {
        method:  "POST",
        headers: { Authorization: `Bearer ${token}` },
        body:    fd,
      });
      const d = await r.json();
      if (d.upload) {
        insertImageMarkdown(d.url, d.original_url, file.name);
        toast("Image uploaded");
      } else {
        toast(d.error || "Upload failed", "err");
      }
    } catch {
      toast("Upload failed", "err");
    } finally {
      setUploading(false);
      if (imgInputRef.current) imgInputRef.current.value = "";
    }
  };

  return (
    <div ref={wrapRef} style={{position:"relative",display:"flex",flexDirection:"column",flex:1,height:"100%"}}>
      {/* Toolbar */}
      <div className="comp-toolbar" ref={toolbarRef}>
        {(toolbarItems||getAllToolbarButtons())
          .filter(b => !b.hidden)
          .filter(b => !(b._ext && typeof b.onClick !== "function"))   // drop orphans from uninstalled extensions
          .map((b,i)=> b.sep
          ? <div key={i} className="comp-tb-sep"/>
          : b._ext
            ? <button key={b.type} className="comp-tb-btn" title={b.tip}
                onMouseDown={e=>{e.preventDefault(); b.onClick && b.onClick(toolbarLinkedGames, toolbarSetLinkedGames);}}>
                <i className={b.label} style={{fontSize:16}}/>
              </button>
            : b.type==="emoji"
              ? <button key="emoji" ref={emojiAnchorRef} className={`comp-tb-btn${emojiOpen?" comp-tb-btn--active":""}`} title="Emoji"
                  onMouseDown={e=>{e.preventDefault(); toggleEmoji();}}>
                  <i className="fa-solid fa-face-smile" style={{fontSize:16}}/>
                </button>
            : b.type==="image"
              ? <label key="image" className="comp-tb-btn" htmlFor="comp-img-input" title="Upload image" style={{cursor:"pointer"}}>
                  {uploading
                    ? <i className="fa-solid fa-spinner fa-spin" style={{fontSize:16}}/>
                    : <i className="fa-solid fa-image" style={{fontSize:16}}/>}
                </label>
              : <button key={b.type} className="comp-tb-btn" title={b.tip}
                  style={b.style} onMouseDown={e=>{e.preventDefault(); applyFormat(b.wrap);}}>
                  {b.label}
                </button>
        )}
        <div style={{flex:1}}/>
        <button className="comp-tb-btn" title="Preview"
          onMouseDown={e=>{e.preventDefault();setShowPreview(p=>!p);}}
          style={{color:showPreview?"var(--ac)":"inherit",opacity:showPreview?1:0.6}}>
          <i className="fa-regular fa-eye" style={{fontSize:16}}/>
        </button>
      </div>

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
          const file = Array.from(e.clipboardData?.files||[]).find(f=>f.type.startsWith("image/"));
          if (file) { e.preventDefault(); handleImageFile(file); }
        }}
        onDrop={e=>{
          const file = Array.from(e.dataTransfer?.files||[]).find(f=>f.type.startsWith("image/"));
          if (file) { e.preventDefault(); handleImageFile(file); }
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

      {/* Emoji picker popup (desktop) / bottom sheet (mobile) */}
      {emojiOpen && <EmojiPickerPortal isMobile={isMobile()} anchorRef={emojiAnchorRef} onSelectRef={onSelectRef}/>}

      {/* Hidden file input */}
      <input
        id="comp-img-input"
        ref={imgInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
        style={{display:"none"}}
        onChange={e=>handleImageFile(e.target.files[0])}
      />
    </div>
  );
}
