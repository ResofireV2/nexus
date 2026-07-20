import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom/client";
// Namespace imports used to populate window.__nexusRuntime for the admin
// bundle (see below). These reference the same module instances the main app
// already uses; esbuild dedupes them with the named imports elsewhere.
import * as _rjsx     from "react/jsx-runtime";
import * as _api      from "./lib/api";
import * as _utils    from "./lib/utils";
import * as _avatar   from "./components/Avatar";
import * as _markdown from "./components/Markdown";
import * as _select   from "./components/Select";
import * as _toasts   from "./components/Toasts";
import * as _rta      from "./components/RichTextArea";
import * as _pgp      from "./components/PermissionGatePicker";
import * as _updates  from "./pages/UpdatesPanel";
import DOMPurify from "dompurify";
import { api }                                              from "./lib/api";
window._nexusApi = api;
import { ago, fmtDate, fmtMsgTime, fmtDaySep, fmtBytes,
         SPACE_COLORS, userColor, spaceColor, formatApiErrors }             from "./lib/utils";
import { RsAv, Av, openUserCard, useUserCard,
         UserCardPopover }                                 from "./components/Avatar";
import { Select, Toggle }                                  from "./components/Select";
import { toast, Toasts }                                   from "./components/Toasts";
import { Md, renderMd }                                    from "./components/Markdown";
import "./components/LinkPreviewCard";
import { onLinkPreviewReady, registerFreshUrls } from "./components/LinkPreviewCard";
window._lpRegisterFresh = registerFreshUrls;
import { REACTIONS, ReactionsModal, ReactionButton }       from "./components/Reactions";
import { RichTextArea, getAllToolbarButtons,
         setActivePostToolbar, setActiveReplyToolbar, TB_BTNS } from "./components/RichTextArea";
import { F, ColorPicker, formatUptime }                    from "./admin/FormHelpers";
import { ReportCard, ModerationPage, AdminModerationPanel } from "./admin/AdminModeration";
import { RARITY_COLOR, RARITY_BG, RARITY_WEIGHT,
         BadgesPageSidebar, BadgesPage,
         AdminBadgesPanel, TRIGGER_TYPE_LABELS }           from "./admin/AdminBadges";
import { AdminPwaPanel, IosInstallPrompt }                 from "./admin/AdminPwaPanel";
// AdminPage is now lazy-loaded from the separate admin.js bundle — see
// loadAdminBundle() / LazyAdmin below. VerifyEmailPage and MagicLoginPage were
// extracted from AdminPage.jsx into pages/AuthPages so the main bundle can serve
// the verify-email and magic-login routes without pulling in the admin tree.
import { VerifyEmailPage, MagicLoginPage }                 from "./pages/AuthPages";
import { LeaderboardPageSidebar,
         LeaderboardPage }                                 from "./pages/LeaderboardPage";
import { PostScrubber, PostPage, PostFooterSlot,
         ProfileSidebarSlot, EditHistoryModal,
         MobileScrubberBar, MobileScrubberSheet }          from "./pages/PostPage";
import { DMInboxPage, DMPage,
         GroupSettingsModal, DMNewPage }                   from "./pages/MessagesPage";
import { FeedPage }                                        from "./pages/FeedPage";
import { ComposePage }                                     from "./pages/ComposePage";
import { SearchPage }                                      from "./pages/SearchPage";
import { NotificationsPage }                               from "./pages/NotificationsPage";
import { ProfilePage }                                     from "./pages/ProfilePage";
import { UpdatesPanel }                                    from "./pages/UpdatesPanel";
import { AppearanceTab, SettingsPage }                     from "./pages/SettingsPage";
import { SavedPage }                                       from "./pages/SavedPage";
import { TagsPage }                                        from "./pages/TagsPage";
import { MemberCard, MembersPage }                         from "./pages/MembersPage";
import { DraftsPage, useDraftAutosave }                    from "./pages/DraftsPage";

// Expose React and ReactDOM globally so extension bundles can access them
window.React = React;
window.ReactDOM = ReactDOM;

// Shared-runtime registry for the lazily-loaded admin bundle (admin.js).
// The admin build (see build.js) externalizes these modules to the entries
// below instead of bundling its own copies, so the admin panel uses the main
// app's single instances: the same React (required for hooks), the same api
// client (whose module-level install-prompt listeners must not run twice), and
// the same singleton state (toast queue, user-card popover).
window.__nexusRuntime = {
  "react":                            React,
  "react/jsx-runtime":                _rjsx,
  "lib/api":                          _api,
  "lib/utils":                        _utils,
  "components/Avatar":                _avatar,
  "components/Markdown":              _markdown,
  "components/Select":                _select,
  "components/Toasts":                _toasts,
  "components/RichTextArea":          _rta,
  "components/PermissionGatePicker":  _pgp,
  "pages/UpdatesPanel":               _updates,
};

// ── Lazy admin bundle loader ──────────────────────────────────────────────────
// Loads admin.js on demand (injecting a <script> for its digested URL, provided
// by the server as window.__nexusAdminBundleUrl) the first time an admin opens
// /admin. Idempotent: subsequent calls resolve immediately once NexusAdmin is
// present.
let _adminBundlePromise = null;
function loadAdminBundle() {
  if (window.NexusAdmin) return Promise.resolve(window.NexusAdmin);
  if (_adminBundlePromise) return _adminBundlePromise;
  _adminBundlePromise = new Promise((resolve, reject) => {
    const url = window.__nexusAdminBundleUrl || "/assets/admin.js";
    const s = document.createElement("script");
    s.src = url;
    s.async = true;
    s.onload = () =>
      window.NexusAdmin
        ? resolve(window.NexusAdmin)
        : reject(new Error("admin bundle loaded but window.NexusAdmin is missing"));
    s.onerror = () => { _adminBundlePromise = null; reject(new Error("failed to load admin bundle")); };
    document.head.appendChild(s);
  });
  return _adminBundlePromise;
}

// Optional prefetch — call to warm the cache (e.g. on admin-nav hover) so the
// panel opens instantly. Safe to call repeatedly.
function prefetchAdminBundle() { loadAdminBundle().catch(() => {}); }
window._prefetchAdminBundle = prefetchAdminBundle;

// Renders the admin panel from the lazily-loaded bundle, showing a lightweight
// loading state while admin.js downloads. Drop-in replacement for <AdminPage/>.
function LazyAdmin(props) {
  const [Comp, setComp] = useState(() => (window.NexusAdmin ? window.NexusAdmin.AdminPage : null));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (Comp) return;
    let alive = true;
    loadAdminBundle()
      .then(m => { if (alive) setComp(() => m.AdminPage); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [Comp]);

  if (failed) {
    return (
      <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,color:"var(--t4)"}}>
        <div>Couldn’t load the admin panel.</div>
        <button className="btn-ghost" style={{fontSize:13}} onClick={()=>{ _adminBundlePromise=null; setFailed(false); }}>Try again</button>
      </div>
    );
  }
  if (!Comp) {
    return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)"}}>Loading admin…</div>;
  }
  return <Comp {...props} />;
}

// ── Lightbox — powered by Fancybox 6 ─────────────────────────────────────────
// The CSS and JS are both injected lazily to keep them off the initial page load.
//
// Root cause of the first-click-only carousel-reset-to-slide-0 bug:
// When the Fancybox CSS <link> loads it triggers a style recalculation and
// layout pass. Fancybox's Carousel listens to resize events and resets to
// page 0 when its container dimensions change. If show() is called before
// the CSS has fully applied and the layout has settled, the resize fires
// after the Carousel is open and resets it to slide 0.
//
// Fix: wait for BOTH link.onload and script.onload (ensuring CSS is parsed
// and JS is ready), then defer one requestAnimationFrame so the browser
// completes the layout pass triggered by the new stylesheet before we call
// show(). By that point the Carousel dimensions are stable and no resize
// will fire after opening.
let _fancyboxLoading = false;
let _fancyboxLoaded  = false;

function loadFancybox(callback) {
  if (_fancyboxLoaded) { callback(); return; }
  if (_fancyboxLoading) { setTimeout(() => loadFancybox(callback), 50); return; }
  _fancyboxLoading = true;

  let cssReady = false;
  let jsReady  = false;

  function onBothReady() {
    if (!cssReady || !jsReady) return;
    _fancyboxLoaded  = true;
    _fancyboxLoading = false;
    // One rAF after both resources are ready lets the browser complete the
    // layout pass triggered by the newly applied CSS before show() is called.
    requestAnimationFrame(callback);
  }

  const link    = document.createElement("link");
  link.rel      = "stylesheet";
  link.href     = "https://unpkg.com/@fancyapps/ui@6/dist/fancybox/fancybox.css";
  link.onload   = () => { cssReady = true;  onBothReady(); };
  link.onerror  = () => { cssReady = true;  onBothReady(); }; // don't block on CSS failure
  document.head.appendChild(link);

  const script   = document.createElement("script");
  script.src     = "https://unpkg.com/@fancyapps/ui@6/dist/fancybox/fancybox.umd.js";
  script.onload  = () => { jsReady = true;  onBothReady(); };
  script.onerror = () => { _fancyboxLoading = false; };
  document.head.appendChild(script);
}

function openFancybox(items, startIndex) {
  loadFancybox(() => {
    if (!window.Fancybox) return;
    // Build gallery items. src is the WebP (fast-loading, shown in lightbox).
    // originalSrc is the raw uploaded file — only used for the "View original"
    // toolbar link that opens it in a new tab. thumbSrc is also the WebP so
    // the thumbnail strip loads quickly.
    //
    // Fancybox 6 does not carry arbitrary custom properties through to its
    // internal slide objects, so originalSrc set on a gallery entry is lost
    // by the time the toolbar click handler runs. We keep a side map keyed
    // by gallery index and look up from there instead.
    const originalSrcByIndex = {};
    const gallery = items.map((item, i) => {
      const webp     = item.src;
      const original = item.originalSrc || item.src;
      const entry = { src: webp, type: "image" };
      if (original && original !== webp) {
        entry.thumbSrc = webp;
        originalSrcByIndex[i] = original;
      }
      return entry;
    });
    const idx = startIndex ?? 0;
    // Build the toolbar items list. "viewOriginal" is a custom button that
    // appears only when at least one slide has a distinct original file.
    const hasAnyOriginal = Object.keys(originalSrcByIndex).length > 0;
    const toolbarRight = hasAnyOriginal
      ? ["viewOriginal", "autoplay", "fullscreen", "thumbs", "close"]
      : ["autoplay", "fullscreen", "thumbs", "close"];
    window.Fancybox.show(gallery, {
      startIndex: idx,
      Carousel: {
        Thumbs: { type: "classic" },
        Toolbar: {
          items: {
            viewOriginal: {
              tpl: '<a class="f-button" title="View original" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>',
              click() {
                const instance = window.Fancybox.getInstance();
                const index    = instance?.getSlide()?.index ?? 0;
                const url      = originalSrcByIndex[index];
                if (url) window.open(url, "_blank", "noopener");
              },
            },
          },
          display: {
            left:   ["counter"],
            middle: [],
            right:  toolbarRight,
          },
        },
      },
    });
  });
}

// YouTube lite embed — click thumbnail to load and play video
document.addEventListener("click", e => {
  const yt = e.target.closest(".yt-lite:not(.active)");
  if (!yt) return;
  const id = yt.getAttribute("data-id");
  if (!id) return;
  yt.classList.add("active");
  const iframe = document.createElement("iframe");
  iframe.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
  iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
  iframe.allowFullscreen = true;
  yt.appendChild(iframe);
});

// ── CompositionTracker ────────────────────────────────────────────────────────
// Attached to a textarea or contenteditable element when the composer mounts.
// Records typing cadence, keystrokes, and paste events. Call snapshot() on
// submit to get the metadata object sent alongside the post/reply body.
class CompositionTracker {
  constructor(el) {
    this._el = el;
    this._openedAt = Date.now();
    this._activeMs = 0;
    this._activeStart = null;
    this._keystrokes = 0;
    this._firstKeystroke = null;
    this._pasteEvents = [];
    this._focusCount = 0;
    this._hasFocus = false;
    this._visible = document.visibilityState !== "hidden";

    this._onFocus     = () => { this._hasFocus = true;  this._focusCount++; this._startActive(); };
    this._onBlur      = () => { this._hasFocus = false; this._pauseActive(); };
    this._onKeydown   = (e) => {
      if (["Shift","Control","Alt","Meta","CapsLock","Tab"].includes(e.key)) return;
      this._keystrokes++;
      if (!this._firstKeystroke) this._firstKeystroke = Date.now();
    };
    this._onPaste     = (e) => {
      const text = e.clipboardData?.getData("text/plain") ?? "";
      this._pasteEvents.push({ at: Date.now(), chars: text.length });
    };
    this._onVisibility = () => {
      this._visible = document.visibilityState !== "hidden";
      this._visible ? this._startActive() : this._pauseActive();
    };

    el.addEventListener("focus",     this._onFocus);
    el.addEventListener("blur",      this._onBlur);
    el.addEventListener("keydown",   this._onKeydown);
    el.addEventListener("paste",     this._onPaste);
    document.addEventListener("visibilitychange", this._onVisibility);
  }

  _startActive() {
    if (this._hasFocus && this._visible && !this._activeStart) {
      this._activeStart = Date.now();
    }
  }

  _pauseActive() {
    if (this._activeStart) {
      this._activeMs += Date.now() - this._activeStart;
      this._activeStart = null;
    }
  }

  snapshot() {
    const now = Date.now();
    let activeMs = this._activeMs;
    if (this._activeStart) activeMs += now - this._activeStart;
    return {
      schemaVersion:    1,
      composerOpenedAt: this._openedAt,
      submittedAt:      now,
      activeMs,
      keystrokeCount:   this._keystrokes,
      firstKeystrokeAt: this._firstKeystroke,
      pasteEvents:      [...this._pasteEvents],
      focusGainedCount: this._focusCount,
      finalCharCount:   (this._el.value !== undefined)
                          ? this._el.value.length
                          : (this._el.textContent || "").length,
    };
  }

  destroy() {
    this._pauseActive();
    this._el.removeEventListener("focus",     this._onFocus);
    this._el.removeEventListener("blur",      this._onBlur);
    this._el.removeEventListener("keydown",   this._onKeydown);
    this._el.removeEventListener("paste",     this._onPaste);
    document.removeEventListener("visibilitychange", this._onVisibility);
  }
}

// X / Twitter oEmbed — hydrate .md-x-embed placeholders using Twitter's oEmbed API
function hydrateXEmbeds(root) {
  const nodes = (root || document).querySelectorAll(".md-x-embed[data-tweet-id]:not([data-loaded])");
  nodes.forEach(node => {
    node.setAttribute("data-loaded", "1");
    const id = node.getAttribute("data-tweet-id");
    const url = `https://publish.twitter.com/oembed?url=https://twitter.com/x/status/${id}&omit_script=true&dnt=true`;
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error("unavailable");
        return r.json();
      })
      .then(data => {
        if (!data.html) throw new Error("empty");
        node.innerHTML = DOMPurify.sanitize(data.html, {ADD_TAGS: ["twitter-widget"], ADD_ATTR: ["async", "charset", "src"]});
        if (window.twttr && window.twttr.widgets) window.twttr.widgets.load(node);
      })
      .catch(() => {
        node.innerHTML = `<a href="https://x.com/i/status/${id}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:8px;padding:14px;font-size:13px;color:var(--t3);text-decoration:none;"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.741l7.73-8.835L1.254 2.25H8.08l4.259 5.631 5.905-5.631zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg> View post on X</a>`;
      });
  });
}
// Load Twitter widget script once on demand
let _twttrScriptLoaded = false;
function loadTwttrScript() {
  if (_twttrScriptLoaded) return;
  _twttrScriptLoaded = true;
  const s = document.createElement("script");
  s.src = "https://platform.twitter.com/widgets.js";
  s.async = true;
  document.head.appendChild(s);
}
// Run on initial load and after React re-renders settle
document.addEventListener("DOMContentLoaded", () => { if (document.querySelector(".md-x-embed")) { loadTwttrScript(); hydrateXEmbeds(); } });
const _xObserver = new MutationObserver(() => {
  if (document.querySelector(".md-x-embed[data-tweet-id]:not([data-loaded])")) { loadTwttrScript(); hydrateXEmbeds(); }
});
_xObserver.observe(document.body, { childList: true, subtree: true });

// Expose CompositionTracker so page components can instantiate it
window.CompositionTracker = CompositionTracker;
// useLightbox is kept as a no-op for compatibility — Fancybox 5 handles everything
let _lbSetState = null;
function useLightbox() {
  return [null, () => {}];
}
// Global trigger for external callers (extensions etc.)
window._lbSetState = (item) => {
  if (!item) return;
  const items = item.slides || [item];
  openFancybox(items, item.slideIndex || 0);
};
window._openFancybox = openFancybox;
_lbSetState = window._lbSetState;

