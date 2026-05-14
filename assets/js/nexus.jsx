import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom/client";
import DOMPurify from "dompurify";
import { api }                                              from "./lib/api";
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
import { DragList, LayoutAdmin }                           from "./admin/AdminLayout";
import { ReportCard, ModerationPage, AdminModerationPanel } from "./admin/AdminModeration";
import { AdminIntegrationsPanel, AdminAntiSpamPanel,
         AdminLogsPanel, AdminDigestPanel,
         AdminLeaderboardPanel }                           from "./admin/AdminPanels";
import { RARITY_COLOR, RARITY_BG, RARITY_WEIGHT,
         BadgesPageSidebar, BadgesPage,
         AdminBadgesPanel, TRIGGER_TYPE_LABELS }           from "./admin/AdminBadges";
import { AdminExtensionsPanel, ExtensionInfoPanel,
         ExtensionFieldRenderer, SimpleSettingsPanel,
         TabbedPanel }                                     from "./admin/AdminExtensions";
import { AdminPwaPanel, IosInstallPrompt }                 from "./admin/AdminPwaPanel";
import { AdminPage, VerifyEmailPage }                      from "./admin/AdminPage";
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

// ── Lightbox — powered by Fancybox 5 ─────────────────────────────────────────
// Fancybox is loaded on demand the first time a user clicks an image.
// This keeps ~47 KiB of JS+CSS off the initial page load entirely.
let _fancyboxLoading = false;
let _fancyboxLoaded  = false;

function loadFancybox(callback) {
  if (_fancyboxLoaded) { callback(); return; }
  if (_fancyboxLoading) { setTimeout(() => loadFancybox(callback), 50); return; }
  _fancyboxLoading = true;

  // Inject CSS
  const link  = document.createElement("link");
  link.rel    = "stylesheet";
  link.href   = "https://unpkg.com/@fancyapps/ui@5/dist/fancybox/fancybox.css";
  document.head.appendChild(link);

  // Inject JS
  const script  = document.createElement("script");
  script.src    = "https://unpkg.com/@fancyapps/ui@5/dist/fancybox/fancybox.umd.js";
  script.onload = () => { _fancyboxLoaded = true; _fancyboxLoading = false; callback(); };
  script.onerror = () => { _fancyboxLoading = false; };
  document.head.appendChild(script);
}