// ── Reply reference preview popup ─────────────────────────────────────────────
let _refPopupSetState = null;
const _refDataMap = {};
window._refDataMap = _refDataMap;
function stripMd(text) {
  if (!text) return "";
  return text
    .replace(/```[\s\S]*?```/g, "[code block]")
    .replace(/`[^`]+`/g, "[code]")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>]/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Track whether the user's last interaction was touch so we can
// switch between hover-popup (desktop) and tap-popup (mobile).
// We use touchend (not touchstart) because mobile browsers fire synthetic
// mousemove/click events ~300ms after touchend — setting the flag here
// ensures it's still true when the click handler runs.
let _lastWasTouch = false;
let _touchFlagTimer = null;
document.addEventListener("touchend", () => {
  _lastWasTouch = true;
  clearTimeout(_touchFlagTimer);
  // Clear after 1s — long enough for all synthetic mouse events to fire
  _touchFlagTimer = setTimeout(() => { _lastWasTouch = false; }, 1000);
}, {passive: true});

function _showRefPopup(link) {
  const href = link.getAttribute("href") || "";
  const data = _refDataMap[href];
  if (!data) return false;
  const targetEl = document.getElementById(href.slice(1));
  if (targetEl) {
    const rect = targetEl.getBoundingClientRect();
    const inView = rect.top >= 0 && rect.bottom <= window.innerHeight;
    if (inView && !_lastWasTouch) {
      // On desktop, if visible: highlight in place instead of popup
      targetEl.classList.remove("reply-ref-highlight");
      void targetEl.offsetWidth;
      targetEl.classList.add("reply-ref-highlight");
      return false;
    }
  }
  const lr = link.getBoundingClientRect();
  // Open on whichever side has more room and hand the popup the height it can
  // actually use, instead of clipping every quote to a fixed 220px while half
  // the screen sits empty.
  const GAP = 6, EDGE = 8;
  const CHROME = 62;               // meta row + vertical padding
  const spaceBelow = window.innerHeight - lr.bottom - GAP - EDGE;
  const spaceAbove = lr.top - GAP - EDGE;
  const showBelow  = spaceBelow >= spaceAbove;
  const maxBodyH   = Math.max(140, Math.min(460, (showBelow ? spaceBelow : spaceAbove) - CHROME));
  _refPopupSetState && _refPopupSetState({
    data,
    x: Math.min(Math.max(lr.left, 8), window.innerWidth - 428),
    y: showBelow ? lr.bottom + GAP : lr.top - GAP,
    above: !showBelow,
    maxBodyH
  });
  return true;
}

let _refHideTimer = null;

// Desktop: hover to show popup
document.addEventListener("mouseover", e => {
  if (_lastWasTouch) return;
  const link = e.target.closest(".reply-ref-link");
  if (!link) return;
  clearTimeout(_refHideTimer);
  _showRefPopup(link);
});
document.addEventListener("mouseout", e => {
  if (_lastWasTouch) return;
  const link = e.target.closest(".reply-ref-link");
  if (!link) return;
  _refHideTimer = setTimeout(() => {
    _refPopupSetState && _refPopupSetState(null);
  }, 120);
});

// All devices: intercept clicks on reply-ref-link
// Desktop: close popup and scroll to target
// Mobile: show popup (suppress navigation entirely)
document.addEventListener("click", e => {
  const link = e.target.closest(".reply-ref-link");
  if (!link) {
    // Click outside popup dismisses it
    if (!e.target.closest(".ref-popup")) {
      _refPopupSetState && _refPopupSetState(null);
    }
    return;
  }
  e.preventDefault();
  if (_lastWasTouch) {
    // Mobile: tap shows popup
    _showRefPopup(link);
  } else {
    // Desktop: close popup and scroll to target
    _refPopupSetState && _refPopupSetState(null);
    const href = link.getAttribute("href") || "";
    const targetEl = document.getElementById(href.slice(1));
    if (targetEl) {
      targetEl.scrollIntoView({behavior: "smooth", block: "center"});
      targetEl.classList.remove("reply-ref-highlight");
      void targetEl.offsetWidth;
      targetEl.classList.add("reply-ref-highlight");
    }
  }
});
// Attach delegated click handler to .md-body images once at module load.
// Uses capture phase (third arg `true`) so e.preventDefault() fires before
// any wrapping <a> tag evaluates its default action (scroll-to-hash / navigate).
// Without capture, the anchor default is committed as the event passes through
// the <a> during bubbling — before our document-level listener ever runs.
// This is the root cause of the first-click-only scroll-to-top bug: on first
// click Fancybox hasn't loaded yet so nothing suppresses the anchor scroll,
// whereas on subsequent clicks Fancybox is already open and masks it visually.
document.addEventListener("click", e => {
  // Handle mention link clicks — SPA navigation
  const mention = e.target.closest(".mention-link");
  if (mention) {
    e.preventDefault();
    const username = mention.getAttribute("data-mention");
    if (username && window._nexusNavigate) window._nexusNavigate("profile", {username});
    return;
  }
  const img = e.target.closest(".md-body img");
  if (!img) return;
  // Don't intercept YouTube lite embed thumbnails — let the yt handler take it
  if (img.closest(".yt-lite")) return;
  // Don't intercept link preview card images — the wrapping <a> handles the click
  if (img.closest(".md-link-preview")) return;
  e.preventDefault();
  e.stopPropagation();
  // If the clicked image is inside a [grid] block, scope the gallery to only
  // that grid's images (isolated by data-gallery). Otherwise collect all
  // images in the .md-body for the post-wide gallery.
  const grid = img.closest(".md-grid");
  let allImgs;
  if (grid) {
    allImgs = [...grid.querySelectorAll("img")];
  } else {
    const body = img.closest(".md-body");
    allImgs = body
      ? [...body.querySelectorAll("img:not(.yt-lite img):not(.md-link-preview img):not(.md-grid img)")]
      : [img];
  }
  const items = allImgs.map(i => ({ src: i.src, originalSrc: i.getAttribute("data-original") || i.src }));
  const startIdx = allImgs.indexOf(img);
  // Blur before opening — prevents browser scroll-into-view on first Fancybox load.
  img.blur();
  openFancybox(items, startIdx < 0 ? 0 : startIdx);
}, true);

function useRefPreview() {
  const [popup, setPopup] = useState(null);
  useEffect(()=>{ _refPopupSetState = setPopup; return ()=>{ _refPopupSetState=null; }; }, []);
  return popup;
}

function RefPreviewPopup() {
  const popup = useRefPreview();
  const bodyRef = useRef(null);
  const [clipped, setClipped] = useState(false);
  const bodyText = popup ? stripMd(popup.data.body).slice(0, 1200) : "";

  // The bottom fade must only be drawn when the text is genuinely cut off.
  // Applied unconditionally it sat on top of short quotes — a one-line reply
  // was rendered almost unreadable under the gradient.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) { setClipped(false); return; }
    setClipped(el.scrollHeight > el.clientHeight + 1);
  }, [popup, bodyText]);

  if (!popup) return null;
  const { data, x, y, above, maxBodyH } = popup;
  const col = userColor({id: data.userId, avatar_color: data.userAvatarColor});
  return (
    <div className="ref-popup" style={{
      left: x,
      top: Math.max(8, y),
      transform: above ? "translateY(-100%)" : "translateY(0)",
      pointerEvents: "auto"
    }}
      onMouseEnter={()=>clearTimeout(_refHideTimer)}
      onMouseLeave={()=>{ _refHideTimer = setTimeout(()=>{ _refPopupSetState && _refPopupSetState(null); }, 120); }}
    >
      <div className="ref-popup-meta">
        <RsAv user={{username:data.username,avatar_url:data.avatar_url,avatar_color:data.userAvatarColor}} size={26} noCard />
        <span className="ref-popup-username">{data.username}</span>
        <span className="ref-popup-time">{ago(data.inserted_at)}</span>
        <button onClick={()=>_refPopupSetState&&_refPopupSetState(null)}
          style={{marginLeft:"auto",background:"none",border:"none",color:"var(--t5)",cursor:"pointer",fontSize:14,lineHeight:1,padding:"0 2px",flexShrink:0}}>×</button>
      </div>
      <div ref={bodyRef}
        className={"ref-popup-body" + (clipped ? " is-clipped" : "")}
        style={maxBodyH ? {maxHeight: maxBodyH} : undefined}>{bodyText}</div>
    </div>
  );
}


// ── Manifest cross-check ─────────────────────────────────────────────────────
// At register-time, each register* call on NexusExtensions verifies that what
// it's registering was declared in the extension's manifest.json. Undeclared
// registrations log a console warning and accumulate in
// window._nexusExtensionMismatches[slug] so the admin runtime panel can
// surface them. The registration itself still goes through — Nexus does not
// break the UI mid-render over a developer-feedback issue.
//
// `kind` is the manifest field to check (e.g. "slots", "routes",
// "right_widgets", "toolbar_buttons", "hooks", "admin_panel", "explore").
// `value` is the specific item being registered: a slot name string, a route
// path, a widget id, etc. — whatever uniquely identifies the registration
// within its kind.
//
// For object-shaped manifest fields (admin_panel, explore — declared as a
// single object, not an array), pass kind="admin_panel" or kind="explore"
// and value=true; presence of the manifest field is all we check.
//
// If `window._nexusExtensionManifests` is not present (development without
// installed extensions, or a page that doesn't inject the map), validation is
// silently skipped.
function _validateAgainstManifest(slug, kind, value) {
  var manifests = window._nexusExtensionManifests;
  if (!manifests) return;  // no manifests injected → skip validation

  var manifest = manifests[slug];
  if (!manifest) {
    // Extension is registering things but has no manifest in the page. This
    // happens during a hot-reload before the page picks up a refreshed
    // manifest map, or in dev when an extension is loaded outside the normal
    // install flow. Log once per slug and move on.
    _recordMismatch(slug, kind, value, "no manifest for slug \"" + slug + "\" available in the page");
    return;
  }

  // Singular object fields are present-or-absent; truthiness of the manifest
  // entry is enough.
  if (kind === "admin_panel" || kind === "explore") {
    if (!manifest[kind]) {
      _recordMismatch(slug, kind, value,
        "registered a " + kind + " but manifest does not declare one");
    }
    return;
  }

  // Array-of-strings fields (hooks, slots).
  if (kind === "hooks" || kind === "slots") {
    var list = manifest[kind] || [];
    if (list.indexOf(value) === -1) {
      _recordMismatch(slug, kind, value,
        "registered " + kind + " entry \"" + value + "\" but manifest does not declare it. " +
        "Declared: " + (list.length ? list.join(", ") : "(none)"));
    }
    return;
  }

  // Array-of-objects fields (routes, right_widgets, toolbar_buttons,
  // digest_sections) — entries declared by a string `id` or `path`/`key`.
  if (kind === "routes") {
    var declared = (manifest.routes || []).map(function(r){ return r.path; });
    if (declared.indexOf(value) === -1) {
      _recordMismatch(slug, "routes", value,
        "registered route path \"" + value + "\" but manifest does not declare it. " +
        "Declared: " + (declared.length ? declared.join(", ") : "(none)"));
    }
    return;
  }

  if (kind === "right_widgets" || kind === "toolbar_buttons" || kind === "digest_sections" || kind === "profile_tabs") {
    var idField = (kind === "digest_sections") ? "key" : "id";
    var declaredIds = (manifest[kind] || []).map(function(e){ return e[idField]; });
    if (declaredIds.indexOf(value) === -1) {
      _recordMismatch(slug, kind, value,
        "registered " + kind + " " + idField + " \"" + value + "\" but manifest does not declare it. " +
        "Declared: " + (declaredIds.length ? declaredIds.join(", ") : "(none)"));
    }
    return;
  }

  // Unknown kind — coding bug in the caller. Surface loudly.
  console.error("[NexusExtensions] _validateAgainstManifest called with unknown kind:", kind);
}

function _recordMismatch(slug, kind, value, message) {
  if (!window._nexusExtensionMismatches) window._nexusExtensionMismatches = {};
  if (!window._nexusExtensionMismatches[slug]) window._nexusExtensionMismatches[slug] = [];
  window._nexusExtensionMismatches[slug].push({ kind: kind, value: value, message: message });
  console.warn("[" + slug + "] " + message);
}


// ── Extension slot registry ──────────────────────────────────────────────────
// Extensions register UI slot components here at runtime via their JS bundle.
// Usage from extension bundle:
//   window.NexusExtensions.registerSlot({slug:"gamepedia", slot:"feed_sidebar", component: MyComponent});
//   window.NexusExtensions.registerRoute("gamepedia", "/users/:username", MyPage);
window.NexusExtensions = {
  _slots: {},
  _listeners: [],
  _toolbarButtons: [],
  _toolbarListeners: [],
  _routes: [],
  _routeListeners: [],
  _adminPanels: [],
  _adminPanelListeners: [],
  _exploreItems: [],
  _exploreListeners: [],

  // Set of currently-active extension slugs. Used by every getter that
  // returns extension-contributed surfaces (explore items, toolbar buttons,
  // right widgets, profile tabs, post actions, notification types, slots).
  //
  // An extension is "active" when its bundle was loaded AND it's currently
  // enabled AND it's currently installed. This set is the client-side
  // analogue of piece 5's server-side Registry.enabled? — when an admin
  // disables or uninstalls an extension, we update this set so its
  // registered surfaces stop appearing without the user reloading the page.
  //
  // The set is seeded from window._nexusExtensionManifests on bundle init
  // (server inlines that map for only enabled+loaded extensions).
  //
  // Public mutators: setExtensionActive(slug, active), removeExtension(slug).
  _activeExtensions: null,

  _isExtActive(slug) {
    if (!slug) return true;  // built-ins (no slug) always pass through
    if (this._activeExtensions === null) {
      // First read — lazy-init from the SSR'd manifest map. Any extension
      // present there is presumed active.
      this._activeExtensions = new Set();
      const manifests = window._nexusExtensionManifests || {};
      Object.keys(manifests).forEach(s => this._activeExtensions.add(s));
    }
    return this._activeExtensions.has(slug);
  },

  setExtensionActive(slug, active) {
    if (!slug) return;
    this._isExtActive(slug);  // ensure lazy init has run
    if (active) this._activeExtensions.add(slug);
    else        this._activeExtensions.delete(slug);
    // Fan out to every listener so consumers re-render.
    this._exploreListeners.forEach(fn => fn());
    this._toolbarListeners.forEach(fn => fn());
    this._rightWidgetListeners.forEach(fn => fn());
    this._profileTabListeners.forEach(fn => fn());
    this._postActionListeners.forEach(fn => fn());
    this._notifTypeListeners.forEach(fn => fn());
    this._adminPanelListeners.forEach(fn => fn());
    this._listeners.forEach(fn => fn());  // slot listeners
    this._accountActionListeners.forEach(fn => fn());
  },

  // Session set of extension slugs whose JS bundle has executed on THIS page.
  // Seeded from the bundles the server injected at page load (the enabled +
  // loaded extensions present in window._nexusExtensionManifests). Ensures an
  // extension enabled from the admin panel gets its bundle injected exactly
  // once, so its surfaces appear live without a reload.
  _loadedBundles: null,

  // Inject an extension's JS bundle into the running page if it isn't loaded
  // yet. Resolves once the script has run (its register* calls fire the surface
  // listeners) — or immediately if already loaded / no bundle. Fails soft so
  // the caller's setExtensionActive still runs on error.
  loadExtensionBundle(slug, url) {
    if (this._loadedBundles === null) {
      this._loadedBundles = new Set(Object.keys(window._nexusExtensionManifests || {}));
    }
    if (!slug || !url || this._loadedBundles.has(slug)) return Promise.resolve();
    return new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = url;
      s.defer = true;
      s.onload  = () => { this._loadedBundles.add(slug); resolve(); };
      s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  },

  isExtensionActive(slug) {
    return this._isExtActive(slug);
  },

  // Permanent removal (uninstall). Drops the slug from active set AND
  // strips its registrations from every in-memory store, so they're not
  // just hidden but actually gone.
  //
  // Surfaces strip cleanly when their registration carries a slug field.
  // Slot, toolbar, explore, right widget, profile tab, admin panel,
  // account action are all slug-tagged. Notification types are looked up
  // via the extension's declared types in the manifest. Post actions
  // currently lack slug-tagging — their cleanup happens implicitly on
  // page reload after uninstall.
  removeExtension(slug) {
    if (!slug) return;
    this._isExtActive(slug);
    this._activeExtensions.delete(slug);

    if (this._exploreItems)   this._exploreItems   = this._exploreItems.filter(i => i.slug !== slug);
    if (this._toolbarButtons) this._toolbarButtons = this._toolbarButtons.filter(b => b.config.slug !== slug);
    if (this._rightWidgets)   this._rightWidgets   = this._rightWidgets.filter(w => w.slug !== slug);
    if (this._profileTabs)    this._profileTabs    = this._profileTabs.filter(t => t.slug !== slug);
    if (this._adminPanels)    this._adminPanels    = this._adminPanels.filter(p => p.slug !== slug);
    if (this._accountActions) this._accountActions = this._accountActions.filter(a => a.slug !== slug);
    if (this._slots) {
      Object.keys(this._slots).forEach(name => {
        this._slots[name] = this._slots[name].filter(s => s.slug !== slug);
      });
    }
    // Notification types are keyed by type string; resolve via the
    // extension's manifest declaration.
    if (this._notifTypes && window._nexusExtensionManifests) {
      const mani = window._nexusExtensionManifests[slug];
      if (mani && Array.isArray(mani.notification_types)) {
        mani.notification_types.forEach(t => { delete this._notifTypes[t.key]; });
      }
    }

    // Fan out so consumers re-render with the trimmed lists.
    this._exploreListeners.forEach(fn => fn());
    this._toolbarListeners.forEach(fn => fn());
    this._rightWidgetListeners.forEach(fn => fn());
    this._profileTabListeners.forEach(fn => fn());
    this._postActionListeners.forEach(fn => fn());
    this._notifTypeListeners.forEach(fn => fn());
    this._adminPanelListeners.forEach(fn => fn());
    this._listeners.forEach(fn => fn());
    this._accountActionListeners.forEach(fn => fn());
  },
  _rightWidgets: [],
  _rightWidgetListeners: [],
  _profileTabs: [],
  _profileTabListeners: [],
  _userActions: [],
  _userActionListeners: [],
  _accountActions: [],
  _accountActionListeners: [],
  _postActions: [],
  _postActionListeners: [],
  _notifTypes: {},
  _notifTypeListeners: [],

  // Register a UI slot component.
  //
  //   slug:      extension slug — required
  //   slot:      slot name — required (must be one of the @ui_slots declared
  //              in lib/nexus/extensions/extensions.ex; e.g. "post_footer")
  //   component: React component — required
  //   priority:  lower priority renders earlier (optional, default 50)
  //
  // The slot must be declared in your manifest's `slots: [...]` array.
  // Undeclared registrations log a warning but still take effect — Nexus
  // won't break your UI mid-render over a developer-feedback issue.
  //
  // Usage from extension bundle:
  //   NE.registerSlot({
  //     slug:      "gamepedia",
  //     slot:      "post_footer",
  //     component: GameAttachmentFooter,
  //   });
  registerSlot({ slug, slot, component, priority = 50 } = {}) {
    if (typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug)) {
      console.error("[NexusExtensions] registerSlot: slug must be lowercase alphanumeric+hyphens, got:", slug);
      return;
    }
    if (typeof slot !== "string" || !slot) {
      console.error("[NexusExtensions] registerSlot: slot is required");
      return;
    }
    if (typeof component !== "function") {
      console.error("[NexusExtensions] registerSlot: component must be a React component, got:", component);
      return;
    }
    _validateAgainstManifest(slug, "slots", slot);
    if (!this._slots[slot]) this._slots[slot] = [];
    this._slots[slot].push({component, priority, slug});
    this._slots[slot].sort((a, b) => a.priority - b.priority);
    this._listeners.forEach(fn => fn(slot));
  },

  getSlot(slotName) {
    var items = this._slots[slotName] || [];
    var self  = this;
    return items.filter(function(item) { return self._isExtActive(item.slug); });
  },

  // Resolve the prop bag that components in a given slot should receive,
  // derived from a render-site context object. This is the runtime authority
  // for slot prop contracts: any field that isn't returned here doesn't
  // reach slotted components, period. There's no implicit spread of host
  // values into slots.
  //
  // The Elixir module Nexus.Extensions.SlotContracts holds the canonical
  // contract metadata (descriptions for docs/admin UI); this function holds
  // the *actual* runtime prop pipeline. The two MUST stay in sync — if you
  // declare `current_user` in a slot's contract there, you must wire it
  // here too, and vice versa.
  //
  // Usage from a host render site:
  //
  //   const components = NE.getSlot("post_footer");
  //   const props      = NE.propsForSlot("post_footer", {post});
  //   {components.map(({component: C}, i) => <C key={i} {...props}/>)}
  //
  // The context object can include anything the render site has on hand;
  // this function picks out and renames only what each slot's contract
  // declares. Extra fields are ignored without warning.
  //
  // Adding a new slot here is one step of adding a slot overall — see the
  // procedure documented in Nexus.Extensions.SlotContracts.
  propsForSlot(slotName, ctx = {}) {
    switch (slotName) {

      // post_footer — bottom of /post/:id pages, below post body, above
      // any reply thread. One render per post.
      case "post_footer":
        return {
          post_id: ctx.post?.id,
        };

      // profile_sidebar — left rail of /profile/:username pages, above the
      // profile's main content area.
      case "profile_sidebar":
        return {
          username:     ctx.username,
          current_user: ctx.current_user ?? null,
        };

      // compose_attachments — below the post body on /compose.
      // attachments is the live array; setAttachments lets the extension
      // remove items the user wants to discard before posting.
      case "compose_attachments":
        return {
          attachments:    ctx.attachments    ?? [],
          setAttachments: ctx.setAttachments ?? (() => {}),
        };

      default:
        // Unknown slot — return empty bag and warn. This catches typos at
        // render-site callers AND catches getSlot calls left behind after
        // a slot has been removed from the contract list.
        console.warn("[NexusExtensions] propsForSlot: unknown slot", slotName,
          "— check Nexus.Extensions.SlotContracts for the current slot list");
        return {};
    }
  },

  // Resolve the prop bag for a profile tab's content component. Same
  // contract philosophy as propsForSlot: only declared props reach the
  // extension's component, nothing else from the render-site context.
  //
  // Declared props for the profile_tab surface:
  //   username      — display username of the profile being viewed (string)
  //   current_user  — viewer user object or null when logged-out
  //
  // To navigate, use window.NexusExtensions.navigate(url). The viewer's id
  // and the profile owner's id are intentionally NOT passed — fetch by
  // username from your API if needed; the username is the canonical
  // identifier visible in the URL.
  propsForProfileTab(ctx = {}) {
    return {
      username:     ctx.username,
      current_user: ctx.current_user ?? null,
    };
  },

  onChange(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(f => f !== fn); };
  },

  // Register a button in the post and/or reply composer toolbar.
  //
  //   slug:     extension slug — required
  //   id:       unique within your extension (e.g. "link-game") — required
  //   icon:     full Font Awesome class string with style prefix — required
  //               "fa-solid fa-gamepad"   ✓ correct
  //               "fa-regular fa-star"    ✓ correct
  //               "fa-gamepad"            ✗ no style prefix, renders as text
  //   tip:      tooltip shown on hover — required (display only, not used for identity)
  //   onClick:  called when the button is clicked.
  //             Signature: ({ attach, currentUser, context })
  //               - attach({kind, data}) — attaches data to the in-flight
  //                 composition. The kind must match an entry in this
  //                 extension's manifest side_data field. On submit, the
  //                 attached data is dispatched to the extension's
  //                 persist_attachment/3 callback.
  //               - currentUser — the logged-in user, or null
  //               - context — "post" | "reply" | null
  //   scope:    "both" (default) | "posts" (post toolbar only) | "replies" (reply toolbar only)
  //   priority: lower numbers render before higher numbers among extension
  //             buttons (built-in buttons always come first). Default: 50.
  //
  // The internal button type is `ext:<slug>:<id>`. This identity is stable
  // across renames of the tip text — change your tip freely without losing
  // the admin's saved toolbar layout for this button. Two extensions cannot
  // collide on identity because the slug namespaces it.
  //
  // Styling: extension buttons render with the same .comp-tb-btn class as
  // built-in buttons. Custom inline styles are not supported.
  //
  // Admins can reorder and hide your button independently per toolbar in
  // Admin → Layout → Post toolbar / Reply toolbar.
  //
  // Example:
  //   NE.registerToolbarButton({
  //     slug: "my-ext",
  //     id:   "attach-note",
  //     icon: "fa-solid fa-note-sticky",
  //     tip:  "Attach a note",
  //     onClick({ attach, context }) {
  //       const note = prompt("Note text?");
  //       if (note) attach({ kind: "my_note", data: { text: note } });
  //     },
  //   });
  registerToolbarButton(config) {
    if (!config || typeof config !== "object") {
      console.error("[NexusExtensions] registerToolbarButton: config object is required");
      return;
    }
    var slug = config.slug, id = config.id;
    if (typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug)) {
      console.error("[NexusExtensions] registerToolbarButton: slug must be lowercase alphanumeric+hyphens, got:", slug);
      return;
    }
    if (typeof id !== "string" || !id) {
      console.error("[NexusExtensions] registerToolbarButton: id is required");
      return;
    }
    if (typeof config.icon !== "string" || !config.icon) {
      console.error("[NexusExtensions] registerToolbarButton: icon is required");
      return;
    }
    if (typeof config.tip !== "string" || !config.tip) {
      console.error("[NexusExtensions] registerToolbarButton: tip is required");
      return;
    }
    if (typeof config.onClick !== "function") {
      console.error("[NexusExtensions] registerToolbarButton: onClick is required");
      return;
    }
    var priority = (typeof config.priority === "number") ? config.priority : 50;
    _validateAgainstManifest(slug, "toolbar_buttons", id);
    // Drop any prior registration for the same (slug, id) so reloads don't stack duplicates.
    var typeKey = "ext:" + slug + ":" + id;
    this._toolbarButtons = this._toolbarButtons.filter(function(b) {
      return ("ext:" + b.config.slug + ":" + b.config.id) !== typeKey;
    });
    this._toolbarButtons.push({config: config, priority: priority});
    this._toolbarButtons.sort(function(a, b) { return a.priority - b.priority; });
    this._toolbarListeners.forEach(function(fn) { fn(); });
  },

  getToolbarButtons() {
    var self = this;
    return this._toolbarButtons.filter(function(b) { return self._isExtActive(b.config.slug); });
  },

  onToolbarChange(fn) {
    this._toolbarListeners.push(fn);
    return () => { this._toolbarListeners = this._toolbarListeners.filter(f => f !== fn); };
  },

  // Register a full-page route for the SPA.
  //
  // slug: extension slug — your route lives under /ext/<slug>/...
  // path: route path RELATIVE to your extension's namespace, e.g.
  //         "/"              → /ext/<slug>
  //         "/browse"        → /ext/<slug>/browse
  //         "/users/:name"   → /ext/<slug>/users/:name  (named params as props)
  // component: React component receiving ({ navigate, currentUser, ...params })
  // options: { title } — optional page title shown in the back-header
  //
  // Usage from extension bundle:
  //   NE.registerRoute("gamepedia", "/users/:username", GamelogPage, { title: "Gamelog" });
  //
  // Do not include /ext/ in the path — Nexus prefixes it automatically.
  registerRoute(slug, path, component, options = {}) {
    if (typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug)) {
      console.error("[NexusExtensions] registerRoute: slug must be lowercase alphanumeric+hyphens, got:", slug);
      return;
    }
    if (typeof path !== "string" || !path.startsWith("/")) {
      console.error("[NexusExtensions] registerRoute: path must start with /, got:", path);
      return;
    }
    if (path.startsWith("/ext/")) {
      console.error("[NexusExtensions] registerRoute: do not include /ext/ in path — Nexus prefixes it automatically. Got:", path);
      return;
    }
    _validateAgainstManifest(slug, "routes", path);

    // Build the full pattern: /ext/<slug> for path "/", otherwise /ext/<slug><path>
    const pattern = path === "/" ? `/ext/${slug}` : `/ext/${slug}${path}`;

    // Convert "/foo/:bar/:baz" → a regex that captures named groups
    const keys = [];
    const regexStr = pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, k) => {
      keys.push(k);
      return "([^/]+)";
    });
    const regex = new RegExp("^" + regexStr + "$");
    // Drop any prior registration for the same pattern so reloads don't stack duplicates.
    this._routes = this._routes.filter(r => r.pattern !== pattern);
    this._routes.push({ pattern, regex, keys, component, options, slug });
    this._routeListeners.forEach(fn => fn());
  },

  // Match a pathname against registered extension routes.
  // Returns { component, params, options, pattern } or null.
  //
  // Advanced helper — normally not needed. Routes are resolved automatically
  // when the user navigates. Use this only if you need to inspect a route
  // from inside an extension component (e.g. conditional rendering based on
  // whether a particular URL is registered).
  matchRoute(pathname) {
    for (const route of this._routes) {
      const m = pathname.match(route.regex);
      if (m) {
        const params = {};
        route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { component: route.component, params, options: route.options, pattern: route.pattern, slug: route.slug };
      }
    }
    return null;
  },

  // Reconstruct a URL for a registered pattern by filling in param values.
  //   NE.routeUrl("/ext/gamepedia/users/:username", { username: "alice" })
  //   → "/ext/gamepedia/users/alice"
  //
  // Advanced helper — normally not needed. To navigate, use NE.navigate(url)
  // with a literal URL string; you rarely need to build one from a pattern.
  routeUrl(pattern, params = {}) {
    return pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, k) =>
      params[k] !== undefined ? encodeURIComponent(params[k]) : `:${k}`
    );
  },

  // Navigate to any URL within Nexus, including extension routes.
  //
  //   NE.navigate("/ext/gamepedia/users/alice");
  //   NE.navigate("/feed");
  //
  // Resolves the URL through the same code path as a hard refresh, so click
  // navigation and hard refresh always produce identical state. Use this
  // instead of window._nexusNavigate when you have a URL string in hand.
  navigate(url) {
    if (typeof url !== "string" || !url.startsWith("/")) {
      console.error("[NexusExtensions] navigate: url must start with /, got:", url);
      return;
    }
    if (!window._nexusNavigate || !window._nexusUrlToPage) {
      console.error("[NexusExtensions] navigate: Nexus SPA not initialised yet.");
      return;
    }
    const { page, props } = window._nexusUrlToPage(url);
    window._nexusNavigate(page, props);
  },

  onRouteChange(fn) {
    this._routeListeners.push(fn);
    return () => { this._routeListeners = this._routeListeners.filter(f => f !== fn); };
  },

  // Register a custom panel in the admin sidebar under an "extensions" section.
  // Extensions call this from their bundle:
  //
  //   window.NexusExtensions.registerAdminPanel("gamepedia", {
  //     label: "Gamepedia",
  //     icon:  "fa-gamepad",          // any FA solid icon class
  //     component: MyAdminPanel,      // React component — receives no required props
  //   });
  //
  // The panel appears as a nav item in the admin sidebar under a dedicated
  // "installed extensions" section, below Forum Settings / Manage / System.
  // Clicking it renders the component in the admin content area.
  //
  // For the component, use one of the pre-built templates exposed on
  // window.NexusExtensionTemplates, or supply a fully custom component.
  registerAdminPanel(slug, { label, icon = "fa-puzzle-piece", component }) {
    _validateAgainstManifest(slug, "admin_panel", true);
    this._adminPanels = this._adminPanels.filter(p => p.slug !== slug);
    this._adminPanels.push({ slug, label, icon, component });
    this._adminPanelListeners.forEach(fn => fn());
  },

  getAdminPanels() {
    var self = this;
    return this._adminPanels.filter(function(p) { return self._isExtActive(p.slug); });
  },

  onAdminPanelChange(fn) {
    this._adminPanelListeners.push(fn);
    return () => { this._adminPanelListeners = this._adminPanelListeners.filter(f => f !== fn); };
  },

  // Register an item in the Explore section of the left sidebar.
  //
  // slug:  extension slug — the item links to /ext/<slug><path>
  // path:  route path RELATIVE to your extension's namespace (default "/")
  //          "/"            → /ext/<slug>           (your extension's home)
  //          "/browse"      → /ext/<slug>/browse
  //
  // The target path must correspond to a route you registered via
  // NE.registerRoute(slug, path, ...). When the admin clicks the item,
  // Nexus resolves the URL through the same code path as a hard refresh.
  //
  // Usage from extension bundle:
  //   NE.registerExploreItem({
  //     slug:     "gamepedia",
  //     label:    "Games",
  //     icon:     "fa-gamepad",     // any FA solid class
  //     path:     "/",              // optional — defaults to "/"
  //     id:       "gamepedia",      // optional — defaults to slug
  //     authOnly: false,            // optional — hide when not logged in
  //     priority: 50,               // optional — lower = higher up (default 50)
  //   });
  //
  // The item appears in Explore and in the Layout admin drag-to-reorder list.
  registerExploreItem({ slug, path="/", id, label, icon="fa-puzzle-piece", authOnly=false, priority=50 }) {
    if (typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug)) {
      console.error("[NexusExtensions] registerExploreItem: slug must be lowercase alphanumeric+hyphens, got:", slug);
      return;
    }
    if (typeof path !== "string" || !path.startsWith("/")) {
      console.error("[NexusExtensions] registerExploreItem: path must start with /, got:", path);
      return;
    }
    if (path.startsWith("/ext/")) {
      console.error("[NexusExtensions] registerExploreItem: do not include /ext/ in path — Nexus prefixes it automatically. Got:", path);
      return;
    }
    _validateAgainstManifest(slug, "explore", true);

    const url       = path === "/" ? `/ext/${slug}` : `/ext/${slug}${path}`;
    const itemId    = id || slug;

    this._exploreItems = this._exploreItems.filter(i => i.id !== itemId);
    this._exploreItems.push({ id: itemId, label, icon, url, slug, authOnly, priority, _ext: true });
    this._exploreItems.sort((a, b) => (a.priority||50) - (b.priority||50));
    this._exploreListeners.forEach(fn => fn());
  },

  getExploreItems() { return this._exploreItems.filter(i => this._isExtActive(i.slug)); },

  onExploreChange(fn) {
    this._exploreListeners.push(fn);
    return () => { this._exploreListeners = this._exploreListeners.filter(f => f !== fn); };
  },

  // Register a widget in the right sidebar.
  //
  //   slug:      extension slug — required.
  //   id:        unique widget id (typically prefixed with your slug)
  //   label:     shown in the Layout admin drag-to-reorder list
  //   component: React component receiving ({ navigate, currentUser, pageProps })
  //   priority:  lower = higher up (optional, default 50)
  //   scope:     where the widget appears (optional, default "extension")
  //                "extension" — on every /ext/<slug>/* page (default)
  //                "global"    — on every page in Nexus
  //                { path: "/x" }            — on /ext/<slug>/x
  //                { path: ["/x", "/y"] }    — on the listed paths
  //                { corePages: ["profile"]} — on the named core pages
  //
  // The widget appears in the right panel and is grouped under your extension
  // in the Layout admin drag-to-reorder list. Admins can override your defaults
  // by reordering or hiding the widget per page.
  //
  // Usage from extension bundle:
  //   NE.registerRightWidget({
  //     slug:      "gamepedia",
  //     id:        "gamepedia-now-playing",
  //     label:     "Now Playing",
  //     component: NowPlayingWidget,
  //   });
  registerRightWidget({ slug, id, label, component, priority=50, scope="extension" }) {
    if (typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug)) {
      console.error("[NexusExtensions] registerRightWidget: slug must be lowercase alphanumeric+hyphens, got:", slug);
      return;
    }
    if (typeof id !== "string" || !id) {
      console.error("[NexusExtensions] registerRightWidget: id is required");
      return;
    }
    if (typeof label !== "string" || !label) {
      console.error("[NexusExtensions] registerRightWidget: label is required");
      return;
    }
    if (typeof component !== "function") {
      console.error("[NexusExtensions] registerRightWidget: component must be a React component, got:", component);
      return;
    }

    // Derive internal `pages` field from `scope`. The resolver in RightPanel
    // and the Layout admin both read this; built-in widgets use the same field.
    let pages;
    if (scope === "global") {
      pages = "global";
    } else if (scope === "extension") {
      pages = { extension: slug };
    } else if (scope && typeof scope === "object" && Array.isArray(scope.corePages)) {
      pages = scope.corePages.slice();
    } else if (scope && typeof scope === "object" && scope.path !== undefined) {
      const paths = Array.isArray(scope.path) ? scope.path : [scope.path];
      for (const p of paths) {
        if (typeof p !== "string" || !p.startsWith("/")) {
          console.error("[NexusExtensions] registerRightWidget: scope.path entries must start with /, got:", p);
          return;
        }
        if (p.startsWith("/ext/")) {
          console.error("[NexusExtensions] registerRightWidget: do not include /ext/ in scope.path — Nexus prefixes it automatically. Got:", p);
          return;
        }
      }
      pages = paths.map(p => p === "/" ? `/ext/${slug}` : `/ext/${slug}${p}`);
    } else {
      console.error("[NexusExtensions] registerRightWidget: invalid scope:", scope);
      return;
    }

    this._rightWidgets = this._rightWidgets.filter(w => w.id !== id);
    _validateAgainstManifest(slug, "right_widgets", id);
    this._rightWidgets.push({ id, label, component, priority, pages, slug, _ext: true });
    this._rightWidgets.sort((a, b) => (a.priority||50) - (b.priority||50));
    this._rightWidgetListeners.forEach(fn => fn());
  },

  getRightWidgets() { return this._rightWidgets.filter(w => this._isExtActive(w.slug)); },

  onRightWidgetChange(fn) {
    this._rightWidgetListeners.push(fn);
    return () => { this._rightWidgetListeners = this._rightWidgetListeners.filter(f => f !== fn); };
  },

  // Register a tab on /profile/:username pages.
  //
  // Profile tabs are a first-class surface: extensions declare them in the
  // manifest's `profile_tabs` array AND register a component for each one
  // here. The id passed here must match an entry in the manifest, or the
  // registration is silently dropped (with a console warning via
  // _validateAgainstManifest).
  //
  //   window.NexusExtensions.registerProfileTab({
  //     slug:      "gamepedia",
  //     id:        "gamepedia-gamelog",  // matches manifest profile_tabs[].id
  //     component: GamelogTab,
  //   });
  //
  // The component receives only the props declared in the slot contract for
  // profile tabs: { username, current_user }. To navigate, use
  // window.NexusExtensions.navigate(url). Other render-site values (the
  // viewer's id, the profile owner's id, etc.) are not passed — fetch them
  // from your API by username if needed.
  //
  // Manifest-declared metadata (label, icon, visibility, priority) are read
  // from the manifest, not passed here. This separates the contract (in the
  // manifest, validated at install) from the implementation (here, the
  // actual React component).
  registerProfileTab({ slug, id, component }) {
    if (typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug)) {
      console.error("[NexusExtensions] registerProfileTab: slug must be lowercase alphanumeric+hyphens, got:", slug);
      return;
    }
    if (typeof id !== "string" || !id) {
      console.error("[NexusExtensions] registerProfileTab: id is required");
      return;
    }
    if (typeof component !== "function") {
      console.error("[NexusExtensions] registerProfileTab: component must be a React component, got:", component);
      return;
    }
    _validateAgainstManifest(slug, "profile_tabs", id);

    // Dedupe by {slug, id} — re-registering with the same id replaces the
    // previous entry. Same pattern as right_widgets and toolbar_buttons.
    this._profileTabs = this._profileTabs.filter(t => !(t.slug === slug && t.id === id));
    this._profileTabs.push({ slug, id, component, _ext: true });
    this._profileTabListeners.forEach(fn => fn());
  },

  // Returns all registered profile tabs. Consumers (ProfilePage) merge these
  // with the manifest's declared metadata to build the actual tab list,
  // applying visibility filters and priority sort there. This function does
  // not filter by visibility — that's per-render-context, not registration-
  // context.
  getProfileTabs() { return this._profileTabs.filter(t => this._isExtActive(t.slug)); },

  onProfileTabChange(fn) {
    this._profileTabListeners.push(fn);
    return () => { this._profileTabListeners = this._profileTabListeners.filter(f => f !== fn); };
  },

  // Register an action button in the user card popover and mobile user menu.
  // Extensions call this from their bundle:
  //
  //   window.NexusExtensions.registerUserAction({
  //     id:       "gamepedia-view-log",
  //     label:    "View Gamelog",
  //     icon:     "fa-gamepad",          // FA solid icon class
  //     onClick({ user, currentUser, navigate, closeCard }) {
  //       closeCard();
  //       window.NexusExtensions.navigate(`/ext/gamepedia/users/${user.username}`);
  //     },
  //     authOnly: false,   // hide when viewer is not logged in (optional)
  //     priority: 50,      // lower = rendered earlier (optional)
  //   });
  //
  // onClick receives { user, currentUser, navigate, closeCard }.
  // Call closeCard() to dismiss the popover before navigating.
  registerUserAction({ id, label, icon="fa-puzzle-piece", onClick, authOnly=false, priority=50 }) {
    this._userActions = this._userActions.filter(a => a.id !== id);
    this._userActions.push({ id, label, icon, onClick, authOnly, priority });
    this._userActions.sort((a, b) => (a.priority||50) - (b.priority||50));
    this._userActionListeners.forEach(fn => fn());
  },

  getUserActions() { return this._userActions; },

  onUserActionChange(fn) {
    this._userActionListeners.push(fn);
    return () => { this._userActionListeners = this._userActionListeners.filter(f => f !== fn); };
  },

  // Register an item in the account menu (desktop topbar dropdown and mobile
  // account sheet). Use this for actions scoped to the current user's own
  // account — e.g. "My Gamelog". For actions on other users' profile cards
  // use registerUserAction instead.
  //
  //   window.NexusExtensions.registerAccountAction({
  //     id:      "gamepedia-my-log",
  //     label:   "My Gamelog",
  //     icon:    "fa-gamepad",
  //     onClick({ currentUser, navigate, close }) {
  //       close();
  //       window.NexusExtensions.navigate(`/ext/gamepedia/users/${currentUser.username}`);
  //     },
  //     priority: 50,
  //   });
  //
  // onClick receives { currentUser, navigate, close }.
  // Call close() to dismiss the menu before navigating.
  registerAccountAction({ id, label, icon="fa-puzzle-piece", onClick, priority=50 }) {
    this._accountActions = this._accountActions.filter(a => a.id !== id);
    this._accountActions.push({ id, label, icon, onClick, priority });
    this._accountActions.sort((a, b) => (a.priority||50) - (b.priority||50));
    this._accountActionListeners.forEach(fn => fn());
  },

  getAccountActions() {
    var self = this;
    return this._accountActions.filter(function(a) { return self._isExtActive(a.slug); });
  },

  onAccountActionChange(fn) {
    this._accountActionListeners.push(fn);
    return () => { this._accountActionListeners = this._accountActionListeners.filter(f => f !== fn); };
  },

  // Register an item in the post … dropdown menu.
  // Extensions call this from their bundle:
  //
  //   window.NexusExtensions.registerPostAction({
  //     id:    "gamepedia-link-game",
  //     label: "Link a Game",
  //     icon:  "fa-gamepad",
  //     onClick({ post, currentUser, navigate, closeMenu }) {
  //       closeMenu();
  //       // open a modal, navigate, etc.
  //     },
  //     // Optional visibility filter — return false to hide the item for a
  //     // given post/user combination.
  //     visible({ post, currentUser }) { return true; },
  //     priority: 50,
  //   });
  //
  // onClick receives { post, currentUser, navigate, closeMenu }.
  registerPostAction({ id, label, icon="fa-puzzle-piece", onClick, visible, priority=50 }) {
    this._postActions = this._postActions.filter(a => a.id !== id);
    this._postActions.push({ id, label, icon, onClick, visible, priority });
    this._postActions.sort((a, b) => (a.priority||50) - (b.priority||50));
    this._postActionListeners.forEach(fn => fn());
  },

  getPostActions() { return this._postActions; },

  onPostActionChange(fn) {
    this._postActionListeners.push(fn);
    return () => { this._postActionListeners = this._postActionListeners.filter(f => f !== fn); };
  },

  // Register a custom notification type.
  // Extensions call this from their bundle:
  //
  //   window.NexusExtensions.registerNotificationType("gamepedia_new_game", {
  //     icon:       "fa-gamepad",
  //     iconColor:  "var(--ac)",
  //     // renderBody receives the notification object and returns a React node.
  //     renderBody(n) {
  //       return React.createElement(React.Fragment, null,
  //         React.createElement("strong", {style:{color:"var(--t1)"}}, n.data?.game_name||"A game"),
  //         React.createElement("span",  {style:{color:"var(--t3)"}}, " was added to the library")
  //       );
  //     },
  //     // onClick receives { n, navigate } — handle navigation for this type.
  //     onClick({ n, navigate }) {
  //       window.NexusExtensions.navigate("/ext/gamepedia");
  //     },
  //   });
  registerNotificationType(type, { icon, iconColor, renderBody, onClick }) {
    this._notifTypes[type] = { icon, iconColor, renderBody, onClick };
    this._notifTypeListeners.forEach(fn => fn());
  },

  getNotifType(type) {
    var entry = this._notifTypes[type];
    if (!entry) return null;
    // If we can find the owning extension via declared manifests, gate on
    // its active state. If we can't resolve ownership, allow through —
    // some legacy registrations don't have manifest backing.
    var manifests = window._nexusExtensionManifests || {};
    var ownerSlug = null;
    var slugs = Object.keys(manifests);
    for (var i = 0; i < slugs.length; i++) {
      var m = manifests[slugs[i]];
      if (m && Array.isArray(m.notification_types)) {
        if (m.notification_types.some(function(t) { return t.key === type; })) {
          ownerSlug = slugs[i];
          break;
        }
      }
    }
    if (ownerSlug && !this._isExtActive(ownerSlug)) return null;
    return entry;
  },

  onNotifTypeChange(fn) {
    this._notifTypeListeners.push(fn);
    return () => { this._notifTypeListeners = this._notifTypeListeners.filter(f => f !== fn); };
  },

  // Following feed tabs — extensions can add tabs to the Following feed page.
  // Each tab is a self-contained React component that owns its own data
  // fetching and rendering. The "Posts" tab is always first and cannot be
  // removed or replaced.
  //
  // Registration:
  //   window.NexusExtensions.registerFollowingTab({
  //     key:       "gallery",          // unique string, no spaces
  //     label:     "Gallery",          // display label in the tab bar
  //     component: GalleryFollowingFeed // React component, receives { currentUser }
  //   });
  //
  // The tab bar only renders when at least one extension tab is registered.
  // If no extension tabs are present the Following page displays exactly as
  // it does today with no visible change.
  _followingTabs: [],
  _followingTabListeners: [],

  registerFollowingTab({ key, label, component }) {
    if (!key || !label || !component) {
      console.warn("[NexusExtensions] registerFollowingTab: key, label, and component are all required");
      return;
    }
    if (this._followingTabs.some(function(t) { return t.key === key; })) {
      console.warn("[NexusExtensions] registerFollowingTab: tab with key '" + key + "' is already registered");
      return;
    }
    this._followingTabs.push({ key, label, component });
    this._followingTabListeners.forEach(function(fn) { fn(); });
  },

  getFollowingTabs() {
    return this._followingTabs.slice();
  },

  onFollowingTabsChange(fn) {
    this._followingTabListeners.push(fn);
    return () => { this._followingTabListeners = this._followingTabListeners.filter(f => f !== fn); };
  },

  // Upload a file through Nexus's upload pipeline.
  //
  // `file`  — a browser File object (from an <input type="file"> or drag-drop)
  // `opts`  — options:
  //   slug:         string  — your extension slug (required)
  //   type:         string  — "extension_image" | "extension_file" (default: "extension_image")
  //   recordId:     string  — opaque ID to associate this file with a record
  //                           in your own database (optional)
  //   allowedMime:  array   — for extension_file only: restrict accepted MIME
  //                           types to a subset of the permitted list (optional)
  //
  // Returns a promise resolving to:
  //   { upload, url, original_url } on success
  //   { error } or {} on failure
  //
  // Example — image upload:
  //   const { url } = await NexusExtensions.uploadFile(file, {
  //     slug: "gallery",
  //     type: "extension_image",
  //     recordId: String(galleryEntryId),
  //   });
  //
  // Example — video upload:
  //   const { url } = await NexusExtensions.uploadFile(file, {
  //     slug: "gallery",
  //     type: "extension_file",
  //     recordId: String(galleryEntryId),
  //     allowedMime: ["video/mp4", "video/webm"],
  //   });
  uploadFile(file, opts = {}) {
    const { slug, type = "extension_image", recordId, allowedMime } = opts;
    if (!slug) {
      console.error("[NexusExtensions] uploadFile: slug is required");
      return Promise.resolve({ error: "slug is required" });
    }
    const params = { type };
    if (recordId)    params.record_id    = recordId;
    if (allowedMime) params.allowed_mime = allowedMime.join(",");
    return window._nexusApi
      ? window._nexusApi.upload(`/uploads/ext/${slug}`, file, params)
      : Promise.resolve({ error: "API not available" });
  },

  // Moderation sections — extensions can contribute to the Approvals and
  // Reports tabs on both the forum-side ModerationPage and the admin-side
  // AdminModerationPanel.
  //
  // Register once per extension with a single call. Nexus renders your
  // component inside both panels under a section header with your extension
  // name and logo. Your component receives { currentUser, context } where
  // context is "moderator" (forum-side panel) or "admin" (admin panel) so
  // you can conditionally show different controls.
  //
  // Registration:
  //   window.NexusExtensions.registerModerationSection({
  //     slug:             "gallery",           // your extension slug
  //     label:            "Gallery",           // section header label
  //     logo_url:         "...",               // optional logo URL
  //
  //     // Approvals — items awaiting moderator/admin approval
  //     approvals: {
  //       badge:     () => pendingCount,       // function returning a number
  //       component: GalleryApprovalsQueue,    // React component
  //     },
  //
  //     // Reports — user-submitted reports on extension content
  //     reports: {
  //       badge:     () => pendingReports,
  //       component: GalleryReportsQueue,
  //     },
  //   });
  //
  // Either approvals or reports (or both) may be provided. Omitting one
  // simply means your extension won't appear in that tab.
  //
  // The "Extension Approvals" and "Extension Reports" tabs are hidden when
  // no extensions have registered for them — zero impact on installs without
  // moderation-aware extensions.
  _moderationSections: [],
  _moderationListeners: [],

  registerModerationSection({ slug, label, logo_url, approvals, reports }) {
    if (!slug || !label) {
      console.warn("[NexusExtensions] registerModerationSection: slug and label are required");
      return;
    }
    if (!approvals && !reports) {
      console.warn("[NexusExtensions] registerModerationSection: at least one of approvals or reports must be provided");
      return;
    }
    if (this._moderationSections.some(function(s) { return s.slug === slug; })) {
      console.warn("[NexusExtensions] registerModerationSection: slug '" + slug + "' is already registered");
      return;
    }
    this._moderationSections.push({ slug, label, logo_url: logo_url || null, approvals: approvals || null, reports: reports || null });
    this._moderationListeners.forEach(function(fn) { fn(); });
  },

  getModerationSections() {
    return this._moderationSections.slice();
  },

  onModerationSectionsChange(fn) {
    this._moderationListeners.push(fn);
    return () => { this._moderationListeners = this._moderationListeners.filter(f => f !== fn); };
  },
};

// Load all enabled extension JS bundles declared in slot assignments.
// Each bundle is a plain ES module that calls NexusExtensions.registerSlot().
// Extension bundles are now injected as <script> tags in root.html.heex
// by NexusWeb.Plugs.ExtensionBundles, so they load synchronously before
// React mounts. No deferred fetch needed.


// ── URL Routing ───────────────────────────────────────────────────────────────
function urlToPage(pathname) {
  const p = pathname.replace(/\/$/, "") || "/";
  if (p === "/" || p === "")           return {page:"feed", props:{}};
  if (p === "/compose")                return {page:"compose", props:{}};
  if (p === "/search")                 return {page:"search", props:{}};
  if (p === "/notifications")          return {page:"notifications", props:{}};
  if (p === "/messages")               return {page:"messages", props:{}};
  if (p === "/verify-email")           return {page:"verify-email", props:{token: new URLSearchParams(window.location.search).get("token")}};
  if (p === "/magic-login")             return {page:"magic-login",   props:{token: new URLSearchParams(window.location.search).get("token")}};
  if (p === "/admin")                  return {page:"admin", props:{}};
  if (p === "/settings")               return {page:"settings", props:{}};
  if (p === "/members")                return {page:"members",     props:{}};
  if (p === "/tags")                   return {page:"tags",        props:{}};
  if (p === "/badges")                 return {page:"badges",      props:{}};
  if (p === "/leaderboard")            return {page:"leaderboard", props:{}};
  if (p === "/saved")                  return {page:"saved", props:{}};
  if (p === "/drafts")                 return {page:"drafts", props:{}};
  const postM    = p.match(/^\/post\/(.+)$/);
  if (postM)  return {page:"post",    props:{id: postM[1]}};
  const profileM = p.match(/^\/profile\/([^/]+)(?:\/([^/]+))?$/);
  if (profileM) return {page:"profile", props:{username: profileM[1], tab: profileM[2]||null}};
  const spaceM   = p.match(/^\/space\/(.+)$/);
  if (spaceM)  return {page:"feed",   props:{space: spaceM[1]}};
  // Tag-filtered feed, mirroring /space/:slug so the view is shareable and the
  // back button works.
  const tagM     = p.match(/^\/tag\/(.+)$/);
  if (tagM)    return {page:"feed",   props:{tag: decodeURIComponent(tagM[1])}};
  const dmM      = p.match(/^\/messages\/(.+)$/);
  if (dmM)    return {page:"dm",     props:{threadId: dmM[1]}};
  // Extension SPA routes all live under /ext/* — this prefix is owned exclusively
  // by extensions. Nexus's registerRoute enforces it; routes outside this
  // prefix are not supported. On hard refresh the bundle may not have loaded
  // yet; return ext-route with _match:null so ExtensionRoutePage's polling
  // loop resolves it once loaded.
  const pageM = p.match(/^\/p\/(.+)$/);
  if (pageM) return {page:"page", props:{slug: pageM[1]}};
  if (p.startsWith("/ext/")) {
    const extRoute = window.NexusExtensions.matchRoute(p);
    if (extRoute) return {page:"ext-route", props:{ _match: extRoute, ...extRoute.params }};
    return {page:"ext-route", props:{ _match: null }};
  }
  return {page:"feed", props:{}};
}

// Expose urlToPage on window so NexusExtensions.navigate(url) can resolve URLs
// through the same code path as a hard refresh — guarantees click navigation
// and hard refresh always produce identical state.
window._nexusUrlToPage = urlToPage;

function pageToUrl(page, props={}) {
  if (page === "ext-route") {
    // props._match.pattern + props (params) → reconstruct the URL
    const match = props._match;
    if (match) return window.NexusExtensions.routeUrl(match.pattern, props);
    return "/";
  }
  switch(page) {
    case "feed":          return props.space ? `/space/${props.space}`
                               : props.tag   ? `/tag/${encodeURIComponent(props.tag)}`
                               : "/";
    case "post":          return props.id ? `/post/${props.id}` : "/";
    case "profile":       return props.username ? `/profile/${props.username}${props.tab ? `/${props.tab}` : ""}` : "/";
    case "compose":       return "/compose";
    case "page":          return `/p/${props?.slug||""}`; 
    case "search":        return "/search";
    case "notifications": return "/notifications";
    case "messages":      return "/messages";
    case "dm":            return props.threadId ? `/messages/${props.threadId}` : "/messages";
    case "moderation":   return "/moderation";
    case "admin":         return "/admin";
    case "settings":      return "/settings";
    case "members":       return "/members";
    case "tags":          return "/tags";
    case "badges":        return "/badges";
    case "leaderboard":   return "/leaderboard";
    case "saved":         return "/saved";
    case "drafts":        return "/drafts";
    default:              return "/";
  }
}

// Strip non-serializable values (functions, DOM elements, React components,
// etc.) from a props object so it can survive history.pushState's structured
// clone algorithm. Used by navigate() to keep history state cloneable when
// extension routes (and any future feature) pass component references in
// props.
//
// Keeps primitives, plain objects, arrays, dates. Drops anything else
// (functions become undefined, the parent key is omitted).
function stripNonSerializable(value) {
  if (value === null) return null;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value;
  if (t === "undefined") return undefined;
  if (t === "function") return undefined;
  if (t === "symbol") return undefined;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    return value.map(stripNonSerializable).filter(v => v !== undefined);
  }
  if (t === "object") {
    const out = {};
    for (const k in value) {
      if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
      const cleaned = stripNonSerializable(value[k]);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return undefined;
}

let _cssEl = null;
let _themeStyleEl  = null; // <link> for active theme stylesheet
let _themeScriptEl = null; // <script> for active theme script

// Strip CSS constructs that can be used to exfiltrate data:
// @import, external url() references, and IE expression().
function sanitizeCSS(css) {
  return css
    .replace(/@import\b[^;]*(;|$)/gi, '')
    .replace(/url\s*\(\s*(?!['"]?(data:|\/|#))[^)]+\)/gi, '')
    .replace(/expression\s*\(/gi, '');
}
// Initialize branding from cache immediately to avoid flash on load
let _brandingState = (() => {
  const fallback = {logo_url:null,site_name:null,favicon_url:null,hero_title:null,hero_body:null,hero_enabled:false};
  // Server-injected branding (window.__nexusBranding) is authoritative on first
  // load and is present even on a cold cache, so the logo renders on the first
  // paint instead of after the /branding fetch. Fall back to the localStorage
  // copy, then to empty defaults.
  try { if (window.__nexusBranding) return {...fallback, ...window.__nexusBranding}; } catch {}
  try { const b = localStorage.getItem("nexus_branding"); return b ? JSON.parse(b) : fallback; }
  catch { return fallback; }
})();
let _brandingListeners = [];
function onBrandingChange(fn) { _brandingListeners.push(fn); }
function setBrandingState(state) {
  _brandingState = {..._brandingState, ...state};
  _brandingListeners.forEach(fn => fn(_brandingState));
}

// ── Contrast-aware color utilities ───────────────────────────────────────────
function hexToRgb(hex) {
  const h = hex.replace("#","");
  const full = h.length===3 ? h.split("").map(c=>c+c).join("") : h;
  const n = parseInt(full,16);
  return [(n>>16)&255,(n>>8)&255,n&255];
}
function luminance([r,g,b]) {
  const ch = v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
  return 0.2126*ch(r)+0.7152*ch(g)+0.0722*ch(b);
}
// Blend two rgb triples by factor t (0..1). Rounding mirrors ThemeVars.rnd.
function _acBlend(a,b,t){return [Math.round(a[0]+(b[0]-a[0])*t),Math.round(a[1]+(b[1]-a[1])*t),Math.round(a[2]+(b[2]-a[2])*t)];}
function _acContrast(a,b){const L1=luminance(a),L2=luminance(b),hi=Math.max(L1,L2),lo=Math.min(L1,L2);return (hi+0.05)/(lo+0.05);}
// Accent text color guaranteed to clear WCAG AA 4.5:1 against `surf`: blend the
// accent toward `toward` (white on dark, black on light) in 5% steps until it
// passes. Mirrored exactly in Nexus.Appearance.ThemeVars (server) so SSR and
// client agree and there's no flash.
function _acTextFor(rgb,toward,surf){for(let i=0;i<=20;i++){const c=_acBlend(rgb,toward,i/20);if(_acContrast(c,surf)>=4.5)return `rgb(${c[0]},${c[1]},${c[2]})`;}return `rgb(${toward[0]},${toward[1]},${toward[2]})`;}
// Given a hex accent color, derive all CSS variable variants
function deriveAccentVars(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const rgb = hexToRgb(hex);
  const lum = luminance(rgb);
  // Text on solid accent background: white for dark colors, near-black for light
  const onAccent = lum > 0.35 ? "#111111" : "#ffffff";
  // Tinted bg: accent at low opacity
  const [r,g,b] = rgb;
  const acBg = `rgba(${r},${g},${b},0.12)`;
  const acBorder = `rgba(${r},${g},${b},0.30)`;
  // ac-text: for text ON dark bg WITH accent color — if accent is very light, darken it slightly
  // Contrast-guaranteed accent text (>=4.5:1) against the ac-bg tint it sits on.
  const _acBgRgb = _acBlend(rgb, [17,17,17], 0.88);   // 12% accent over #111
  const acText = _acTextFor(rgb, [255,255,255], _acBgRgb);
  return {onAccent, acBg, acBorder, acText};
}

function deriveTintVars(hex, intensity) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const [r,g,b] = hexToRgb(hex);
  // intensity: 0–100 (default 10 = original behaviour)
  const amt = ((intensity ?? 10) / 100);
  const mix = (base, amt) => {
    const br=(base>>16)&255, bg=(base>>8)&255, bb=base&255;
    return `rgb(${Math.round(br+(r-br)*amt)},${Math.round(bg+(g-bg)*amt)},${Math.round(bb+(b-bb)*amt)})`;
  };
  return { bg:mix(0x111111,amt), s1:mix(0x1a1a1a,amt), s2:mix(0x222222,amt), s3:mix(0x2a2a2a,amt) };
}

// ── Light-mode derive functions ──────────────────────────────────────────────
// Parallel to deriveAccentVars/deriveTintVars but tuned for light surfaces.

function deriveAccentVarsLight(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const rgb = hexToRgb(hex);
  const lum = luminance(rgb);
  const [r,g,b] = rgb;
  // Text on solid accent bg: same logic as dark (luminance-based)
  const onAccent = lum > 0.35 ? "#111111" : "#ffffff";
  // Tinted bg at low opacity looks fine on white too
  const acBg = `rgba(${r},${g},${b},0.09)`;
  const acBorder = `rgba(${r},${g},${b},0.25)`;
  // acText must contrast against light surfaces — darken light accents
  // Contrast-guaranteed accent text (>=4.5:1) against the light ac-bg tint.
  const _acBgRgbL = _acBlend(rgb, [255,255,255], 0.91);  // 9% accent over white
  const acText = _acTextFor(rgb, [0,0,0], _acBgRgbL);
  return {onAccent, acBg, acBorder, acText};
}

function deriveTintVarsLight(hex, intensity) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const [r,g,b] = hexToRgb(hex);
  // intensity: 0–100 (default 22 = visible but tasteful on light surfaces)
  // Light mode needs higher base than dark because the eye is less sensitive
  // to hue shifts near white.
  const amt = ((intensity ?? 22) / 100);
  const mix = (base, amt) => {
    const br=(base>>16)&255, bg=(base>>8)&255, bb=base&255;
    return `rgb(${Math.round(br+(r-br)*amt)},${Math.round(bg+(g-bg)*amt)},${Math.round(bb+(b-bb)*amt)})`;
  };
  return {
    bg: mix(0xf4f4f5, amt),
    s1: mix(0xffffff, amt * 0.68), // s1 slightly less intense than bg
    s2: mix(0xe4e4e7, amt),
    s3: mix(0xd4d4d8, amt),
  };
}

// Light-mode CSS variable overrides (text, borders)
const LIGHT_VARS = {
  "--t1": "#1a1428",
  "--t2": "rgba(26,20,80,0.86)",
  "--t3": "rgba(26,20,80,0.77)",
  "--t4": "rgba(26,20,80,0.69)",
  "--t5": "rgba(26,20,80,0.60)",
  "--b1": "rgba(26,20,80,0.07)",
  "--b2": "rgba(26,20,80,0.10)",
  "--b3": "rgba(26,20,80,0.14)",
};
const DARK_VARS = {
  "--t1": "#f0eeff",
  "--t2": "rgba(255,255,255,0.86)",
  "--t3": "rgba(255,255,255,0.70)",
  "--t4": "rgba(255,255,255,0.58)",
  "--t5": "rgba(255,255,255,0.50)",
  "--b1": "rgba(255,255,255,0.07)",
  "--b2": "rgba(255,255,255,0.10)",
  "--b3": "rgba(255,255,255,0.14)",
};

// Active theme tracking
let _currentTheme = "dark";

// Apply dark or light CSS variables for a given appearance config
function applyTheme(mode, app={}) {
  const r = document.documentElement;
  _currentTheme = mode;
  r.setAttribute("data-theme", mode);

  if (mode === "light") {
    // 1. Base text + border vars
    Object.entries(LIGHT_VARS).forEach(([k,v]) => r.style.setProperty(k,v));
    // 2. Admin accent
    const ac = app.light_accent_color || "#2563eb";
    r.style.setProperty("--ac", ac.startsWith("#") ? ac : `#${ac}`);
    const acVars = deriveAccentVarsLight(ac.startsWith("#") ? ac : `#${ac}`);
    if (acVars) { r.style.setProperty("--ac-on",acVars.onAccent); r.style.setProperty("--ac-bg",acVars.acBg); r.style.setProperty("--ac-border",acVars.acBorder); r.style.setProperty("--ac-text",acVars.acText); }
    // 3. Admin surface tint or fallback
    if (app.light_tint_color) {
      const tint = deriveTintVarsLight(app.light_tint_color, app.light_tint_intensity);
      if (tint) { r.style.setProperty("--bg",tint.bg); r.style.setProperty("--s1",tint.s1); r.style.setProperty("--s2",tint.s2); r.style.setProperty("--s3",tint.s3); }
    } else {
      r.style.setProperty("--bg","#f4f4f5"); r.style.setProperty("--s1","#ffffff"); r.style.setProperty("--s2","#e4e4e7"); r.style.setProperty("--s3","#d4d4d8");
    }
    // 4. Content link color (post/reply body hyperlinks only)
    r.style.setProperty("--link-color", app.light_link_color || "#2563eb");
  } else {
    // 1. Base text + border vars
    Object.entries(DARK_VARS).forEach(([k,v]) => r.style.setProperty(k,v));
    // 2. Admin accent
    const ac = app.accent_color || "#4A90E2";
    r.style.setProperty("--ac", ac);
    const acVars = deriveAccentVars(ac);
    if (acVars) { r.style.setProperty("--ac-on",acVars.onAccent); r.style.setProperty("--ac-bg",acVars.acBg); r.style.setProperty("--ac-border",acVars.acBorder); r.style.setProperty("--ac-text",acVars.acText); }
    // 3. Admin surface tint or fallback
    if (app.tint_color) {
      const tint = deriveTintVars(app.tint_color, app.tint_intensity);
      if (tint) { r.style.setProperty("--bg",tint.bg); r.style.setProperty("--s1",tint.s1); r.style.setProperty("--s2",tint.s2); r.style.setProperty("--s3",tint.s3); }
    } else {
      r.style.setProperty("--bg","#111111"); r.style.setProperty("--s1","#1a1a1a"); r.style.setProperty("--s2","#222222"); r.style.setProperty("--s3","#2a2a2a");
    }
    // 4. Content link color (post/reply body hyperlinks only)
    r.style.setProperty("--link-color", app.link_color || "#60a5fa");
  }
  // Apply admin non-colour vars (avatar radius, font sizes).
  // Placed here so they are set before css_vars can override them, and so
  // mode-switch calls (which invoke applyTheme directly) also re-apply them.
  r.style.setProperty("--av-radius", `${app.avatar_radius ?? 22}%`);
  if (app.fs_ui)         r.style.setProperty("--fs-ui",         `${app.fs_ui}px`);
  if (app.fs_body)       r.style.setProperty("--fs-body",       `${app.fs_body}px`);
  if (app.fs_title)      r.style.setProperty("--fs-title",      `${app.fs_title}px`);
  if (app.fs_content)    r.style.setProperty("--fs-content",    `${app.fs_content}px`);
  if (app.fs_feed_title) r.style.setProperty("--fs-feed-title", `${app.fs_feed_title}px`);
  if (app.fs_code)       r.style.setProperty("--fs-code",       `${app.fs_code}px`);

  // Apply theme CSS variable overrides declared in theme.json.
  // These run after all admin vars so they take precedence.
  // variables:       applied in both modes
  // dark_variables:  applied in dark mode only
  // light_variables: applied in light mode only
  const activeThemeForVars = mode === "light" ? app.active_theme_light : app.active_theme_dark;
  if (activeThemeForVars) {
    const vars = {
      ...(activeThemeForVars.variables      || {}),
      ...(mode === "dark"  ? (activeThemeForVars.dark_variables  || {}) : {}),
      ...(mode === "light" ? (activeThemeForVars.light_variables || {}) : {}),
    };
    Object.entries(vars).forEach(([k, v]) => r.style.setProperty(k, v));
  }

  // Cache the final computed CSS vars so the early-theme script can restore
  // them synchronously on the next page load — before React mounts.
  // Includes --av-radius and --fs-* so theme overrides of those vars are also
  // restored flash-free on page load.
  const varsToCache = [
    "--bg","--s1","--s2","--s3",
    "--t1","--t2","--t3","--t4","--t5",
    "--b1","--b2","--b3",
    "--ac","--ac-on","--ac-bg","--ac-border","--ac-text",
    "--av-radius",
    "--fs-ui","--fs-body","--fs-title","--fs-feed-title","--fs-content","--fs-code",
    "--link-color",
  ];
  const cached = { theme: mode };
  varsToCache.forEach(v => {
    cached[v] = r.style.getPropertyValue(v) || getComputedStyle(r).getPropertyValue(v).trim();
  });
  try { localStorage.setItem("nexus_appearance_vars", JSON.stringify(cached)); } catch {}
}