function openFancybox(items, startIndex) {
  loadFancybox(() => {
    if (!window.Fancybox) return;
    const gallery = items.map(item => ({
      src:   item.originalSrc || item.src,
      thumb: item.src,
      type:  "image",
    }));
    window.Fancybox.show(gallery, {
      startIndex: startIndex || 0,
      Thumbs: { type: "classic" },
      Toolbar: {
        display: {
          left:   ["infobar"],
          middle: [],
          right:  ["slideshow","fullscreen","thumbs","close"],
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
  const spaceBelow = window.innerHeight - lr.bottom;
  const showBelow = spaceBelow > 220;
  _refPopupSetState && _refPopupSetState({
    data,
    x: Math.min(Math.max(lr.left, 8), window.innerWidth - 428),
    y: showBelow ? lr.bottom + 6 : lr.top - 6,
    above: !showBelow
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
// Attach delegated click handler to .md-body images once at module load
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
  const originalSrc = img.getAttribute("data-original") || img.src;
  // Collect all images in the same .md-body for gallery mode
  const body = img.closest(".md-body");
  const allImgs = body ? [...body.querySelectorAll("img:not(.yt-lite img):not(.md-link-preview img)")] : [img];
  const items = allImgs.map(i => ({ src: i.src, originalSrc: i.getAttribute("data-original") || i.src }));
  const startIdx = allImgs.indexOf(img);
  openFancybox(items, startIdx < 0 ? 0 : startIdx);
});

function useRefPreview() {
  const [popup, setPopup] = useState(null);
  useEffect(()=>{ _refPopupSetState = setPopup; return ()=>{ _refPopupSetState=null; }; }, []);
  return popup;
}

function RefPreviewPopup() {
  const popup = useRefPreview();
  if (!popup) return null;
  const { data, x, y, above } = popup;
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
      <div className="ref-popup-body">{stripMd(data.body).slice(0, 600)}</div>
    </div>
  );
}


// ── Extension slot registry ──────────────────────────────────────────────────
// Extensions register UI slot components here at runtime via their JS bundle.
// Usage from extension bundle:
//   window.NexusExtensions.registerSlot("feed_sidebar", MyComponent, 50);
//   window.NexusExtensions.registerRoute("/my-ext/users/:username", MyPage);
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
  _rightWidgets: [],
  _rightWidgetListeners: [],
  _userActions: [],
  _userActionListeners: [],
  _accountActions: [],
  _accountActionListeners: [],
  _postActions: [],
  _postActionListeners: [],
  _notifTypes: {},
  _notifTypeListeners: [],

  registerSlot(slotName, component, priority = 50) {
    if (!this._slots[slotName]) this._slots[slotName] = [];
    this._slots[slotName].push({component, priority});
    this._slots[slotName].sort((a, b) => a.priority - b.priority);
    this._listeners.forEach(fn => fn(slotName));
  },

  getSlot(slotName) {
    return this._slots[slotName] || [];
  },

  onChange(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(f => f !== fn); };
  },

  // Register a toolbar button in the post and/or reply composer.
  //
  // NexusExtensions.registerToolbarButton(config, priority)
  //
  // config fields:
  //   icon     {string}   Required. Full Font Awesome class string for the button icon.
  //                       Must include both the style prefix and the icon name.
  //                       Examples:
  //                         "fa-solid fa-gamepad"      ✓ correct
  //                         "fa-regular fa-star"       ✓ correct
  //                         "fa-gamepad"               ✗ missing style prefix — renders as text
  //                         "fa-solid"                 ✗ missing icon name
  //
  //   tip      {string}   Required. Tooltip text shown on hover. Also used to generate
  //                       the internal button type — must be unique across all extensions.
  //                       Example: "Link a game"
  //
  //   scope    {string}   Optional. Controls which composer toolbar the button appears in.
  //                       "both"    — visible in Post toolbar and Reply toolbar (default)
  //                       "posts"   — visible in Post toolbar, hidden in Reply toolbar
  //                       "replies" — visible in Reply toolbar, hidden in Post toolbar
  //                       Admins can always override visibility per-toolbar in the Layout panel.
  //
  //   onClick  {function} Required. Called when the button is clicked.
  //                       Receives (linkedGames, setLinkedGames) — use these to read and
  //                       write the post's linked games array (Gamepedia integration).
  //                       For buttons unrelated to games, ignore both arguments.
  //                       Example:
  //                         onClick(linkedGames, setLinkedGames) {
  //                           openMyPicker();
  //                         }
  //
  // Styling:
  //   Extension buttons inherit the same styling as built-in toolbar buttons via the
  //   .comp-tb-btn CSS class — muted color at rest, brighter on hover. Do not pass a
  //   color field; it is ignored. Custom styling via inline styles is not supported.
  //
  // priority {number} Optional. Lower numbers appear before higher numbers among
  //                   extension buttons (built-in buttons always come first).
  //                   Default: 50.
  //
  // Example:
  //   NexusExtensions.registerToolbarButton({
  //     icon:  "fa-solid fa-photo-film",
  //     tip:   "Insert GIF or Sticker",
  //     scope: "both",
  //     onClick(_linkedGames, _setLinkedGames) {
  //       openGifPicker();
  //     },
  //   }, 60);
  //
  registerToolbarButton(config, priority = 50) {
    this._toolbarButtons.push({config, priority});
    this._toolbarButtons.sort((a, b) => a.priority - b.priority);
    this._toolbarListeners.forEach(fn => fn());
  },

  getToolbarButtons() {
    return this._toolbarButtons;
  },

  onToolbarChange(fn) {
    this._toolbarListeners.push(fn);
    return () => { this._toolbarListeners = this._toolbarListeners.filter(f => f !== fn); };
  },

  // Register a full-page route for the SPA.
  // pattern: string like "/my-ext/users/:username" — colon-prefixed segments
  //          become named params passed as props to the component.
  // component: React component receiving ({ navigate, currentUser, ...params })
  // options: { title } — optional page title shown in the back-header
  // Usage from extension bundle:
  //   window.NexusExtensions.registerRoute("/gamepedia/users/:username", GamelogPage, { title: "Gamelog" });
  registerRoute(pattern, component, options = {}) {
    // Convert "/foo/:bar/:baz" → a regex that captures named groups
    const keys = [];
    const regexStr = pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, k) => {
      keys.push(k);
      return "([^/]+)";
    });
    const regex = new RegExp("^" + regexStr + "$");
    this._routes.push({ pattern, regex, keys, component, options });
    this._routeListeners.forEach(fn => fn());
  },

  // Match a pathname against registered extension routes.
  // Returns { component, params, options } or null.
  matchRoute(pathname) {
    for (const route of this._routes) {
      const m = pathname.match(route.regex);
      if (m) {
        const params = {};
        route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { component: route.component, params, options: route.options, pattern: route.pattern };
      }
    }
    return null;
  },

  // Reconstruct a URL for a registered route by filling in param values.
  // window.NexusExtensions.routeUrl("/gamepedia/users/:username", { username: "alice" })
  // → "/gamepedia/users/alice"
  routeUrl(pattern, params = {}) {
    return pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, k) =>
      params[k] !== undefined ? encodeURIComponent(params[k]) : `:${k}`
    );
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
    this._adminPanels = this._adminPanels.filter(p => p.slug !== slug);
    this._adminPanels.push({ slug, label, icon, component });
    this._adminPanelListeners.forEach(fn => fn());
  },

  getAdminPanels() {
    return this._adminPanels;
  },

  onAdminPanelChange(fn) {
    this._adminPanelListeners.push(fn);
    return () => { this._adminPanelListeners = this._adminPanelListeners.filter(f => f !== fn); };
  },

  // Register an item in the Explore section of the left sidebar.
  // Extensions call this from their bundle:
  //
  //   window.NexusExtensions.registerExploreItem({
  //     id:       "gamepedia",          // unique — used for layout save/restore
  //     label:    "Games",
  //     icon:     "fa-gamepad",         // any FA solid class
  //     page:     "ext-route",          // use "ext-route" for extension SPA routes
  //     props:    { _match: ..., ... }, // passed straight to navigate()
  //     authOnly: false,                // hide when not logged in (optional)
  //     priority: 50,                   // lower = higher up (optional, default 50)
  //   });
  //
  // For linking to a registered route the easiest pattern is:
  //   page: "ext-route",
  //   props: window.NexusExtensions.matchRoute("/gamepedia") || {}
  //
  // The item appears in Explore and in the Layout admin drag-to-reorder list.
  registerExploreItem({ id, label, icon="fa-puzzle-piece", page, props={}, authOnly=false, priority=50 }) {
    this._exploreItems = this._exploreItems.filter(i => i.id !== id);
    this._exploreItems.push({ id, label, icon, page, props, authOnly, priority, _ext: true });
    this._exploreItems.sort((a, b) => (a.priority||50) - (b.priority||50));
    this._exploreListeners.forEach(fn => fn());
  },

  getExploreItems() { return this._exploreItems; },

  onExploreChange(fn) {
    this._exploreListeners.push(fn);
    return () => { this._exploreListeners = this._exploreListeners.filter(f => f !== fn); };
  },

  // Register a widget in the right sidebar.
  // Extensions call this from their bundle:
  //
  //   window.NexusExtensions.registerRightWidget({
  //     id:        "gamepedia-recent",      // unique
  //     label:     "Recent Games",          // shown in Layout admin drag list
  //     component: MyWidget,               // React component, receives ({ navigate, currentUser })
  //     priority:  50,                     // lower = higher up (optional, default 50)
  //     pages:     ["ext-route:gamepedia"], // optional — restrict to specific pages.
  //                                        // Format: "page" or "ext-route:patternPrefix"
  //                                        // Omit to show on all pages (default behaviour).
  //   });
  //
  // The widget appears in the right panel and in the Layout admin drag-to-reorder list.
  registerRightWidget({ id, label, component, priority=50, pages=null }) {
    this._rightWidgets = this._rightWidgets.filter(w => w.id !== id);
    this._rightWidgets.push({ id, label, component, priority, pages, _ext: true });
    this._rightWidgets.sort((a, b) => (a.priority||50) - (b.priority||50));
    this._rightWidgetListeners.forEach(fn => fn());
  },

  getRightWidgets() { return this._rightWidgets; },

  onRightWidgetChange(fn) {
    this._rightWidgetListeners.push(fn);
    return () => { this._rightWidgetListeners = this._rightWidgetListeners.filter(f => f !== fn); };
  },

  // Register a custom right sidebar layout for a specific extension page or
  // pattern of pages. When the user is on a matching route, RightPanel renders
  // exactly the widget IDs supplied (in order) instead of the default layout.
  // Core built-in widget IDs: "live_activity", "spaces_by_pulse", "stats".
  // Extension widgets are referenced by their registered id.
  //
  // pattern: a string prefix matched against the current ext-route pattern.
  //   "/ext/gamepedia/"  matches any Gamepedia route
  //   "/ext/gamepedia/browse" matches only the browse page
  //
  // widgetIds: ordered array of widget IDs to render. Any ID not found in the
  //   built-in or registered widget maps is silently skipped.
  //
  // Usage from extension bundle:
  //   NE.registerPageSidebar("/ext/gamepedia/", [
  //     "live_activity",
  //     "gamepedia-most-discussed",
  //     "gamepedia-most-gamelogd",
  //     "gamepedia-genre-explorer",
  //     "stats",
  //     "gamepedia-now-playing",
  //   ]);
  registerPageSidebar(pattern, widgetIds) {
    this._pageSidebars = this._pageSidebars || [];
    this._pageSidebars = this._pageSidebars.filter(p => p.pattern !== pattern);
    this._pageSidebars.push({ pattern, widgetIds });
    this._rightWidgetListeners.forEach(fn => fn());
  },

  getPageSidebar(routePattern) {
    if (!this._pageSidebars || !routePattern) return null;
    return this._pageSidebars.find(p => routePattern.startsWith(p.pattern)) || null;
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
  //       navigate("ext-route", window.NexusExtensions.matchRoute(
  //         `/gamepedia/users/${user.username}`
  //       ) || {});
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
  //       navigate("ext-route", ...);
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

  getAccountActions() { return this._accountActions; },

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
  //       navigate("ext-route", window.NexusExtensions.matchRoute("/gamepedia") || {});
  //     },
  //   });
  registerNotificationType(type, { icon, iconColor, renderBody, onClick }) {
    this._notifTypes[type] = { icon, iconColor, renderBody, onClick };
    this._notifTypeListeners.forEach(fn => fn());
  },

  getNotifType(type) { return this._notifTypes[type] || null; },

  onNotifTypeChange(fn) {
    this._notifTypeListeners.push(fn);
    return () => { this._notifTypeListeners = this._notifTypeListeners.filter(f => f !== fn); };
  },
};

// Load all enabled extension JS bundles declared in slot assignments.
// Each bundle is a plain ES module that calls NexusExtensions.registerSlot().
// Extension bundles are now injected as <script> tags in root.html.heex
// by NexusWeb.Plugs.ExtensionBundles, so they load synchronously before
// React mounts. No deferred fetch needed.

// ── Global CSS ───────────────────────────────────────────────────────────────
const S = document.createElement("style");
S.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');
/* Font Awesome 7 Free — self-hosted via assets/css/fontawesome.css bundled into app.css */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{
  --tgl-off:rgba(255,255,255,0.12);
  --tgl-knob-off:rgba(255,255,255,0.75);
  --fs-ui:16px;
  --fs-body:13px;
  --fs-title:20px;
  --fs-content:14px;
  --fs-feed-title:14px;
  --fs-code:12px;
  --bg:#0d0d14;
  --s1:#13121e;
  --av-radius:22%;
  --s2:#18182a;
  --s3:#1e1c2e;
  --b1:rgba(255,255,255,0.07);
  --b2:rgba(255,255,255,0.10);
  --b3:rgba(255,255,255,0.14);
  --t1:#f0eeff;
  --t2:rgba(255,255,255,0.75);
  --t3:rgba(255,255,255,0.55);
  --t4:rgba(255,255,255,0.38);
  --t5:rgba(255,255,255,0.28);
  --ac:#a78bfa;
  --ac-on:#0d0d14;
  --ac-bg:rgba(167,139,250,0.09);
  --ac-border:rgba(167,139,250,0.25);
  --ac-text:#c4b5fd;
  --green:#34d399;
  --pink:#f472b6;
  --blue:#60a5fa;
  --amber:#fbbf24;
  --red:#f87171;
}
[data-theme="light"] .icon-btn{background:rgba(0,0,0,0.05);border-color:rgba(0,0,0,0.09);color:rgba(26,20,80,0.55);}
[data-theme="light"] .icon-btn:hover{background:rgba(0,0,0,0.09);}
[data-theme="light"] .sb-item:hover{background:rgba(0,0,0,0.04);}
[data-theme="light"] .tb-search{background:rgba(0,0,0,0.04);border-color:rgba(0,0,0,0.09);}
[data-theme="light"] .tb-search-item:hover{background:rgba(0,0,0,0.04);}
[data-theme="light"] .sort-pill{border-color:rgba(26,20,80,0.10);color:rgba(26,20,80,0.60);}
[data-theme="light"] .thread-preview{color:rgba(26,20,80,0.60);}
[data-theme="light"] .part-label{color:rgba(26,20,80,0.60);}
[data-theme="light"] .last-ago{color:rgba(26,20,80,0.60);}
[data-theme="light"] .pav-more{background:rgba(0,0,0,0.06);color:rgba(26,20,80,0.60);}
[data-theme="light"] .mob-tab{color:rgba(26,20,80,0.60);}
[data-theme="light"] .thread{border-bottom-color:rgba(26,20,80,0.07);}
[data-theme="light"] .thread:hover{background:rgba(0,0,0,0.02);}
[data-theme="light"] .pav-more{background:rgba(0,0,0,0.06);color:var(--t4);}
[data-theme="light"] .meta-div{background:rgba(26,20,80,0.08);}
[data-theme="light"] .rw{border-color:rgba(26,20,80,0.10);}
[data-theme="light"] .p-bar-wrap{background:rgba(26,20,80,0.07);}
[data-theme="light"] .stat-card{background:rgba(26,20,80,0.04);}
[data-theme="light"] .rx-trigger:hover{background:rgba(0,0,0,0.04);}
[data-theme="light"] .rx-pick-btn:hover{background:rgba(0,0,0,0.06);}
[data-theme="light"] .rx-pill{border-color:rgba(26,20,80,0.12);background:rgba(26,20,80,0.03);}
[data-theme="light"] .reply-item{border-bottom-color:rgba(26,20,80,0.06);}
[data-theme="light"] .row-menu-btn:hover{background:rgba(0,0,0,0.05);}
[data-theme="light"] .btn-ghost{border-color:rgba(26,20,80,0.15);color:var(--t3);}
[data-theme="light"] .btn-ghost:hover{background:rgba(26,20,80,0.05);}
[data-theme="light"] .fi{background:rgba(0,0,0,0.04);border-color:rgba(26,20,80,0.12);color:var(--t1);}
[data-theme="light"] .fi:focus{border-color:var(--ac-border);}
[data-theme="light"] .panel{background:rgba(0,0,0,0.02);border-color:var(--b1);}
[data-theme="light"] .toggle-row{border-bottom-color:rgba(26,20,80,0.06);}
[data-theme="light"] .atbl td{border-bottom-color:rgba(26,20,80,0.06);}
[data-theme="light"] .atbl tr:hover td{background:rgba(0,0,0,0.02);}
[data-theme="light"] .admin-stat-card{background:rgba(26,20,80,0.03);border-color:rgba(26,20,80,0.09);}
[data-theme="light"] .admin-stat-card:hover{border-color:rgba(26,20,80,0.15);}
[data-theme="light"] .admin-sn-item:hover{background:rgba(0,0,0,0.04);}
[data-theme="light"] .comp-sel{border-color:rgba(26,20,80,0.12);background:rgba(0,0,0,0.03);}
[data-theme="light"] .comp-tag-add{border-color:rgba(26,20,80,0.10);}
[data-theme="light"] .reply-box{border-color:rgba(26,20,80,0.12);background:rgba(0,0,0,0.01);}
[data-theme="light"] .reply-box-foot{border-top-color:rgba(26,20,80,0.08);}
[data-theme="light"] .comp-tb-btn:hover{background:rgba(0,0,0,0.06);}
[data-theme="light"] .slash-item:hover,.slash-item.sel{background:rgba(0,0,0,0.05);}
[data-theme="light"] .mention-item:hover,.mention-item.sel{background:rgba(0,0,0,0.06);}
[data-theme="light"] .slash-icon{background:rgba(0,0,0,0.04);border-color:var(--b1);}
[data-theme="light"] .notif-item:hover{background:rgba(0,0,0,0.02);}
[data-theme="light"] .dm-search-inner{background:rgba(0,0,0,0.04);border-color:rgba(26,20,80,0.09);}
[data-theme="light"] .thread-row{border-bottom-color:rgba(26,20,80,0.06);}
[data-theme="light"] .thread-row:hover,.thread-row.active{background:rgba(0,0,0,0.03);}
[data-theme="light"] .theirs .bubble{background:rgba(26,20,80,0.07);border-color:var(--b1);}
[data-theme="light"] .profile-stat-card{background:rgba(26,20,80,0.03);border-color:rgba(26,20,80,0.08);}
[data-theme="light"] .profile-stat-card:hover{border-color:rgba(26,20,80,0.14);}
[data-theme="light"] .p-reply-card{border-bottom-color:rgba(26,20,80,0.06);}
[data-theme="light"] .md-body code{background:rgba(26,20,80,0.07);}
[data-theme="light"] .md-body pre{background:rgba(26,20,80,0.04);}
[data-theme="light"] .atbl.members-tbl tr{border-bottom-color:rgba(26,20,80,0.07);}
[data-theme="light"] .comp-title-input::placeholder{color:rgba(26,20,80,0.20);}
[data-theme="light"] .comp-ta::placeholder{color:rgba(26,20,80,0.18);}
[data-theme="light"] .reply-box-ta::placeholder{color:rgba(26,20,80,0.20);}
[data-theme="light"] .mob-scrubber-track{background:rgba(26,20,80,0.09);}
[data-theme="light"] .mob-sheet-handle{background:rgba(26,20,80,0.15);}
[data-theme="light"] .mob-reply-fake{background:rgba(0,0,0,0.04);}
[data-theme="light"] .spoiler{background:rgba(26,20,80,0.09);}
[data-theme="light"] .spoiler.revealed{background:rgba(26,20,80,0.05);}
[data-theme="light"] .spoiler:hover{background:rgba(26,20,80,0.14);}
[data-theme="light"] select{background:rgba(0,0,0,0.04);color:var(--t1);border-color:rgba(26,20,80,0.12);}
[data-theme="light"] select option{background:#fff;color:var(--t1);}
[data-theme="light"] .av-dd-item:hover{background:rgba(0,0,0,0.05);color:var(--t1);}
[data-theme="light"] .tgl{box-shadow:inset 0 0 0 1px rgba(26,20,80,0.15);}
[data-theme="light"]{--tgl-off:rgba(26,20,80,0.12);--tgl-knob-off:#ffffff;}
[data-theme="light"] .tgl-knob{box-shadow:0 1px 3px rgba(26,20,80,0.18);}
[data-theme="light"] .rw-label{color:var(--t4);}
[data-theme="light"] .p-bar-wrap{background:rgba(26,20,80,0.12);}
[data-theme="light"] .av-dd{border-color:rgba(26,20,80,0.18);box-shadow:0 4px 24px rgba(26,20,80,0.10);}
[data-theme="light"] .av-dd-item{color:var(--t2);}
[data-theme="light"] .av-dd-handle{color:var(--t3);}
[data-theme="light"] .theirs .bubble{background:rgba(26,20,80,0.07);color:var(--t2);border-color:var(--b2);}
[data-theme="light"] .profile-cover-edit{background:rgba(255,255,255,0.75);color:var(--t2);border-color:rgba(26,20,80,0.15);}
[data-theme="light"] .profile-cover-expand{background:rgba(255,255,255,0.75);color:var(--t2);border-color:rgba(26,20,80,0.15);}
[data-theme="light"] .profile-cover-expand:hover{color:var(--t1);}
[data-theme="light"] .ucard-stat-n{color:var(--t1);}
[data-theme="light"] .ucard-stat-l{color:var(--t4);}
html,body{background:var(--bg);color:var(--t1);font-family:'Inter',system-ui,sans-serif;font-size:var(--fs-body);line-height:1.5;min-height:100vh;}
#root{min-height:100vh;display:flex;flex-direction:column;}
::-webkit-scrollbar{width:3px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:3px;}
button{font-family:inherit;cursor:pointer;border:none;background:none;}
input,textarea,select{font-family:inherit;}
select{background:rgba(255,255,255,0.05);color:var(--t1);border:0.5px solid rgba(255,255,255,0.1);border-radius:8px;}
select option{background:#1a1a2e;color:var(--t1);}

@keyframes fadein{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:translateY(0);}}
@keyframes bounce{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-4px);opacity:1}}

/* Layout */
.app-root{display:flex;justify-content:center;height:100vh;overflow:hidden;background:var(--bg);}
.app-shell{display:flex;width:100%;max-width:1600px;height:100vh;overflow:hidden;}
.sidebar{width:320px;min-width:320px;background:var(--bg);border-right:0.5px solid var(--b1);display:flex;flex-direction:column;height:100vh;flex-shrink:0;overflow:hidden;}
.sb-logo{height:64px;display:flex;align-items:center;padding:0 18px;border-bottom:0.5px solid var(--b1);flex-shrink:0;}
.sb-scroll{flex:1;overflow-y:auto;padding:10px 0;}
.sb-label{font-size:var(--fs-ui);font-weight:500;color:var(--t5);letter-spacing:.8px;text-transform:uppercase;padding:0 16px;margin-bottom:4px;margin-top:14px;}
.sb-label:first-child{margin-top:2px;}
.sb-item{display:flex;align-items:center;gap:12px;padding:10px 18px;cursor:pointer;position:relative;transition:background .1s;}
.sb-item:hover{background:rgba(255,255,255,0.04);}
.sb-item.active{background:var(--ac-bg);}
.sb-item.active::before{content:'';position:absolute;left:0;top:4px;bottom:4px;width:2.5px;background:var(--ac);border-radius:0 2px 2px 0;}
.sb-item i{width:18px;text-align:center;font-size:15px;flex-shrink:0;color:var(--t3);}
.sb-item.active i{color:var(--ac);}
.sb-item-name{font-size:var(--fs-body);color:var(--t3);flex:1;}
.sb-item.active .sb-item-name{color:var(--ac-text);font-weight:500;}
.sb-item-count{font-size:11px;color:var(--t5);}
.sb-item.active .sb-item-count{color:rgba(167,139,250,0.55);}
.sb-badge{font-size:10px;background:rgba(248,113,113,0.2);color:var(--red);border-radius:20px;padding:1px 7px;font-weight:500;}
.sb-divider{height:0.5px;background:var(--b1);margin:8px 0;}
.sb-user{border-top:0.5px solid var(--b1);padding:10px 12px;display:flex;align-items:center;gap:9px;flex-shrink:0;}
.sb-user-info{flex:1;min-width:0;}
.sb-user-name{font-size:13px;font-weight:500;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.sb-user-role{font-size:11px;color:var(--t5);}
.sb-user-icon{color:var(--t4);cursor:pointer;flex-shrink:0;transition:color .1s;display:flex;align-items:center;}
.sb-user-icon:hover{color:var(--t1);}
.sb-user-icon.danger:hover{color:var(--red);}

/* Main area */
.main-area{flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden;}

/* Topbar */
.topbar{height:64px;background:var(--bg);border-bottom:0.5px solid var(--b1);display:flex;align-items:center;padding:0 18px;gap:8px;flex-shrink:0;position:relative;z-index:50;}
.logo-text{font-size:15px;font-weight:500;color:#fff;letter-spacing:-.5px;}
[data-theme="light"] .logo-text{color:var(--ac);}
.logo-text em{font-style:normal;color:var(--ac);}
.tb-search{flex:1;max-width:400px;background:rgba(255,255,255,0.05);border:0.5px solid rgba(255,255,255,0.09);border-radius:24px;padding:10px 18px;font-size:14px;color:var(--t4);display:flex;align-items:center;gap:10px;cursor:text;}
.tb-search input{background:transparent;border:none;outline:none;font-size:14px;color:var(--t2);font-family:inherit;flex:1;}
.tb-search input::placeholder{color:var(--t4);}
.tb-search-drop{position:absolute;top:calc(100% + 8px);left:0;right:0;background:var(--s2);border:0.5px solid var(--b2);border-radius:14px;overflow:hidden;z-index:500;box-shadow:0 8px 32px rgba(0,0,0,.5);}
.tb-search-item{display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;transition:background .1s;}
.tb-search-item:hover{background:rgba(255,255,255,0.05);}
.tb-search-section{font-size:var(--fs-ui);font-weight:500;color:var(--t5);text-transform:uppercase;letter-spacing:.07em;padding:8px 14px 4px;}
.tb-search-title{font-size:13px;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;}
.tb-search-sub{font-size:11px;color:var(--t5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;}
.tb-search-all{padding:10px 14px;font-size:12px;color:var(--ac-text);cursor:pointer;text-align:center;border-top:0.5px solid var(--b1);}
.tb-search-all:hover{background:rgba(255,255,255,0.04);}
.icon-btn{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.05);border:0.5px solid rgba(255,255,255,0.09);display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;flex-shrink:0;transition:background .1s;color:rgba(255,255,255,0.55);}
.icon-btn:hover{background:rgba(255,255,255,0.09);}
.icon-badge{position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:var(--ac);border:1.5px solid var(--bg);}
.icon-badge.green{background:var(--green);}
.write-btn{font-size:15px;color:var(--ac-on);background:var(--ac);border:none;border-radius:24px;padding:10px 24px;font-weight:600;cursor:pointer;white-space:nowrap;transition:opacity .1s;}
.write-btn:hover{opacity:.9;}

/* Avatar menu */
.av-wrap{position:relative;margin-left:2px;}
.av-circle{width:38px;height:38px;border-radius:var(--av-radius);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:500;color:#fff;cursor:pointer;border:2px solid transparent;transition:border-color .15s;flex-shrink:0;overflow:hidden;}
.av-circle:hover{border-color:rgba(167,139,250,.5);}
.av-circle.open{border-color:var(--ac);}
.av-dd{position:absolute;top:calc(100% + 10px);right:0;width:200px;background:var(--s2);border:0.5px solid var(--b3);border-radius:14px;padding:6px;z-index:200;opacity:0;pointer-events:none;transform:translateY(-6px);transition:opacity .18s ease,transform .18s ease;}
.av-dd.open{opacity:1;pointer-events:all;transform:translateY(0);}
.av-dd-hdr{padding:10px 12px 8px;border-bottom:0.5px solid var(--b1);margin-bottom:4px;}
.av-dd-name{font-size:13px;font-weight:500;color:var(--t1);margin-bottom:2px;}
.av-dd-handle{font-size:11px;color:var(--t4);}
.av-dd-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;cursor:pointer;font-size:var(--fs-body);color:var(--t3);transition:background .1s,color .1s;}
.av-dd-item:hover{background:rgba(255,255,255,0.06);color:#fff;}
.av-dd-item i{width:14px;text-align:center;font-size:12px;flex-shrink:0;}
.av-dd-item.admin-item{color:rgba(251,191,36,.8);}
.av-dd-item.admin-item i{color:var(--amber);}
.av-dd-item.admin-item:hover{background:rgba(251,191,36,.08);color:var(--amber);}
.av-dd-item.logout-item{color:rgba(248,113,113,.7);}
.av-dd-item.logout-item i{color:var(--red);}
.av-dd-item.logout-item:hover{background:rgba(248,113,113,.08);color:var(--red);}
.av-dd-divider{height:0.5px;background:var(--b1);margin:4px 0;}

/* Feed center */
.feed-wrap{flex:1;display:flex;flex-direction:column;overflow:hidden;}
.feed-header{display:flex;align-items:center;justify-content:space-between;padding:0 18px;height:44px;border-bottom:0.5px solid var(--b1);flex-shrink:0;}
.feed-title{font-size:var(--fs-body);font-weight:500;color:var(--t2);}
.sort-pills{display:flex;gap:4px;}
.sort-pill{font-size:var(--fs-ui);color:var(--t3);padding:4px 11px;border-radius:20px;border:0.5px solid rgba(255,255,255,0.08);cursor:pointer;transition:all .1s;}
.sort-pill.active{color:var(--ac);border-color:var(--ac-border);background:var(--ac-bg);}
.sort-pill:hover:not(.active){color:var(--t2);border-color:var(--b2);}
.feed-list{flex:1;overflow-y:auto;}

/* Thread rows */
.thread{border-bottom:0.5px solid rgba(255,255,255,0.05);cursor:pointer;display:flex;flex-direction:column;transition:background .1s;}
.thread:hover{background:rgba(255,255,255,0.02);}
.thread-main{display:flex;align-items:stretch;}
.thread-accent{width:3px;align-self:stretch;flex-shrink:0;border-radius:0 2px 2px 0;}
.thread-av{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:500;flex-shrink:0;margin:0 14px 0 18px;align-self:center;}
.thread-body{flex:1;min-width:0;padding:12px 0 8px;align-self:center;}
.thread-top{display:flex;align-items:center;gap:8px;margin-bottom:3px;}
.thread-title{font-size:var(--fs-feed-title);font-weight:500;color:#e8e4ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;}
[data-theme="light"] .thread-title{color:var(--t1);}
.thread-tag{font-size:var(--fs-ui);font-weight:500;padding:2px 7px;border-radius:20px;flex-shrink:0;text-transform:uppercase;letter-spacing:.4px;}
.thread-tags-row{display:none;}
.thread-top-tags{display:none;}
.thread-tags-col{display:flex;flex-direction:column;gap:4px;align-items:flex-end;justify-content:center;padding:0 14px 0 0;flex-shrink:0;}
.thread-preview{font-size:var(--fs-body);color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:8px;}
.av-stack{display:flex;}
.pav{width:26px;height:26px;border-radius:50%;border:2px solid var(--bg);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;color:#fff;margin-right:-8px;flex-shrink:0;}
.av-tip{position:relative;display:inline-flex;flex-shrink:0;}
.av-tip::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:var(--s1);color:var(--t1);border:0.5px solid var(--b2);border-radius:6px;padding:3px 8px;font-size:11px;font-weight:500;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .12s;z-index:200;box-shadow:0 2px 8px rgba(0,0,0,.25);}
.av-tip:hover::after{opacity:1;}
.pav-more{background:rgba(255,255,255,0.08);color:var(--t3);font-size:8px;}
.part-label{font-size:var(--fs-ui);color:var(--t3);margin-left:14px;}
.participants-row{display:flex;align-items:center;padding:0 0 11px;}
.thread-meta{display:flex;align-items:center;justify-content:center;padding:0 14px 0 0;flex-shrink:0;}
.meta-block{display:flex;flex-direction:column;align-items:center;gap:1px;width:48px;}
.meta-n{font-size:16px;font-weight:500;color:var(--t3);}
.meta-l{font-size:16px;color:var(--t5);}
.meta-div{width:0.5px;height:26px;background:rgba(255,255,255,0.06);}
.thread-last{display:flex;flex-direction:column;align-items:center;gap:2px;width:52px;}
.thread-save-btn{position:absolute;top:10px;left:12px;width:26px;height:26px;border-radius:50%;background:transparent;border:none;color:var(--t5);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;opacity:0;transition:opacity .15s;z-index:10;}
.thread-save-btn.saved{color:var(--ac);opacity:1;}
.thread:hover .thread-save-btn{opacity:1;}
@media(max-width:767.99px){.thread-save-btn{opacity:1!important;}}
.last-av{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;color:#fff;}
.last-ago{font-size:16px;color:var(--t3);}

/* Right panel */
.right-panel{width:320px;min-width:320px;border-left:0.5px solid var(--b1);padding:16px 14px;display:flex;flex-direction:column;gap:16px;overflow-y:auto;flex-shrink:0;}
.rw{border-radius:12px;border:0.5px solid rgba(255,255,255,0.08);padding:15px 16px;}
.rw-label{font-size:var(--fs-ui);font-weight:500;color:var(--t5);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px;}
.live-row{display:flex;align-items:flex-start;gap:8px;padding:5px 0;}
.l-av{width:22px;height:22px;border-radius:var(--av-radius);display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:500;color:#fff;flex-shrink:0;margin-top:1px;}
.l-txt{font-size:var(--fs-body);color:var(--t3);line-height:1.5;flex:1;}
.l-txt strong{color:var(--t2);font-weight:500;}
.l-ago{font-size:11px;color:var(--t5);flex-shrink:0;margin-top:2px;}
.pulse-row{display:flex;align-items:center;gap:8px;padding:5px 0;}
.p-name{font-size:13px;color:var(--t3);width:80px;flex-shrink:0;display:flex;align-items:center;gap:6px;}
.p-bar-wrap{flex:1;height:3px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;}
.p-bar{height:3px;border-radius:3px;}
.p-count{font-size:12px;color:var(--t4);width:24px;text-align:right;flex-shrink:0;}
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.stat-card{background:rgba(255,255,255,0.04);border-radius:10px;padding:12px 14px;}
.stat-n{font-size:20px;font-weight:500;color:#e8e4ff;line-height:1;}
[data-theme="light"] .stat-n{color:var(--t1);}
.stat-l{font-size:12px;color:var(--t4);margin-top:3px;}

/* Post view */
.post-shell{flex:1;display:flex;overflow:hidden;}
.desk-scrubber{display:flex;align-items:stretch;flex-shrink:0;}
@media(max-width:767.99px){
/* Scrubber */
.desk-scrubber{display:none!important;}

/* Feed thread cards */
.thread-top{flex-wrap:wrap;}
.thread-title{width:100%;flex-shrink:0;white-space:normal;overflow:visible;text-overflow:unset;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:4px;}
.thread-tags-col{display:none;}
.thread-tags-row{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:5px;}
.thread-body{min-width:0;}
.thread-meta{flex-direction:column;align-items:flex-end;gap:2px;}
.meta-div{display:none;}
.meta-block .meta-l{display:none;}
.thread-last{margin-top:0;}

/* Hide hearts count on mobile feed */
.thread-meta .meta-block{display:none;}

/* Admin panel */
.admin-content-header{padding:0 14px;height:52px;}
.admin-content-title{font-size:16px;}
.admin-content-body{padding:16px 14px;}
.asc-title{font-size:18px!important;}
.admin-content-wrap{flex:1;overflow:hidden;display:flex;flex-direction:column;}

/* Tables scroll horizontally */
.atbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;}

/* Admin table rows — stack controls below content on mobile */
.atbl td:last-child{display:block;padding-top:6px;}
.atbl td:last-child>div{flex-wrap:wrap;}

/* Logo / favicon upload — stack vertically on mobile */
.logo-upload-row{flex-direction:column;align-items:flex-start!important;gap:10px!important;}
.logo-upload-row .logo-upload-hint{margin-top:4px;}

/* Badge pills in admin rows — wrap */
.badge-row-pills{flex-wrap:wrap;gap:4px;}

/* Toggle rows — keep on one line but allow label to wrap */
.toggle-row{flex-wrap:nowrap;gap:12px;}
.toggle-row>div:first-child{flex:1;min-width:0;}
.tgl{flex-shrink:0;}

/* Members admin table — collapse to card-like rows */
.atbl.members-tbl thead{display:none;}
.atbl.members-tbl tr{display:block;padding:12px 14px;border-bottom:0.5px solid rgba(255,255,255,0.06);}
.atbl.members-tbl td{display:block;padding:2px 0;border:none;}
.atbl.members-tbl td:last-child{padding-top:8px;}

/* Reduce form padding */
.fi{font-size:14px;}
.fgt{font-size:11px;}
}
.post-content-wrap{flex:1;overflow-y:auto;padding:24px 28px;}
@media(max-width:767.99px){.post-content-wrap{padding-bottom:calc(80px + env(safe-area-inset-bottom));}}
.post-back{font-size:12px;color:var(--t4);cursor:pointer;display:flex;align-items:center;gap:6px;margin-bottom:18px;transition:color .1s;}
.post-back:hover{color:var(--t2);}
.post-title{font-size:var(--fs-title);font-weight:600;color:var(--t1);letter-spacing:-.3px;line-height:1.35;margin-bottom:12px;}
.post-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px;}
.post-body{font-size:var(--fs-content);color:var(--t3);line-height:1.75;padding-bottom:18px;border-bottom:0.5px solid var(--b1);}
.reaction-row{display:flex;align-items:center;gap:8px;padding:10px 0;flex-wrap:wrap;}
/* React button */
.rx-trigger{display:inline-flex;align-items:center;gap:6px;font-size:13px;padding:5px 10px;border:0.5px solid transparent;border-radius:20px;cursor:pointer;background:transparent;color:var(--t4);transition:all .15s;user-select:none;position:relative;}
.rx-trigger:hover{border-color:var(--b2);color:var(--t2);background:rgba(255,255,255,0.06);}
.rx-trigger.reacted{background:var(--ac-bg);color:var(--ac-text);border:1.5px solid var(--ac);}
/* Reaction picker */
.rx-picker{position:absolute;bottom:calc(100% + 8px);right:0;background:var(--s2);border:0.5px solid var(--b2);border-radius:16px;padding:8px;display:flex;gap:4px;z-index:200;box-shadow:0 8px 32px rgba(0,0,0,.4);animation:rxPop .12s ease;}
@keyframes rxPop{from{opacity:0;transform:scale(.92) translateY(4px);}to{opacity:1;transform:scale(1) translateY(0);}}
.rx-pick-btn{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:22px;transition:all .1s;border:1.5px solid transparent;}
.rx-pick-btn:hover{background:rgba(255,255,255,0.08);transform:scale(1.15);}
.rx-pick-btn.selected{border-color:var(--ac);background:var(--ac-bg);}
/* Reaction count pills */
.rx-pills{display:flex;gap:5px;flex-wrap:wrap;}
.rx-pill{display:inline-flex;align-items:center;gap:4px;font-size:12px;padding:3px 10px;border:0.5px solid rgba(255,255,255,0.1);border-radius:20px;cursor:pointer;background:rgba(255,255,255,0.03);color:var(--t4);transition:all .1s;}
.rx-pill:hover{border-color:var(--b2);color:var(--t2);}
.rx-pill.mine{background:var(--ac-bg);color:var(--ac-text);border-color:var(--ac-border);}
.replies-header{display:flex;align-items:center;padding:10px 0 6px;border-bottom:0.5px solid var(--b1);}
.replies-count{font-size:14px;color:var(--t3);}
/* Extension slots */
.post-footer-slot{padding:12px 0 4px;}
.comp-ext-toolbar{display:flex;align-items:center;gap:6px;padding:6px 0 2px;}
.comp-game-chips{display:flex;flex-wrap:wrap;gap:6px;padding:6px 0;}
.comp-game-chip{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,0.06);border:0.5px solid var(--b2);border-radius:20px;padding:4px 10px 4px 6px;font-size:12px;color:var(--t2);}
.comp-game-chip img{width:20px;height:28px;object-fit:cover;border-radius:3px;}
.comp-game-chip button{background:none;border:none;color:var(--t4);cursor:pointer;font-size:11px;padding:0 0 0 2px;line-height:1;}
.comp-game-chip button:hover{color:var(--t1);}
.reply-item{padding:14px 0;border-bottom:0.5px solid rgba(255,255,255,0.04);}
.reply-av{width:48px;height:48px;border-radius:var(--av-radius);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:500;color:#fff;flex-shrink:0;}
.reply-body-wrap{}
.reply-meta{display:flex;align-items:center;gap:8px;margin-bottom:6px;width:100%;}
.reply-quote-btn{font-size:14px;color:var(--t5);cursor:pointer;margin-left:auto;opacity:0;transition:opacity .15s;padding:2px 6px;border-radius:4px;flex-shrink:0;}
.reply-item:hover .reply-quote-btn{opacity:1;}
.reply-item:hover .reply-menu-btn{opacity:1!important;border-color:var(--b1)!important;}
.reply-quote-btn:hover{color:var(--ac-text);}
.post-reply-btn{font-size:14px;color:var(--t5);cursor:pointer;opacity:0;transition:opacity .15s;padding:2px 6px;border-radius:4px;flex-shrink:0;white-space:nowrap;background:none;border:none;font-family:inherit;}
.post-reply-btn:hover{color:var(--ac-text);}
.reply-item:hover .post-reply-btn{opacity:1;}
.reaction-row:hover .post-reply-btn{opacity:1;}
.row-menu-btn{width:26px;height:26px;border-radius:50%;background:transparent;border:0.5px solid transparent;color:var(--t4);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;opacity:0;transition:opacity .15s;flex-shrink:0;}
.row-menu-btn:hover{background:rgba(255,255,255,0.06);}
.reply-item:hover .row-menu-btn{opacity:1;border-color:var(--b1);}
.reaction-row:hover .row-menu-btn{opacity:1;border-color:var(--b1);}
@media(max-width:767.99px){.post-reply-btn{opacity:1!important;}.row-menu-btn{opacity:1!important;border-color:var(--b1)!important;}}
.reply-author{font-size:14px;font-weight:500;color:var(--t2);}
.reply-time{font-size:14px;color:var(--t5);}
.reply-text{font-size:13px;color:var(--t3);line-height:1.65;}

/* Composer */
.composer-shell{flex:1;padding:0;display:flex;flex-direction:column;overflow:hidden;}
.composer-inner{width:100%;padding:32px 48px 0;box-sizing:border-box;display:flex;flex-direction:column;flex:1;overflow:hidden;}
.comp-title-input{width:100%;background:transparent;border:none;border-bottom:0.5px solid var(--b1);outline:none;font-size:22px;font-weight:600;color:var(--t1);font-family:inherit;letter-spacing:-.3px;margin-bottom:0;padding-bottom:16px;}
.comp-title-input::placeholder{color:rgba(255,255,255,0.15);}
.comp-meta-row{display:flex;align-items:center;gap:8px;padding:12px 0;flex-wrap:wrap;border-bottom:0.5px solid var(--b1);margin-bottom:0;}
.comp-sel{font-size:12px;padding:4px 12px;border-radius:20px;border:0.5px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:var(--t3);cursor:pointer;font-family:inherit;outline:none;}
.comp-tag-pill{font-size:14px;padding:4px 12px;border-radius:20px;background:var(--ac-bg);color:var(--ac-text);border:0.5px solid var(--ac-border);cursor:pointer;display:flex;align-items:center;gap:6px;}
.comp-tag-add{font-size:14px;padding:6px 14px;border-radius:20px;border:0.5px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:var(--t4);cursor:pointer;display:flex;align-items:center;gap:6px;transition:all .1s;}
.comp-tag-add:hover{border-color:var(--b2);color:var(--t2);}
.comp-body-area{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--s1);border-radius:0 0 12px 12px;}
.comp-type-btn{display:flex;align-items:center;gap:7px;padding:6px 14px;border-radius:20px;border:0.5px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:var(--t3);cursor:pointer;font-size:14px;font-family:inherit;transition:all .1s;position:relative;user-select:none;}
.comp-type-btn:hover{border-color:var(--b2);color:var(--t2);}
.comp-dd{position:absolute;top:calc(100% + 6px);left:0;background:var(--s2);border:0.5px solid var(--b3);border-radius:14px;padding:6px;z-index:100;min-width:180px;box-shadow:0 8px 32px rgba(0,0,0,.4);}
.comp-dd-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;cursor:pointer;font-size:14px;color:var(--t3);transition:background .1s;}
.comp-dd-item:hover{background:rgba(255,255,255,0.06);color:var(--t1);}
.comp-dd-item.active{color:var(--ac-text);background:var(--ac-bg);}
.comp-ta{width:100%;height:100%;background:transparent;border:none;outline:none;font-size:15px;color:var(--t3);line-height:1.75;font-family:inherit;resize:none;min-height:240px;caret-color:var(--ac);padding:0 16px;box-sizing:border-box;}
.comp-ta::placeholder{color:rgba(255,255,255,0.12);}
.comp-footer{display:flex;align-items:center;gap:10px;padding:16px 0 24px;border-top:0.5px solid var(--b1);margin-top:0;flex-shrink:0;}
.comp-char{font-size:14px;color:var(--t5);}

/* Buttons */
.btn-primary{font-size:14px;padding:9px 22px;border-radius:22px;background:var(--ac);color:var(--ac-on);border:none;cursor:pointer;font-family:inherit;font-weight:500;transition:opacity .1s;}
.btn-primary:hover{opacity:.9;}
.btn-primary:disabled{opacity:.4;cursor:not-allowed;}
.btn-ghost{font-size:13px;padding:7px 18px;border-radius:20px;background:transparent;border:0.5px solid rgba(255,255,255,0.12);color:var(--t3);cursor:pointer;font-family:inherit;transition:all .1s;}
.btn-ghost:hover{color:var(--t1);border-color:var(--b2);}

/* Tags / space pills */
.sp-tag{font-size:9px;font-weight:500;padding:2px 8px;border-radius:20px;text-transform:uppercase;letter-spacing:.4px;}

/* Reply box */

@media(max-width:767.99px){
.sidebar,.right-panel,.topbar{display:none!important;}
.mob-topbar{position:fixed;top:0;left:0;right:0;height:52px;background:var(--bg);border-bottom:0.5px solid var(--b1);display:flex;align-items:center;justify-content:space-between;padding:0 14px;z-index:900;}
.mob-topbar-logo{font-size:22px;font-weight:700;color:var(--t1);letter-spacing:-1px;}
.mob-topbar-logo em{color:var(--ac);font-style:normal;}
.mob-icon-btn{width:38px;height:38px;display:flex;align-items:center;justify-content:center;border-radius:10px;cursor:pointer;background:none;border:none;color:var(--t2);font-size:18px;}
.mob-tabbar{position:fixed;bottom:0;left:0;right:0;height:calc(54px + env(safe-area-inset-bottom));padding-bottom:env(safe-area-inset-bottom);background:var(--bg);border-top:0.5px solid var(--b1);display:flex;align-items:center;justify-content:space-around;z-index:900;}
.mob-tab{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:52px;height:44px;cursor:pointer;position:relative;border:none;background:none;color:var(--t3);}
.mob-tab.active{color:var(--ac);}
.mob-tab i{font-size:20px;}
.mob-tab-label{font-size:9px;letter-spacing:.2px;}
.mob-tab-compose{width:46px;height:46px;border-radius:14px;background:var(--ac);color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;border:none;cursor:pointer;box-shadow:0 2px 12px rgba(167,139,250,.4);}
.mob-badge{position:absolute;top:4px;right:4px;width:7px;height:7px;border-radius:50%;background:var(--red);border:1.5px solid var(--bg);}
.mob-overlay{position:fixed;inset:0;background:var(--bg);z-index:950;display:flex;flex-direction:column;transform:translateX(-100%);transition:transform .25s cubic-bezier(.4,0,.2,1);}
.mob-overlay.right{transform:translateX(100%);}
.mob-overlay.open{transform:translateX(0);}
.mob-overlay-head{height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:0.5px solid var(--b1);flex-shrink:0;}
.mob-overlay-title{font-size:15px;font-weight:600;color:var(--t1);}
.mob-overlay-body{flex:1;overflow-y:auto;}
.mob-page-wrap{padding-top:52px;padding-bottom:calc(54px + env(safe-area-inset-bottom));flex:1;display:flex;flex-direction:column;overflow:hidden;}
.mob-user-overlay{position:fixed;inset:0;background:var(--bg);z-index:960;display:flex;flex-direction:column;transform:translateY(100%);transition:transform .25s cubic-bezier(.4,0,.2,1);}
.mob-user-overlay.open{transform:translateY(0);}
.mob-scrubber-bar{height:36px;background:var(--s1);border-bottom:0.5px solid var(--b1);display:flex;align-items:center;padding:0 14px;gap:10px;flex-shrink:0;cursor:pointer;-webkit-tap-highlight-color:transparent;}
.mob-scrubber-track{flex:1;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;position:relative;}
.mob-scrubber-fill{position:absolute;top:0;left:0;height:4px;border-radius:2px;background:var(--ac);transition:width .2s;}
.mob-scrubber-label{font-size:11px;color:var(--t4);flex-shrink:0;}
.mob-sheet{position:fixed;bottom:0;left:0;right:0;background:var(--s2);border:0.5px solid var(--b2);border-bottom:none;border-radius:16px 16px 0 0;z-index:980;transform:translateY(100%);transition:transform .25s cubic-bezier(.4,0,.2,1);padding-bottom:env(safe-area-inset-bottom);}
.mob-sheet.open{transform:translateY(0);}
.mob-sheet-handle{width:36px;height:4px;border-radius:2px;background:rgba(255,255,255,0.15);margin:12px auto 8px;}
.mob-reply-bar{position:fixed;left:0;right:0;background:var(--s1);border-top:0.5px solid var(--b1);z-index:895;}
.mob-reply-fake{flex:1;height:36px;background:rgba(255,255,255,0.05);border:0.5px solid var(--b1);border-radius:20px;display:flex;align-items:center;padding:0 14px;font-size:13px;color:var(--t5);cursor:text;}
}
@media(min-width:768px){
.mob-topbar,.mob-tabbar,.mob-overlay,.mob-page-wrap,.mob-user-overlay,.mob-reply-bar,.mob-scrubber-bar,.mob-sheet{display:none!important;}
.mob-admin-topbar{display:none;}
.mob-admin-close{display:none;}
}
@media(min-width:768px) and (max-width:1239.99px){
.right-panel{display:none!important;}
}
@media(min-width:768px) and (max-width:1080px){
.tb-search{max-width:240px;padding:8px 14px;}
.tb-search input{font-size:13px;}
}
@media(min-width:768px) and (max-width:900px){
.tb-search{max-width:44px;min-width:44px;padding:10px;overflow:hidden;border-radius:50%;}
.tb-search input,.tb-search-placeholder{display:none;}
}
@media(max-width:767.99px){.desk-composer{display:none!important;}}
@media(max-width:767.99px){
.admin-sidenav{display:none!important;}
.admin-sidenav.mob-open{display:flex!important;position:fixed;inset:0;z-index:950;width:100%;background:var(--bg);}
.admin-shell{flex-direction:column;}
.mob-admin-topbar{height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;border-bottom:0.5px solid var(--b1);flex-shrink:0;background:var(--bg);}
.mob-admin-close{height:52px;display:flex;align-items:center;justify-content:flex-end;padding:0 14px;border-bottom:0.5px solid var(--b1);flex-shrink:0;}
.mob-admin-back{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ac-text);cursor:pointer;padding:6px 0;}
.mob-admin-back i{font-size:15px;}
}
@media(max-width:767.99px){
.mob-sidebar-inner{width:100%;display:flex;flex-direction:column;}
.mob-sidebar-inner .sb-logo{display:none;}
.mob-sidebar-inner .sb-scroll{flex:1;overflow-y:auto;padding:8px 0;}
.mob-rightpanel-inner{width:100%;padding:16px;display:flex;flex-direction:column;gap:16px;}
}
@media(max-width:767.99px){.page-area{padding-top:52px;padding-bottom:calc(54px + env(safe-area-inset-bottom));}}

.reply-box{border:0.5px solid rgba(255,255,255,0.1);border-radius:12px;background:rgba(255,255,255,0.02);overflow:hidden;margin-top:16px;}
.reply-box-ta{width:100%;background:transparent;border:none;outline:none;font-size:13px;color:var(--t2);font-family:inherit;resize:none;min-height:72px;line-height:1.6;padding:14px 16px;caret-color:var(--ac);}
.reply-box-ta::placeholder{color:rgba(255,255,255,0.15);}
.spoiler{background:rgba(255,255,255,0.07);color:transparent;border-radius:3px;cursor:pointer;user-select:none;padding:0 3px;transition:color .2s,background .2s;}
.spoiler.revealed{color:var(--t2);background:rgba(255,255,255,0.04);}
.spoiler:hover{background:rgba(255,255,255,0.12);}
.reply-box-foot{padding:8px 12px;border-top:0.5px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:10px;}


/* Composer toolbar */
.comp-toolbar{display:flex;align-items:center;gap:2px;padding:6px 8px;border-bottom:0.5px solid var(--b1);}
.comp-tb-btn{display:inline-flex;align-items:center;justify-content:center;min-width:32px;height:32px;padding:0 6px;border-radius:6px;cursor:pointer;border:none;background:transparent;color:var(--t4);font-family:inherit;font-size:16px;transition:all .1s;}
.comp-tb-btn:hover{background:rgba(255,255,255,0.07);color:var(--t1);}
.comp-tb-sep{width:0.5px;height:16px;background:var(--b1);margin:0 3px;}
.slash-menu{position:fixed;background:var(--s2);border:0.5px solid var(--b2);border-radius:12px;width:214px;overflow:hidden;z-index:9999;box-shadow:0 6px 24px rgba(0,0,0,.6);}
.slash-item{display:flex;align-items:center;gap:10px;padding:9px 12px;font-size:13px;color:var(--t3);cursor:pointer;border-bottom:0.5px solid var(--b1);transition:background .1s;}
.slash-item:last-child{border-bottom:none;}
.slash-item:hover,.slash-item.sel{background:rgba(255,255,255,0.05);color:var(--t1);}
/* Mention dropdown */
.mention-drop{position:fixed;background:var(--s2);border:0.5px solid var(--b2);border-radius:12px;padding:4px;z-index:9000;min-width:200px;max-width:280px;box-shadow:0 8px 32px rgba(0,0,0,.5);overflow:hidden;}
.mention-item{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:8px;cursor:pointer;transition:background .1s;}
.mention-item:hover,.mention-item.sel{background:rgba(255,255,255,0.07);}
.mention-av{width:28px;height:28px;border-radius:var(--av-radius);object-fit:cover;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:500;color:#fff;}
.mention-name{font-size:13px;color:var(--t1);font-weight:500;}
.slash-icon{width:26px;height:26px;border-radius:7px;background:rgba(255,255,255,0.05);border:0.5px solid var(--b1);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;}
.slash-desc{font-size:11px;color:var(--t5);margin-top:1px;}

/* Auth */
.auth-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);}
.auth-card{width:100%;max-width:440px;padding:40px;background:var(--s2);border:0.5px solid var(--b2);border-radius:20px;}
.auth-logo{text-align:center;margin-bottom:28px;}
.auth-title{font-size:22px;font-weight:600;color:var(--t1);margin-top:10px;}
.auth-sub{font-size:14px;color:var(--t4);margin-top:6px;}
.fg{margin-bottom:18px;}
.fl{font-size:13px;color:var(--t3);margin-bottom:6px;display:block;}
.fi{width:100%;padding:11px 15px;background:rgba(255,255,255,0.05);border:0.5px solid rgba(255,255,255,0.1);border-radius:12px;color:var(--t1);font-size:15px;outline:none;transition:border-color .15s;}
.fi:focus{border-color:var(--ac);}
.fi::placeholder{color:var(--t5);}
.ferr{font-size:13px;color:var(--red);margin-top:4px;}
.link{color:var(--ac);cursor:pointer;}
.auth-switch{text-align:center;font-size:13px;color:var(--t4);margin-top:20px;}
.remember-row{display:flex;align-items:center;gap:8px;margin-bottom:18px;cursor:pointer;user-select:none;}
.remember-row input{width:16px;height:16px;accent-color:var(--ac);cursor:pointer;}
.remember-row span{font-size:13px;color:var(--t3);}

/* Admin */
.admin-shell{display:flex;width:100%;max-width:1600px;height:100vh;overflow:hidden;}
.admin-topbar{height:64px;background:var(--bg);border-bottom:0.5px solid var(--b1);display:flex;align-items:center;padding:0 24px;gap:14px;flex-shrink:0;}
.admin-badge{font-size:12px;font-weight:500;background:rgba(251,191,36,.15);color:var(--amber);border:0.5px solid rgba(251,191,36,.3);border-radius:20px;padding:5px 14px;display:flex;align-items:center;gap:6px;}
.admin-sidenav{width:320px;min-width:320px;border-right:0.5px solid var(--b1);display:flex;flex-direction:column;overflow:hidden;}
.admin-sidenav-scroll{flex:1;overflow-y:auto;padding:12px 0;}
.admin-sn-label{font-size:12px;font-weight:500;color:var(--t5);letter-spacing:.8px;text-transform:uppercase;padding:0 18px;margin-bottom:4px;margin-top:16px;}
.admin-sn-label:first-child{margin-top:2px;}
.admin-sn-item{display:flex;align-items:center;gap:14px;padding:12px 20px;cursor:pointer;position:relative;transition:background .1s;}
.admin-sn-item:hover{background:rgba(255,255,255,0.04);}
.admin-sn-item.active{background:var(--ac-bg);}
.admin-sn-item.active::before{content:'';position:absolute;left:0;top:4px;bottom:4px;width:2.5px;background:var(--ac);border-radius:0 2px 2px 0;}
.admin-sn-item i{width:20px;text-align:center;font-size:17px;flex-shrink:0;color:var(--t4);}
.admin-sn-item.active i{color:var(--ac);}
.admin-sn-item-name{font-size:16px;color:var(--t3);flex:1;}
.admin-sn-item.active .admin-sn-item-name{color:var(--ac-text);font-weight:500;}
.admin-sn-badge{font-size:12px;background:rgba(248,113,113,0.2);color:var(--red);border-radius:20px;padding:3px 9px;font-weight:500;}
.admin-content-wrap{flex:1;display:flex;flex-direction:column;overflow:hidden;}
.admin-content-header{padding:0 36px;height:64px;border-bottom:0.5px solid var(--b1);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
.admin-content-title{font-size:20px;font-weight:600;color:var(--t1);letter-spacing:-.2px;}
.admin-content-body{flex:1;overflow-y:auto;padding:32px 36px;}

/* Admin content bits */
.page-sub{font-size:14px;color:var(--t4);margin-bottom:20px;}
.admin-stat-row{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;margin-bottom:28px;}
.admin-stat-card{background:rgba(255,255,255,0.03);border:0.5px solid rgba(255,255,255,0.08);border-radius:14px;padding:18px 20px;transition:border-color .1s;}
.admin-stat-card:hover{border-color:rgba(255,255,255,0.14);}
.asc-icon{width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:14px;}
.asc-n{font-size:30px;font-weight:600;color:var(--t1);letter-spacing:-.5px;line-height:1;margin-bottom:6px;}
.asc-l{font-size:14px;color:var(--t4);}
.asc-delta{font-size:13px;margin-top:4px;display:flex;align-items:center;gap:4px;}
.delta-up{color:var(--green);}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:22px;}
.panel{background:rgba(255,255,255,0.02);border:0.5px solid var(--b1);border-radius:14px;padding:20px 22px;}
.panel-title{font-size:14px;font-weight:500;color:var(--t3);margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;}
.fgt{font-size:var(--fs-ui);color:var(--t3);letter-spacing:.05em;text-transform:uppercase;margin-bottom:16px;padding-bottom:8px;border-bottom:0.5px solid var(--b1);}
.f-label{font-size:14px;color:var(--t3);margin-bottom:7px;display:block;}
.f-hint{font-size:12px;color:var(--t5);margin-top:4px;}
.toggle-row{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:0.5px solid rgba(255,255,255,0.04);}
.toggle-row:last-child{border-bottom:none;}
.tgl{width:46px;height:26px;border-radius:20px;position:relative;cursor:pointer;transition:background .2s;}
.tgl-knob{position:absolute;top:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .2s;}
.atbl{width:100%;border-collapse:collapse;}
.atbl th{text-align:left;font-size:var(--fs-ui);color:var(--t5);padding:10px 14px;letter-spacing:.05em;text-transform:uppercase;border-bottom:0.5px solid var(--b1);}
.atbl td{padding:13px 14px;font-size:14px;color:var(--t3);border-bottom:0.5px solid rgba(255,255,255,0.04);}
.atbl tr:last-child td{border-bottom:none;}
.atbl tr:hover td{background:rgba(255,255,255,0.02);}

/* Notifications */
.notif-item{display:flex;align-items:flex-start;gap:12px;padding:14px 20px;border-bottom:0.5px solid var(--b1);cursor:pointer;transition:background .1s;}
.notif-item:hover{background:rgba(255,255,255,0.02);}
.notif-item.unread{background:rgba(167,139,250,0.04);}
.notif-pip{width:6px;height:6px;border-radius:50%;flex-shrink:0;margin-top:5px;}

/* DM */
.dm-shell{flex:1;display:flex;flex-direction:column;overflow:hidden;}
.dm-sidebar{flex:1;display:flex;flex-direction:column;overflow:hidden;}
.dm-search{padding:10px 14px;border-bottom:0.5px solid var(--b1);flex-shrink:0;}
.dm-search-inner{background:rgba(255,255,255,0.04);border:0.5px solid rgba(255,255,255,0.09);border-radius:20px;display:flex;align-items:center;padding:7px 13px;gap:8px;}
.dm-search-inner input{background:transparent;border:none;outline:none;font-size:12px;color:var(--t2);font-family:inherit;flex:1;}
.dm-search-inner input::placeholder{color:var(--t5);}
.thread-row{display:flex;align-items:center;gap:12px;padding:11px 14px;cursor:pointer;border-bottom:0.5px solid rgba(255,255,255,0.04);transition:background .1s;}
.thread-row:hover,.thread-row.active{background:rgba(255,255,255,0.03);}
.thr-av{width:38px;height:38px;border-radius:var(--av-radius);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:500;color:#fff;}
.thr-name{font-size:var(--fs-body);font-weight:500;color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.thr-preview{font-size:12px;color:var(--t5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.thr-unread{min-width:18px;height:18px;border-radius:20px;background:var(--ac);color:#fff;font-size:10px;font-weight:600;display:flex;align-items:center;justify-content:center;padding:0 5px;flex-shrink:0;}
.bubble{max-width:100%;padding:9px 13px;font-size:var(--fs-body);line-height:1.5;border-radius:18px;word-break:break-word;}
.mine .bubble{background:var(--ac);color:var(--ac-on);font-weight:500;border-bottom-right-radius:4px;}
.mine .bubble .md-body,.mine .bubble .md-body p,.mine .bubble .md-body *{color:inherit!important;}.bubble .md-body p:last-child{margin-bottom:0;}
.theirs .bubble{background:rgba(255,255,255,0.07);color:var(--t2);border:0.5px solid var(--b1);border-bottom-left-radius:4px;}

/* Profile */
.profile-cover{height:160px;background:var(--s2);position:relative;flex-shrink:0;overflow:hidden;transition:height .3s ease;}
.profile-cover.expanded{height:420px;}
.profile-cover-edit{position:absolute;top:12px;right:14px;font-size:11px;padding:4px 12px;border-radius:20px;background:rgba(0,0,0,.4);color:var(--t3);border:0.5px solid var(--b2);cursor:pointer;}
.profile-cover-expand{position:absolute;bottom:12px;right:14px;font-size:11px;padding:4px 10px;border-radius:20px;background:rgba(0,0,0,.4);color:var(--t3);border:0.5px solid var(--b2);cursor:pointer;display:flex;align-items:center;gap:5px;}
.profile-cover-expand:hover{color:var(--t1);}
.profile-cover-gradient{position:absolute;bottom:0;left:0;right:0;height:80px;background:linear-gradient(to top,var(--bg),transparent);}
.profile-info-wrap{padding:0 28px 20px;border-bottom:0.5px solid var(--b1);}
.profile-av-row{margin-top:-40px;margin-bottom:14px;display:flex;align-items:flex-end;justify-content:space-between;}
.profile-av-ring{width:80px;height:80px;border-radius:var(--av-radius);border:3px solid var(--bg);display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:#fff;flex-shrink:0;}
.profile-name{font-size:18px;font-weight:600;color:var(--t1);letter-spacing:-.3px;}
.profile-handle{font-size:13px;color:var(--t5);margin-bottom:10px;}
.profile-bio{font-size:13px;color:var(--t3);line-height:1.6;margin-bottom:14px;}
.profile-stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding-top:14px;border-top:0.5px solid var(--b1);}
.profile-stat-card{background:rgba(255,255,255,0.03);border:0.5px solid rgba(255,255,255,0.07);border-radius:12px;padding:12px 14px;transition:border-color .1s;}
.profile-stat-card:hover{border-color:rgba(255,255,255,0.12);}
.psc-icon{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;margin-bottom:8px;}
.psc-n{font-size:20px;font-weight:600;letter-spacing:-.5px;line-height:1;margin-bottom:3px;}
.psc-l{font-size:11px;color:var(--t5);}
.profile-tabs{display:flex;border-bottom:0.5px solid var(--b1);padding:0 28px;overflow-x:auto;scrollbar-width:none;}
.profile-tabs::-webkit-scrollbar{display:none;}
.p-tab{font-size:13px;color:var(--t4);padding:12px 0;margin-right:24px;cursor:pointer;border-bottom:1.5px solid transparent;white-space:nowrap;flex-shrink:0;}
.p-tab.active{color:var(--t1);border-bottom-color:var(--ac);}
.profile-tabs-mob{display:none;}
.settings-tabs-mob{display:none;}
.settings-desktop-tabs{display:flex;}
@media(max-width:600px){
  .profile-tabs{display:none;}
  .profile-tabs-mob{display:block;padding:0 16px;border-bottom:0.5px solid var(--b1);}
  .profile-tabs-mob details{position:relative;z-index:50;}
  .profile-tabs-mob summary{list-style:none;display:flex;align-items:center;justify-content:space-between;padding:11px 14px;border-radius:10px;cursor:pointer;font-size:13px;font-weight:500;color:var(--t1);background:var(--s2);border:0.5px solid var(--b2);margin:10px 0;}
  .profile-tabs-mob summary::-webkit-details-marker{display:none;}
  .profile-tabs-mob details[open] summary{border-bottom-left-radius:0;border-bottom-right-radius:0;border-bottom-color:transparent;}
  .profile-tabs-mob .ptm-menu{position:absolute;top:100%;left:0;right:0;background:var(--s2);border:0.5px solid var(--b2);border-top:none;border-bottom-left-radius:10px;border-bottom-right-radius:10px;overflow:hidden;z-index:50;}
  .profile-tabs-mob .ptm-item{padding:11px 14px;font-size:13px;color:var(--t4);cursor:pointer;}
  .profile-tabs-mob .ptm-item:hover{background:var(--s3);color:var(--t1);}
  .profile-tabs-mob .ptm-item.active{color:var(--ac);font-weight:500;}
  .settings-tabs-mob{display:block;padding:0 16px;border-bottom:0.5px solid var(--b1);}
  .settings-tabs-mob details{position:relative;z-index:50;}
  .settings-tabs-mob summary{list-style:none;display:flex;align-items:center;justify-content:space-between;padding:11px 14px;border-radius:10px;cursor:pointer;font-size:13px;font-weight:500;color:var(--t1);background:var(--s2);border:0.5px solid var(--b2);margin:10px 0;}
  .settings-tabs-mob summary::-webkit-details-marker{display:none;}
  .settings-tabs-mob details[open] summary{border-bottom-left-radius:0;border-bottom-right-radius:0;border-bottom-color:transparent;}
  .settings-tabs-mob .stm-menu{position:absolute;top:100%;left:0;right:0;background:var(--s2);border:0.5px solid var(--b2);border-top:none;border-bottom-left-radius:10px;border-bottom-right-radius:10px;overflow:hidden;z-index:50;}
  .settings-tabs-mob .stm-item{padding:11px 14px;font-size:13px;color:var(--t4);cursor:pointer;display:flex;align-items:center;gap:8px;}
  .settings-tabs-mob .stm-item:hover{background:var(--s3);color:var(--t1);}
  .settings-tabs-mob .stm-item.active{color:var(--ac);font-weight:500;}
  .settings-desktop-tabs{display:none;}
}
.p-reply-card{padding:14px 0;border-bottom:0.5px solid rgba(255,255,255,0.04);}
.p-reply-body{font-size:13px;color:var(--t3);line-height:1.6;margin-bottom:6px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
.p-reply-meta{font-size:11px;color:var(--t5);display:flex;align-items:center;gap:6px;}
.members-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;}
@media(max-width:767.99px){.members-grid{grid-template-columns:1fr;}}
@media(max-width:767.99px){.podium-desktop{display:none!important;}.podium-mobile{display:flex!important;}}
.mob-only{display:none;}
.p-media-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:16px 0;}
@media(max-width:767.99px){.profile-stat-grid{grid-template-columns:repeat(2,1fr);}.p-media-grid{grid-template-columns:repeat(2,1fr);}}

/* Search */
.search-wrap{flex:1;overflow-y:auto;padding:24px 28px;}
.search-bar{display:flex;gap:10px;margin-bottom:20px;align-items:center;}
@media(max-width:767.99px){.mob-only{display:flex!important;}}

/* Markdown */
.md-body{font-size:var(--fs-content);color:var(--t3);line-height:1.75;}
.md-body p{margin-bottom:10px;}
.md-body h1,.md-body h2,.md-body h3{color:var(--t1);font-weight:600;margin:16px 0 8px;letter-spacing:-.2px;}
.md-body code{font-family:'SF Mono','Fira Code',monospace;font-size:var(--fs-code);background:rgba(255,255,255,0.07);color:var(--ac-text);padding:2px 6px;border-radius:5px;}
.md-body pre{background:rgba(255,255,255,0.05);border:0.5px solid var(--b1);border-radius:10px;padding:14px;overflow-x:auto;margin-bottom:12px;}
.md-body pre code{background:none;padding:0;color:var(--t2);}
.md-body blockquote{border-left:3px solid var(--ac);padding:8px 14px;color:var(--t3);margin:10px 0;background:rgba(167,139,250,0.06);border-radius:0 8px 8px 0;}
.md-body blockquote p{margin-bottom:0;}
.md-body strong{color:var(--t1);font-weight:600;}
.md-body a{color:var(--blue);}
.mention-link{color:var(--ac-text)!important;background:var(--ac-bg);border-radius:4px;padding:1px 4px;text-decoration:none!important;font-weight:500;}
.reply-ref-link{color:var(--ac-text)!important;background:var(--ac-bg);border-radius:4px;padding:1px 4px;text-decoration:none!important;font-weight:500;font-size:11px;}
@keyframes refHighlight{0%{background:transparent;}25%{background:rgba(167,139,250,0.18);}75%{background:rgba(167,139,250,0.12);}100%{background:transparent;}}
.reply-ref-highlight{animation:refHighlight 1.2s ease forwards;}
.ref-popup{position:fixed;z-index:9100;width:420px;max-width:calc(100vw - 24px);background:var(--s2);border:0.5px solid var(--b2);border-radius:12px;padding:14px 16px;box-shadow:0 8px 32px rgba(0,0,0,.55);pointer-events:none;}
.ref-popup-meta{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
.ref-popup-av{width:26px;height:26px;border-radius:var(--av-radius);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;color:#fff;object-fit:cover;}
.ref-popup-username{font-size:12px;font-weight:500;color:var(--t2);}
.ref-popup-time{font-size:11px;color:var(--t5);margin-left:auto;}
.ref-popup-body{font-size:12px;color:var(--t4);line-height:1.6;max-height:220px;overflow:hidden;position:relative;}
.ref-popup-body::after{content:"";position:absolute;bottom:0;left:0;right:0;height:32px;background:linear-gradient(transparent,var(--s2));}
.md-body ul,.md-body ol{padding-left:20px;margin-bottom:10px;}
.md-body img{max-width:100%;max-height:480px;border-radius:10px;border:0.5px solid var(--b1);display:block;margin:10px 0;cursor:zoom-in;object-fit:contain;background:var(--bg2);}
.yt-lite img,.yt-thumb{cursor:pointer!important;border:none!important;background:none!important;margin:0!important;border-radius:0!important;max-height:none!important;}
.md-body a:has(img){display:inline-block;}
.md-embed{position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:12px;margin:12px 0;background:var(--bg2);border:0.5px solid var(--b1);}
.md-embed iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:none;border-radius:12px;}
.md-embed-video{margin:12px 0;}
/* YouTube lite embed */
.yt-lite{position:relative;padding-bottom:56.25%;border-radius:12px;overflow:hidden;margin:12px 0;cursor:pointer;background:#000;border:0.5px solid var(--b1);}
.yt-thumb{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;transition:opacity .2s;display:block;}
.yt-lite:hover .yt-thumb{opacity:.85;}
.yt-play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;filter:drop-shadow(0 2px 8px rgba(0,0,0,.5));transition:transform .15s;}
.yt-lite:hover .yt-play{transform:translate(-50%,-50%) scale(1.1);}
.yt-lite.active .yt-thumb,.yt-lite.active .yt-play{display:none;}
.yt-lite.active iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:none;}
/* X / Twitter embed */
.md-x-embed{margin:12px 0;border-radius:12px;overflow:hidden;border:0.5px solid var(--b1);background:var(--bg2);}
.md-x-loading{display:flex;align-items:center;gap:8px;padding:16px;font-size:13px;color:var(--t4);}
.md-x-embed .twitter-tweet{margin:0!important;}
/* Spotify embed */
.md-spotify-embed{margin:12px 0;border-radius:12px;overflow:hidden;border:0.5px solid var(--b1);}
.md-spotify-embed iframe{width:100%;height:352px;display:block;border-radius:12px;}
/* Link preview card */
.md-link-preview{margin:12px 0;}
.md-link-preview.loading{min-height:60px;background:var(--bg2);border:0.5px solid var(--b1);border-radius:12px;}
.md-link-preview a{cursor:pointer;}
.md-link-preview img{cursor:pointer!important;border:none!important;border-radius:0!important;margin:0!important;background:none!important;}
/* Lightbox */
/* Lightbox CSS removed — Fancybox 5 handles styling */


/* User card popover */
.ucard-wrap{position:fixed;z-index:8000;pointer-events:none;}
.ucard-wrap.visible{pointer-events:auto;}
.ucard{background:var(--s2);border:0.5px solid var(--b2);border-radius:16px;width:320px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.5);animation:rxPop .15s ease;}
.ucard-cover{height:100px;background:linear-gradient(135deg,#1e1c2e,#312e55);position:relative;flex-shrink:0;}
.ucard-body{padding:16px 18px 18px;}
.ucard-stat{background:rgba(255,255,255,0.05);border-radius:8px;padding:10px 8px;text-align:center;flex:1;}
.ucard-stat-n{font-size:18px;font-weight:500;color:var(--t1);}
.ucard-stat-l{font-size:12px;color:var(--t5);margin-top:3px;}
/* Quote tooltip */
.quote-tooltip{position:fixed;background:var(--s2);border:0.5px solid var(--b2);border-radius:8px;padding:5px 12px;font-size:12px;color:var(--t2);cursor:pointer;z-index:9000;display:flex;align-items:center;gap:6px;box-shadow:0 4px 16px rgba(0,0,0,.6);user-select:none;}
.quote-tooltip:hover{background:var(--s3);color:var(--t1);}

/* Composer image upload button */
.comp-img-btn{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--t4);cursor:pointer;padding:4px 8px;border-radius:6px;border:0.5px solid var(--b2);background:var(--bg2);transition:color .15s,border-color .15s;}
.comp-img-btn:hover{color:var(--t2);border-color:var(--b3);}
.comp-img-btn.uploading{opacity:.5;pointer-events:none;}
.comp-img-btn input{display:none;}

/* Toasts */
.toast{padding:10px 16px;border-radius:10px;font-size:13px;font-weight:500;backdrop-filter:blur(8px);}
.toast.ok{background:rgba(52,211,153,.1);color:var(--green);border:0.5px solid rgba(52,211,153,.2);}
.toast.err{background:rgba(248,113,113,.1);color:var(--red);border:0.5px solid rgba(248,113,113,.2);}
`;
document.head.appendChild(S);

// ── URL Routing ───────────────────────────────────────────────────────────────
function urlToPage(pathname) {
  const p = pathname.replace(/\/$/, "") || "/";
  if (p === "/" || p === "")           return {page:"feed", props:{}};
  if (p === "/compose")                return {page:"compose", props:{}};
  if (p === "/search")                 return {page:"search", props:{}};
  if (p === "/notifications")          return {page:"notifications", props:{}};
  if (p === "/messages")               return {page:"messages", props:{}};
  if (p === "/verify-email")           return {page:"verify-email", props:{token: new URLSearchParams(window.location.search).get("token")}};
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
  const dmM      = p.match(/^\/messages\/(.+)$/);
  if (dmM)    return {page:"dm",     props:{threadId: dmM[1]}};
  // Extension SPA routes all live under /ext/* — this prefix is owned exclusively
  // by extensions so we can match it definitively against the live registry.
  // On hard refresh the bundle may not have loaded yet; return ext-route with
  // _match:null so ExtensionRoutePage's polling loop resolves it once loaded.
  if (p.startsWith("/ext/")) {
    const extRoute = window.NexusExtensions.matchRoute(p);
    if (extRoute) return {page:"ext-route", props:{ _match: extRoute, ...extRoute.params }};
    return {page:"ext-route", props:{ _match: null }};
  }
  // Non-extension routes — checked against registry for any edge cases
  const extRoute = window.NexusExtensions.matchRoute(p);
  if (extRoute) return {page:"ext-route", props:{ _match: extRoute, ...extRoute.params }};
  return {page:"feed", props:{}};
}

function pageToUrl(page, props={}) {
  if (page === "ext-route") {
    // props._match.pattern + props (params) → reconstruct the URL
    const match = props._match;
    if (match) return window.NexusExtensions.routeUrl(match.pattern, props);
    return "/";
  }
  switch(page) {
    case "feed":          return props.space ? `/space/${props.space}` : "/";
    case "post":          return props.id ? `/post/${props.id}` : "/";
    case "profile":       return props.username ? `/profile/${props.username}${props.tab ? `/${props.tab}` : ""}` : "/";
    case "compose":       return "/compose";
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
let _cssEl = null;

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
  try { const b = localStorage.getItem("nexus_branding"); return b ? JSON.parse(b) : {logo_url:null,site_name:null,favicon_url:null,hero_title:null,hero_body:null,hero_enabled:false}; }
  catch { return {logo_url:null,site_name:null,favicon_url:null,hero_title:null,hero_body:null,hero_enabled:false}; }
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
// Given a hex accent color, derive all CSS variable variants
function deriveAccentVars(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const rgb = hexToRgb(hex);
  const lum = luminance(rgb);
  // Text on solid accent background: white for dark colors, near-black for light
  const onAccent = lum > 0.35 ? "#0d0d14" : "#ffffff";
  // Tinted bg: accent at low opacity
  const [r,g,b] = rgb;
  const acBg = `rgba(${r},${g},${b},0.12)`;
  const acBorder = `rgba(${r},${g},${b},0.30)`;
  // ac-text: for text ON dark bg WITH accent color — if accent is very light, darken it slightly
  const acText = lum > 0.6
    ? `rgb(${Math.round(r*0.7)},${Math.round(g*0.7)},${Math.round(b*0.7)})`
    : lum > 0.35
    ? hex
    : `rgb(${Math.min(255,Math.round(r*1.3))},${Math.min(255,Math.round(g*1.3))},${Math.min(255,Math.round(b*1.3))})`;
  return {onAccent, acBg, acBorder, acText};
}

function deriveTintVars(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const [r,g,b] = hexToRgb(hex);
  const mix = (base, amt) => {
    const br=(base>>16)&255, bg=(base>>8)&255, bb=base&255;
    return `rgb(${Math.round(br+(r-br)*amt)},${Math.round(bg+(g-bg)*amt)},${Math.round(bb+(b-bb)*amt)})`;
  };
  return { bg:mix(0x0d0d14,0.10), s1:mix(0x13121e,0.10), s2:mix(0x18182a,0.10), s3:mix(0x1e1c2e,0.10) };
}

// ── Light-mode derive functions ──────────────────────────────────────────────
// Parallel to deriveAccentVars/deriveTintVars but tuned for light surfaces.

function deriveAccentVarsLight(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const rgb = hexToRgb(hex);
  const lum = luminance(rgb);
  const [r,g,b] = rgb;
  // Text on solid accent bg: same logic as dark (luminance-based)
  const onAccent = lum > 0.35 ? "#0d0d14" : "#ffffff";
  // Tinted bg at low opacity looks fine on white too
  const acBg = `rgba(${r},${g},${b},0.09)`;
  const acBorder = `rgba(${r},${g},${b},0.25)`;
  // acText must contrast against light surfaces — darken light accents
  const acText = lum > 0.5
    ? `rgb(${Math.round(r*0.55)},${Math.round(g*0.55)},${Math.round(b*0.55)})`
    : lum > 0.25
    ? hex
    : hex; // already dark enough
  return {onAccent, acBg, acBorder, acText};
}

function deriveTintVarsLight(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const [r,g,b] = hexToRgb(hex);
  // Mix toward light bases (inverted from dark)
  const mix = (base, amt) => {
    const br=(base>>16)&255, bg=(base>>8)&255, bb=base&255;
    return `rgb(${Math.round(br+(r-br)*amt)},${Math.round(bg+(g-bg)*amt)},${Math.round(bb+(b-bb)*amt)})`;
  };
  return {
    bg: mix(0xf5f4fb, 0.12),
    s1: mix(0xffffff, 0.08),
    s2: mix(0xedeaf9, 0.12),
    s3: mix(0xe3dff5, 0.12),
  };
}

// Light-mode CSS variable overrides (text, borders)
const LIGHT_VARS = {
  "--t1": "#1a1428",
  "--t2": "rgba(26,20,80,0.70)",
  "--t3": "rgba(26,20,80,0.50)",
  "--t4": "rgba(26,20,80,0.30)",
  "--t5": "rgba(26,20,80,0.18)",
  "--b1": "rgba(26,20,80,0.07)",
  "--b2": "rgba(26,20,80,0.10)",
  "--b3": "rgba(26,20,80,0.14)",
};
const DARK_VARS = {
  "--t1": "#f0eeff",
  "--t2": "rgba(255,255,255,0.65)",
  "--t3": "rgba(255,255,255,0.45)",
  "--t4": "rgba(255,255,255,0.25)",
  "--t5": "rgba(255,255,255,0.15)",
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
    // Text + border vars
    Object.entries(LIGHT_VARS).forEach(([k,v]) => r.style.setProperty(k,v));
    // Accent
    const ac = app.light_accent_color || "#7351db";
    r.style.setProperty("--ac", ac);
    const vars = deriveAccentVarsLight(ac);
    if (vars) {
      r.style.setProperty("--ac-on", vars.onAccent);
      r.style.setProperty("--ac-bg", vars.acBg);
      r.style.setProperty("--ac-border", vars.acBorder);
      r.style.setProperty("--ac-text", vars.acText);
    }
    // Surfaces
    if (app.light_tint_color) {
      const tint = deriveTintVarsLight(app.light_tint_color);
      if (tint) { r.style.setProperty("--bg",tint.bg); r.style.setProperty("--s1",tint.s1); r.style.setProperty("--s2",tint.s2); r.style.setProperty("--s3",tint.s3); }
    } else {
      r.style.setProperty("--bg","#f5f4fb"); r.style.setProperty("--s1","#ffffff"); r.style.setProperty("--s2","#edeaf9"); r.style.setProperty("--s3","#e3dff5");
    }
  } else {
    // Dark mode
    Object.entries(DARK_VARS).forEach(([k,v]) => r.style.setProperty(k,v));
    // Accent
    const ac = app.accent_color || "#a78bfa";
    r.style.setProperty("--ac", ac);
    const vars = deriveAccentVars(ac);
    if (vars) {
      r.style.setProperty("--ac-on", vars.onAccent);
      r.style.setProperty("--ac-bg", vars.acBg);
      r.style.setProperty("--ac-border", vars.acBorder);
      r.style.setProperty("--ac-text", vars.acText);
    }
    // Surfaces
    if (app.tint_color) {
      const tint = deriveTintVars(app.tint_color);
      if (tint) { r.style.setProperty("--bg",tint.bg); r.style.setProperty("--s1",tint.s1); r.style.setProperty("--s2",tint.s2); r.style.setProperty("--s3",tint.s3); }
    } else {
      r.style.setProperty("--bg","#0d0d14"); r.style.setProperty("--s1","#13121e"); r.style.setProperty("--s2","#18182a"); r.style.setProperty("--s3","#1e1c2e");
    }
  }

  // Cache the final computed CSS vars so the early-theme script can restore
  // them synchronously on the next page load — before React mounts.
  const varsToCache = [
    "--bg","--s1","--s2","--s3",
    "--t1","--t2","--t3","--t4","--t5",
    "--b1","--b2","--b3",
    "--ac","--ac-on","--ac-bg","--ac-border","--ac-text",
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

  // Avatar radius: 0=square, 50=circle. Default 22%
  r.style.setProperty("--av-radius", `${app.avatar_radius ?? 22}%`);
  if (app.fs_ui)      r.style.setProperty("--fs-ui",      `${app.fs_ui}px`);
  if (app.fs_body)    r.style.setProperty("--fs-body",    `${app.fs_body}px`);
  if (app.fs_title)   r.style.setProperty("--fs-title",   `${app.fs_title}px`);
  if (app.fs_content)    r.style.setProperty("--fs-content",    `${app.fs_content}px`);
  if (app.fs_feed_title) r.style.setProperty("--fs-feed-title", `${app.fs_feed_title}px`);
  if (app.fs_code)    r.style.setProperty("--fs-code",    `${app.fs_code}px`);
  if (gen.site_name) document.title = gen.site_name === "Nexus" ? "Nexus" : gen.site_name + " · Nexus";
  if (app.custom_css) {
    if (!_cssEl) { _cssEl = document.createElement("style"); document.head.appendChild(_cssEl); }
    _cssEl.textContent = sanitizeCSS(app.custom_css);
  }
  // Apply favicon
  if (gen.favicon_url) {
    let link = document.querySelector("link[rel~='icon']");
    if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
    link.href = gen.favicon_url;
  }
  const newBranding = {logo_url: gen.logo_url||null, site_name: gen.site_name||null, favicon_url: gen.favicon_url||null, hero_title: gen.hero_title||null, hero_body: gen.hero_body||null, hero_enabled: gen.hero_enabled||false};
  try { localStorage.setItem("nexus_branding", JSON.stringify(newBranding)); } catch {}
  // Cache non-color appearance settings so the early script can restore them
  try {
    localStorage.setItem("nexus_appearance_app", JSON.stringify({
      avatar_radius: app.avatar_radius ?? 22,
      fs_ui:      app.fs_ui      || null,
      fs_body:    app.fs_body    || null,
      fs_title:   app.fs_title   || null,
      fs_content:    app.fs_content    || null,
      fs_feed_title: app.fs_feed_title || null,
      fs_code:       app.fs_code       || null,
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
window._applyBranding    = applyBranding;
window._getBrandingState = () => _brandingState;
window._applyTheme       = applyTheme;
window._resolveTheme     = resolveTheme;
window._onBrandingChange = onBrandingChange;

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
          <div style={{width:40,height:40,borderRadius:"50%",background:"linear-gradient(135deg,#a78bfa,#ec4899)",margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,color:"#fff",fontWeight:500}}>N</div>
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

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({currentUser, spaces, page, pageProps, navigate, onLogout, notifCount=0, msgCount=0, modReportCount=0, onAuthRequired, layoutCfg={}, mobile=false}) {
  const [branding, setBranding] = useState({logo_url:null, site_name:null});
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
            ? savedExplore.map(function(s){return EXPLORE_ITEMS.find(function(d){return d.id===s.id;})||s;})
            : EXPLORE_ITEMS.slice();
          EXPLORE_ITEMS.forEach(function(d){if(!exploreItems.find(function(s){return s.id===d.id;}))exploreItems.push(d);});
          // Append extension-registered explore items (not yet in the saved list)
          window.NexusExtensions.getExploreItems().forEach(function(d){
            if(!exploreItems.find(function(s){return s.id===d.id;}))exploreItems.push(d);
          });

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
                // Extension-registered item — render generically using page/props
                if(item._ext) {
                  if(item.authOnly && !currentUser) return null;
                  const extActive = page===item.page && JSON.stringify(pageProps)===JSON.stringify(item.props);
                  return <div key={item.id} className={`sb-item ${extActive?"active":""}`}
                    onClick={()=>navigate(item.page, item.props)}>
                    <i className={`fa-solid ${item.icon}`}/>
                    <span className="sb-item-name">{item.label}</span>
                  </div>;
                }
                return null;
              })}
            </React.Fragment>;
            if(sec.id === "spaces") return <React.Fragment key="spaces">
              {divider}<div className="sb-label">Spaces</div>
              {orderedSpaces.map(function(s){
                const col=spaceColor(s);
                const active=page==="feed"&&pageProps?.space===s.slug;
                return <div key={s.id} className={`sb-item ${active?"active":""}`} onClick={()=>navigate("feed",{space:s.slug})}>
                  <i className={`fa-solid ${s.icon||"fa-layer-group"}`} style={{color:active?col:undefined}}/>
                  <span className="sb-item-name">{s.name}</span>
                  {s.post_count>0&&<span className="sb-item-count">{s.post_count}</span>}
                </div>;
              })}
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
function TopBar({currentUser, navigate, onLogout, notifCount=0, msgCount=0, onSearch, onAuthRequired, registrationOpen=true}) {
  const [q,setQ]=useState("");
  const [drop,setDrop]=useState(null); // {posts, replies} | null
  const [searching,setSearching]=useState(false);
  const searchRef=useRef();
  const debounceRef=useRef();

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
          <button className="write-btn" onClick={()=>navigate("compose")}>+ write</button>
          <AvatarMenu user={currentUser} navigate={navigate} onLogout={onLogout}/>
        </> : <>
          <button onClick={()=>onAuthRequired?.("login")} className="write-btn" style={{background:"transparent",border:"1.5px solid var(--b2)",color:"var(--t2)"}}>Log in</button>
          {registrationOpen&&<button onClick={()=>onAuthRequired?.("register")} className="write-btn">Sign up</button>}
        </>}
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

  const sorted = [...spaces].sort((a,b)=>(b.post_count||0)-(a.post_count||0));
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
              <div key={s.id} style={{padding:"5px 0"}}>
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:5}}>
                  <i className={`fa-solid ${s.icon||"fa-layer-group"}`} style={{fontSize:10,color:col,width:14,textAlign:"center",flexShrink:0}}/>
                  <span style={{fontSize:13,color:"var(--t3)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</span>
                  <span style={{fontSize:12,color:col,fontWeight:500,flexShrink:0}}>{s.post_count||0}</span>
                </div>
                <div className="p-bar-wrap"><div className="p-bar" style={{width:`${bw}%`,background:col}}/></div>
              </div>
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
              <div key={t.id} style={{padding:"5px 0"}}>
                <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:5}}>
                  <i className="fa-solid fa-tag" style={{fontSize:10,color:col,width:14,textAlign:"center",flexShrink:0}}/>
                  <span style={{fontSize:13,color:"var(--t3)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.name}</span>
                  <span style={{fontSize:12,color:col,fontWeight:500,flexShrink:0}}>{t.post_count||0}</span>
                </div>
                <div className="p-bar-wrap"><div className="p-bar" style={{width:`${bw}%`,background:col}}/></div>
              </div>
            );
          })}
        </div>
      );
    }
    if(w.id === "stats") {
      return (
        <div className="stat-grid" key="stats">
          <div className="stat-card"><div className="stat-n">{stats.threads}</div><div className="stat-l">threads</div></div>
          <div className="stat-card"><div className="stat-n" style={{color:"#34d399"}}>{stats.online}</div><div className="stat-l">online</div></div>
          <div className="stat-card"><div className="stat-n">{stats.members}</div><div className="stat-l">members</div></div>
          <div className="stat-card" style={{cursor:navigate?"pointer":undefined}} onClick={()=>navigate&&navigate("leaderboard")}>
            <div className="stat-n" style={{color:"#a78bfa"}}>{myRank ? `#${myRank.rank}` : "—"}</div>
            <div className="stat-l">your rank</div>
          </div>
        </div>
      );
    }
    return undefined;
  }

  // Resolve ordered, visible widget list for the current page
  function resolveWidgets(pageId) {
    var allExt = window.NexusExtensions.getRightWidgets();
    var candidates = [];
    RIGHT_WIDGETS.forEach(function(w) {
      if(w.pages === "global" || (Array.isArray(w.pages) && w.pages.indexOf(pageId) !== -1)) {
        candidates.push(Object.assign({}, w));
      }
    });
    allExt.forEach(function(w) {
      var wp = w.pages;
      if(!wp || wp === "global" || (Array.isArray(wp) && wp.indexOf(pageId) !== -1)) {
        candidates.push(Object.assign({}, w));
      }
    });
    var savedByPage = layoutCfg.right_widgets_by_page || {};
    var saved = savedByPage[pageId];
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

  // For ext-routes use the pattern as the page id so each route gets its own widget config
  var resolvedPage = (page === "ext-route" && pageProps?._match?.pattern)
    ? pageProps._match.pattern
    : page;

  // Enrich pageProps passed to widgets — search widget needs spaces/tags
  var enrichedPageProps = Object.assign({}, pageProps, {spaces: spaces, tags: tags});

  var widgets = resolveWidgets(resolvedPage);

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

// ── Extension route page ──────────────────────────────────────────────────────
// Generic wrapper rendered when the SPA lands on an extension-registered route.
// Extensions call:
//   window.NexusExtensions.registerRoute("/my-ext/users/:username", MyPage, { title: "My Page" });
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
        <button className="mob-icon-btn mob-only" onClick={()=>window.history.back()} style={{marginRight:8}}>
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
function useSocket(token, userId, onNewPost, onNewNotif, onNewMsg, onUnreadCount) {
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
  useEffect(() => { onNewPostRef.current = onNewPost; }, [onNewPost]);
  useEffect(() => { onNewNotifRef.current = onNewNotif; }, [onNewNotif]);
  useEffect(() => { onNewMsgRef.current = onNewMsg; }, [onNewMsg]);
  useEffect(() => { onUnreadCountRef.current = onUnreadCount; }, [onUnreadCount]);

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
        // Reconnect with exponential backoff: 3s → 6s → 12s → 24s → 60s max
        if (mountedRef.current && token && userId) {
          reconnectRef.current = setTimeout(connect, reconnectDelay.current);
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, 60000);
        }
      };
    };

    connectRef.current = connect;
    connect();

    return () => {
      mountedRef.current = false;
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
function AuthModalForm({mode, onLogin, onSwitch, registrationOpen=true, oauthProviders={}}) {
  const [form,setForm]=useState({login:"",email:"",username:"",password:""});
  const [showPw,setShowPw]=useState(false);
  const [remember,setRemember]=useState(true);
  const [err,setErr]=useState(null); const [loading,setLoading]=useState(false);
  const submit=async e=>{
    e.preventDefault(); setLoading(true); setErr(null);
    try {
      const body = mode==="login"
        ? {email: form.login.trim(), password: form.password, remember_me: remember}
        : {email: form.email.trim(), username: form.username.trim(), password: form.password};
      const d=await api.post(mode==="login"?"/auth/login":"/auth/register", body);
      if(d.access_token){api.setToken(d.access_token);onLogin(d.user);}
      else setErr(formatApiErrors(d));
    } finally { setLoading(false); }
  };

  const hasOAuth = oauthProviders.google || oauthProviders.github;
  const oauthBtnStyle = {
    width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:10,
    padding:"10px 16px", borderRadius:10, fontSize:14, fontWeight:500, cursor:"pointer",
    background:"var(--bg3)", border:"0.5px solid var(--b2)", color:"var(--t1)",
    marginBottom:10, textDecoration:"none"
  };

  return (
    <form onSubmit={submit}>
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
      {mode==="login"&&<label className="remember-row">
        <input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>
        <span>Remember me</span>
      </label>}
      {err&&<div className="ferr" style={{marginBottom:10,whiteSpace:"pre-line"}}>{err}</div>}
      <button className="btn-primary" style={{width:"100%",borderRadius:12,padding:"12px",marginBottom:18,fontSize:15}} disabled={loading}>{loading?"...":mode==="login"?"Sign in":"Create account"}</button>
      <div style={{textAlign:"center",fontSize:13,color:"var(--t4)"}}>
        {mode==="login"
          ?<>{registrationOpen&&<>No account? <span className="link" onClick={()=>{onSwitch("register");setErr(null);}}>Sign up</span></>}</>
          :<>Have an account? <span className="link" onClick={()=>{onSwitch("login");setErr(null);}}>Sign in</span></>}
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
        <button className="mob-icon-btn" onClick={onClose}><i className="fa-solid fa-xmark"/></button>
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
        <button className="mob-icon-btn" onClick={()=>{setQ("");setResults(null);onClose();}}><i className="fa-solid fa-xmark"/></button>
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
  const [notifCount,setNotifCount]=useState(0);
  const [msgCount,setMsgCount]=useState(0);
  const pollMsgRef = useRef(null);
  const [modReportCount,setModReportCount]=useState(0);
  const [layoutCfg,setLayoutCfg]=useState({});
  const [appBranding,setAppBranding]=useState({});
  const [mobLeftOpen,setMobLeftOpen]=useState(false);
  const [mobRightOpen,setMobRightOpen]=useState(false);
  const [mobUserOpen,setMobUserOpen]=useState(false);
  const [mobSearchOpen,setMobSearchOpen]=useState(false);
  const [msgPageKey,setMsgPageKey]=useState(0);
  const [livePosts,setLivePosts]=useState([]);
  const [liveEvents,setLiveEvents]=useState([]);
  const [authModal,setAuthModal]=useState(null); // null | "login" | "register"
  const [registrationOpen,setRegistrationOpen]=useState(true);
  const [iosPromptDismissed,setIosPromptDismissed]=useState(()=>{
    try { return localStorage.getItem("pwa.ios_prompt.dismissed")==="1"; } catch { return false; }
  });
  const [pwaCfgPublic,setPwaCfgPublic]=useState({});
  const [oauthProviders,setOauthProviders]=useState({google:false,github:false});

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
    window.history.pushState({page:p, props}, "", url);
    if(p==="messages") setMsgPageKey(k=>k+1);
    setPage(p);setPageProps(props);window.scrollTo(0,0);
    window._nexusNavigate = navigate;
  },[]);
  useEffect(()=>{ window._nexusNavigate = navigate; },[navigate]);

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
    api.token,
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
    useCallback(count=>setNotifCount(count),[])
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
        // Refresh failed and we have no token — session truly expired
        updateCurrentUser(null);
        window.dispatchEvent(new Event("nexus:logout"));
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(()=>{loadSpaces();api.get("/tags").then(d=>setTags(d.tags||[]));
    // Load registration setting publicly to show/hide signup buttons
    api.get("/branding").then(d=>{const s=d.settings||{};applyBranding(s.appearance||{},s.general||{});setRegistrationOpen((s.registration||{}).open!==false);setAppBranding({...s.appearance||{},...s.general||{}});setPwaCfgPublic(s.pwa||{});setOauthProviders(s.oauth_providers||{google:false,github:false});window._postCfg=s.posting||{};
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
    }).catch(()=>{});
  },[]);

  useEffect(()=>{
    if(!currentUser) return;
  },[currentUser]);

  useEffect(()=>{
    if(!currentUser) return;
    const pollNotif = () => api.get("/notifications/unread").then(d=>setNotifCount(d.count||0)).catch(()=>{});
    const pollMsg   = () => api.get("/threads/unread").then(d=>setMsgCount(d.unread||0)).catch(()=>{});
    const pollMod = () => {
      if(currentUser?.role==="admin"||currentUser?.role==="moderator")
        api.get("/reports?status=pending").then(d=>setModReportCount((d.reports||[]).length)).catch(()=>{});
    };
    pollMsgRef.current = pollMsg;
    pollNotif(); pollMsg(); pollMod();
    const interval = setInterval(()=>{ pollNotif(); pollMsg(); pollMod(); }, 60000);
    return () => clearInterval(interval);
  },[currentUser]);

  // Update document.title with unread notification count
  useEffect(()=>{
    const siteName = appBranding?.site_name || "Nexus";
    const base = siteName === "Nexus" ? "Nexus" : siteName + " · Nexus";
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

  if(!authChecked) return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)"}}>Loading…</div>;

  // Admin gets its own full shell
  if(page==="verify-email") return <><div className="app-root" style={{flex:1,display:"flex",flexDirection:"column"}}><VerifyEmailPage token={pageProps?.token} navigate={navigate} onVerified={()=>updateCurrentUser(u=>u?{...u,email_verified:true}:u)}/></div><Toasts/></>;

  if(page==="admin"&&currentUser) return <><div className="app-root"><AdminPage currentUser={currentUser} navigate={navigate} onSpacesUpdated={loadSpaces} layoutCfg={layoutCfg} setLayoutCfg={setLayoutCfg}/></div><Toasts/></>;

  const renderPage=()=>{
    const requireAuth = (el) => {
      if(!currentUser) return <GuestPrompt onAuthRequired={m=>setAuthModal(m)} registrationOpen={registrationOpen}/>;
      return el;
    };
    switch(page) {
      case "feed":
        return <FeedPage spaces={spaces} tags={tags} currentUser={currentUser} navigate={navigate} notifCount={notifCount} msgCount={msgCount} onLogout={logout} spaceFilter={pageProps?.space||null} sortOverride={pageProps?.sort||null} livePosts={livePosts} liveEvents={liveEvents} onAuthRequired={m=>setAuthModal(m)}/>;
      case "following":   return requireAuth(<FeedPage spaces={spaces} tags={tags} currentUser={currentUser} navigate={navigate} notifCount={notifCount} msgCount={msgCount} onLogout={logout} followingOnly={true}/>);
      case "saved":       return requireAuth(<SavedPage navigate={navigate} currentUser={currentUser}/>);
      case "drafts":      return requireAuth(<DraftsPage currentUser={currentUser} navigate={navigate}/>);
      case "settings":    return requireAuth(<SettingsPage currentUser={currentUser} onUpdate={u=>updateCurrentUser(u)} navigate={navigate}/>);
      case "compose":     return requireAuth(<ComposePage spaces={spaces} tags={tags} navigate={navigate} currentUser={currentUser} pageProps={pageProps}/>);
      case "notifications": return requireAuth(<NotificationsPage navigate={navigate} onCountChange={setNotifCount}/>);
      case "messages":    return requireAuth(<DMInboxPage key={msgPageKey} currentUser={currentUser} navigate={navigate}/>);
      case "dm":          return requireAuth(<DMPage threadId={pageProps.threadId} threadName={pageProps.threadName} threadImage={pageProps.threadImage} currentUser={currentUser} navigate={navigate} joinTopic={joinTopic} leaveTopic={leaveTopic} sendEvent={sendEvent} onRead={()=>pollMsgRef.current?.()}/>);
      case "dm-new":      return requireAuth(<DMNewPage navigate={navigate} currentUser={currentUser}/>);
      case "members":     return <MembersPage navigate={navigate} currentUser={currentUser}/>;
      case "tags":        return <TagsPage navigate={navigate} currentUser={currentUser}/>;
      case "badges":      return <BadgesPage currentUser={currentUser} navigate={navigate}/>;
      case "leaderboard": return <LeaderboardPage currentUser={currentUser} navigate={navigate}/>;
      case "post":        return <PostPage postId={pageProps.id} currentUser={currentUser} navigate={navigate} spaces={spaces} onAuthRequired={m=>setAuthModal(m)} joinTopic={joinTopic} leaveTopic={leaveTopic} sendEvent={sendEvent} openReport={pageProps.openReport} scrollToReply={pageProps.scrollToReply} resumeDraft={pageProps.resumeDraft||null}/>;
      case "search":      return <SearchPage navigate={navigate} tags={tags} spaces={spaces} initialQ={pageProps?.q||""}/>;
      case "profile":     return <ProfilePage username={pageProps.username||currentUser?.username} currentUser={currentUser} navigate={navigate} initialTab={pageProps.tab||null}/>;
      case "ext-route":   return <ExtensionRoutePage {...pageProps} currentUser={currentUser} navigate={navigate}/>;
      case "moderation":    return requireAuth(<ModerationPage currentUser={currentUser} navigate={navigate}/>);
      default:            return <FeedPage spaces={spaces} tags={tags} currentUser={currentUser} navigate={navigate} notifCount={notifCount} msgCount={msgCount} onLogout={logout} livePosts={livePosts} liveEvents={liveEvents}/>;
    }
  };

  return (
    <>
      <div className="app-root">
        {/* Mobile overlays */}
        <div className={`mob-overlay ${mobLeftOpen?"open":""}`}>
          <div className="mob-overlay-head">
            <span className="mob-overlay-title">Menu</span>
            <button className="mob-icon-btn" onClick={()=>setMobLeftOpen(false)}><i className="fa-solid fa-xmark"/></button>
          </div>
          <div className="mob-overlay-body">
            <Sidebar currentUser={currentUser} spaces={spaces} page={page} pageProps={pageProps} navigate={(p,props)=>{setMobLeftOpen(false);navigate(p,props);}} onLogout={logout} notifCount={notifCount} msgCount={msgCount} modReportCount={modReportCount} onAuthRequired={m=>setAuthModal(m)} layoutCfg={layoutCfg} mobile={true}/>
          </div>
        </div>
        <div className={`mob-overlay right ${mobRightOpen?"open":""}`}>
          <div className="mob-overlay-head">
            <span className="mob-overlay-title">Activity</span>
            <button className="mob-icon-btn" onClick={()=>setMobRightOpen(false)}><i className="fa-solid fa-xmark"/></button>
          </div>
          <div className="mob-overlay-body">
            <RightPanel spaces={spaces} tags={tags} liveEvents={liveEvents} layoutCfg={layoutCfg} mobile={true} currentUser={currentUser} navigate={navigate} page={page} pageProps={pageProps}/>
          </div>
        </div>
        <MobileUserMenu user={currentUser} navigate={navigate} onLogout={logout} open={mobUserOpen} onClose={()=>setMobUserOpen(false)}/>
        <MobileSearchOverlay open={mobSearchOpen} onClose={()=>setMobSearchOpen(false)} navigate={navigate}/>
        <MobileTopBar onHamburger={()=>setMobLeftOpen(true)} onRight={()=>setMobRightOpen(true)} branding={appBranding} onNavigateHome={()=>navigate("feed",{})}/>
        <MobileTabBar currentUser={currentUser} navigate={navigate} page={page} notifCount={notifCount} msgCount={msgCount} onCompose={()=>navigate("compose")} onSearch={()=>setMobSearchOpen(true)} onProfile={()=>setMobUserOpen(true)} onAuthRequired={m=>setAuthModal(m)} registrationOpen={registrationOpen}/>
      <div className="app-shell">
        <Sidebar currentUser={currentUser} spaces={spaces} page={page} pageProps={pageProps} navigate={navigate} onLogout={logout} notifCount={notifCount} msgCount={msgCount} modReportCount={modReportCount} onAuthRequired={m=>setAuthModal(m)} layoutCfg={layoutCfg}/>
        <div className="main-area">
          <TopBar currentUser={currentUser} navigate={navigate} onLogout={logout} notifCount={notifCount} msgCount={msgCount} modReportCount={modReportCount} onSearch={q=>navigate("search",{q})} onAuthRequired={m=>setAuthModal(m)} registrationOpen={registrationOpen}/>
          <div className="page-area" style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            {renderPage()}
          </div>
        </div>
        <RightPanel spaces={spaces} tags={tags} liveEvents={liveEvents} layoutCfg={layoutCfg} currentUser={currentUser} navigate={navigate} page={page} pageProps={pageProps}/>
      </div>
      </div>
      {/* Lightbox handled by Fancybox 5 */}
      {userCard&&<UserCardPopover card={userCard} setCard={setUserCard} currentUser={currentUser} navigate={navigate}/>}
      <RefPreviewPopup/>
      {authModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,padding:20}} onClick={e=>e.target===e.currentTarget&&setAuthModal(null)}>
          <div style={{width:"100%",maxWidth:440,background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:20,padding:40,position:"relative"}}>
            <button onClick={()=>setAuthModal(null)} style={{position:"absolute",top:16,right:18,background:"none",border:"none",color:"var(--t4)",fontSize:20,cursor:"pointer",lineHeight:1}}>✕</button>
            <div style={{textAlign:"center",marginBottom:28}}>
              <div style={{margin:"0 auto 14px",display:"flex",alignItems:"center",justifyContent:"center"}}>
                {appBranding?.logo_url
                  ? <img src={appBranding.logo_url} style={{maxHeight:48,maxWidth:160,objectFit:"contain"}} alt={appBranding.site_name||"logo"}/>
                  : appBranding?.favicon_url
                    ? <img src={appBranding.favicon_url} style={{width:48,height:48,objectFit:"contain",borderRadius:12}} alt={appBranding.site_name||"logo"}/>
                    : <div style={{width:48,height:48,borderRadius:"50%",background:"linear-gradient(135deg,#a78bfa,#ec4899)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:"#fff",fontWeight:500}}>
                        {(appBranding?.site_name||"N").slice(0,1).toUpperCase()}
                      </div>
                }
              </div>
              <div style={{fontSize:22,fontWeight:600,color:"var(--t1)"}}>{authModal==="login"?"Welcome back":"Create account"}</div>
              <div style={{fontSize:14,color:"var(--t4)",marginTop:6}}>{authModal==="login"?"Sign in to continue":"Join the community"}</div>
            </div>
            <AuthModalForm mode={authModal} onLogin={u=>{updateCurrentUser(u);setAuthModal(null);}} onSwitch={m=>setAuthModal(m)} registrationOpen={registrationOpen} oauthProviders={oauthProviders}/>
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
      <Toasts/>
    </>
  );
}

const root = document.getElementById("root");
if (root) ReactDOM.createRoot(root).render(<App/>);