// Resolve which theme to show based on user pref, admin default, and OS
function resolveTheme(userPref, adminDefault, darkEnabled, lightEnabled) {
  const osDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const allowed = [];
  if (darkEnabled !== false) allowed.push("dark");
  if (lightEnabled !== false) allowed.push("light");
  // If user has a stored pref and it's allowed, use it
  if (userPref && userPref !== "auto" && allowed.includes(userPref)) return userPref;
  // "auto" or no pref: if admin default is a specific theme and it's allowed, use it
  // unless user explicitly chose "auto" (follow OS)
  if (userPref !== "auto" && adminDefault && adminDefault !== "auto" && allowed.includes(adminDefault)) {
    return adminDefault;
  }
  // Auto: follow OS if both available, otherwise use whichever is allowed
  if (allowed.length >= 2) return osDark ? "dark" : "light";
  return allowed[0] || "dark";
}

function applyBranding(app={}, gen={}) {
  const r = document.documentElement;

  // Expose allowed themes globally so user settings UI can read them
  window._darkEnabled  = app.dark_enabled  !== false;
  window._lightEnabled = app.light_enabled !== false;
  window._defaultTheme = app.default_theme || "dark";
  window._appBrandingForTheme = app;

  // Persist allowed themes config to localStorage so the early-theme script
  // on next page load can validate the stored pref against what's allowed.
  try {
    localStorage.setItem("nexus_theme_cfg", JSON.stringify({
      darkEnabled:  window._darkEnabled,
      lightEnabled: window._lightEnabled,
      defaultTheme: window._defaultTheme
    }));
  } catch {}

  // Resolve and apply the active theme
  let storedPref = null;
  try { storedPref = localStorage.getItem("nexus_theme_pref"); } catch {}
  const theme = resolveTheme(storedPref, window._defaultTheme, window._darkEnabled, window._lightEnabled);
  applyTheme(theme, app);

  if (gen.site_name) document.title = gen.site_name;
  if (app.custom_css) {
    if (!_cssEl) { _cssEl = document.createElement("style"); document.head.appendChild(_cssEl); }
    _cssEl.textContent = sanitizeCSS(app.custom_css);
  }

  // Inject active theme stylesheet — idempotent, updates href on mode change
  const activeTheme = theme === "light" ? app.active_theme_light : app.active_theme_dark;
  const stylesheetUrl = activeTheme?.stylesheet_url || null;
  if (stylesheetUrl) {
    if (!_themeStyleEl) {
      _themeStyleEl = document.createElement("link");
      _themeStyleEl.rel = "stylesheet";
      _themeStyleEl.id  = "nexus-theme-stylesheet";
      document.head.appendChild(_themeStyleEl);
    }
    if (_themeStyleEl.href !== stylesheetUrl) {
      _themeStyleEl.href = stylesheetUrl;
    }
  } else if (_themeStyleEl) {
    // No active theme for this mode — remove the stylesheet
    _themeStyleEl.href = "";
  }
  // Inject active theme script — remove and re-inject when the URL changes
  // so the new script executes. applyBranding is not called on every mode
  // switch (mode switches call _applyTheme directly) so this does not
  // cause repeated execution during normal use.
  const scriptUrl = activeTheme?.script_url || null;
  if (scriptUrl) {
    const resolvedScriptUrl = new URL(scriptUrl, location.origin).href;
    if (_themeScriptEl && _themeScriptEl.src !== resolvedScriptUrl) {
      _themeScriptEl.remove();
      _themeScriptEl = null;
    }
    if (!_themeScriptEl) {
      _themeScriptEl = document.createElement("script");
      _themeScriptEl.src = scriptUrl;
      _themeScriptEl.id  = "nexus-theme-script";
      document.head.appendChild(_themeScriptEl);
    }
  } else if (_themeScriptEl) {
    // No active theme script for this mode — remove it
    _themeScriptEl.remove();
    _themeScriptEl = null;
  }
  // Set data-theme-slug on <html> so themes can scope rules to a specific theme
  r.setAttribute("data-theme-slug", activeTheme?.slug || "");
  // Apply favicon
  if (gen.favicon_url) {
    let link = document.querySelector("link[rel~='icon']");
    if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
    link.href = gen.favicon_url;
  }
  const newBranding = {logo_url: gen.logo_url||null, site_name: gen.site_name||null, favicon_url: gen.favicon_url||null, hero_title: gen.hero_title||null, hero_body: gen.hero_body||null, hero_enabled: gen.hero_enabled||false};
  try { localStorage.setItem("nexus_branding", JSON.stringify(newBranding)); } catch {}
  // Cache custom_css so the early script can apply it synchronously.
  // avatar_radius and fs_* are now cached in nexus_appearance_vars (inside
  // applyTheme) so the early script reads them from there instead, ensuring
  // theme css_vars overrides of those properties are restored flash-free.
  try {
    localStorage.setItem("nexus_appearance_app", JSON.stringify({
      custom_css: app.custom_css || null,
    }));
  } catch {}
  setBrandingState(newBranding);
}

// Register the OS theme change listener exactly once at module load.
// applyBranding is called every time settings are saved, so registering
// inside it would accumulate duplicate listeners.
(function() {
  const mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
  if (!mq) return;
  mq.addEventListener("change", () => {
    const pref = localStorage.getItem("nexus_theme_pref");
    if (!pref || pref === "auto") {
      const t = resolveTheme("auto", window._defaultTheme, window._darkEnabled, window._lightEnabled);
      applyTheme(t, window._appBrandingForTheme || {});
    }
  });
})();

// ── Layout constants ──────────────────────────────────────────────────────────
// Expose branding utilities on window so admin/AdminPage.jsx can access them
// without circular imports. Same pattern used for _postCfg, _nexusNavigate, etc.
window._applyBranding      = applyBranding;
window._getBrandingState   = () => _brandingState;
window._applyTheme         = applyTheme;
window._resolveTheme       = resolveTheme;
window._onBrandingChange   = onBrandingChange;
window._deriveTintVars     = deriveTintVars;
window._deriveTintVarsLight = deriveTintVarsLight;
window._deriveAccentVars   = deriveAccentVars;
window._deriveAccentVarsLight = deriveAccentVarsLight;

// These define the default items for the sidebar, explore section, and right
// panel. Admins can reorder them via the Layout admin panel.
const EXPLORE_ITEMS = [
  {id:"everything",   label:"Everything",    icon:"fa-border-all"},
  {id:"search",       label:"Search",        icon:"fa-magnifying-glass"},
  {id:"notifications",label:"Notifications", icon:"fa-bell",    authOnly:true},
  {id:"messages",     label:"Messages",      icon:"fa-message", authOnly:true},
  {id:"members",      label:"Members",       icon:"fa-users"},
  {id:"tags",         label:"Tags",          icon:"fa-tag"},
  {id:"leaderboard",  label:"Leaderboard",   icon:"fa-trophy"},
  {id:"badges",       label:"Badges",        icon:"fa-medal"},
];
// All built-in right sidebar widgets.
// pages: "global" — shown on every page by default.
// pages: [...] — shown only on those pages by default.
// component: the React component to render, receives { navigate, currentUser, pageProps }.
const RIGHT_WIDGETS = [
  {id:"post_author",       label:"Post Author",      pages:["post"],        component: PostAuthorWidget},
  {id:"post_participants", label:"Participants",      pages:["post"],        component: PostParticipantsWidget},
  {id:"post_related",      label:"Related Posts",     pages:["post"],        component: PostRelatedWidget},
  {id:"leaderboard_panel", label:"Leaderboard Panel", pages:["leaderboard"], component: LeaderboardSidebarWidget},
  {id:"badges_panel",      label:"Badges Panel",      pages:["badges"],      component: BadgesSidebarWidget},
  {id:"search_filters",    label:"Search Filters",    pages:["search"],      component: SearchFilterWidget},
  {id:"online_members",    label:"Online Members",    pages:"global",        component: OnlineMembersWidget},
  {id:"live_activity",     label:"Live Activity",     pages:"global",        component: null},
  {id:"spaces_by_pulse",   label:"Spaces by Pulse",   pages:["feed"],        component: null},
  {id:"tags_by_pulse",     label:"Tags by Pulse",     pages:["feed"],        component: null},
  {id:"stats",             label:"Stats",             pages:"global",        component: null},
];
// Page widgets are dynamic — injected at runtime from window._pageWidgets once
// the /pages/widgets/public API response arrives. Each entry gets id "page_widget:{id}",
// label from the widget name, pages:"global", and component:null (rendered inline
// in renderBuiltin via the page_widget: prefix check).
function getDynamicPageWidgets() {
  return (window._pageWidgets || []).map(function(pw) {
    return {id: "page_widget:" + pw.id, label: pw.name, pages: "global", component: null};
  });
}
const SIDEBAR_SECTIONS = [
  {id:"explore", label:"Explore"},
  {id:"spaces",  label:"Spaces"},
  {id:"you",     label:"You"},
];

// ── Avatar dropdown ───────────────────────────────────────────────────────────
function AvatarMenu({user, navigate, onLogout}) {
  const [open,setOpen]=useState(false); const ref=useRef();
  const [, forceUpdate] = useState(0);
  useEffect(()=>{ return window.NexusExtensions.onAccountActionChange(()=>forceUpdate(n=>n+1)); },[]);
  useEffect(()=>{
    const fn=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
    document.addEventListener("mousedown",fn); return ()=>document.removeEventListener("mousedown",fn);
  },[]);
  const initials = (user?.username||"?").slice(0,2).toUpperCase();
  const bg = userColor(user);
  return (
    <div className="av-wrap" ref={ref}>
      <div className={`av-circle ${open?"open":""}`} style={{background: user?.avatar_url ? "transparent" : bg}} onClick={()=>setOpen(p=>!p)}>
        {user?.avatar_url
          ?<img src={user.avatar_url} style={{width:"100%",height:"100%",objectFit:"cover",borderRadius:"inherit"}} alt={user.username}/>
          :initials}
      </div>
      <div className={`av-dd ${open?"open":""}`}>
        <div className="av-dd-hdr">
          <div className="av-dd-name">{user?.username}</div>
          <div className="av-dd-handle">@{user?.username?.toLowerCase()} · {user?.role}</div>
        </div>
        <div className="av-dd-item" onClick={()=>{navigate("profile",{username:user?.username});setOpen(false);}}>
          <i className="fa-solid fa-user" style={{color:"var(--t3)"}}></i>profile
        </div>
        <div className="av-dd-item" onClick={()=>{navigate("settings");setOpen(false);}}>
          <i className="fa-solid fa-gear" style={{color:"var(--t3)"}}></i>settings
        </div>
        {user?.role==="admin"&&<div className="av-dd-item admin-item" onClick={()=>{navigate("admin");setOpen(false);}}>
          <i className="fa-solid fa-shield-halved"></i>administration
        </div>}
        {window.NexusExtensions.getAccountActions().map(a=>(
          <div key={a.id} className="av-dd-item" onClick={()=>a.onClick({currentUser:user,navigate,close:()=>setOpen(false)})}>
            <i className={`fa-solid ${a.icon}`} style={{color:"var(--t3)"}}></i>{a.label}
          </div>
        ))}
        <div className="av-dd-divider"/>
        <div className="av-dd-item logout-item" onClick={()=>{onLogout();setOpen(false);}}>
          <i className="fa-solid fa-arrow-right-from-bracket"></i>log out
        </div>
      </div>
    </div>
  );
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function AuthPage({onLogin}) {
  const [mode,setMode]=useState("login");
  const [form,setForm]=useState({login:"",email:"",username:"",password:""});
  const [showPw,setShowPw]=useState(false);
  const [err,setErr]=useState(null); const [loading,setLoading]=useState(false);
  const submit=async e=>{
    e.preventDefault(); setLoading(true); setErr(null);
    try {
      const body = mode==="login"
        ? {email: form.login.trim(), password: form.password}  // backend handles email or username
        : {email: form.email.trim(), username: form.username.trim(), password: form.password};
      const d=await api.post(mode==="login"?"/auth/login":"/auth/register", body);
      if(d.access_token){api.setToken(d.access_token);onLogin(d.user);}
      else setErr(formatApiErrors(d));
    } finally { setLoading(false); }
  };
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <div style={{width:40,height:40,borderRadius:"50%",background:"var(--ac)",margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,color:"#fff",fontWeight:500}}>N</div>
          <div className="auth-title">{mode==="login"?"Welcome back":"Create account"}</div>
          <div className="auth-sub">{mode==="login"?"Sign in to continue":"Join the community"}</div>
        </div>
        <form onSubmit={submit}>
          {mode==="login"
            ?<div className="fg"><label className="fl">Email or username</label><input className="fi" placeholder="you@example.com or username" value={form.login} onChange={e=>setForm(p=>({...p,login:e.target.value}))} required autoFocus/></div>
            :<>
              <div className="fg"><label className="fl">Email</label><input className="fi" type="email" placeholder="you@example.com" value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))} required autoFocus/></div>
              <div className="fg"><label className="fl">Username</label><input className="fi" placeholder="username" value={form.username} onChange={e=>setForm(p=>({...p,username:e.target.value}))} required/></div>
            </>}
          <div className="fg"><label className="fl">Password</label>
          <div style={{position:"relative"}}>
            <input className="fi" type={showPw?"text":"password"} placeholder="••••••••" value={form.password} onChange={e=>setForm(p=>({...p,password:e.target.value}))} required style={{paddingRight:40}}/>
            <span onClick={()=>setShowPw(p=>!p)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",cursor:"pointer",color:"var(--t4)",fontSize:15,userSelect:"none"}}>
              <i className={`fa-solid ${showPw?"fa-eye-slash":"fa-eye"}`}/>
            </span>
          </div></div>
          {err&&<div className="ferr" style={{marginBottom:10,whiteSpace:"pre-line"}}>{err}</div>}
          <button className="btn-primary" style={{width:"100%",borderRadius:10,padding:"10px"}} disabled={loading}>{loading?"...":mode==="login"?"Sign in":"Create account"}</button>
        </form>
        <div className="auth-switch">{mode==="login"?<>No account? <span className="link" onClick={()=>{setMode("register");setErr(null);}}>Sign up</span></>:<>Have an account? <span className="link" onClick={()=>{setMode("login");setErr(null);}}>Sign in</span></>}</div>
      </div>
    </div>
  );
}

// ── AndroidInstallSheet ───────────────────────────────────────────────────────
// Slide-up PWA install sheet for Android/Chrome.
// Shows on the second visit (window._pwaVisitCount >= 2) when:
//   - beforeinstallprompt has fired (installPrompt is available)
//   - Not already running in standalone mode (already installed)
//   - Not permanently dismissed (pwa.android_prompt.dismissed in localStorage)
//   - Not snoozed for this visit (pwa.android_prompt.snoozed set this session)
//
// Three actions:
//   "Add to home screen" — triggers native install prompt, clears sheet
//   "Not now"           — hides for this visit, shows again next visit
//   "Dismiss"           — sets permanent dismissed flag, never shows again
//
// Completely independent of the sidebar install banner — dismissing one
// does not affect the other.
function AndroidInstallSheet({pwaCfg={}, appBranding={}}) {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches;

  // All conditions checked before any state — avoids hook order issues
  const eligible = isAndroid && !isStandalone;

  const [installPrompt, setInstallPrompt] = useState(window._installPrompt || null);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem("pwa.android_prompt.dismissed") === "1"; } catch { return false; }
  });

  // Subscribe to installPrompt changes (fires when beforeinstallprompt arrives
  // after component mounts, or when appinstalled clears it)
  useEffect(() => {
    const unsub = window.onInstallPromptChange?.(p => setInstallPrompt(p || null));
    return () => unsub?.();
  }, []);

  // Show the sheet once installPrompt is available, conditions are met,
  // and a short delay has passed so the user sees the page first
  useEffect(() => {
    if (!eligible) return;
    if (dismissed) return;
    if (!installPrompt) return;
    // Only show on second visit or later
    if ((window._pwaVisitCount || 1) < 2) return;
    // Snoozed for this session via "Not now"
    try { if (sessionStorage.getItem("pwa.android_prompt.snoozed") === "1") return; } catch {}

    const t = setTimeout(() => setVisible(true), 1500);
    return () => clearTimeout(t);
  }, [eligible, dismissed, installPrompt]);

  if (!visible || !installPrompt) return null;

  const appName = pwaCfg.app_name || appBranding.site_name || "Nexus";
  const domain  = window.location.hostname;

  // Icon: 192px PWA icon (already a full URL path) → favicon → initial letter
  const iconUrl = pwaCfg.icon_192_path
    ? pwaCfg.icon_192_path
    : appBranding.favicon_url || null;

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setVisible(false);
    window._installPrompt = null;
  };

  const handleNotNow = () => {
    setVisible(false);
    try { sessionStorage.setItem("pwa.android_prompt.snoozed", "1"); } catch {}
  };

  const handleDismiss = () => {
    setVisible(false);
    setDismissed(true);
    try { localStorage.setItem("pwa.android_prompt.dismissed", "1"); } catch {}
  };

  return (
    <>
      {/* Backdrop */}
      <div
        style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:9998}}
        onClick={handleNotNow}
      />
      {/* Sheet */}
      <div style={{
        position:"fixed",bottom:0,left:0,right:0,zIndex:9999,
        background:"var(--s2)",
        borderRadius:"20px 20px 0 0",
        border:"0.5px solid var(--b2)",
        borderBottom:"none",
        padding:"0 20px 32px",
      }}>
        {/* Handle */}
        <div style={{width:36,height:4,background:"var(--b3)",borderRadius:2,margin:"10px auto 18px"}}/>
        {/* App row */}
        <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:20}}>
          <div style={{width:52,height:52,borderRadius:14,overflow:"hidden",flexShrink:0,
            background:"linear-gradient(135deg,var(--ac),#1d6fbd)",
            display:"flex",alignItems:"center",justifyContent:"center"}}>
            {iconUrl
              ? <img src={iconUrl} style={{width:"100%",height:"100%",objectFit:"cover"}} alt=""/>
              : <span style={{fontSize:22,fontWeight:600,color:"#fff"}}>
                  {appName.slice(0,1).toUpperCase()}
                </span>}
          </div>
          <div style={{minWidth:0}}>
            <div style={{fontSize:15,fontWeight:500,color:"var(--t1)",marginBottom:2}}>{appName}</div>
            <div style={{fontSize:11,color:"var(--t5)"}}>{domain}</div>
          </div>
        </div>
        {/* Install button */}
        <button
          onClick={handleInstall}
          style={{width:"100%",background:"var(--ac)",border:"none",borderRadius:12,
            color:"var(--ac-on)",fontSize:13,fontWeight:500,padding:12,
            fontFamily:"inherit",cursor:"pointer",marginBottom:8}}>
          Add to home screen
        </button>
        {/* Secondary actions */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"2px 4px"}}>
          <button
            onClick={handleNotNow}
            style={{background:"none",border:"none",fontSize:12,color:"var(--t4)",
              fontFamily:"inherit",cursor:"pointer",padding:"6px 0"}}>
            Not now
          </button>
          <button
            onClick={handleDismiss}
            style={{background:"none",border:"none",fontSize:12,color:"var(--t5)",
              fontFamily:"inherit",cursor:"pointer",padding:"6px 0"}}>
            Dismiss
          </button>
        </div>
      </div>
    </>
  );
}

// ── SpaceWithChildren ─────────────────────────────────────────────────────────
// Renders a top-level space that has sub-spaces. The name area navigates to the
// parent space feed; the chevron button exclusively controls expand/collapse.
// A space's post_count only counts posts directly in it. Both the sidebar and
// the Spaces by Pulse widget present totals that include sub-spaces, so the
// rollup lives here and is shared — previously only the widget rolled up, and
// the same space showed two different numbers on the same screen.
function rollupSpaceCounts(spaces) {
  const totals = {};
  (spaces || []).forEach(s => { totals[s.id] = s.post_count || 0; });
  (spaces || []).filter(s => s.parent_id).forEach(s => {
    if (totals[s.parent_id] !== undefined) totals[s.parent_id] += s.post_count || 0;
  });
  return totals;
}

function SpaceWithChildren({space, col, children, parentActive, defaultExpanded, page, pageProps, navigate, totals={}}) {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  return (
    <div>
      <div className={`sb-item ${parentActive ? "active" : ""}`} style={{padding:0}}>
        <div className="sb-item-inner" onClick={() => navigate("feed", {space: space.slug})}>
          <i className={`fa-solid ${space.icon || "fa-layer-group"}`}
            style={{width:18,textAlign:"center",fontSize:15,flexShrink:0,
              color: parentActive ? col : "var(--t3)"}}/>
          <span className="sb-item-name">{space.name}</span>
          {totals[space.id] > 0 && <span className="sb-item-count">{totals[space.id]}</span>}
        </div>
        <span className={`sb-item-toggle ${expanded ? "expanded" : "collapsed"}`}
          onClick={e => { e.stopPropagation(); setExpanded(p => !p); }}
          title={expanded ? "Collapse" : "Expand"}>
          <i className="fa-solid fa-chevron-down"/>
        </span>
      </div>
      {expanded && children.map(sub => {
        const subActive = page === "feed" && pageProps?.space === sub.slug;
        return (
          <div key={sub.id} className={`sb-sub-item ${subActive ? "active" : ""}`}
            onClick={() => navigate("feed", {space: sub.slug})}>
            <span className="sb-sub-dot" style={{background: col}}/>
            <span className="sb-sub-name">{sub.name}</span>
            {totals[sub.id] > 0 && <span className="sb-item-count">{totals[sub.id]}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({currentUser, spaces, page, pageProps, navigate, onLogout, notifCount=0, msgCount=0, modReportCount=0, onAuthRequired, layoutCfg={}, mobile=false}) {
  const [branding, setBranding] = useState(() => ({logo_url:_brandingState.logo_url, site_name:_brandingState.site_name}));
  const [installPrompt, setInstallPrompt] = useState(window._installPrompt||null);
  const [installDismissed, setInstallDismissed] = useState(false);
  const [, forceExploreUpdate] = useState(0);
  // Only show on mobile — beforeinstallprompt fires on desktop Chrome too
  // but "Add to home screen" only makes sense on a mobile device.
  const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  useEffect(()=>{
    setBranding({logo_url:_brandingState.logo_url, site_name:_brandingState.site_name});
    onBrandingChange(b=>setBranding({logo_url:b.logo_url, site_name:b.site_name}));
  },[]);
  useEffect(()=>{
    setInstallPrompt(window._installPrompt||null);
    const unsub = window.onInstallPromptChange?.(p=>setInstallPrompt(p||null));
    return ()=>unsub?.();
  },[]);
  useEffect(()=>{
    const unsub = window.NexusExtensions.onExploreChange(()=>forceExploreUpdate(n=>n+1));
    return unsub;
  },[]);
  const SbItem = ({icon, label, count, badge, targetPage, targetProps={}}) => {
    const active = page===targetPage && JSON.stringify(pageProps)===JSON.stringify(targetProps);
    return (
      <div className={`sb-item ${active?"active":""}`} onClick={()=>navigate(targetPage,targetProps)}>
        <i className={`fa-solid ${icon}`}></i>
        <span className="sb-item-name">{label}</span>
        {badge>0 && <span className="sb-badge">{badge}</span>}
        {count!=null && !badge && <span className="sb-item-count">{count}</span>}
      </div>
    );
  };
  return (
    <div className={mobile?"mob-sidebar-inner":"sidebar"}>
      <div className="sb-logo" style={{cursor:"pointer"}} onClick={()=>navigate("feed",{})}>
        {branding.logo_url
          ?<img src={branding.logo_url} style={{height:32,maxWidth:140,objectFit:"contain"}} alt={branding.site_name||"nexus"}/>
          :<span className="logo-text">{branding.site_name||<>nexus<em>.</em></>}</span>}
      </div>
      <div className="sb-scroll">
        {installPrompt&&isMobileDevice&&!installDismissed&&(
          <div style={{margin:"8px 12px 4px",background:"var(--ac-bg)",border:"0.5px solid var(--ac-border)",borderRadius:10,padding:"9px 14px",display:"flex",alignItems:"center",gap:10}}>
            <i className="fa-solid fa-mobile-screen" style={{fontSize:14,color:"var(--ac)",flexShrink:0}}/>
            <button
              style={{flex:1,background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,color:"var(--ac-text)",fontWeight:500,textAlign:"left",padding:0}}
              onClick={async()=>{
                if(!installPrompt) return;
                installPrompt.prompt();
                await installPrompt.userChoice;
                setInstallPrompt(null);
                window._installPrompt=null;
              }}>
              Add to home screen
            </button>
            <button
              onClick={()=>setInstallDismissed(true)}
              style={{background:"none",border:"none",cursor:"pointer",color:"var(--t4)",fontSize:15,padding:"0 2px",lineHeight:1,flexShrink:0,fontFamily:"inherit"}}
              title="Dismiss">
              ✕
            </button>
          </div>
        )}
        {(()=>{
          // Ordered sections from layout config
          var savedSections = layoutCfg.sidebar_sections;
          var sections = savedSections && savedSections.length
            ? savedSections.map(function(s){return SIDEBAR_SECTIONS.find(function(d){return d.id===s.id;})||s;})
            : SIDEBAR_SECTIONS.slice();
          // Append any missing
          SIDEBAR_SECTIONS.forEach(function(d){if(!sections.find(function(s){return s.id===d.id;}))sections.push(d);});

          var savedExplore = layoutCfg.explore_items;
          var exploreItems = savedExplore && savedExplore.length
            ? savedExplore.map(function(s){
                var def = EXPLORE_ITEMS.find(function(d){return d.id===s.id;});
                if(def) return Object.assign({}, def, {hidden: s.hidden || false});
                return s;
              })
            : EXPLORE_ITEMS.slice();
          // Drop any saved entries whose extension is disabled or uninstalled.
          // savedExplore can contain extension entries persisted from a
          // prior layout save — those need filtering by active state too,
          // not just the live-registered list below.
          exploreItems = exploreItems.filter(function(item) {
            return !item.slug || window.NexusExtensions.isExtensionActive(item.slug);
          });
          EXPLORE_ITEMS.forEach(function(d){if(!exploreItems.find(function(s){return s.id===d.id;}))exploreItems.push(d);});
          // Append extension-registered explore items (not yet in the saved list)
          window.NexusExtensions.getExploreItems().forEach(function(d){
            if(!exploreItems.find(function(s){return s.id===d.id;}))exploreItems.push(d);
          });
          // Filter out hidden items before rendering
          exploreItems = exploreItems.filter(function(item){ return !item.hidden; });

          // Ordered spaces from layout config
          var savedSpaceOrder = layoutCfg.spaces_order;
          var orderedSpaces = spaces.slice();
          if(savedSpaceOrder && savedSpaceOrder.length){
            orderedSpaces.sort(function(a,b){
              var ai=savedSpaceOrder.indexOf(a.id); var bi=savedSpaceOrder.indexOf(b.id);
              if(ai===-1) return 1; if(bi===-1) return -1; return ai-bi;
            });
          }

          var exploreMap = {
            everything: <SbItem key="everything" icon="fa-border-all" label="Everything" targetPage="feed" targetProps={{}}/>,
            search:     <SbItem key="search" icon="fa-magnifying-glass" label="Search" targetPage="search" targetProps={{}}/>,
            notifications: currentUser&&<SbItem key="notifications" icon="fa-bell" label="Notifications" targetPage="notifications" badge={notifCount}/>,
            messages:   currentUser&&<SbItem key="messages" icon="fa-message" label="Messages" targetPage="messages" badge={msgCount}/>,
            members:    <SbItem key="members" icon="fa-users" label="Members" targetPage="members"/>,
            tags:       <SbItem key="tags" icon="fa-tag" label="Tags" targetPage="tags"/>,
            leaderboard:<SbItem key="leaderboard" icon="fa-trophy" label="Leaderboard" targetPage="leaderboard"/>,
            badges:     <SbItem key="badges" icon="fa-medal" label="Badges" targetPage="badges"/>,
          };

          return sections.map(function(sec, si){
            var divider = si > 0 ? <div key={"div"+si} className="sb-divider"/> : null;
          if(sec.id === "explore") return <React.Fragment key="explore">
              {divider}<div className="sb-label">Explore</div>
              {exploreItems.map(function(item){
                if(exploreMap[item.id]) return exploreMap[item.id];
                // Extension-registered item — navigate by URL through urlToPage,
                // the same code path that handles hard refresh.
                if(item._ext) {
                  if(item.authOnly && !currentUser) return null;
                  const extActive = pageToUrl(page, pageProps) === item.url;
                  return <div key={item.id} className={`sb-item ${extActive?"active":""}`}
                    onClick={()=>{ const r = urlToPage(item.url); navigate(r.page, r.props); }}>
                    <i className={`fa-solid ${item.icon}`}/>
                    <span className="sb-item-name">{item.label}</span>
                  </div>;
                }
                return null;
              })}
            </React.Fragment>;
            if(sec.id === "spaces") return <React.Fragment key="spaces">
              {divider}<div className="sb-label">Spaces</div>
              {(()=>{
                // Separate top-level and sub-spaces
                const topLevel = orderedSpaces.filter(s => !s.parent_id);
                const subMap   = {};
                orderedSpaces.filter(s => s.parent_id).forEach(s => {
                  if (!subMap[s.parent_id]) subMap[s.parent_id] = [];
                  subMap[s.parent_id].push(s);
                });

                // Determine which parent should be auto-expanded:
                // the parent of the currently active sub-space, if any.
                const activeSubSpace = pageProps?.space
                  ? orderedSpaces.find(s => s.slug === pageProps.space && s.parent_id)
                  : null;
                const autoExpandParentId = activeSubSpace ? activeSubSpace.parent_id : null;

                const spaceTotals = rollupSpaceCounts(orderedSpaces);

                return topLevel.map(s => {
                  const col      = spaceColor(s);
                  const children = subMap[s.id] || [];
                  const hasChildren = children.length > 0;
                  // Parent is active if viewing its feed directly (not a sub-space)
                  const parentActive = page === "feed" && pageProps?.space === s.slug;
                  // Parent is expanded if it was auto-expanded due to active child,
                  // tracked in local state via data attribute — we use React key trick
                  const defaultExpanded = s.id === autoExpandParentId;

                  if (!hasChildren) {
                    return (
                      <div key={s.id} className={`sb-item ${parentActive ? "active" : ""}`}
                        onClick={() => navigate("feed", {space: s.slug})}>
                        <i className={`fa-solid ${s.icon || "fa-layer-group"}`} style={{color: parentActive ? col : undefined}}/>
                        <span className="sb-item-name">{s.name}</span>
                        {spaceTotals[s.id] > 0 && <span className="sb-item-count">{spaceTotals[s.id]}</span>}
                      </div>
                    );
                  }

                  // Space has children — split hit areas
                  return (
                    <SpaceWithChildren key={s.id}
                      space={s} col={col} children={children}
                      totals={spaceTotals}
                      parentActive={parentActive}
                      defaultExpanded={defaultExpanded}
                      page={page} pageProps={pageProps}
                      navigate={navigate}
                    />
                  );
                });
              })()}
            </React.Fragment>;
            if(sec.id === "you" && currentUser) return <React.Fragment key="you">
              {divider}<div className="sb-label">You</div>
              <SbItem icon="fa-rss" label="Following" targetPage="following" count={null}/>
              <SbItem icon="fa-bookmark" label="Saved" targetPage="saved" count={null}/>
              <SbItem icon="fa-pen-to-square" label="Your Threads" targetPage="profile" targetProps={{username:currentUser?.username}} count={null}/>
            </React.Fragment>;
            return null;
          });
        })()}
        {(currentUser?.role==="moderator"||currentUser?.role==="admin")&&<>
          <div className="sb-divider"/>
          <SbItem icon="fa-shield-halved" label="Moderation" targetPage="moderation" badge={modReportCount}/>
        </>}
        {currentUser?.role==="admin"&&<>
          <SbItem icon="fa-gear" label="Admin Panel" targetPage="admin"/>
        </>}
      </div>
    </div>
  );
}

// ── Shared topbar ─────────────────────────────────────────────────────────────
// ── PendingDeletionBanner ─────────────────────────────────────────────────────
// Shown below the topbar on every page while an account deletion is pending.
function PendingDeletionBanner({scheduledAt, onCancel, onNavigateSettings}) {
  const dateStr = scheduledAt ? new Date(scheduledAt).toLocaleString() : "soon";
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,background:"rgba(248,113,113,0.08)",borderBottom:"0.5px solid rgba(248,113,113,0.2)",padding:"10px 20px",flexShrink:0}}>
      <i className="fa-solid fa-triangle-exclamation" style={{fontSize:13,color:"var(--red)",flexShrink:0}}/>
      <div style={{flex:1,fontSize:12,color:"rgba(248,113,113,0.8)"}}>
        Your account is scheduled for deletion on <strong style={{color:"var(--red)"}}>{dateStr}</strong> — you can still read but not post or reply.
      </div>
      <button className="btn-ghost" style={{fontSize:11,padding:"4px 12px",flexShrink:0}} onClick={onCancel}>Cancel deletion</button>
    </div>
  );
}

function TopBar({currentUser, navigate, onLogout, notifCount=0, msgCount=0, onSearch, onAuthRequired, registrationOpen=true, onToggleRight}) {
  const [q,setQ]=useState("");
  const [drop,setDrop]=useState(null); // {posts, replies} | null
  const [searching,setSearching]=useState(false);
  const searchRef=useRef();
  const debounceRef=useRef();
  const [currentTheme, setCurrentTheme]=useState(()=>document.documentElement.getAttribute("data-theme")||"dark");

  // Keep currentTheme in sync when applyTheme mutates the DOM externally
  useEffect(()=>{
    const observer=new MutationObserver(()=>{
      const t=document.documentElement.getAttribute("data-theme")||"dark";
      setCurrentTheme(t);
    });
    observer.observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
    return ()=>observer.disconnect();
  },[]);

  const runSearch=useCallback(async(val)=>{
    if(!val.trim()){setDrop(null);return;}
    setSearching(true);
    try{
      const d=await api.get(`/search?q=${encodeURIComponent(val)}`);
      setDrop(d);
    }catch{setDrop(null);}
    finally{setSearching(false);}
  },[]);

  const onChange=e=>{
    const val=e.target.value; setQ(val);
    clearTimeout(debounceRef.current);
    if(!val.trim()){setDrop(null);return;}
    debounceRef.current=setTimeout(()=>runSearch(val),300);
  };

  const goAll=()=>{ setDrop(null); onSearch?.(q); };

  // Close dropdown on outside click
  useEffect(()=>{
    const fn=e=>{ if(searchRef.current&&!searchRef.current.contains(e.target)) setDrop(null); };
    document.addEventListener("mousedown",fn);
    return ()=>document.removeEventListener("mousedown",fn);
  },[]);

  const posts = (drop?.posts||[]).slice(0,5);
  const replies = (drop?.replies||[]).slice(0,3);
  const hasResults = posts.length>0||replies.length>0;

  return (
    <div className="topbar">
      <div className="tb-search" ref={searchRef} style={{position:"relative"}} onClick={e=>{if(e.currentTarget===e.target||e.target.closest("i"))searchRef.current?.querySelector("input")?.focus();}}>
        <i className="fa-solid fa-magnifying-glass" style={{fontSize:14,color:searching?"var(--ac)":"rgba(255,255,255,0.25)",transition:"color .2s",flexShrink:0}}></i>
        <input placeholder="search threads…" value={q}
          onChange={onChange}
          onKeyDown={e=>{if(e.key==="Enter"){clearTimeout(debounceRef.current);goAll();}if(e.key==="Escape"){setDrop(null);setQ("");}}}
          onFocus={()=>q.trim()&&!drop&&runSearch(q)}
        />
        {drop&&(
          <div className="tb-search-drop">
            {!hasResults&&<div style={{padding:"20px 14px",color:"var(--t5)",fontSize:13,textAlign:"center"}}>No results for "{q}"</div>}
            {posts.length>0&&<>
              <div className="tb-search-section">Threads</div>
              {posts.map(p=>{
                const col=spaceColor(p.space||{id:p.id});
                return (
                  <div key={p.id} className="tb-search-item" onClick={()=>{setDrop(null);setQ("");navigate("post",{id:p.id});}}>
                    <RsAv user={p.user} size={28} color={userColor(p.user)}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div className="tb-search-title">{p.title}</div>
                      {p.space&&<div style={{fontSize:10,color:col,marginTop:1}}>{p.space.name}</div>}
                    </div>
                    <span style={{fontSize:11,color:"var(--t5)",flexShrink:0}}>{ago(p.inserted_at)}</span>
                  </div>
                );
              })}
            </>}
            {replies.length>0&&<>
              <div className="tb-search-section">Replies</div>
              {replies.map(r=>(
                <div key={r.id} className="tb-search-item" onClick={()=>{setDrop(null);setQ("");navigate("post",{id:r.post_id});}}>
                  <RsAv user={r.user} size={28} color={userColor(r.user)}/>
                  <div className="tb-search-sub">{r.body?.replace(/!?\[.*?\]\(.*?\)/g,"").replace(/[#*`>]/g,"").slice(0,80)}</div>
                </div>
              ))}
            </>}
            {hasResults&&<div className="tb-search-all" onClick={goAll}>See all results for "{q}" →</div>}
          </div>
        )}
      </div>
      <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
        {currentUser ? <>
          <div className="icon-btn" onClick={()=>navigate("notifications")} title="Notifications">
            <i className="fa-solid fa-bell" style={{fontSize:16}}></i>
            {notifCount>0&&<div className="icon-badge"/>}
          </div>
          <div className="icon-btn" onClick={()=>navigate("messages")} title="Messages">
            <i className="fa-solid fa-message" style={{fontSize:16}}></i>
            {msgCount>0&&<div className="icon-badge green"/>}
          </div>
          <div className="icon-btn" onClick={()=>navigate("drafts")} title="Drafts">
            <i className="fa-solid fa-file-pen" style={{fontSize:16}}></i>
          </div>
          {window._darkEnabled!==false&&window._lightEnabled!==false&&(
            <div className="icon-btn" title={currentTheme==="dark"?"Switch to light mode":"Switch to dark mode"}
              onClick={()=>{
                const next=currentTheme==="dark"?"light":"dark";
                try { localStorage.setItem("nexus_theme_pref", next); } catch {}
                window._applyTheme&&window._applyTheme(next, window._appBrandingForTheme||{});
              }}>
              <i className={`fa-solid ${currentTheme==="dark"?"fa-sun":"fa-moon"}`} style={{fontSize:16}}/>
            </div>
          )}
          <button className="write-btn" onClick={()=>navigate("compose")}>+ write</button>
          <AvatarMenu user={currentUser} navigate={navigate} onLogout={onLogout}/>
        </> : <>
          <button onClick={()=>onAuthRequired?.("login")} className="write-btn" style={{background:"transparent",border:"1.5px solid var(--b2)",color:"var(--t2)"}}>Log in</button>
          {registrationOpen&&<button onClick={()=>onAuthRequired?.("register")} className="write-btn">Sign up</button>}
        </>}
        {/* Right-panel toggle. Only rendered between the mobile breakpoint and
            the width at which .right-panel becomes visible again (see the
            .tb-right-toggle rule in app.css). In that band the panel is
            display:none with no other way to reach it.

            Sits after the currentUser conditional for two reasons: it is the
            rightmost control, mirroring the activity trigger's position in
            .mob-topbar and sitting on the same edge as the panel it opens; and
            being outside both branches it renders for guests as well as
            members without duplicating the markup. Same icon and label as the
            mobile trigger. */}
        {onToggleRight&&(
          <div className="tb-right-toggle" onClick={onToggleRight}
               title="Activity" aria-label="Open activity panel">
            <i className="fa-solid fa-chart-simple" style={{fontSize:16}}></i>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Right Panel ───────────────────────────────────────────────────────────────
// ── Online members widget ─────────────────────────────────────────────────────
// Global widget showing members active in the last 15 minutes.
// Polls every 60 seconds. Clicking an avatar opens the user card.
// Shows up to 18 avatars; any beyond that collapses to a +X pill.

function OnlineMembersWidget({navigate, currentUser}) {
  const [members, setMembers] = useState([]);
  const [extra,   setExtra]   = useState(0);

  const fetchOnline = useCallback(() => {
    api.get("/users/online").then(d => {
      if (d.members) { setMembers(d.members); setExtra(d.extra || 0); }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetchOnline();
    const t = setInterval(fetchOnline, 60_000);
    return () => clearInterval(t);
  }, [fetchOnline]);

  if (!currentUser || !members.length) return null;

  return (
    <div className="rw">
      <div className="rw-label" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span>online now</span>
        <span style={{fontSize:11,letterSpacing:0,textTransform:"none",fontWeight:400}}>
          {members.length + extra} member{members.length + extra !== 1 ? "s" : ""}
        </span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(6, 36px)",gap:8}}>
        {members.map(u => (
          <RsAv key={u.id} user={u} size={36} />
        ))}
        {extra > 0 && (
          <div
            onClick={() => navigate("members")}
            style={{
              width:36, height:36, borderRadius:"var(--av-radius)",
              background:"rgba(255,255,255,0.07)",
              border:"0.5px solid rgba(255,255,255,0.12)",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:11, fontWeight:500, color:"var(--t4)", cursor:"pointer",
            }}
          >
            +{extra}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Post page right sidebar widgets ──────────────────────────────────────────
// Each is a standalone component receiving { navigate, currentUser, pageProps }
// where pageProps.id is the postId.

function PostAuthorWidget({navigate, currentUser, pageProps}) {
  const postId = pageProps?.id;
  const [author, setAuthor] = useState(null);
  useEffect(()=>{
    if(!postId) return;
    setAuthor(null);
    api.get(`/posts/${postId}`).then(d=>{
      const p = d.post;
      if(!p?.user?.username) return;
      api.get(`/users/${p.user.username}`).then(ud=>{
        if(ud.user) setAuthor(ud.user);
      }).catch(()=>{});
    }).catch(()=>{});
  },[postId]);
  if(!author) return null;
  return (
    <div className="rw">
      <div className="rw-label">posted by</div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,cursor:"pointer"}}
        onClick={()=>navigate("profile",{username:author.username})}>
        <RsAv user={author} size={38} />
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13,fontWeight:500,color:"var(--t1)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{author.username}</div>
          {author.role&&author.role!=="member"&&<div style={{fontSize:10,color:"var(--ac)",textTransform:"capitalize"}}>{author.role}</div>}
        </div>
      </div>
      {author.bio&&<div style={{fontSize:12,color:"var(--t4)",lineHeight:1.55,marginBottom:10}}>{author.bio.slice(0,120)}{author.bio.length>120?"…":""}</div>}
      <div style={{display:"flex",gap:6}}>
        <div className="ucard-stat"><div className="ucard-stat-n">{author.post_count||0}</div><div className="ucard-stat-l">posts</div></div>
        <div className="ucard-stat"><div className="ucard-stat-n">{author.reply_count||0}</div><div className="ucard-stat-l">replies</div></div>
        <div className="ucard-stat"><div className="ucard-stat-n" style={{color:"var(--ac)"}}>{author.reactions_received||0}</div><div className="ucard-stat-l">reactions</div></div>
      </div>
    </div>
  );
}

function PostParticipantsWidget({navigate, currentUser, pageProps}) {
  const postId = pageProps?.id;
  const [participants, setParticipants] = useState([]);
  useEffect(()=>{
    if(!postId) return;
    setParticipants([]);
    api.get(`/posts/${postId}/replies`).then(d=>{
      const replies = d.replies||[];
      const seen = new Set();
      const people = [];
      replies.forEach(r=>{
        if(r.user && !seen.has(r.user.id)) {
          seen.add(r.user.id);
          people.push(r.user);
        }
      });
      setParticipants(people.slice(0,12));
    }).catch(()=>{});
  },[postId]);
  if(!participants.length) return null;
  return (
    <div className="rw">
      <div className="rw-label">participants · {participants.length}</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:4}}>
        {participants.map(u=>(
          <div key={u.id} title={u.username} style={{cursor:"pointer"}}
            onClick={()=>navigate("profile",{username:u.username})}>
            <RsAv user={u} size={28} noCard />
          </div>
        ))}
      </div>
    </div>
  );
}

function PostRelatedWidget({navigate, currentUser, pageProps}) {
  const postId = pageProps?.id;
  const [related, setRelated] = useState([]);
  const [spaceName, setSpaceName] = useState(null);
  const [col, setCol] = useState("var(--ac)");
  useEffect(()=>{
    if(!postId) return;
    setRelated([]); setSpaceName(null);
    api.get(`/posts/${postId}`).then(d=>{
      const p = d.post;
      if(!p?.space?.slug) return;
      setSpaceName(p.space.name);
      setCol(spaceColor(p.space));
      api.get(`/feed?space=${p.space.slug}&sort=latest&limit=4`).then(fd=>{
        const others = (fd.posts||[]).filter(r=>r.id!==postId).slice(0,4);
        setRelated(others);
      }).catch(()=>{});
    }).catch(()=>{});
  },[postId]);
  if(!related.length || !spaceName) return null;
  return (
    <div className="rw">
      <div className="rw-label">more in {spaceName}</div>
      {related.map(r=>(
        <div key={r.id} onClick={()=>navigate("post",{id:r.id})}
          style={{padding:"7px 0",borderBottom:"0.5px solid var(--b1)",cursor:"pointer",display:"flex",alignItems:"flex-start",gap:8}}>
          <div style={{width:3,height:"100%",minHeight:32,borderRadius:2,background:col,flexShrink:0,alignSelf:"stretch"}}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:12,fontWeight:500,color:"var(--t2)",lineHeight:1.4,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{r.title}</div>
            <div style={{fontSize:10,color:"var(--t5)",marginTop:3,display:"flex",gap:6}}>
              <span>{r.reply_count||0} replies</span>
              <span>·</span>
              <span>{ago(r.inserted_at)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Leaderboard / Badges / Search sidebar widgets ─────────────────────────────
function LeaderboardSidebarWidget({navigate, currentUser, pageProps}) {
  return <LeaderboardPageSidebar currentUser={currentUser} navigate={navigate}/>;
}

function BadgesSidebarWidget({navigate, currentUser, pageProps}) {
  return <BadgesPageSidebar currentUser={currentUser} navigate={navigate}/>;
}

function SearchFilterWidget({navigate, currentUser, pageProps}) {
  return <SearchFilterPanel spaces={pageProps?.spaces||[]} tags={pageProps?.tags||[]} navigate={navigate}/>;
}

// Stable module-level components — must NOT be defined inside SearchFilterPanel
// or any other component, otherwise React remounts them on every render and
// inputs inside them lose focus after each keystroke.
function FilterPills({options, value, onChange}) {
  return (
    <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
      {options.map(({v,label}) => (
        <button key={v} onClick={()=>onChange(v)} style={{
          fontSize:11, padding:"3px 10px", borderRadius:20, cursor:"pointer",
          fontFamily:"inherit", border:"0.5px solid",
          borderColor: value===v ? "var(--ac-border)" : "var(--b2)",
          background:  value===v ? "var(--ac-bg)"     : "transparent",
          color:       value===v ? "var(--ac-text)"   : "var(--t4)",
        }}>{label}</button>
      ))}
    </div>
  );
}

function FilterSection({label, children}) {
  return (
    <div className="rw">
      <div className="rw-label">{label}</div>
      {children}
    </div>
  );
}

// ── Search filter panel ───────────────────────────────────────────────────────
// Renders in the right sidebar on the search page.
// Communicates filter changes to SearchPage via a window custom event so the
// two components don't need to be coupled through shared state.
function SearchFilterPanel({spaces=[], tags=[], navigate}) {
  const [kind,      setKind]      = useState("all");
  const [sort,      setSort]      = useState("relevance");
  const [space,     setSpace]     = useState("");
  const [tag,       setTag]       = useState("");
  const [author,    setAuthor]    = useState("");
  const [authorObj, setAuthorObj] = useState(null); // selected user object
  const [authorQ,   setAuthorQ]   = useState("");
  const [authorRes, setAuthorRes] = useState([]);
  const [authorSearching, setAuthorSearching] = useState(false);
  const [dateFrom,  setDateFrom]  = useState("");
  const [dateTo,    setDateTo]    = useState("");
  const authorDebRef = useRef();
  const authorInputRef = useRef();

  const dispatch = (overrides={}) => {
    const filters = {kind, sort, space, tag, author, date_from: dateFrom, date_to: dateTo, ...overrides};
    window.dispatchEvent(new CustomEvent("nexus:search-filter", {detail: filters}));
  };

  const setAndDispatch = (key, val) => {
    const updates = {[key]: val};
    const state = {kind, sort, space, tag, author, date_from: dateFrom, date_to: dateTo, ...updates};
    window.dispatchEvent(new CustomEvent("nexus:search-filter", {detail: state}));
  };

  const onKind  = v => { setKind(v);  setAndDispatch("kind", v);  };
  const onSort  = v => { setSort(v);  setAndDispatch("sort", v);  };
  const onSpace = v => { setSpace(v); setAndDispatch("space", v); };
  const onTag   = v => { setTag(v);   setAndDispatch("tag", v);   };

  const onDateFrom = e => {
    setDateFrom(e.target.value);
    dispatch({date_from: e.target.value});
  };
  const onDateTo = e => {
    setDateTo(e.target.value);
    dispatch({date_to: e.target.value});
  };

  const onAuthorInput = e => {
    const val = e.target.value;
    setAuthorQ(val);
    clearTimeout(authorDebRef.current);
    if (!val.trim()) { setAuthorRes([]); return; }
    setAuthorSearching(true);
    authorDebRef.current = setTimeout(async () => {
      try {
        const d = await api.get(`/users?q=${encodeURIComponent(val)}`);
        setAuthorRes((d.members||[]).slice(0,6));
      } finally { setAuthorSearching(false); }
    }, 200);
  };

  const selectAuthor = user => {
    setAuthorObj(user);
    setAuthor(user.username);
    setAuthorQ("");
    setAuthorRes([]);
    setAndDispatch("author", user.username);
  };

  const clearAuthor = () => {
    setAuthorObj(null);
    setAuthor("");
    setAuthorQ("");
    setAuthorRes([]);
    setAndDispatch("author", "");
  };

  const clearAll = () => {
    setKind("all"); setSort("relevance"); setSpace(""); setTag("");
    setAuthor(""); setAuthorObj(null); setAuthorQ(""); setAuthorRes([]);
    setDateFrom(""); setDateTo("");
    window.dispatchEvent(new CustomEvent("nexus:search-filter", {detail: {
      kind:"all", sort:"relevance", space:"", tag:"", author:"", date_from:"", date_to:""
    }}));
  };

  const activeCount = [
    kind !== "all", sort !== "relevance", !!space, !!tag, !!author, !!dateFrom, !!dateTo
  ].filter(Boolean).length;

  return (
    <>
      {activeCount > 0 && (
        <div style={{display:"flex",justifyContent:"flex-end"}}>
          <button onClick={clearAll} className="btn-ghost" style={{fontSize:11,padding:"4px 10px",color:"var(--t4)"}}>
            Clear all filters
          </button>
        </div>
      )}

      <FilterSection label="show">
        <FilterPills
          options={[{v:"all",label:"Both"},{v:"posts",label:"Threads"},{v:"replies",label:"Replies"}]}
          value={kind} onChange={onKind}
        />
      </FilterSection>

      <FilterSection label="sort">
        <FilterPills
          options={[{v:"relevance",label:"Relevance"},{v:"latest",label:"Latest"},{v:"top",label:"Top"}]}
          value={sort} onChange={onSort}
        />
      </FilterSection>

      {spaces.length > 0 && (
        <FilterSection label="space">
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            <button onClick={()=>onSpace("")} style={{
              fontSize:11, padding:"3px 10px", borderRadius:20, cursor:"pointer",
              fontFamily:"inherit", border:"0.5px solid",
              borderColor: !space ? "var(--ac-border)" : "var(--b2)",
              background:  !space ? "var(--ac-bg)"     : "transparent",
              color:       !space ? "var(--ac-text)"   : "var(--t4)",
            }}>All</button>
            {spaces.map(s => (
              <button key={s.id} onClick={()=>onSpace(space===s.slug?"":s.slug)} style={{
                fontSize:11, padding:"3px 10px", borderRadius:20, cursor:"pointer",
                fontFamily:"inherit", border:"0.5px solid",
                borderColor: space===s.slug ? "var(--ac-border)" : "var(--b2)",
                background:  space===s.slug ? "var(--ac-bg)"     : "transparent",
                color:       space===s.slug ? "var(--ac-text)"   : "var(--t4)",
              }}>{s.name}</button>
            ))}
          </div>
        </FilterSection>
      )}

      {tags.length > 0 && (
        <FilterSection label="tag">
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            <button onClick={()=>onTag("")} style={{
              fontSize:11, padding:"3px 10px", borderRadius:20, cursor:"pointer",
              fontFamily:"inherit", border:"0.5px solid",
              borderColor: !tag ? "var(--ac-border)" : "var(--b2)",
              background:  !tag ? "var(--ac-bg)"     : "transparent",
              color:       !tag ? "var(--ac-text)"   : "var(--t4)",
            }}>All</button>
            {tags.map(t => (
              <button key={t.id} onClick={()=>onTag(tag===t.slug?"":t.slug)} style={{
                fontSize:11, padding:"3px 10px", borderRadius:20, cursor:"pointer",
                fontFamily:"inherit", border:"0.5px solid",
                borderColor: tag===t.slug ? "var(--ac-border)" : "var(--b2)",
                background:  tag===t.slug ? "var(--ac-bg)"     : "transparent",
                color:       tag===t.slug ? "var(--ac-text)"   : "var(--t4)",
              }}>#{t.name}</button>
            ))}
          </div>
        </FilterSection>
      )}

      <FilterSection label="author">
        {authorObj ? (
          <div style={{display:"flex",alignItems:"center",gap:8,background:"var(--s3)",borderRadius:8,padding:"6px 10px"}}>
            <RsAv user={authorObj} size={20} noCard/>
            <span style={{fontSize:12,color:"var(--t1)",flex:1}}>{authorObj.username}</span>
            <button onClick={clearAuthor} style={{background:"none",border:"none",color:"var(--t4)",cursor:"pointer",fontSize:12,padding:0}}>
              <i className="fa-solid fa-xmark"/>
            </button>
          </div>
        ) : (
          <div style={{position:"relative"}}>
            <input
              ref={authorInputRef}
              className="fi"
              placeholder="Username…"
              value={authorQ}
              onChange={onAuthorInput}
              style={{fontSize:12,padding:"6px 12px",width:"100%"}}
            />
            {authorSearching && (
              <i className="fa-solid fa-spinner fa-spin" style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",color:"var(--t5)",fontSize:11}}/>
            )}
            {authorRes.length > 0 && (
              <div style={{border:"0.5px solid var(--b1)",borderRadius:8,overflow:"hidden",marginTop:4,background:"var(--s2)"}}>
                {authorRes.map((u,i) => (
                  <div key={u.id} onClick={()=>selectAuthor(u)} style={{
                    display:"flex",alignItems:"center",gap:8,padding:"7px 10px",cursor:"pointer",
                    borderBottom:i<authorRes.length-1?"0.5px solid var(--b1)":"none",
                  }}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--s3)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <RsAv user={u} size={22} noCard/>
                    <span style={{fontSize:12,color:"var(--t1)"}}>{u.username}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </FilterSection>

      <FilterSection label="date range">
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          <input
            type="date" className="fi" value={dateFrom} onChange={onDateFrom}
            style={{fontSize:12,padding:"6px 10px",width:"100%"}}
          />
          <input
            type="date" className="fi" value={dateTo} onChange={onDateTo}
            style={{fontSize:12,padding:"6px 10px",width:"100%"}}
          />
        </div>
      </FilterSection>
    </>
  );
}

function RightPanel({spaces, tags=[], liveEvents=[], layoutCfg={}, mobile=false, currentUser, navigate, page, pageProps}) {
  const [stats, setStats] = useState({members:0, threads:0, online:0});
  const [myRank, setMyRank] = useState(null);
  const [, forceWidgetUpdate] = useState(0);
  const fetchStats = useCallback(()=>{ api.get("/stats").then(d=>setStats(d)).catch(()=>{}); }, []);
  useEffect(()=>{
    fetchStats();
    // Fetch again after a short delay so the online count reflects connected
    // WebSocket clients — Presence tracking happens async after socket connect,
    // so the immediate fetch above may race and return 0.
    const warmup = setTimeout(fetchStats, 3000);
    const t = setInterval(fetchStats, 30_000);
    return ()=>{ clearTimeout(warmup); clearInterval(t); };
  },[fetchStats]);
  useEffect(()=>{
    if(currentUser) {
      api.get("/leaderboard/me?period=all").then(d=>{ if(d.rank) setMyRank(d.rank); }).catch(()=>{});
    }
  },[currentUser]);
  useEffect(()=>{
    const unsub = window.NexusExtensions.onRightWidgetChange(()=>forceWidgetUpdate(n=>n+1));
    return unsub;
  },[]);

  // Shared with the sidebar so the two can't disagree.
  const spacePostCounts = rollupSpaceCounts(spaces);
  const sorted = spaces
    .filter(s => !s.parent_id)
    .map(s => ({...s, post_count: spacePostCounts[s.id] || 0}))
    .sort((a,b) => (b.post_count||0) - (a.post_count||0));
  const max = sorted[0]?.post_count||1;

  // Inline renderers for built-in widgets that need RightPanel closure state
  // (liveEvents, stats, spaces). All other built-ins have their own components.
  function renderBuiltin(w) {
    if(w.id === "live_activity") {
      return (
        <div className="rw" key="live_activity">
          <div className="rw-label">live activity</div>
          {liveEvents.length===0
            ?<div style={{fontSize:11,color:"var(--t5)",padding:"8px 0"}}>No recent activity</div>
            :liveEvents.slice(0,4).map((e,i)=>(
              <div key={i} className="live-row">
                <RsAv user={{username:e.username,avatar_url:e.avatarUrl,avatar_color:e.avatarColor,id:e.userId}} size={22} noCard />
                <div className="l-txt"><strong>{e.username}</strong> {e.action}</div>
                <div className="l-ago">{ago(e.at)}</div>
              </div>
            ))}
        </div>
      );
    }
    if(w.id === "spaces_by_pulse") {
      if(!sorted.length) return null;
      return (
        <div className="rw" key="spaces_by_pulse">
          <div className="rw-label">spaces by pulse</div>
          {sorted.slice(0,5).map(s=>{
            const col=spaceColor(s);
            const bw=Math.max(4, Math.round((s.post_count||0)/max*100));
            return (
              // A real button, not a div with onClick — these are the only place
              // in the app showing a space name that didn't navigate to it.
              <button key={s.id} type="button"
                onClick={()=>navigate&&navigate("feed",{space:s.slug})}
                title={`Show threads in ${s.name}`}
                aria-label={`Show threads in ${s.name}`}
                style={{padding:"5px 0",display:"block",width:"100%",background:"none",border:"none",cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}>
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:5}}>
                  <i className={`fa-solid ${s.icon||"fa-layer-group"}`} style={{fontSize:10,color:col,width:14,textAlign:"center",flexShrink:0}}/>
                  <span style={{fontSize:13,color:"var(--t3)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</span>
                  <span style={{fontSize:12,color:col,fontWeight:500,flexShrink:0}}>{s.post_count||0}</span>
                </div>
                <div className="p-bar-wrap"><div className="p-bar" style={{width:`${bw}%`,background:col}}/></div>
              </button>
            );
          })}
        </div>
      );
    }
    if(w.id === "tags_by_pulse") {
      var sortedTags = [...tags].sort((a,b)=>(b.post_count||0)-(a.post_count||0)).filter(t=>(t.post_count||0)>0);
      if(!sortedTags.length) return null;
      var maxTag = sortedTags[0].post_count||1;
      return (
        <div className="rw" key="tags_by_pulse">
          <div className="rw-label">tags by pulse</div>
          {sortedTags.slice(0,5).map(t=>{
            const col=t.color||"var(--ac)";
            const bw=Math.max(4, Math.round((t.post_count||0)/maxTag*100));
            return (
              <button key={t.id} type="button"
                onClick={()=>navigate&&navigate("feed",{tag:t.slug})}
                title={`Show threads tagged ${t.name}`}
                aria-label={`Show threads tagged ${t.name}`}
                style={{padding:"5px 0",display:"block",width:"100%",background:"none",border:"none",cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}>
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:5}}>
                  <i className="fa-solid fa-tag" style={{fontSize:10,color:col,width:14,textAlign:"center",flexShrink:0}}/>
                  <span style={{fontSize:13,color:"var(--t3)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.name}</span>
                  <span style={{fontSize:12,color:col,fontWeight:500,flexShrink:0}}>{t.post_count||0}</span>
                </div>
                <div className="p-bar-wrap"><div className="p-bar" style={{width:`${bw}%`,background:col}}/></div>
              </button>
            );
          })}
        </div>
      );
    }
    if(w.id === "stats") {
      return (
        <div className="stat-grid" key="stats">
          <div className="stat-card"><div className="stat-n">{stats.threads}</div><div className="stat-l">threads</div></div>
          <div className="stat-card"><div className="stat-n" style={{color:"var(--ac)"}}>{stats.online}</div><div className="stat-l">online</div></div>
          <div className="stat-card"><div className="stat-n">{stats.members}</div><div className="stat-l">members</div></div>
          <div className="stat-card" style={{cursor:navigate?"pointer":undefined}} onClick={()=>navigate&&navigate("leaderboard")}>
            <div className="stat-n" style={{color:"var(--ac)"}}>{myRank ? `#${myRank.rank}` : "—"}</div>
            <div className="stat-l">your rank</div>
          </div>
        </div>
      );
    }
    if(w.id === "legal_info") {
      // legacy_info is now retired — page widgets render via the "page_widget:*" id
      // prefix below. Return undefined so the slot is skipped gracefully.
      return undefined;
    }
    if(w.id && w.id.startsWith("page_widget:")) {
      var widgetData = (window._pageWidgets || []).find(function(pw){ return "page_widget:" + pw.id === w.id; });
      if(!widgetData || !widgetData.pages || widgetData.pages.length === 0) return undefined;
      return (
        <div className="rw" key={w.id}>
          <div className="rw-label">{widgetData.name}</div>
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            {widgetData.pages.map(function(p){
              return (
                <div key={p.slug}
                  style={{fontSize:13,color:"var(--t3)",display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:"0.5px solid var(--b1)",cursor:"pointer"}}
                  onClick={function(){ navigate&&navigate("page",{slug:p.slug}); }}>
                  <i className="fa-solid fa-file-lines" style={{fontSize:12,color:"var(--t5)",width:14,textAlign:"center"}}/>
                  {p.title}
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    return undefined;
  }

  // Resolve ordered, visible widget list for the current page.
  // For ext-route pages, all widgets (core globals + that extension's widgets +
  // path-specific widgets matching the URL) share a single saved-state entry
  // keyed by "ext:<slug>", so the admin configures one consolidated layout per
  // extension rather than per-route-pattern.
  function widgetMatchesPage(w, pageId, currentSlug, currentPattern) {
    var wp = w.pages;
    if (wp === "global") return true;
    // Per-extension scope (extension widgets default to this)
    if (wp && typeof wp === "object" && !Array.isArray(wp) && wp.extension) {
      return currentSlug && wp.extension === currentSlug;
    }
    if (Array.isArray(wp)) {
      // Path-specific patterns are full route patterns (e.g. "/ext/gamepedia/:slug").
      // Match those against the current route pattern. Core-page IDs ("post", "feed")
      // match against pageId. Both shapes live in the same array.
      if (wp.indexOf(pageId) !== -1) return true;
      if (currentPattern && wp.indexOf(currentPattern) !== -1) return true;
      return false;
    }
    return false;
  }

  function resolveWidgets(pageId, currentSlug, currentPattern) {
    var allExt = window.NexusExtensions.getRightWidgets();
    var candidates = [];
    RIGHT_WIDGETS.forEach(function(w) {
      if(widgetMatchesPage(w, pageId, currentSlug, currentPattern)) {
        candidates.push(Object.assign({}, w));
      }
    });
    getDynamicPageWidgets().forEach(function(w) {
      if(widgetMatchesPage(w, pageId, currentSlug, currentPattern)) {
        candidates.push(Object.assign({}, w));
      }
    });
    allExt.forEach(function(w) {
      if(widgetMatchesPage(w, pageId, currentSlug, currentPattern)) {
        candidates.push(Object.assign({}, w));
      }
    });
    // Saved-state key: "ext:<slug>" for ext-route pages, the page id otherwise.
    var savedKey = currentSlug ? ("ext:" + currentSlug) : pageId;
    var savedByPage = layoutCfg.right_widgets_by_page || {};
    var saved = savedByPage[savedKey];
    if(!saved || !saved.length) return candidates.filter(function(w){ return !w.hidden; });
    var result = [];
    saved.forEach(function(s) {
      if(s.hidden) return;
      var found = candidates.find(function(w){ return w.id === s.id; });
      if(found) result.push(found);
    });
    candidates.forEach(function(w) {
      if(!saved.find(function(s){ return s.id === w.id; })) result.push(w);
    });
    return result;
  }

  // Identify which extension (if any) we're currently inside, plus the route
  // pattern for path-scoped widget matching.
  var currentSlug    = (page === "ext-route" && pageProps?._match?.slug)    || null;
  var currentPattern = (page === "ext-route" && pageProps?._match?.pattern) || null;
  var resolvedPage   = page;  // core page id, or "ext-route" for extension pages

  // Enrich pageProps passed to widgets — search widget needs spaces/tags
  var enrichedPageProps = Object.assign({}, pageProps, {spaces: spaces, tags: tags});

  var widgets = resolveWidgets(resolvedPage, currentSlug, currentPattern);

  return (
    <div className={mobile?"mob-rightpanel-inner":"right-panel"}>
      {widgets.map(function(w) {
        // Try built-in inline renderer first (live_activity, spaces_by_pulse, stats)
        var builtin = renderBuiltin(w);
        if(builtin !== undefined) return builtin;
        // Component-based widget (built-in or extension)
        if(w.component) {
          return React.createElement(w.component, {
            key: w.id,
            navigate: navigate,
            currentUser: currentUser,
            pageProps: enrichedPageProps,
          });
        }
        return null;
      })}
    </div>
  );
}

// ── Static page view ─────────────────────────────────────────────────────────
// Renders a published static page at /p/:slug (privacy policy, guidelines, etc.)
function PageViewPage({slug, navigate}) {
  const [page,    setPage]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) { setNotFound(true); setLoading(false); return; }
    setLoading(true);
    api.get(`/pages/${slug}`)
      .then(d => {
        if (d.page) { setPage(d.page); }
        else        { setNotFound(true); }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return (
    <div style={{padding:"40px 24px",textAlign:"center",color:"var(--t5)",fontSize:13}}>Loading…</div>
  );

  if (notFound) return (
    <div style={{padding:"40px 24px",textAlign:"center"}}>
      <i className="fa-solid fa-file-circle-question" style={{fontSize:32,color:"var(--t5)",display:"block",marginBottom:12}}/>
      <div style={{fontSize:15,fontWeight:500,color:"var(--t2)",marginBottom:8}}>Page not found</div>
      <div style={{fontSize:13,color:"var(--t4)",marginBottom:16}}>This page doesn't exist or isn't published yet.</div>
      <button className="btn-ghost" style={{fontSize:13}} onClick={()=>navigate("feed")}>Back to feed</button>
    </div>
  );

  return (
    <div className="post-content-wrap">
      <button className="btn-ghost" style={{fontSize:12,padding:"5px 12px",marginBottom:20}}
        onClick={()=>window.history.back()}>
        <i className="fa-solid fa-arrow-left" style={{marginRight:6}}/>Back
      </button>
      <h1 style={{fontSize:24,fontWeight:700,color:"var(--t1)",marginBottom:6,letterSpacing:"-.3px"}}>{page.title}</h1>
      <div style={{fontSize:12,color:"var(--t5)",marginBottom:28}}>
        Last updated {new Date(page.updated_at).toLocaleDateString()}
      </div>
      <div className="md-body" dangerouslySetInnerHTML={{__html: renderMd(page.body || "")}}/>
    </div>
  );
}

// ── Extension route page ──────────────────────────────────────────────────────
// Generic wrapper rendered when the SPA lands on an extension-registered route.
// Extensions call:
//   window.NexusExtensions.registerRoute("my-ext", "/users/:username", MyPage, { title: "My Page" });
// MyPage receives ({ navigate, currentUser, ...params }) where params are the
// named segments extracted from the URL (e.g. { username: "alice" }).
//
// The wrapper provides a standard back-button header using the optional title
// from the route's options. If the extension bundle hasn't loaded yet it polls
// briefly and shows a spinner in the meantime.
function ExtensionRoutePage({ _match, currentUser, navigate, ...params }) {
  const [, forceUpdate] = React.useState(0);
  const [timedOut, setTimedOut] = React.useState(false);

  // Re-check once the bundle registers its component (handles race where the
  // page is navigated to before the bundle finishes loading, or when popstate
  // restores history state that had the component function stripped by JSON serialization).
  React.useEffect(() => {
    // First try resolving immediately from the live registry
    const live = window.NexusExtensions.matchRoute(window.location.pathname);
    if (live?.component && !_match?.component) {
      forceUpdate(n => n + 1);
      return;
    }
    if (_match?.component) return;

    // Poll for up to 8 seconds, then show an error
    let elapsed = 0;
    const id = setInterval(() => {
      elapsed += 100;
      if (window.NexusExtensions.matchRoute(window.location.pathname)?.component) {
        clearInterval(id);
        forceUpdate(n => n + 1);
      } else if (elapsed >= 8000) {
        clearInterval(id);
        setTimedOut(true);
      }
    }, 100);
    return () => clearInterval(id);
  }, []);

  // Resolve component from live registry if _match is missing/stale (e.g. after popstate)
  const liveMatch = window.NexusExtensions.matchRoute(window.location.pathname);
  const Component = _match?.component || liveMatch?.component;
  const title     = _match?.options?.title || liveMatch?.options?.title || "";
  // On hard refresh, params come from liveMatch (URL re-parsed against registry)
  // rather than from props, which may be empty if urlToPage ran before bundles loaded.
  const resolvedParams = Object.keys(params).length > 0 ? params : (liveMatch?.params || {});

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{height:48,borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"center",padding:"0 24px",flexShrink:0}}>
        <button className="mob-icon-btn mob-only" onClick={()=>window.history.back()} aria-label="Back" style={{marginRight:8}}>
          <i className="fa-solid fa-arrow-left"/>
        </button>
        {title && <span style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>{title}</span>}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"0 28px"}}>
        {Component
          ? <Component {...resolvedParams} currentUser={currentUser} navigate={navigate}/>
          : timedOut
            ? <div style={{padding:"48px 0",textAlign:"center",color:"var(--t5)",fontSize:14}}>
                <i className="fa-solid fa-circle-exclamation" style={{marginRight:8,color:"var(--red)"}}/>
                Extension failed to load.{" "}
                <span style={{cursor:"pointer",color:"var(--ac)",textDecoration:"underline"}} onClick={()=>window.location.reload()}>Reload</span>
              </div>
            : <div style={{padding:"48px 0",textAlign:"center",color:"var(--t5)",fontSize:14}}>
                <i className="fa-solid fa-spinner fa-spin" style={{marginRight:8}}/>Loading…
              </div>
        }
      </div>
    </div>
  );
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function useSocket(token, userId, onNewPost, onNewNotif, onNewMsg, onUnreadCount, onReplyCountUpdate) {
  const wsRef = useRef(null);
  const heartbeatRef = useRef(null);
  const reconnectRef = useRef(null);
  const reconnectDelay = useRef(3000);
  const refSeq = useRef(1);
  // Topics the application wants to be joined. Persists across reconnects.
  const desiredTopics = useRef(new Set());
  // Topics actually joined on the current live socket.
  const joinedTopics = useRef(new Set());
  const mountedRef = useRef(true);

  const onNewPostRef = useRef(onNewPost);
  const onNewNotifRef = useRef(onNewNotif);
  const onNewMsgRef = useRef(onNewMsg);
  const onUnreadCountRef = useRef(onUnreadCount);
  const onReplyCountUpdateRef = useRef(onReplyCountUpdate);
  useEffect(() => { onNewPostRef.current = onNewPost; }, [onNewPost]);
  useEffect(() => { onNewNotifRef.current = onNewNotif; }, [onNewNotif]);
  useEffect(() => { onNewMsgRef.current = onNewMsg; }, [onNewMsg]);
  useEffect(() => { onUnreadCountRef.current = onUnreadCount; }, [onUnreadCount]);
  useEffect(() => { onReplyCountUpdateRef.current = onReplyCountUpdate; }, [onReplyCountUpdate]);

  const connectRef = useRef(null);

  const joinTopic = useCallback((topic) => {
    desiredTopics.current.add(topic);
    if (joinedTopics.current.has(topic)) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      joinedTopics.current.add(topic);
      ws.send(JSON.stringify([null, String(refSeq.current++), topic, "phx_join", {}]));
    }
    // If WS not open yet, desiredTopics ensures phx_join is sent in onopen
  }, []);

  const leaveTopic = useCallback((topic) => {
    desiredTopics.current.delete(topic);
    joinedTopics.current.delete(topic);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify([null, String(refSeq.current++), topic, "phx_leave", {}]));
    }
  }, []);

  const sendEvent = useCallback((topic, event, payload={}) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify([null, String(refSeq.current++), topic, event, payload]));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!token || !userId) return;

    const connect = () => {
      if (!mountedRef.current) return;
      clearTimeout(reconnectRef.current);

      const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/socket/websocket?token=${token}&vsn=2.0.0`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      // Reset joined set for this new connection
      joinedTopics.current.clear();

      const send = (msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));

      ws.onopen = () => {
        reconnectDelay.current = 3000; // reset backoff on successful connection
        // Always join the core topics
        send([null, String(refSeq.current++), "feed:global", "phx_join", {}]);
        joinedTopics.current.add("feed:global");
        send([null, String(refSeq.current++), `notifications:${userId}`, "phx_join", {}]);
        joinedTopics.current.add(`notifications:${userId}`);
        // Re-join any topics components are currently subscribed to (e.g. open DM or post)
        // Always send phx_join for all desired topics on (re)connect - joinedTopics was cleared
        desiredTopics.current.forEach(topic => {
          send([null, String(refSeq.current++), topic, "phx_join", {}]);
          joinedTopics.current.add(topic);
        });
        heartbeatRef.current = setInterval(() => send([null, String(refSeq.current++), "phoenix", "heartbeat", {}]), 30000);
      };

      ws.onmessage = (e) => {
        try {
          const [, , topic, event, payload] = JSON.parse(e.data);
          if (event === "new_post" && topic === "feed:global") onNewPostRef.current?.(payload);
          if (event === "reply_count_updated" && topic.startsWith("feed:")) onReplyCountUpdateRef.current?.(payload);
          if (event === "link_preview_ready" && topic === "feed:global") onLinkPreviewReady(payload?.url);
          if (event === "new_notification" && topic === `notifications:${userId}`) {
            // Dispatch to NotificationsPage if it's open
            window.dispatchEvent(new CustomEvent("nexus:notification", {detail: payload}));
            // Don't increment here — the backend pushes a real unread_count
            // immediately after, which corrects the badge to the actual DB count.
            // DM badge is handled separately by the new_message event below.
          }
          if (event === "unread_count" && topic === `notifications:${userId}`) onUnreadCountRef.current?.(payload?.count||0);
          // Retry failed channel joins (rejected at join time)
          if (event === "phx_reply" && payload?.status === "error") {
            joinedTopics.current.delete(topic);
            if (desiredTopics.current.has(topic)) {
              setTimeout(() => joinTopic(topic), 1000);
            }
          }
          // phx_error = channel process crashed after joining -> must rejoin
          if (event === "phx_error") {
            joinedTopics.current.delete(topic);
            if (desiredTopics.current.has(topic)) {
              setTimeout(() => joinTopic(topic), 1000);
            }
          }
          // DM messages — arrive on the stable notifications channel
          if (event === "new_message" && (topic.startsWith("dm:") || topic === `notifications:${userId}`)) {
            const threadId = payload?.thread_id ?? topic.split(":")[1];
            window.dispatchEvent(new CustomEvent("nexus:dm_message", {detail: {threadId: String(threadId), message: payload}}));
            // Poll the real unread thread count rather than blind-incrementing
            api.get("/threads/unread").then(d=>setMsgCount(d.unread||0)).catch(()=>{});
          }
          // DM typing
          if ((event === "typing_start" || event === "typing_stop") && topic.startsWith("dm:")) {
            window.dispatchEvent(new CustomEvent("nexus:typing", {detail: {channel: topic, userId: payload?.user_id, started: event === "typing_start"}}));
          }
          // Post replies — arrive on the post: channel (for viewers already on the page)
          if (event === "new_reply" && topic.startsWith("post:")) {
            window.dispatchEvent(new CustomEvent("nexus:new_reply", {detail: {postId: topic.split(":")[1], reply: payload}}));
          }
          if ((event === "typing_start" || event === "typing_stop") && topic.startsWith("post:")) {
            window.dispatchEvent(new CustomEvent("nexus:typing", {detail: {channel: topic, userId: payload?.user_id, started: event === "typing_start"}}));
          }
        } catch {}
      };

      ws.onerror = () => {};
      ws.onclose = () => {
        clearInterval(heartbeatRef.current);
        joinedTopics.current.clear();
        // Only schedule a reconnect if the tab is visible. If it's hidden,
        // the heartbeat will be throttled and the server will immediately
        // close the new connection too — causing a flood of failed attempts.
        // The visibilitychange handler below reconnects when the tab returns.
        if (mountedRef.current && token && userId && !document.hidden) {
          reconnectRef.current = setTimeout(connect, reconnectDelay.current);
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, 60000);
        }
      };
    };

    connectRef.current = connect;

    // When the tab becomes visible again, reconnect immediately if the socket
    // is not already open. This covers the case where the tab was hidden while
    // the server closed the connection due to a missed heartbeat.
    const onVisible = () => {
      if (!mountedRef.current || !token || !userId) return;
      if (document.hidden) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        clearTimeout(reconnectRef.current);
        reconnectDelay.current = 3000; // reset backoff — this is a user-initiated restore
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    connect();

    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(reconnectRef.current);
      clearInterval(heartbeatRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [token, userId]);

  return {joinTopic, leaveTopic, sendEvent};
}

// ── Guest Prompt ──────────────────────────────────────────────────────────────
function GuestPrompt({onAuthRequired, registrationOpen=true}) {
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,color:"var(--t5)"}}>
      <i className="fa-solid fa-lock" style={{fontSize:28,opacity:.3}}></i>
      <div style={{fontSize:14,color:"var(--t2)",fontWeight:500}}>Sign in to continue</div>
      <div style={{display:"flex",gap:10}}>
        <button className="btn-ghost" onClick={()=>onAuthRequired("login")}>Log in</button>
        {registrationOpen&&<button className="btn-primary" onClick={()=>onAuthRequired("register")}>Sign up</button>}
      </div>
    </div>
  );
}

// ── Auth Modal Form ───────────────────────────────────────────────────────────
function AuthModalForm({mode, onLogin, onSwitch, registrationOpen=true, oauthProviders={}, turnstileSiteKey=null}) {
  const [form,setForm]=useState({login:"",email:"",username:"",password:""});
  const [showPw,setShowPw]=useState(false);
  const [remember,setRemember]=useState(true);
  const [err,setErr]=useState(null);
  const [loading,setLoading]=useState(false);
  // Magic link state: "password" | "magic" | "sent"
  const [loginTab,setLoginTab]=useState("password");
  // Turnstile widget ID (for explicit re-render on mode switch)
  const turnstileRef = useRef(null);
  const turnstileWidgetId = useRef(null);

  // Load Turnstile script on demand when site key is present and mode is register
  useEffect(()=>{
    if (!turnstileSiteKey || mode !== "register") return;
    let cancelled = false;
    const load = () => {
      if (cancelled) return;
      // Defer render until the browser has performed layout so the container
      // has non-zero dimensions — Cloudflare silently fails on zero-width targets.
      requestAnimationFrame(() => {
        if (cancelled) return;
        if (window.turnstile && turnstileRef.current && !turnstileWidgetId.current) {
          const theme = typeof _currentTheme !== "undefined" ? _currentTheme : "dark";
          turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
            sitekey: turnstileSiteKey,
            theme:   theme === "light" ? "light" : "dark",
            size:    "flexible",
          });
        }
      });
    };
    if (window.turnstile) {
      load();
    } else if (!document.getElementById("cf-turnstile-script")) {
      const s = document.createElement("script");
      s.id  = "cf-turnstile-script";
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = load;
      document.head.appendChild(s);
    } else {
      // Script tag exists but not yet loaded — poll
      const poll = setInterval(()=>{ if (window.turnstile) { clearInterval(poll); load(); } }, 100);
      return () => clearInterval(poll);
    }
    return () => {
      cancelled = true;
      if (turnstileWidgetId.current != null && window.turnstile) {
        window.turnstile.remove(turnstileWidgetId.current);
        turnstileWidgetId.current = null;
      }
    };
  }, [turnstileSiteKey, mode]);
  const [mlEmail,setMlEmail]=useState("");
  const [mlSent,setMlSent]=useState(false);
  const [mlLoading,setMlLoading]=useState(false);
  const [mlErr,setMlErr]=useState(null);

  const submit=async e=>{
    e.preventDefault(); setLoading(true); setErr(null);
    try {
      let body;
      if (mode === "login") {
        body = {email: form.login.trim(), password: form.password, remember_me: remember};
      } else {
        // Collect the Turnstile token if the widget was rendered
        const cfToken = (turnstileSiteKey && turnstileWidgetId.current != null && window.turnstile)
          ? window.turnstile.getResponse(turnstileWidgetId.current)
          : null;
        // If Turnstile is configured but the user hasn't completed the challenge yet,
        // block submission and prompt them rather than sending an empty token
        // (which the backend would reject as "Human verification failed").
        // Only block if the widget actually rendered (turnstileWidgetId.current != null)
        // — if Cloudflare failed to load or render, fail open like the backend does.
        if (turnstileSiteKey && turnstileWidgetId.current != null && (!cfToken || cfToken === "")) {
          setErr("Please complete the human verification challenge.");
          setLoading(false);
          return;
        }
        body = {
          email:    form.email.trim(),
          username: form.username.trim(),
          password: form.password,
          ...(cfToken ? {cf_turnstile_response: cfToken} : {})
        };
      }
      const d=await api.post(mode==="login"?"/auth/login":"/auth/register", body);
      if(d.access_token){api.setToken(d.access_token);onLogin(d.user);}
      else setErr(formatApiErrors(d));
    } finally { setLoading(false); }
  };

  const sendMagicLink=async e=>{
    e.preventDefault(); setMlLoading(true); setMlErr(null);
    try {
      const d=await api.post("/auth/magic-link", {email: mlEmail.trim()});
      if(d.ok) setMlSent(true);
      else setMlErr(d.error||"Failed to send magic link. Please try again.");
    } finally { setMlLoading(false); }
  };

  const switchTab=tab=>{
    setLoginTab(tab);
    setMlSent(false);
    setMlErr(null);
    setErr(null);
  };

  const hasOAuth = oauthProviders.google || oauthProviders.github;
  const oauthBtnStyle = {
    width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:10,
    padding:"10px 16px", borderRadius:10, fontSize:14, fontWeight:500, cursor:"pointer",
    background:"var(--bg3)", border:"0.5px solid var(--b2)", color:"var(--t1)",
    marginBottom:10, textDecoration:"none"
  };
  const tabBtnStyle=(active)=>({
    flex:1, padding:"7px", borderRadius:8, fontSize:13, fontWeight:500, border:"none",
    cursor:"pointer", fontFamily:"inherit", transition:"all .15s",
    background: active?"var(--s2)":"transparent",
    color: active?"var(--t1)":"var(--t4)",
    boxShadow: active?"0 1px 4px rgba(0,0,0,.3)":"none",
  });

  return (
    <form onSubmit={mode==="login"&&loginTab==="magic"?sendMagicLink:submit}>
      {hasOAuth && <>
        {oauthProviders.github &&
          <a href="/api/v1/auth/oauth/github" style={oauthBtnStyle}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
            Continue with GitHub
          </a>
        }
        {oauthProviders.google &&
          <a href="/api/v1/auth/oauth/google" style={oauthBtnStyle}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Continue with Google
          </a>
        }
        <div style={{display:"flex",alignItems:"center",gap:10,margin:"4px 0 16px"}}>
          <div style={{flex:1,height:"0.5px",background:"var(--b2)"}}/>
          <span style={{fontSize:12,color:"var(--t5)"}}>or</span>
          <div style={{flex:1,height:"0.5px",background:"var(--b2)"}}/>
        </div>
      </>}

      {/* Login mode — show tab switcher for password vs magic link */}
      {mode==="login" && (
        <div style={{display:"flex",background:"var(--s3)",borderRadius:10,padding:3,gap:3,marginBottom:20}}>
          <button type="button" style={tabBtnStyle(loginTab==="password")} onClick={()=>switchTab("password")}>Password</button>
          <button type="button" style={tabBtnStyle(loginTab==="magic")} onClick={()=>switchTab("magic")}>Magic link</button>
        </div>
      )}

      {/* Registration fields */}
      {mode==="register" && <>
        <div className="fg"><label className="fl">Email</label><input className="fi" type="email" placeholder="you@example.com" value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))} required autoFocus/></div>
        <div className="fg"><label className="fl">Username</label><input className="fi" placeholder="username" value={form.username} onChange={e=>setForm(p=>({...p,username:e.target.value}))} required/></div>
      </>}

      {/* Password login fields */}
      {mode==="login" && loginTab==="password" && <>
        <div className="fg"><label className="fl">Email or username</label><input className="fi" placeholder="you@example.com or username" value={form.login} onChange={e=>setForm(p=>({...p,login:e.target.value}))} required autoFocus/></div>
      </>}

      {/* Password field — shown for both login and register, not magic link */}
      {loginTab!=="magic" && (
        <div className="fg"><label className="fl">Password</label>
          <div style={{position:"relative"}}>
            <input className="fi" type={showPw?"text":"password"} placeholder="••••••••" value={form.password} onChange={e=>setForm(p=>({...p,password:e.target.value}))} required style={{paddingRight:40}}/>
            <span onClick={()=>setShowPw(p=>!p)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",cursor:"pointer",color:"var(--t4)",fontSize:15,userSelect:"none"}}>
              <i className={`fa-solid ${showPw?"fa-eye-slash":"fa-eye"}`}/>
            </span>
          </div>
        </div>
      )}

      {/* Remember me — password login only */}
      {mode==="login" && loginTab==="password" && (
        <label className="remember-row">
          <input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>
          <span>Remember me</span>
        </label>
      )}

      {/* Magic link — email input and sent states */}
      {mode==="login" && loginTab==="magic" && !mlSent && <>
        <div className="fg">
          <label className="fl">Your email address</label>
          <input className="fi" type="email" placeholder="you@example.com" value={mlEmail} onChange={e=>setMlEmail(e.target.value)} required autoFocus/>
        </div>
        {mlErr&&<div className="ferr" style={{marginBottom:10}}>{mlErr}</div>}
      </>}

      {mode==="login" && loginTab==="magic" && mlSent && (
        <div style={{background:"var(--ac-bg)",border:"0.5px solid var(--ac-border)",borderRadius:12,padding:20,textAlign:"center",marginBottom:16}}>
          <i className="fa-solid fa-envelope-open-text" style={{fontSize:28,color:"var(--ac-text)",display:"block",marginBottom:10}}/>
          <div style={{fontSize:14,fontWeight:600,color:"var(--t1)",marginBottom:6}}>Check your inbox</div>
          <div style={{fontSize:13,color:"var(--t4)",lineHeight:1.6}}>
            We sent a sign-in link to<br/>
            <strong style={{color:"var(--ac-text)"}}>{mlEmail}</strong><br/><br/>
            The link expires in 15 minutes.
          </div>
        </div>
      )}

      {/* Error display for password forms */}
      {loginTab!=="magic" && err && <div className="ferr" style={{marginBottom:10,whiteSpace:"pre-line"}}>{err}</div>}

      {/* Turnstile widget — register mode only */}
      {mode==="register" && turnstileSiteKey && (
        <div ref={turnstileRef} style={{marginBottom:14, width:"100%", minHeight:65}}/>
      )}

      {/* Primary action button */}
      {!(mode==="login" && loginTab==="magic" && mlSent) && (
        <button className="btn-primary" style={{width:"100%",borderRadius:12,padding:"12px",marginBottom:14,fontSize:15}}
          disabled={loading||mlLoading}>
          {mode==="login" && loginTab==="magic"
            ? (mlLoading ? "Sending…" : <><i className="fa-solid fa-paper-plane" style={{marginRight:8,fontSize:13}}/>Send magic link</>)
            : (loading ? "…" : mode==="login" ? "Sign in" : "Create account")
          }
        </button>
      )}

      {/* Resend button in sent state */}
      {mode==="login" && loginTab==="magic" && mlSent && (
        <button type="button" className="btn-ghost" style={{width:"100%",fontSize:13,padding:"9px 16px",borderRadius:9,marginBottom:14,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}
          disabled={mlLoading}
          onClick={async()=>{setMlLoading(true);setMlErr(null);try{const d=await api.post("/auth/magic-link",{email:mlEmail.trim()});if(!d.ok)setMlErr(d.error||"Failed to resend");}finally{setMlLoading(false);}}}>
          <i className="fa-solid fa-rotate-left" style={{fontSize:12}}/>
          {mlLoading?"Sending…":"Resend link"}
        </button>
      )}

      {/* Switch mode link */}
      <div style={{textAlign:"center",fontSize:13,color:"var(--t4)"}}>
        {mode==="login"
          ? <>
              {loginTab==="magic"&&mlSent&&<><span className="link" style={{color:"var(--t4)"}} onClick={()=>switchTab("password")}>← Back to sign in</span>{registrationOpen&&" · "}</>}
              {registrationOpen&&<>No account? <span className="link" onClick={()=>{onSwitch("register");setErr(null);}}>Sign up</span></>}
            </>
          : <>Have an account? <span className="link" onClick={()=>{onSwitch("login");setErr(null);}}>Sign in</span></>
        }
      </div>
    </form>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

// ── Mobile shell components ────────────────────────────────────────────────────

function MobileTopBar({onHamburger, onRight, branding, onNavigateHome}) {
  return (
    <div className="mob-topbar">
      <button className="mob-icon-btn" onClick={onHamburger} aria-label="Menu">
        <i className="fa-solid fa-bars"/>
      </button>
      <div className="mob-topbar-logo" onClick={onNavigateHome} style={{cursor:"pointer"}}>
        {branding?.logo_url
          ? <img src={branding.logo_url} style={{height:28,objectFit:"contain"}} alt="logo"/>
          : <>{branding?.site_name||"nexus"}<em>.</em></>}
      </div>
      <button className="mob-icon-btn" onClick={onRight} aria-label="Activity">
        <i className="fa-solid fa-chart-simple"/>
      </button>
    </div>
  );
}

function MobileTabBar({currentUser, navigate, page, notifCount, msgCount, onCompose, onSearch, onProfile, onAuthRequired, registrationOpen}) {
  if(currentUser) {
    return (
      <div className="mob-tabbar">
        <button className="mob-tab" onClick={()=>navigate("notifications")}>
          <i className="fa-solid fa-bell"/>
          {notifCount>0&&<div className="mob-badge"/>}
          <span className="mob-tab-label">Alerts</span>
        </button>
        <button className="mob-tab" onClick={()=>navigate("messages")}>
          <i className="fa-solid fa-message"/>
          {msgCount>0&&<div className="mob-badge"/>}
          <span className="mob-tab-label">Messages</span>
        </button>
        <button className="mob-tab-compose" onClick={onCompose} aria-label="Write">+</button>
        <button className="mob-tab" onClick={onSearch}>
          <i className="fa-solid fa-magnifying-glass"/>
          <span className="mob-tab-label">Search</span>
        </button>
        <button className="mob-tab" onClick={onProfile}>
          <Av user={currentUser} size={28} />
          <span className="mob-tab-label">Profile</span>
        </button>
      </div>
    );
  }
  return (
    <div className="mob-tabbar">
      <button className="mob-tab" onClick={onSearch}>
        <i className="fa-solid fa-magnifying-glass"/>
        <span className="mob-tab-label">Search</span>
      </button>
      <button className="mob-tab-compose" onClick={()=>onAuthRequired?.("login")} aria-label="Write">+</button>
      <button className="mob-tab" onClick={()=>onAuthRequired?.("login")}>
        <i className="fa-solid fa-arrow-right-to-bracket"/>
        <span className="mob-tab-label">Login</span>
      </button>
    </div>
  );
}

function MobileUserMenu({user, navigate, onLogout, open, onClose}) {
  const [, forceUpdate] = useState(0);
  useEffect(()=>{ return window.NexusExtensions.onAccountActionChange(()=>forceUpdate(n=>n+1)); },[]);
  if(!user) return null;
  return (
    <div className={`mob-user-overlay ${open?"open":""}`}>
      <div className="mob-overlay-head">
        <span className="mob-overlay-title">Account</span>
        <button className="mob-icon-btn" onClick={onClose} aria-label="Close"><i className="fa-solid fa-xmark"/></button>
      </div>
      <div style={{padding:"20px 16px",borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"center",gap:14}}>
        <RsAv user={user} size={56} noCard />
        <div>
          <div style={{fontSize:16,fontWeight:600,color:"var(--t1)"}}>{user.username}</div>
          <div style={{fontSize:12,color:"var(--t5)",marginTop:2}}>@{user.username?.toLowerCase()} · {user.role}</div>
        </div>
      </div>
      {[
        {icon:"fa-user",label:"Profile",action:()=>{navigate("profile",{username:user.username});onClose();}},
        {icon:"fa-gear",label:"Settings",action:()=>{navigate("settings");onClose();}},
        ...(user.role==="admin"?[{icon:"fa-shield-halved",label:"Admin Panel",action:()=>{navigate("admin");onClose();}}]:[]),
        ...window.NexusExtensions.getAccountActions().map(a => ({
          icon: a.icon,
          label: a.label,
          action: () => a.onClick({ currentUser: user, navigate, close: onClose }),
        })),
      ].map(item=>(
        <div key={item.label} onClick={item.action}
          style={{display:"flex",alignItems:"center",gap:14,padding:"16px 20px",borderBottom:"0.5px solid var(--b1)",cursor:"pointer",fontSize:15,color:"var(--t2)"}}>
          <i className={`fa-solid ${item.icon}`} style={{width:20,color:"var(--t4)",textAlign:"center"}}/>
          {item.label}
        </div>
      ))}
      <div onClick={()=>{onLogout();onClose();}}
        style={{display:"flex",alignItems:"center",gap:14,padding:"16px 20px",cursor:"pointer",fontSize:15,color:"var(--red)"}}>
        <i className="fa-solid fa-arrow-right-from-bracket" style={{width:20,textAlign:"center"}}/>
        Log out
      </div>
    </div>
  );
}

function MobileSearchOverlay({open, onClose, navigate}) {
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState(null);
  const inputRef = React.useRef();
  React.useEffect(()=>{if(open) setTimeout(()=>inputRef.current?.focus(),100);},[open]);
  async function search(val) {
    if(!val.trim()){setResults(null);return;}
    const d = await api.get(`/search?q=${encodeURIComponent(val)}`).catch(()=>({}));
    setResults(d);
  }
  return (
    <div className={`mob-overlay ${open?"open":""}`} style={{zIndex:970}}>
      <div className="mob-overlay-head">
        <span className="mob-overlay-title">Search</span>
        <button className="mob-icon-btn" onClick={()=>{setQ("");setResults(null);onClose();}} aria-label="Close"><i className="fa-solid fa-xmark"/></button>
      </div>
      <div style={{padding:"12px 16px",borderBottom:"0.5px solid var(--b1)"}}>
        <div style={{background:"rgba(255,255,255,0.05)",border:"0.5px solid var(--b1)",borderRadius:24,display:"flex",alignItems:"center",gap:8,padding:"10px 14px"}}>
          <i className="fa-solid fa-magnifying-glass" style={{color:"var(--t5)",fontSize:13}}/>
          <input ref={inputRef} value={q} onChange={e=>{setQ(e.target.value);search(e.target.value);}}
            placeholder="Search threads…"
            style={{background:"transparent",border:"none",outline:"none",fontSize:14,color:"var(--t2)",fontFamily:"inherit",flex:1}}/>
        </div>
      </div>
      <div className="mob-overlay-body" style={{padding:"8px 0"}}>
        {results&&(results.posts||[]).map(p=>(
          <div key={p.id} onClick={()=>{navigate("post",{id:p.id});setQ("");setResults(null);onClose();}}
            style={{padding:"12px 16px",borderBottom:"0.5px solid var(--b1)",cursor:"pointer"}}>
            <div style={{fontSize:13,fontWeight:500,color:"var(--t1)"}}>{p.title}</div>
            <div style={{fontSize:11,color:"var(--t5)",marginTop:2}}>{p.space?.name} · {ago(p.inserted_at)}</div>
          </div>
        ))}
        {results&&!(results.posts||[]).length&&<div style={{padding:"40px",textAlign:"center",color:"var(--t5)",fontSize:13}}>No results for "{q}"</div>}
      </div>
    </div>
  );
}

// Mobile scrubber bottom sheet

function App() {
  const [currentUser,setCurrentUser]=useState(()=>{
    // Load cached user immediately to prevent flash of default avatar
    try { const u=localStorage.getItem("nexus_user"); return u?JSON.parse(u):null; } catch { return null; }
  });
  const updateCurrentUser = (user) => {
    setCurrentUser(user);
    if (user) localStorage.setItem("nexus_user", JSON.stringify(user));
    else localStorage.removeItem("nexus_user");
  };
  // Reactive token — mirrors api.token in React state so useSocket re-runs
  // whenever a refresh issues a new access token. Without this, useSocket
  // captures the stale token at mount time and never reconnects with the
  // fresh one, causing permanent WebSocket failures and dead notifications.
  const [apiToken, setApiToken] = useState(() => api.token);
  // Register immediately at render time (not in a useEffect) so the callback
  // is in place before init() fires its async refresh.
  api._onTokenChange = setApiToken;
  const [authChecked,setAuthChecked]=useState(()=>{
    // Fast-path: if we have a cached user AND a non-expired token, skip the
    // loading screen entirely. If the token is expired we still have the cached
    // user rendered (no flash of logged-out), but authChecked stays false so the
    // loading overlay shows while the async refresh runs.
    if (!localStorage.getItem("nexus_token") || !localStorage.getItem("nexus_user")) return false;
    try {
      const payload = JSON.parse(atob(localStorage.getItem("nexus_token").split(".")[1]));
      const exp = payload?.exp ?? 0;
      return (exp - Math.floor(Date.now() / 1000)) > 30; // token valid for > 30s
    } catch { return false; }
  });
  const [spaces,setSpaces]=useState([]);
  const [tags,setTags]=useState([]);
  const initial = urlToPage(window.location.pathname);
  const [page,setPage]=useState(initial.page);
  const [pageProps,setPageProps]=useState(initial.props);
  window.__nexusPage = initial.page;
  const [notifCount,setNotifCount]=useState(0);
  const [msgCount,setMsgCount]=useState(0);
  const pollMsgRef = useRef(null);
  const [modReportCount,setModReportCount]=useState(0);
  const [layoutCfg,setLayoutCfg]=useState(() => {
    // Seed from the server-injected Layout config so the sidebars render in the
    // admin-configured order on first paint (no default-order flash). /boot
    // still updates this afterward (and adds the toolbars).
    try {
      const inj = window.__nexusLayoutCfg;
      if (inj && typeof inj === "object" && !Array.isArray(inj)) return inj;
    } catch (e) {}
    return {};
  });
  const [appBranding,setAppBranding]=useState({});
  const [mobLeftOpen,setMobLeftOpen]=useState(false);
  const [mobRightOpen,setMobRightOpen]=useState(false);
  const [mobUserOpen,setMobUserOpen]=useState(false);
  const [mobSearchOpen,setMobSearchOpen]=useState(false);
  const [msgPageKey,setMsgPageKey]=useState(0);
  const [livePosts,setLivePosts]=useState([]);
  const [liveEvents,setLiveEvents]=useState([]);
  const replyUpdateSeq = useRef(0);
  const [liveReplyUpdate,setLiveReplyUpdate]=useState(null);
  const [authModal,setAuthModal]=useState(null); // null | "login" | "register"
  const [registrationOpen,setRegistrationOpen]=useState(true);
  const [iosPromptDismissed,setIosPromptDismissed]=useState(()=>{
    try { return localStorage.getItem("pwa.ios_prompt.dismissed")==="1"; } catch { return false; }
  });
  const [pwaCfgPublic,setPwaCfgPublic]=useState({});
  const [oauthProviders,setOauthProviders]=useState({google:false,github:false});
  const [turnstileSiteKey,setTurnstileSiteKey]=useState(null);
  const [cookieConsentCfg,setCookieConsentCfg]=useState(null);

  // Detect iOS Safari (not already installed, not already dismissed)
  const isIosSafari = (()=>{
    const ua = navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua);
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || !!(navigator.standalone);
    return isIos && isSafari && !isStandalone;
  })();

  const navigate=useCallback((p,props={})=>{
    const url = pageToUrl(p, props);
    // history.pushState uses the structured clone algorithm, which throws on
    // functions and other non-clonable values. Extension routes pass
    // _match objects containing the route's React component (a function),
    // so we strip those before storing in history state. The component can
    // be re-resolved from the slug+path on popstate. React state retains
    // the original props for the current render.
    const serializableProps = stripNonSerializable(props);
    try {
      window.history.pushState({page:p, props: serializableProps}, "", url);
    } catch (e) {
      // If structured-clone still fails, log it and continue without the
      // history entry — the React state update below still navigates the
      // user, they just lose back-button support for this hop.
      console.warn("navigate: pushState failed, navigation continues without history entry:", e);
    }
    if(p==="messages") setMsgPageKey(k=>k+1);
    setPage(p);setPageProps(props);window.scrollTo(0,0);
    window.__nexusPage = p;
    window._nexusNavigate = navigate;
  },[]);
  useEffect(()=>{ window._nexusNavigate = navigate; },[navigate]);

  // Close all mobile overlays on any navigation — this catches the navigate
  // prop, window._nexusNavigate (used by extensions), and popstate
  // (back/forward). The prop-wrapping approach alone does not work because
  // extensions call window._nexusNavigate directly.
  //
  // pageProps is in the dependency list, not just page: navigating within the
  // same page still counts. Spaces by Pulse and Tags by Pulse only render on
  // the feed, so they always go feed -> feed and page never changes — the
  // right panel stayed open over the results the user had just asked to see.
  // Every setPageProps call is navigation-driven and passes a fresh object, so
  // this fires exactly once per navigation.
  useEffect(()=>{
    setMobLeftOpen(false);
    setMobRightOpen(false);
    setMobUserOpen(false);
    setMobSearchOpen(false);
  },[page, pageProps]);

  // Escape closes the right panel drawer.
  useEffect(()=>{
    if(!mobRightOpen) return;
    const onKey=e=>{ if(e.key==="Escape") setMobRightOpen(false); };
    document.addEventListener("keydown",onKey);
    return ()=>document.removeEventListener("keydown",onKey);
  },[mobRightOpen]);

  // Above 1240px .right-panel is visible again and .tb-right-toggle is hidden,
  // so an open drawer would sit over a panel already showing the same widgets
  // with no control left to dismiss it. Close it on the way past.
  useEffect(()=>{
    const onResize=()=>{ if(window.innerWidth>=1240) setMobRightOpen(false); };
    window.addEventListener("resize",onResize);
    return ()=>window.removeEventListener("resize",onResize);
  },[]);

  // Handle browser back/forward
  useEffect(()=>{
    const fn = (e) => {
      if (e.state?.page) {
        let restoredProps = e.state.props || {};
        // For ext-route, the component function is stripped by JSON serialization.
        // Re-resolve it from the live registry so the page doesn't spin forever.
        if (e.state.page === "ext-route" && !restoredProps._match?.component) {
          const live = window.NexusExtensions.matchRoute(window.location.pathname);
          if (live) restoredProps = { ...restoredProps, _match: live };
        }
        setPage(e.state.page);
        setPageProps(restoredProps);
      } else {
        const {page:pg, props:pr} = urlToPage(window.location.pathname);
        setPage(pg); setPageProps(pr);
      }
      window.scrollTo(0,0);
    };
    window.addEventListener("popstate", fn);
    return () => window.removeEventListener("popstate", fn);
  }, []);
  const loadSpaces=useCallback(()=>{api.get("/spaces").then(d=>setSpaces(d.spaces||[]));},[]);

  const seenPostIds = useRef(new Set());
  const {joinTopic, leaveTopic, sendEvent} = useSocket(
    apiToken,
    currentUser?.id,
    useCallback(post=>{
      // Deduplicate: the socket may briefly double-fire during token refresh
      if (seenPostIds.current.has(post.id)) return;
      seenPostIds.current.add(post.id);
      setLivePosts(p=>[post,...p]);
      setLiveEvents(p=>[{username:post.user?.username,userId:post.user?.id,avatarColor:post.user?.avatar_color,avatarUrl:post.user?.avatar_url,action:`posted in ${post.space?.name||"general"}`,at:new Date().toISOString()},...p].slice(0,10));
    },[]),
    useCallback(()=>setNotifCount(c=>c+1),[]),
    useCallback(()=>setMsgCount(c=>c+1),[]),
    useCallback(count=>setNotifCount(count),[]),
    useCallback(update=>{
      replyUpdateSeq.current += 1;
      setLiveReplyUpdate({data: update, seq: replyUpdateSeq.current});
    },[])
  );

  useEffect(()=>{
    const init = async () => {
      if (!api.token) { setAuthChecked(true); return; }

      // On cold load (especially PWA/mobile), the access token may have expired
      // while the app was closed. Proactively attempt a refresh before hitting
      // /auth/me so we never encounter a 401 that clears credentials.
      //
      // We use tryRefreshWithRetry rather than tryRefresh because iOS Safari PWA
      // does not reliably send cookies on the very first fetch after a cold launch
      // from the home screen — the cookie jar is loaded asynchronously. A single
      // retry after 800ms covers this window without any visible delay to the user.
      const tokenPayload = (() => {
        try { return JSON.parse(atob(api.token.split(".")[1])); } catch { return null; }
      })();
      const expiresAt = tokenPayload?.exp ?? 0;
      const nowSec = Math.floor(Date.now() / 1000);
      const expired = expiresAt <= nowSec;
      const expiresSoon = expiresAt - nowSec < 120; // refresh if < 2 min remaining

      if (expiresSoon) {
        // Use retry variant: if the token is already expired, allow up to 3 attempts
        // (covers slow iOS cookie jar init on cold PWA launch).
        await api.tryRefreshWithRetry(expired ? 3 : 2, 800);
      }

      // Only call /auth/me if we now have a valid (non-expired) token.
      // If the refresh failed but the token is still present (e.g. network
      // blip, server momentarily unavailable), do NOT call /auth/me with the
      // expired token — that would get "Authentication required" back and
      // wipe the cached user, showing the logged-out UI incorrectly.
      // Instead keep the cached user in place; the next API call will
      // re-attempt the refresh automatically via the 401 retry path.
      const tokenAfterRefresh = (() => {
        try { return JSON.parse(atob(api.token.split(".")[1])); } catch { return null; }
      })();
      const tokenNowValid = tokenAfterRefresh && (tokenAfterRefresh.exp - Math.floor(Date.now() / 1000)) > 0;

      if (!tokenNowValid) {
        // Token still expired — keep cached user, mark auth as checked.
        // The socket and next API call will trigger a fresh refresh attempt.
        setAuthChecked(true);
        return;
      }

      const d = await api.request("GET", "/auth/me", null, true, true).catch(()=>({}));
      if (d.user) {
        updateCurrentUser(d.user);
      } else if (d.error === "Authentication required" || d.error === "Invalid or expired refresh token") {
        // Definitive server rejection — clear everything
        api.setToken(null);
        updateCurrentUser(null);
      }
      // Any other failure (network error, empty response, 5xx) — keep the cached
      // user. The next API call will re-attempt auth. This prevents a blip of
      // logged-out state caused by a slow or temporarily unavailable server.
      setAuthChecked(true);
    };
    init();
  },[]);

  // Proactively refresh the session when the user returns to the tab.
  // Without this, a 15-minute idle causes the access token to expire silently.
  // On visibility restore we attempt a token refresh before any API calls fire,
  // preventing the app from seeing a 401 and briefly clearing the logged-in state.
  useEffect(()=>{
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      if (!api.token) return;
      // Proactively refresh — tryRefresh is a no-op if token is still fresh
      // because the server will just issue a new one if the cookie is valid
      const refreshed = await api.tryRefresh();
      if (refreshed) {
        // Refresh succeeded — silently re-verify the user in case role/status changed
        api.request("GET", "/auth/me", null, false, true).then(d=>{
          if (d.user) updateCurrentUser(d.user);
        }).catch(()=>{});
      } else if (!api.token) {
        // Refresh failed and we have no token — session truly expired.
        // Clear the user but only navigate to feed if on an auth-required page.
        // Pages like feed, post, members, etc. are publicly visible and the user
        // should stay where they are; requireAuth will show GuestPrompt naturally.
        const AUTH_ONLY_PAGES = new Set(["following","saved","drafts","settings","compose","notifications","messages","dm","dm-new","admin"]);
        updateCurrentUser(null);
        if (AUTH_ONLY_PAGES.has(window.__nexusPage)) {
          window.dispatchEvent(new Event("nexus:logout"));
        }
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(()=>{
    // Consolidated boot: a single round-trip returns spaces, tags, branding
    // settings and public page widgets (previously four separate GETs — the
    // widgets one was sequenced after branding — see BootController).
    api.get("/boot").then(d=>{
      setSpaces(d.spaces||[]);
      setTags(d.tags||[]);
      const s=d.settings||{};const app={...(s.appearance||{}),active_theme_dark:s.active_theme_dark||null,active_theme_light:s.active_theme_light||null};applyBranding(app,s.general||{});setRegistrationOpen((s.registration||{}).open!==false);setAppBranding({...s.appearance||{},...s.general||{}});setPwaCfgPublic(s.pwa||{});setOauthProviders(s.oauth_providers||{google:false,github:false});setTurnstileSiteKey(s.turnstile_site_key||null);setCookieConsentCfg(s.cookie_consent||null);window._postCfg=s.posting||{};
      const reg=s.registration||{};
      window._requireEmailVerification = reg.require_email_verification===true;
      const digest=s.digest||{};
      if(digest.enabled && digest.frequencies?.length) {
        window._digestFrequencies = digest.frequencies;
      } else {
        window._digestFrequencies = [];
      }
      const lc=s.layout||{};
      // Rehydrate helper: restores live onClick references on ext buttons after
      // deserializing from DB (onClick can't be stored as JSON).
      function rehydrate(items){
        var live=getAllToolbarButtons();
        return items.map(function(item){
          if(!item._ext) return item;
          var liveBtn=live.find(function(l){return l.type===item.type;});
          if(!liveBtn) return item;
          return Object.assign({},item,{onClick:liveBtn.onClick});
        });
      }
      // Seed helper: build default toolbar with hidden flags based on scope
      function seedTB(scopeKey){
        return getAllToolbarButtons().map(function(btn){
          if(btn.sep) return btn;
          var scope=btn.scope||'both'; var hidden=btn.hidden||false;
          if(scopeKey==='post'  && scope==='replies') hidden=true;
          if(scopeKey==='reply' && scope==='posts')   hidden=true;
          return Object.assign({},btn,{hidden:hidden});
        });
      }
      // Merge helper: saved items + append any new buttons not yet saved
      function mergeTB(saved, scopeKey){
        var merged=saved.slice();
        getAllToolbarButtons().forEach(function(def){
          if(def.sep) return;
          var exists=merged.some(function(s){return s.type===def.type;});
          if(!exists){
            var scope=def.scope||'both'; var hidden=false;
            if(scopeKey==='post'  && scope==='replies') hidden=true;
            if(scopeKey==='reply' && scope==='posts')   hidden=true;
            merged.push(Object.assign({},def,{hidden:hidden}));
          }
        });
        return rehydrate(merged);
      }
      var postTB  = lc.post_toolbar  ? mergeTB(lc.post_toolbar,  'post')  : seedTB('post');
      var replyTB = lc.reply_toolbar ? mergeTB(lc.reply_toolbar, 'reply') : seedTB('reply');
      lc.post_toolbar  = postTB;  setActivePostToolbar(postTB);
      lc.reply_toolbar = replyTB; setActiveReplyToolbar(replyTB);
      // Keep legacy lc.toolbar in sync for any code that still reads it
      lc.toolbar = postTB;
      setLayoutCfg(lc);
      // Guard against the race where an extension bundle's defer script
      // finishes executing AFTER the branding fetch resolves. In that case
      // the mergeTB/seedTB calls above ran before registerToolbarButton was
      // called, so _activePostToolbar and _activeReplyToolbar were built
      // without the extension buttons. Subscribe once — as a one-shot
      // listener — so that when the late registerToolbarButton call fires
      // onToolbarChange, we rebuild both toolbars with the now-complete
      // button list and update both the module-level active toolbar state
      // and the React layoutCfg state together.
      var tbUnsub = window.NexusExtensions.onToolbarChange(function() {
        tbUnsub();
        var savedPost  = lc.post_toolbar;
        var savedReply = lc.reply_toolbar;
        var refreshedPost  = savedPost  ? mergeTB(savedPost,  'post')  : seedTB('post');
        var refreshedReply = savedReply ? mergeTB(savedReply, 'reply') : seedTB('reply');
        setActivePostToolbar(refreshedPost);
        setActiveReplyToolbar(refreshedReply);
        setLayoutCfg(function(prev) {
          return Object.assign({}, prev, {
            post_toolbar:  refreshedPost,
            reply_toolbar: refreshedReply,
            toolbar:       refreshedPost,
          });
        });
      });
      // Page widgets now arrive in the same boot payload.
      window._pageWidgets = d.widgets || [];
    }).catch(()=>{});
  },[]);

  useEffect(()=>{
    if(!currentUser) return;
  },[currentUser]);

  useEffect(()=>{
    if(!currentUser) return;
    // Notification and message counts are pushed via WebSocket (unread_count event
    // and new_message event) so polling for them every 60s is redundant.
    // We still fetch once on mount to hydrate counts before the WS connection settles.
    const pollNotif = () => api.get("/notifications/unread").then(d=>setNotifCount(d.count||0)).catch(()=>{});
    const pollMsg   = () => api.get("/threads/unread").then(d=>setMsgCount(d.unread||0)).catch(()=>{});
    const pollMod = () => {
      if(currentUser?.role==="admin"||currentUser?.role==="moderator")
        api.get("/reports?status=pending").then(d=>setModReportCount((d.reports||[]).length)).catch(()=>{});
    };
    pollMsgRef.current = pollMsg;
    // Initial fetch — hydrates counts on mount
    pollNotif(); pollMsg(); pollMod();
    // pollMod has no WebSocket equivalent so keep it on a 5-minute interval.
    // pollNotif and pollMsg are covered by WebSocket so not polled periodically.
    const modInterval = setInterval(pollMod, 5 * 60_000);
    return () => clearInterval(modInterval);
  },[currentUser]);

  // Update document.title with unread notification count
  useEffect(()=>{
    const siteName = appBranding?.site_name || "Nexus";
    const base = siteName;
    if(notifCount > 0) {
      document.title = `(${notifCount > 99 ? "99+" : notifCount}) ${base}`;
    } else {
      document.title = base;
    }
  },[notifCount, appBranding]);

  useEffect(()=>{const fn=()=>{updateCurrentUser(null);setPage("feed");};window.addEventListener("nexus:logout",fn);return ()=>window.removeEventListener("nexus:logout",fn);},[]);

  const logout=()=>{api.post("/auth/logout",{});api.setToken(null);updateCurrentUser(null);window.history.pushState({},"","/");navigate("feed");};

  useLightbox(); // no-op kept for hook rules
  const [userCard, setUserCard] = useUserCard();

  if(!authChecked) {
    // While the async token refresh is in progress, render the admin panel
    // immediately if we have a cached user and the URL is /admin. This prevents
    // the loading spinner flash when returning to a tab whose access token has
    // expired but the refresh cookie is still valid (the common case after
    // 15+ minutes away). The refresh runs in the background; if it fails,
    // updateCurrentUser(null) will clear the panel naturally.
    if(page==="admin"&&currentUser) return <><div className="app-root"><LazyAdmin currentUser={currentUser} navigate={navigate} onSpacesUpdated={loadSpaces} layoutCfg={layoutCfg} setLayoutCfg={setLayoutCfg}/></div><Toasts/></>;
    return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)"}}>Loading…</div>;
  }

  // Admin gets its own full shell
  if(page==="verify-email") return <><div className="app-root" style={{flex:1,display:"flex",flexDirection:"column"}}><VerifyEmailPage token={pageProps?.token} navigate={navigate} onVerified={()=>updateCurrentUser(u=>u?{...u,email_verified:true}:u)}/></div><Toasts/></>;
  if(page==="magic-login")  return <><div className="app-root" style={{flex:1,display:"flex",flexDirection:"column"}}><MagicLoginPage token={pageProps?.token} onLogin={u=>{api.setToken(u.access_token);updateCurrentUser(u.user);navigate("feed",{});}} navigate={navigate}/></div><Toasts/></>;

  if(page==="admin"&&currentUser) return <><div className="app-root"><LazyAdmin currentUser={currentUser} navigate={navigate} onSpacesUpdated={loadSpaces} layoutCfg={layoutCfg} setLayoutCfg={setLayoutCfg}/></div><Toasts/></>;

  const renderPage=()=>{
    const requireAuth = (el) => {
      if(!currentUser) return <GuestPrompt onAuthRequired={m=>setAuthModal(m)} registrationOpen={registrationOpen}/>;
      return el;
    };
    switch(page) {
      case "feed":
        return <FeedPage spaces={spaces} tags={tags} currentUser={currentUser} navigate={navigate} notifCount={notifCount} msgCount={msgCount} onLogout={logout} spaceFilter={pageProps?.space||null} tagFilter={pageProps?.tag||null} sortOverride={pageProps?.sort||null} livePosts={livePosts} liveEvents={liveEvents} liveReplyUpdate={liveReplyUpdate} onAuthRequired={m=>setAuthModal(m)}/>;
      case "following":   return requireAuth(<FeedPage spaces={spaces} tags={tags} currentUser={currentUser} navigate={navigate} notifCount={notifCount} msgCount={msgCount} onLogout={logout} followingOnly={true}/>);
      case "saved":       return requireAuth(<SavedPage navigate={navigate} currentUser={currentUser}/>);
      case "drafts":      return requireAuth(<DraftsPage currentUser={currentUser} navigate={navigate}/>);
      case "settings":    return requireAuth(<SettingsPage currentUser={currentUser} onUpdate={u=>updateCurrentUser(u)} navigate={navigate}/>);
      case "page":        return <PageViewPage slug={pageProps?.slug} navigate={navigate}/>;
      case "compose":     return requireAuth(currentUser?.status==="pending_deletion"?<div style={{padding:"40px 24px",textAlign:"center",color:"var(--t4)",fontSize:14}}><i className="fa-solid fa-user-slash" style={{fontSize:28,marginBottom:12,color:"var(--red)",display:"block"}}/><div style={{fontWeight:600,color:"var(--t2)",marginBottom:8}}>Account deletion pending</div><div style={{marginBottom:16}}>You cannot post while your account is scheduled for deletion.</div><button className="btn-ghost" style={{fontSize:12}} onClick={()=>navigate("settings",{tab:"security"})}>Manage in Settings</button></div>:<ComposePage spaces={spaces} tags={tags} navigate={navigate} currentUser={currentUser} pageProps={pageProps}/>);
      case "notifications": return requireAuth(<NotificationsPage navigate={navigate} onCountChange={setNotifCount}/>);
      case "messages":    return requireAuth(<DMInboxPage key={msgPageKey} currentUser={currentUser} navigate={navigate}/>);
      case "dm":          return requireAuth(<DMPage threadId={pageProps.threadId} threadName={pageProps.threadName} threadImage={pageProps.threadImage} currentUser={currentUser} navigate={navigate} joinTopic={joinTopic} leaveTopic={leaveTopic} sendEvent={sendEvent} onRead={()=>pollMsgRef.current?.()}/>);
      case "dm-new":      return requireAuth(<DMNewPage navigate={navigate} currentUser={currentUser}/>);
      case "members":     return <MembersPage navigate={navigate} currentUser={currentUser}/>;
      case "tags":        return <TagsPage navigate={navigate} currentUser={currentUser}/>;
      case "badges":      return <BadgesPage currentUser={currentUser} navigate={navigate}/>;
      case "leaderboard": return <LeaderboardPage currentUser={currentUser} navigate={navigate}/>;
      case "post":        return <PostPage postId={pageProps.id} currentUser={currentUser} navigate={navigate} spaces={spaces} tags={tags} onAuthRequired={m=>setAuthModal(m)} joinTopic={joinTopic} leaveTopic={leaveTopic} sendEvent={sendEvent} openReport={pageProps.openReport} scrollToReply={pageProps.scrollToReply} resumeDraft={pageProps.resumeDraft||null}/>;
      case "search":      return <SearchPage navigate={navigate} tags={tags} spaces={spaces} initialQ={pageProps?.q||""}/>;
      case "profile":     return <ProfilePage username={pageProps.username||currentUser?.username} currentUser={currentUser} navigate={navigate} initialTab={pageProps.tab||null}/>;
      case "ext-route":   return <ExtensionRoutePage {...pageProps} currentUser={currentUser} navigate={navigate}/>;
      case "moderation":    return requireAuth(<ModerationPage currentUser={currentUser} navigate={navigate}/>);
      default:            return <FeedPage spaces={spaces} tags={tags} currentUser={currentUser} navigate={navigate} notifCount={notifCount} msgCount={msgCount} onLogout={logout} tagFilter={pageProps?.tag||null} livePosts={livePosts} liveEvents={liveEvents} liveReplyUpdate={liveReplyUpdate}/>;
    }
  };

  return (
    <>
      <div className="app-root">
        {/* Mobile overlays */}
        <div className={`mob-overlay ${mobLeftOpen?"open":""}`}>
          <div className="mob-overlay-head">
            <span className="mob-overlay-title">Menu</span>
            <button className="mob-icon-btn" onClick={()=>setMobLeftOpen(false)} aria-label="Close menu"><i className="fa-solid fa-xmark"/></button>
          </div>
          <div className="mob-overlay-body">
            <Sidebar currentUser={currentUser} spaces={spaces} page={page} pageProps={pageProps} navigate={(p,props)=>{setMobLeftOpen(false);navigate(p,props);}} onLogout={logout} notifCount={notifCount} msgCount={msgCount} modReportCount={modReportCount} onAuthRequired={m=>setAuthModal(m)} layoutCfg={layoutCfg} mobile={true}/>
          </div>
        </div>
        {/* Drawer backdrop. Only painted in the tablet band where the right
            overlay renders as a side drawer rather than a full-screen sheet;
            see .mob-overlay-backdrop in app.css. onMouseDown rather than
            onClick so a drag that starts inside the drawer and ends on the
            backdrop does not dismiss it. */}
        <div className={`mob-overlay-backdrop ${mobRightOpen?"open":""}`}
             onMouseDown={()=>setMobRightOpen(false)} aria-hidden="true"/>
        <div className={`mob-overlay right ${mobRightOpen?"open":""}`}>
          <div className="mob-overlay-head">
            <span className="mob-overlay-title">Activity</span>
            <button className="mob-icon-btn" onClick={()=>setMobRightOpen(false)} aria-label="Close activity"><i className="fa-solid fa-xmark"/></button>
          </div>
          <div className="mob-overlay-body">
            <RightPanel spaces={spaces} tags={tags} liveEvents={liveEvents} layoutCfg={layoutCfg} mobile={true} currentUser={currentUser} navigate={navigate} page={page} pageProps={pageProps}/>
          </div>
        </div>
        <MobileUserMenu user={currentUser} navigate={navigate} onLogout={logout} open={mobUserOpen} onClose={()=>setMobUserOpen(false)}/>
        <MobileSearchOverlay open={mobSearchOpen} onClose={()=>setMobSearchOpen(false)} navigate={navigate}/>
        <MobileTopBar onHamburger={()=>setMobLeftOpen(true)} onRight={()=>setMobRightOpen(true)} branding={appBranding} onNavigateHome={()=>navigate("feed",{})}/>
        <MobileTabBar currentUser={currentUser} navigate={navigate} page={page} notifCount={notifCount} msgCount={msgCount} onCompose={()=>navigate("compose")} onSearch={()=>navigate("search")} onProfile={()=>setMobUserOpen(true)} onAuthRequired={m=>setAuthModal(m)} registrationOpen={registrationOpen}/>
      <div className="app-shell">
        <Sidebar currentUser={currentUser} spaces={spaces} page={page} pageProps={pageProps} navigate={navigate} onLogout={logout} notifCount={notifCount} msgCount={msgCount} modReportCount={modReportCount} onAuthRequired={m=>setAuthModal(m)} layoutCfg={layoutCfg}/>
        <div className="main-area">
          <TopBar currentUser={currentUser} navigate={navigate} onLogout={logout} notifCount={notifCount} msgCount={msgCount} modReportCount={modReportCount} onSearch={q=>navigate("search",{q})} onAuthRequired={m=>setAuthModal(m)} registrationOpen={registrationOpen} onToggleRight={()=>setMobRightOpen(true)}/>
          {currentUser?.status==="pending_deletion"&&<PendingDeletionBanner scheduledAt={currentUser.deletion_scheduled_at} onCancel={async()=>{const d=await api.delete("/auth/schedule-deletion").catch(()=>({}));if(d.ok){setCurrentUser(u=>({...u,status:"active",deletion_scheduled_at:null}));toast("Deletion cancelled — account restored");}}} onNavigateSettings={()=>navigate("settings",{tab:"security"})}/> }
          <main className="page-area" style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            {renderPage()}
          </main>
        </div>
        <RightPanel spaces={spaces} tags={tags} liveEvents={liveEvents} layoutCfg={layoutCfg} currentUser={currentUser} navigate={navigate} page={page} pageProps={pageProps}/>
      </div>
      </div>
      {/* Lightbox handled by Fancybox 5 */}
      {userCard&&<UserCardPopover card={userCard} setCard={setUserCard} currentUser={currentUser} navigate={navigate}/>}
      <RefPreviewPopup/>
      {authModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,padding:20}} onMouseDown={e=>e.target===e.currentTarget&&setAuthModal(null)}>
          <div style={{width:"100%",maxWidth:440,background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:20,padding:40,position:"relative"}}>
            <button onClick={()=>setAuthModal(null)} style={{position:"absolute",top:16,right:18,background:"none",border:"none",color:"var(--t4)",fontSize:20,cursor:"pointer",lineHeight:1}}>✕</button>
            <div style={{textAlign:"center",marginBottom:28}}>
              <div style={{margin:"0 auto 14px",display:"flex",alignItems:"center",justifyContent:"center"}}>
                {appBranding?.logo_url
                  ? <img src={appBranding.logo_url} style={{maxHeight:48,maxWidth:160,objectFit:"contain"}} alt={appBranding.site_name||"logo"}/>
                  : appBranding?.favicon_url
                    ? <img src={appBranding.favicon_url} style={{width:48,height:48,objectFit:"contain",borderRadius:12}} alt={appBranding.site_name||"logo"}/>
                    : <div style={{width:48,height:48,borderRadius:"50%",background:"var(--ac)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:"#fff",fontWeight:500}}>
                        {(appBranding?.site_name||"N").slice(0,1).toUpperCase()}
                      </div>
                }
              </div>
              <div style={{fontSize:22,fontWeight:600,color:"var(--t1)"}}>{authModal==="login"?"Welcome back":"Create account"}</div>
              <div style={{fontSize:14,color:"var(--t4)",marginTop:6}}>{authModal==="login"?"Sign in to continue":"Join the community"}</div>
            </div>
            <AuthModalForm mode={authModal} onLogin={u=>{updateCurrentUser(u);setAuthModal(null);}} onSwitch={m=>setAuthModal(m)} registrationOpen={registrationOpen} oauthProviders={oauthProviders} turnstileSiteKey={turnstileSiteKey}/>
          </div>
        </div>
      )}
      {isIosSafari&&!iosPromptDismissed&&pwaCfgPublic.ios_prompt_enabled&&(
        <IosInstallPrompt
          pwaCfg={pwaCfgPublic}
          onDismiss={()=>{
            setIosPromptDismissed(true);
            try { localStorage.setItem("pwa.ios_prompt.dismissed","1"); } catch {}
          }}
        />
      )}
      <AndroidInstallSheet pwaCfg={pwaCfgPublic} appBranding={appBranding}/>
      {(!currentUser || cookieConsentCfg?.show_to_members) && <CookieBanner config={cookieConsentCfg}/>}
      <Toasts/>
    </>
  );
}

// ── CookieBanner ──────────────────────────────────────────────────────────────
//
// Shown on first visit when cookie_consent.enabled is true. Persists choice
// in localStorage under "nexus.cookie_consent" as "all" | "essential".
// Exposes window.NexusCookieConsent = { level: "all"|"essential"|null }
// so extensions can gate optional cookies on user consent.

function CookieBanner({ config }) {
  const STORAGE_KEY = "nexus.cookie_consent";
  const saved = (() => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } })();
  const [dismissed, setDismissed] = useState(!!saved);
  const [expanded, setExpanded] = useState(false);
  const [prefs, setPrefs] = useState(() => {
    // Initialise category toggles: required categories always on, others on by default
    const cats = config?.categories || [];
    return Object.fromEntries(cats.map(c => [c.key, c.required || saved === "all" || !saved]));
  });

  // Expose consent level globally for extensions
  useEffect(() => {
    window.NexusCookieConsent = { level: saved || null };
  }, []);

  if (dismissed || !config?.enabled) return null;

  const save = (level) => {
    try { localStorage.setItem(STORAGE_KEY, level); } catch {}
    window.NexusCookieConsent = { level };
    setDismissed(true);
  };

  const acceptAll   = () => save("all");
  const rejectOpt   = () => save("essential");
  const savePrefs   = () => {
    // If all optional categories are toggled on treat as "all", else "essential"
    const optCats = (config?.categories || []).filter(c => !c.required);
    const allOn   = optCats.every(c => prefs[c.key]);
    save(allOn ? "all" : "essential");
  };

  const privacyLink = config?.privacy_policy_url
    ? <a href={config.privacy_policy_url} target="_blank" rel="noopener noreferrer"
         style={{color:"var(--ac-text)",textDecoration:"underline",marginLeft:4}}>Privacy policy</a>
    : null;

  const bannerStyle = {
    position:"fixed", bottom:0, left:0, right:0,
    background:"var(--s2)", borderTop:"0.5px solid var(--b3)",
    zIndex:9999, boxShadow:"0 -8px 32px rgba(0,0,0,0.4)"
  };
  const innerStyle = { maxWidth:900, margin:"0 auto", padding:"18px 24px" };

  if (expanded) {
    const categories = config?.categories || [];
    return (
      <div style={bannerStyle}>
        <div style={innerStyle}>
          <div style={{fontSize:15,fontWeight:600,color:"var(--t1)",marginBottom:3}}>Manage cookie preferences</div>
          <div style={{fontSize:12,color:"var(--t3)",marginBottom:18}}>
            Choose which cookies you allow. Essential cookies cannot be disabled as they are required for the forum to function.
            {privacyLink}
          </div>
          {categories.map(cat => (
            <div key={cat.key} style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16,padding:"12px 0",borderBottom:"0.5px solid rgba(255,255,255,0.04)"}}>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:500,color:"var(--t1)"}}>
                  {cat.name}
                  {cat.required && <span style={{fontSize:10,background:"rgba(255,255,255,0.06)",border:"0.5px solid var(--b1)",borderRadius:20,padding:"2px 8px",color:"var(--t4)",marginLeft:8}}>Always on</span>}
                </div>
                <div style={{fontSize:12,color:"var(--t4)",marginTop:2}}>{cat.description}</div>
              </div>
              <div style={{flexShrink:0,paddingTop:2}}>
                <div
                  style={{width:36,height:20,borderRadius:10,background:prefs[cat.key]?"var(--ac)":"var(--tgl-off)",position:"relative",cursor:cat.required?"not-allowed":"pointer",transition:"background .2s",flexShrink:0,opacity:cat.required?0.5:1}}
                  onClick={()=>{ if(!cat.required) setPrefs(p=>({...p,[cat.key]:!p[cat.key]})); }}>
                  <div style={{position:"absolute",top:3,left:prefs[cat.key]?18:3,width:14,height:14,borderRadius:"50%",background:"#fff",transition:"left .2s"}}/>
                </div>
              </div>
            </div>
          ))}
          <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:8,paddingTop:14,borderTop:"0.5px solid var(--b1)",marginTop:4}}>
            <button className="btn-ghost" style={{fontSize:12,padding:"6px 16px"}} onClick={rejectOpt}>Reject optional</button>
            <button className="btn-primary" style={{fontSize:13,padding:"8px 20px"}} onClick={savePrefs}>Save preferences</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={bannerStyle}>
      <div style={{...innerStyle,display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:220}}>
          <div style={{fontSize:14,fontWeight:600,color:"var(--t1)",marginBottom:4}}>Cookie preferences</div>
          <div style={{fontSize:12,color:"var(--t3)",lineHeight:1.55}}>
            {config?.banner_message || "We use cookies to keep you signed in and improve your experience."}
            {privacyLink}
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0,flexWrap:"wrap"}}>
          <button onClick={()=>setExpanded(true)} style={{fontSize:12,color:"var(--t4)",cursor:"pointer",background:"none",border:"none",fontFamily:"inherit",padding:0,textDecoration:"underline",textUnderlineOffset:2}}>Manage preferences</button>
          <button className="btn-ghost" style={{fontSize:12,padding:"6px 16px"}} onClick={rejectOpt}>Reject optional</button>
          <button className="btn-primary" style={{fontSize:13,padding:"8px 20px"}} onClick={acceptAll}>Accept all</button>
        </div>
      </div>
    </div>
  );
}

// ── Extension UI primitives ───────────────────────────────────────────────────
//
// Exposed on `window.NexusComponents` so no-build extension bundles can use
// Nexus's native UI primitives without importing React modules or shipping
// their own copies. Mirrors the `window.NexusExtensionTemplates` pattern
// used for admin panel templates.
//
// Curated, not exhaustive. These five primitives cover the 90% of extension
// UI needs. Adding more in the future is a deliberate decision — each
// addition becomes part of the extension API contract.
//
// Props for each are listed below. Documented prop shapes are stable;
// changes follow the same deprecation path as any other extension API
// breakage.
//
//   NexusComponents.Toggle
//     { value: boolean, onChange: (newValue) => void,
//       label?: string, hint?: string }
//
//   NexusComponents.Select
//     { value, onChange: (newValue) => void,
//       options?: Array<{value, label}> | Array<string>,
//       children?: ReactNode (alternative to options for raw <option> elements),
//       disabled?: boolean, id?: string, className?: string, style?: object }
//
//   NexusComponents.Av
//     { user: { username, avatar_url? }, size?: number (default 28) }
//
//   NexusComponents.Md
//     { text: string }  — renders Nexus's markdown flavor including
//     mention links, post embeds, and other Nexus-specific syntax.
//
//   NexusComponents.toast
//     toast(message: string, type?: "ok" | "err" | "warn") — fire-and-forget,
//     a single <Toasts/> mount at the app root displays them. Already mounted;
//     extensions don't need to render anything.
//
// Example (no-build extension):
//
//   const { Toggle, toast } = window.NexusComponents;
//
//   NE.registerAdminPanel({
//     slug: "my-ext",
//     label: "My Extension",
//     icon: "fa-puzzle-piece",
//     component: function MyPanel() {
//       const [enabled, setEnabled] = React.useState(false);
//       return React.createElement("div", null,
//         React.createElement(Toggle, {
//           value: enabled,
//           onChange: (v) => { setEnabled(v); toast("Updated"); },
//           label: "Enable feature X",
//         })
//       );
//     },
//   });
window.NexusComponents = {
  Toggle,
  Select,
  Av,
  Md,
  toast,
};

const root = document.getElementById("root");
if (root) ReactDOM.createRoot(root).render(<App/>);
