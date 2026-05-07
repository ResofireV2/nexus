import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom/client";
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ breaks: true, gfm: true });
// Allow <a> tags wrapping images (needed for lightbox original URL)
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.querySelector("img")) {
    node.setAttribute("data-lightbox-link", "true");
  }
  if (node.tagName === "IMG") {
    const parent = node.parentElement;
    if (parent && parent.tagName === "A") {
      node.setAttribute("data-original", parent.getAttribute("href") || "");
    }
  }
});

// Custom marked renderer — media embeds + lightbox image links
const mdRenderer = new marked.Renderer();

// ── Media embed helpers ───────────────────────────────────────────────────────
function getYouTubeId(url) {
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}
function getVimeoId(url) {
  const m = url.match(/vimeo\.com\/(?:video\/)?([0-9]+)/);
  return m ? m[1] : null;
}
function isVideoUrl(url) {
  return /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url);
}
function isAudioUrl(url) {
  return /\.(mp3|ogg|wav|flac|m4a)(\?.*)?$/i.test(url);
}

// Extract raw URL from either a plain URL or a GFM auto-linked <a href="url">url</a>
function extractBareUrl(text) {
  const stripped = text.trim();
  // Plain bare URL
  if (/^https?:\/\/[^\s<>"]+$/.test(stripped)) return stripped;
  // GFM auto-linked: <a href="URL">URL</a> — extract href
  const m = stripped.match(/^<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>.*<\/a>$/);
  if (m) return m[1];
  return null;
}

// Paragraph override — detect bare media URLs and render embeds
mdRenderer.paragraph = function(text) {
  const url = extractBareUrl(text);
  if (url) {
    const ytId = getYouTubeId(url);
    if (ytId) return `<div class="yt-lite" data-id="${ytId}">
      <img class="yt-thumb" src="https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg" alt="YouTube video" loading="lazy" onerror="this.src='https://i.ytimg.com/vi/${ytId}/hqdefault.jpg'"/>
      <div class="yt-play"><svg viewBox="0 0 68 48" width="68" height="48"><path d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55c-2.93.78-4.63 3.26-5.42 6.19C.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z" fill="#f00"/><path d="M45 24 27 14v20" fill="#fff"/></svg></div>
    </div>`;
    const vmId = getVimeoId(url);
    if (vmId) return `<div class="md-embed"><iframe src="https://player.vimeo.com/video/${vmId}" allowfullscreen loading="lazy" frameborder="0"></iframe></div>`;
    if (isVideoUrl(url)) return `<div class="md-embed-video"><video controls preload="metadata" style="max-width:100%;border-radius:10px;"><source src="${url}"/></video></div>`;
    if (isAudioUrl(url)) return `<audio controls preload="metadata" style="width:100%;margin:8px 0;"><source src="${url}"/></audio>`;
  }
  return `<p>${text}</p>`;
};

// Link override — lightbox for image links, external for regular links
mdRenderer.link = function(href, title, text) {
  if (text && text.includes('<img ')) {
    return text.replace('<img ', `<img data-original="${href}" `);
  }
  return `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
};

marked.use({ renderer: mdRenderer });

// @mention tokenizer — turns @username into a styled link
marked.use({
  extensions: [{
    name: "mention",
    level: "inline",
    start(src) { return src.indexOf("@"); },
    tokenizer(src) {
      const m = src.match(/^@([a-zA-Z0-9_]+)/);
      if (m) return { type: "mention", raw: m[0], username: m[1] };
    },
    renderer(token) {
      return `<a class="mention-link" href="/profile/${token.username}" data-mention="${token.username}">@${token.username}</a>`;
    }
  }]
});

function renderMd(t) {
  if(!t) return "";
  t = t.replace(/\|\|(.+?)\|\|/g, function(m, inner) {
    return '<span class="spoiler" onclick="this.classList.toggle(\'revealed\')">' + inner + '</span>';
  });
  return DOMPurify.sanitize(marked.parse(t), {
    ADD_TAGS: ["iframe","video","source","audio","svg","path","span"],
    ADD_ATTR: ["data-original","data-lightbox-link","data-id","allowfullscreen","loading","frameborder","src","controls","preload","viewBox","d","fill","width","height","class","onclick"]
  });
}
function Md({ text }) { return <div dangerouslySetInnerHTML={{__html: renderMd(text)}} className="md-body" />; }

// ── Lightbox ──────────────────────────────────────────────────────────────────
function Lightbox({src, originalSrc, onClose}) {
  useEffect(()=>{
    const fn=e=>{ if(e.key==="Escape") onClose(); };
    document.addEventListener("keydown",fn);
    return ()=>document.removeEventListener("keydown",fn);
  },[]);
  return (
    <div className="lb-overlay" onMouseDown={e=>{if(e.button===0)onClose();}}>
      <span className="lb-close" onMouseDown={e=>{e.stopPropagation();onClose();}}>×</span>
      <img src={originalSrc||src} alt=""/>
      {originalSrc&&originalSrc!==src&&
        <a className="lb-orig" href={originalSrc} target="_blank" rel="noopener" onMouseDown={e=>e.stopPropagation()}>
          <i className="fa-solid fa-arrow-up-right-from-square" style={{marginRight:4}}></i>open original
        </a>}
    </div>
  );
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
let _lbSetState = null;
function useLightbox() {
  const [lb, setLb] = useState(null);
  useEffect(()=>{ _lbSetState = setLb; return ()=>{ _lbSetState=null; }; }, []);
  return [lb, setLb];
}
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
  e.preventDefault();
  e.stopPropagation();
  const originalSrc = img.getAttribute("data-original") || img.src;
  if (_lbSetState) _lbSetState({ src: img.src, originalSrc });
});

// ── API ──────────────────────────────────────────────────────────────────────
const api = {
  token: localStorage.getItem("nexus_token"),
  refreshing: false,
  setToken(t) { this.token = t; t ? localStorage.setItem("nexus_token", t) : localStorage.removeItem("nexus_token"); },
  async request(method, path, body, retry=true, silentAuth=false) {
    const h = {"Content-Type":"application/json"};
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    try {
      const res = await fetch(`/api/v1${path}`, {method, headers:h, body: body ? JSON.stringify(body) : undefined, credentials:"include"});
      if (res.status === 401 && retry && path !== "/auth/refresh" && path !== "/auth/login") {
        const refreshed = await this.tryRefresh();
        if (refreshed) return this.request(method, path, body, false, silentAuth);
        this.setToken(null);
        localStorage.removeItem("nexus_user");
        // Only force logout if this isn't the silent initial auth check
        if (!silentAuth) window.dispatchEvent(new Event("nexus:logout"));
        return {};
      }
      // Guard against non-JSON responses (e.g. 502 Bad Gateway returns HTML)
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) return {};
      return res.json();
    } catch {
      return {};
    }
  },
  async tryRefresh() {
    if (this.refreshing) return false;
    this.refreshing = true;
    try {
      const res = await fetch("/api/v1/auth/refresh", {method:"POST", headers:{"Content-Type":"application/json"}, credentials:"include"});
      if (res.ok) {
        const d = await res.json();
        if (d.access_token) { this.setToken(d.access_token); return true; }
      }
      return false;
    } catch { return false; }
    finally { this.refreshing = false; }
  },
  get: p => api.request("GET", p),
  post: (p,b) => api.request("POST", p, b),
  patch: (p,b) => api.request("PATCH", p, b),
  delete: (p,b) => api.request("DELETE", p, b),
};

// ── Global CSS ───────────────────────────────────────────────────────────────
const S = document.createElement("style");
S.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');
@import url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{
  --bg:#0d0d14;
  --s1:#13121e;
  --av-radius:22%;
  --s2:#18182a;
  --s3:#1e1c2e;
  --b1:rgba(255,255,255,0.07);
  --b2:rgba(255,255,255,0.10);
  --b3:rgba(255,255,255,0.14);
  --t1:#f0eeff;
  --t2:rgba(255,255,255,0.65);
  --t3:rgba(255,255,255,0.45);
  --t4:rgba(255,255,255,0.25);
  --t5:rgba(255,255,255,0.15);
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
html,body{background:var(--bg);color:var(--t1);font-family:'Inter',system-ui,sans-serif;font-size:13px;line-height:1.5;min-height:100vh;}
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
.sb-label{font-size:11px;font-weight:500;color:var(--t5);letter-spacing:.8px;text-transform:uppercase;padding:0 16px;margin-bottom:4px;margin-top:14px;}
.sb-label:first-child{margin-top:2px;}
.sb-item{display:flex;align-items:center;gap:12px;padding:10px 18px;cursor:pointer;position:relative;transition:background .1s;}
.sb-item:hover{background:rgba(255,255,255,0.04);}
.sb-item.active{background:var(--ac-bg);}
.sb-item.active::before{content:'';position:absolute;left:0;top:4px;bottom:4px;width:2.5px;background:var(--ac);border-radius:0 2px 2px 0;}
.sb-item i{width:18px;text-align:center;font-size:15px;flex-shrink:0;color:var(--t3);}
.sb-item.active i{color:var(--ac);}
.sb-item-name{font-size:15px;color:var(--t3);flex:1;}
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
.logo-text em{font-style:normal;color:var(--ac);}
.tb-search{flex:1;max-width:400px;background:rgba(255,255,255,0.05);border:0.5px solid rgba(255,255,255,0.09);border-radius:24px;padding:10px 18px;font-size:14px;color:var(--t4);display:flex;align-items:center;gap:10px;cursor:text;}
.tb-search input{background:transparent;border:none;outline:none;font-size:14px;color:var(--t2);font-family:inherit;flex:1;}
.tb-search input::placeholder{color:var(--t4);}
.tb-search-drop{position:absolute;top:calc(100% + 8px);left:0;right:0;background:var(--s2);border:0.5px solid var(--b2);border-radius:14px;overflow:hidden;z-index:500;box-shadow:0 8px 32px rgba(0,0,0,.5);}
.tb-search-item{display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;transition:background .1s;}
.tb-search-item:hover{background:rgba(255,255,255,0.05);}
.tb-search-section{font-size:10px;font-weight:500;color:var(--t5);text-transform:uppercase;letter-spacing:.07em;padding:8px 14px 4px;}
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
.av-circle{width:38px;height:38px;border-radius:var(--av-radius);background:linear-gradient(135deg,#a78bfa,#ec4899);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:500;color:#fff;cursor:pointer;border:2px solid transparent;transition:border-color .15s;flex-shrink:0;overflow:hidden;}
.av-circle:hover{border-color:rgba(167,139,250,.5);}
.av-circle.open{border-color:var(--ac);}
.av-dd{position:absolute;top:calc(100% + 10px);right:0;width:200px;background:var(--s2);border:0.5px solid var(--b3);border-radius:14px;padding:6px;z-index:200;opacity:0;pointer-events:none;transform:translateY(-6px);transition:opacity .18s ease,transform .18s ease;}
.av-dd.open{opacity:1;pointer-events:all;transform:translateY(0);}
.av-dd-hdr{padding:10px 12px 8px;border-bottom:0.5px solid var(--b1);margin-bottom:4px;}
.av-dd-name{font-size:13px;font-weight:500;color:var(--t1);margin-bottom:2px;}
.av-dd-handle{font-size:11px;color:var(--t4);}
.av-dd-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;cursor:pointer;font-size:13px;color:var(--t3);transition:background .1s,color .1s;}
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
.feed-title{font-size:13px;font-weight:500;color:var(--t2);}
.sort-pills{display:flex;gap:4px;}
.sort-pill{font-size:11px;color:var(--t4);padding:4px 11px;border-radius:20px;border:0.5px solid rgba(255,255,255,0.08);cursor:pointer;transition:all .1s;}
.sort-pill.active{color:var(--ac);border-color:var(--ac-border);background:var(--ac-bg);}
.sort-pill:hover:not(.active){color:var(--t2);border-color:var(--b2);}
.feed-list{flex:1;overflow-y:auto;}

/* Thread rows */
.thread{border-bottom:0.5px solid rgba(255,255,255,0.05);cursor:pointer;display:flex;flex-direction:column;transition:background .1s;}
.thread:hover{background:rgba(255,255,255,0.02);}
.thread-main{display:flex;align-items:center;}
.thread-accent{width:3px;align-self:stretch;flex-shrink:0;border-radius:0 2px 2px 0;}
.thread-av{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:500;flex-shrink:0;margin:0 14px 0 18px;}
.thread-body{flex:1;min-width:0;padding:12px 0 8px;}
.thread-top{display:flex;align-items:center;gap:8px;margin-bottom:3px;}
.thread-title{font-size:14px;font-weight:500;color:#e8e4ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;}
.thread-tag{font-size:9px;font-weight:500;padding:2px 7px;border-radius:20px;flex-shrink:0;text-transform:uppercase;letter-spacing:.4px;}
.thread-preview{font-size:12px;color:var(--t4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:8px;}
.av-stack{display:flex;}
.pav{width:20px;height:20px;border-radius:50%;border:1.5px solid var(--bg);display:flex;align-items:center;justify-content:center;font-size:7px;font-weight:500;color:#fff;margin-right:-6px;flex-shrink:0;}
.pav-more{background:rgba(255,255,255,0.08);color:var(--t4);font-size:8px;}
.part-label{font-size:10px;color:var(--t5);margin-left:14px;}
.participants-row{display:flex;align-items:center;padding:0 0 11px;}
.thread-meta{display:flex;align-items:center;padding:12px 14px 12px 0;flex-shrink:0;}
.meta-block{display:flex;flex-direction:column;align-items:center;gap:1px;width:48px;}
.meta-n{font-size:13px;font-weight:500;color:var(--t3);}
.meta-l{font-size:10px;color:var(--t5);}
.meta-div{width:0.5px;height:26px;background:rgba(255,255,255,0.06);}
.thread-last{display:flex;flex-direction:column;align-items:center;gap:2px;width:52px;}
.last-av{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:500;color:#fff;}
.last-ago{font-size:10px;color:var(--t5);}

/* Right panel */
.right-panel{width:320px;min-width:320px;border-left:0.5px solid var(--b1);padding:16px 14px;display:flex;flex-direction:column;gap:16px;overflow-y:auto;flex-shrink:0;}
.rw{border-radius:12px;border:0.5px solid rgba(255,255,255,0.08);padding:15px 16px;}
.rw-label{font-size:11px;font-weight:500;color:var(--t5);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px;}
.live-row{display:flex;align-items:flex-start;gap:8px;padding:5px 0;}
.l-av{width:22px;height:22px;border-radius:var(--av-radius);display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:500;color:#fff;flex-shrink:0;margin-top:1px;}
.l-txt{font-size:13px;color:var(--t3);line-height:1.5;flex:1;}
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
.stat-l{font-size:12px;color:var(--t4);margin-top:3px;}

/* Post view */
.post-shell{flex:1;display:flex;overflow:hidden;}
@media(max-width:767.99px){
.desk-scrubber{display:none!important;}
.thread-top{flex-wrap:wrap;}
.thread-title{width:100%;flex-shrink:0;}
.thread-tag{margin-top:2px;}
.thread-body{min-width:0;}
.thread-meta{flex-direction:column;align-items:flex-end;gap:4px;}
.meta-div{display:none;}
.thread-last{margin-top:0;}
}
.post-content-wrap{flex:1;overflow-y:auto;padding:24px 28px;}
.post-back{font-size:12px;color:var(--t4);cursor:pointer;display:flex;align-items:center;gap:6px;margin-bottom:18px;transition:color .1s;}
.post-back:hover{color:var(--t2);}
.post-title{font-size:20px;font-weight:600;color:var(--t1);letter-spacing:-.3px;line-height:1.35;margin-bottom:12px;}
.post-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px;}
.post-body{font-size:14px;color:var(--t3);line-height:1.75;padding-bottom:18px;border-bottom:0.5px solid var(--b1);}
.reaction-row{display:flex;align-items:center;gap:8px;padding:10px 0;flex-wrap:wrap;}
/* React button */
.rx-trigger{display:inline-flex;align-items:center;gap:6px;font-size:13px;padding:5px 10px;border:0.5px solid transparent;border-radius:20px;cursor:pointer;background:transparent;color:var(--t4);transition:all .15s;user-select:none;position:relative;}
.rx-trigger:hover{border-color:var(--b2);color:var(--t2);background:rgba(255,255,255,0.06);}
.rx-trigger.reacted{background:var(--ac-bg);color:var(--ac-text);border-color:var(--ac-border);}
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
.replies-count{font-size:12px;color:var(--t3);}
.reply-item{padding:14px 0;border-bottom:0.5px solid rgba(255,255,255,0.04);display:flex;gap:12px;}
.reply-av{width:40px;height:40px;border-radius:var(--av-radius);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:500;color:#fff;flex-shrink:0;margin-top:1px;}
.reply-body-wrap{flex:1;}
.reply-meta{display:flex;align-items:center;gap:8px;margin-bottom:6px;width:100%;}
.reply-quote-btn{font-size:11px;color:var(--t5);cursor:pointer;margin-left:auto;opacity:0;transition:opacity .15s;padding:2px 6px;border-radius:4px;flex-shrink:0;}
.reply-item:hover .reply-quote-btn{opacity:1;}
.reply-item:hover .reply-menu-btn{opacity:1!important;border-color:var(--b1)!important;}
.reply-quote-btn:hover{color:var(--ac-text);}
.reply-author{font-size:13px;font-weight:500;color:var(--t2);}
.reply-time{font-size:11px;color:var(--t5);}
.reply-text{font-size:13px;color:var(--t3);line-height:1.65;}

/* Composer */
.composer-shell{flex:1;padding:0;display:flex;flex-direction:column;overflow:hidden;}
.composer-inner{width:100%;padding:32px 48px 0;box-sizing:border-box;display:flex;flex-direction:column;flex:1;overflow:hidden;}
.comp-title-input{width:100%;background:transparent;border:none;outline:none;font-size:22px;font-weight:600;color:var(--t1);font-family:inherit;letter-spacing:-.3px;margin-bottom:8px;}
.comp-title-input::placeholder{color:rgba(255,255,255,0.15);}
.comp-meta-row{display:flex;align-items:center;gap:8px;padding:10px 0 16px;border-bottom:0.5px solid var(--b1);flex-wrap:wrap;margin-bottom:20px;}
.comp-sel{font-size:12px;padding:4px 12px;border-radius:20px;border:0.5px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:var(--t3);cursor:pointer;font-family:inherit;outline:none;}
.comp-tag-pill{font-size:11px;padding:3px 10px;border-radius:20px;background:var(--ac-bg);color:var(--ac-text);border:0.5px solid var(--ac-border);cursor:pointer;}
.comp-tag-add{font-size:12px;padding:4px 12px;border-radius:20px;border:0.5px solid rgba(255,255,255,0.08);background:transparent;color:var(--t4);cursor:pointer;}
.comp-body-area{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;}
.comp-ta{width:100%;height:100%;background:transparent;border:none;outline:none;font-size:15px;color:var(--t3);line-height:1.75;font-family:inherit;resize:none;min-height:240px;caret-color:var(--ac);padding:0 16px;box-sizing:border-box;}
.comp-ta::placeholder{color:rgba(255,255,255,0.12);}
.comp-footer{display:flex;align-items:center;gap:10px;padding:16px 0 24px;border-top:0.5px solid var(--b1);margin-top:16px;flex-shrink:0;}
.comp-char{font-size:11px;color:var(--t5);}

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
.mob-tab{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:52px;height:44px;cursor:pointer;position:relative;border:none;background:none;color:var(--t4);}
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
.comp-tb-btn{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;padding:0 6px;border-radius:6px;cursor:pointer;border:none;background:transparent;color:var(--t4);font-family:inherit;font-size:13px;transition:all .1s;}
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
.admin-stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:28px;}
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
.fgt{font-size:13px;color:var(--t3);letter-spacing:.05em;text-transform:uppercase;margin-bottom:16px;padding-bottom:8px;border-bottom:0.5px solid var(--b1);}
.f-label{font-size:14px;color:var(--t3);margin-bottom:7px;display:block;}
.f-hint{font-size:12px;color:var(--t5);margin-top:4px;}
.toggle-row{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:0.5px solid rgba(255,255,255,0.04);}
.toggle-row:last-child{border-bottom:none;}
.tgl{width:46px;height:26px;border-radius:20px;position:relative;cursor:pointer;transition:background .2s;}
.tgl-knob{position:absolute;top:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .2s;}
.atbl{width:100%;border-collapse:collapse;}
.atbl th{text-align:left;font-size:12px;color:var(--t5);padding:10px 14px;letter-spacing:.05em;text-transform:uppercase;border-bottom:0.5px solid var(--b1);}
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
.thr-name{font-size:13px;font-weight:500;color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.thr-preview{font-size:12px;color:var(--t5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.thr-unread{min-width:18px;height:18px;border-radius:20px;background:var(--ac);color:#fff;font-size:10px;font-weight:600;display:flex;align-items:center;justify-content:center;padding:0 5px;flex-shrink:0;}
.bubble{max-width:100%;padding:9px 13px;font-size:13px;line-height:1.5;border-radius:18px;word-break:break-word;}
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
.profile-av-ring{width:80px;height:80px;border-radius:var(--av-radius);border:3px solid var(--bg);display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:#fff;flex-shrink:0;background:linear-gradient(135deg,#a78bfa,#ec4899);}
.profile-name{font-size:18px;font-weight:600;color:var(--t1);letter-spacing:-.3px;}
.profile-handle{font-size:13px;color:var(--t5);margin-bottom:10px;}
.profile-bio{font-size:13px;color:var(--t3);line-height:1.6;margin-bottom:14px;}
.profile-stats{display:flex;gap:24px;padding-top:14px;border-top:0.5px solid var(--b1);}
.p-stat{text-align:center;}
.p-stat-n{font-size:18px;font-weight:600;color:var(--t2);letter-spacing:-.5px;}
.p-stat-l{font-size:11px;color:var(--t5);margin-top:2px;}
.profile-tabs{display:flex;border-bottom:0.5px solid var(--b1);padding:0 28px;}
.p-tab{font-size:13px;color:var(--t4);padding:12px 0;margin-right:24px;cursor:pointer;border-bottom:1.5px solid transparent;}
.p-tab.active{color:var(--t1);border-bottom-color:var(--ac);}

/* Search */
.search-wrap{flex:1;overflow-y:auto;padding:24px 28px;}
.search-bar{display:flex;gap:10px;margin-bottom:20px;}

/* Markdown */
.md-body{font-size:14px;color:var(--t3);line-height:1.75;}
.md-body p{margin-bottom:10px;}
.md-body h1,.md-body h2,.md-body h3{color:var(--t1);font-weight:600;margin:16px 0 8px;letter-spacing:-.2px;}
.md-body code{font-family:'SF Mono','Fira Code',monospace;font-size:12px;background:rgba(255,255,255,0.07);color:var(--ac-text);padding:2px 6px;border-radius:5px;}
.md-body pre{background:rgba(255,255,255,0.05);border:0.5px solid var(--b1);border-radius:10px;padding:14px;overflow-x:auto;margin-bottom:12px;}
.md-body pre code{background:none;padding:0;color:var(--t2);}
.md-body blockquote{border-left:3px solid var(--ac);padding:8px 14px;color:var(--t3);margin:10px 0;background:rgba(167,139,250,0.06);border-radius:0 8px 8px 0;}
.md-body blockquote p{margin-bottom:0;}
.md-body strong{color:var(--t1);font-weight:600;}
.md-body a{color:var(--blue);}
.mention-link{color:var(--ac-text)!important;background:var(--ac-bg);border-radius:4px;padding:1px 4px;text-decoration:none!important;font-weight:500;}
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
/* Lightbox */
.lb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out;}
.lb-overlay img{max-width:calc(100vw - 48px);max-height:calc(100vh - 80px);border-radius:10px;object-fit:contain;box-shadow:0 8px 48px rgba(0,0,0,.6);}
.lb-close{position:fixed;top:16px;right:20px;font-size:24px;color:rgba(255,255,255,.7);cursor:pointer;line-height:1;z-index:10000;}
.lb-close:hover{color:#fff;}
.lb-orig{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);font-size:12px;color:rgba(255,255,255,.5);cursor:pointer;}
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
.lb-orig:hover{color:rgba(255,255,255,.85);}
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

// ── Toasts ───────────────────────────────────────────────────────────────────
let _tid = 0; const _tl = new Set();
function toast(msg, type="ok") { const id=++_tid; _tl.forEach(f=>f({id,msg,type})); setTimeout(()=>_tl.forEach(f=>f({id,rm:true})),3000); }
function fmtBytes(b) { if(!b)return "0 B"; const u=["B","KB","MB","GB"]; let i=0; while(b>=1024&&i<3){b/=1024;i++;} return `${b.toFixed(i?1:0)} ${u[i]}`; }
function Toasts() {
  const [list,setList]=useState([]);
  useEffect(()=>{ const f=t=>{ if(t.rm) setList(p=>p.filter(x=>x.id!==t.id)); else setList(p=>[...p,t]); }; _tl.add(f); return ()=>_tl.delete(f); },[]);
  return <div style={{position:"fixed",bottom:24,right:24,display:"flex",flexDirection:"column",gap:6,zIndex:9999}}>{list.map(t=><div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}</div>;
}

// ── Utils ────────────────────────────────────────────────────────────────────
function ago(d) {
  if (!d) return "";
  const s = Math.floor((Date.now()-new Date(d))/1000);
  if (s<60) return "just now"; if (s<3600) return `${Math.floor(s/60)}m`;
  if (s<86400) return `${Math.floor(s/3600)}h`; if (s<604800) return `${Math.floor(s/86400)}d`;
  return new Date(d).toLocaleDateString();
}
function fmtDate(d) {
  if (!d) return "recently";
  return new Date(d).toLocaleDateString("en-US", {month:"long",year:"numeric"});
}
function fmtMsgTime(d) {
  if (!d) return "";
  return new Date(d).toLocaleTimeString("en-US", {hour:"numeric",minute:"2-digit",hour12:true});
}
function fmtDaySep(d) {
  if (!d) return "";
  const date = new Date(d);
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate()-1);
  const sameDay = (a,b) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
  if (sameDay(date, now)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  if (now - date < 7*86400*1000) return date.toLocaleDateString("en-US",{weekday:"long"});
  if (date.getFullYear()===now.getFullYear()) return date.toLocaleDateString("en-US",{month:"long",day:"numeric"});
  return date.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
}

// Space colors mapped to accent
const SPACE_COLORS = ["#a78bfa","#f472b6","#34d399","#60a5fa","#fbbf24","#f87171","#ec4899","#10b981"];
function spaceColor(space) { return space?.color || SPACE_COLORS[(space?.id||0) % SPACE_COLORS.length]; }

// Rounded-square avatar
// ── User card popover ─────────────────────────────────────────────────────────
let _ucardSetState = null;
function useUserCard() {
  const [card, setCard] = useState(null); // {user, x, y}
  useEffect(()=>{ _ucardSetState = setCard; return ()=>{ _ucardSetState=null; }; },[]);
  return [card, setCard];
}
function openUserCard(username, anchorEl) {
  if (!_ucardSetState) return;
  const rect = anchorEl.getBoundingClientRect();
  _ucardSetState({username, x: rect.left, y: rect.bottom + 8, loading: true, user: null});
  api.get(`/users/${username}`).then(d=>{
    if (d.user) _ucardSetState(p=>p?.username===username ? {...p, user:d.user, loading:false} : p);
  }).catch(()=>_ucardSetState(null));
}

function UserCardPopover({card, setCard, currentUser, navigate}) {
  const ref = useRef();
  useEffect(()=>{
    if (!card) return;
    const fn = e => { if (ref.current && !ref.current.contains(e.target)) setCard(null); };
    setTimeout(()=>document.addEventListener("mousedown", fn), 0);
    return ()=>document.removeEventListener("mousedown", fn);
  },[card]);

  if (!card) return null;

  const u = card.user;
  const ROLE_COLOR = {admin:"var(--amber)", moderator:"var(--ac)", member:"var(--t5)"};
  const ROLE_BG = {admin:"rgba(251,191,36,.15)", moderator:"var(--ac-bg)", member:"rgba(255,255,255,0.05)"};

  const startDM = async () => {
    setCard(null);
    const d = await api.post("/threads/direct", {username: card.username});
    if (d.thread) navigate("dm", {threadId: d.thread.id, threadName: card.username});
    else toast(d.error||"Could not start conversation","err");
  };

  // Flip horizontally if card would go off right edge
  const cardW = 320;
  const x = Math.min(card.x, window.innerWidth - cardW - 12);
  // Flip vertically if card would go off bottom
  const cardH = 420;
  const y = card.y + cardH > window.innerHeight ? card.y - cardH - 60 : card.y;

  return (
    <div ref={ref} className={`ucard-wrap ${card?"visible":""}`} style={{left:x, top:y}}>
      <div className="ucard">
        {/* Cover */}
        <div className="ucard-cover" style={{background: u?.cover_url ? `url(${u.cover_url}) center/cover` : "linear-gradient(135deg,#1e1c2e,#312e55)"}}>
          {/* Avatar overlapping cover */}
          <div style={{position:"absolute",bottom:-36,left:16}}>
            {u?.avatar_url
              ?<img src={u.avatar_url} style={{width:96,height:96,borderRadius:"var(--av-radius)",border:"3px solid var(--s2)",objectFit:"cover"}} alt={u.username}/>
              :<div style={{width:96,height:96,borderRadius:"var(--av-radius)",border:"3px solid var(--s2)",background:spaceColor({id:u?.id||0}),display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,fontWeight:500,color:"#fff"}}>{(card.username||"?").slice(0,2).toUpperCase()}</div>}
          </div>
        </div>
        {/* Body */}
        <div className="ucard-body">
          {card.loading&&!u
            ?<div style={{height:100,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)",fontSize:13}}>Loading…</div>
            :<>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:10,paddingTop:44}}>
                <div>
                  <div style={{fontSize:17,fontWeight:500,color:"var(--t1)",cursor:"pointer"}} onClick={()=>{setCard(null);navigate("profile",{username:u.username});}}>{u.username}</div>
                  <div style={{fontSize:12,color:"var(--t5)",marginTop:3}}>Joined {new Date(u.inserted_at).toLocaleDateString("en-US",{month:"short",year:"numeric"})}</div>
                </div>
                {u.role&&u.role!=="member"&&<div style={{fontSize:11,padding:"3px 8px",borderRadius:6,background:ROLE_BG[u.role],color:ROLE_COLOR[u.role],border:`0.5px solid ${ROLE_COLOR[u.role]}44`,flexShrink:0}}>{u.role}</div>}
              </div>
              {u.bio&&<p style={{fontSize:13,color:"var(--t3)",margin:"0 0 12px",lineHeight:1.5,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{u.bio}</p>}
              {/* Stats */}
              <div style={{display:"flex",gap:6,marginBottom:10}}>
                <div className="ucard-stat"><div className="ucard-stat-n">{u.post_count||0}</div><div className="ucard-stat-l">posts</div></div>
                <div className="ucard-stat"><div className="ucard-stat-n">{u.reply_count||0}</div><div className="ucard-stat-l">replies</div></div>
                <div className="ucard-stat"><div className="ucard-stat-n" style={{color:"var(--ac)"}}>{u.reactions_received||0}</div><div className="ucard-stat-l">reactions</div></div>
              </div>
              {/* Last seen */}
              {u.last_seen_at&&<div style={{fontSize:12,color:"var(--t5)",marginBottom:12,display:"flex",alignItems:"center",gap:5}}>
                <i className="fa-solid fa-clock" style={{fontSize:10}}></i>
                Active {ago(u.last_seen_at)}
              </div>}
              {/* Actions */}
              <div style={{display:"flex",gap:7}}>
                {currentUser&&currentUser.username!==u.username&&<button className="btn-ghost" style={{flex:1,fontSize:13,padding:"8px 0",borderRadius:8}} onClick={startDM}>
                  <i className="fa-solid fa-message" style={{fontSize:11,marginRight:5}}></i>Message
                </button>}
                <button className="btn-ghost" style={{flex:1,fontSize:13,padding:"8px 0",borderRadius:8}} onClick={()=>{setCard(null);navigate("profile",{username:u.username});}}>
                  <i className="fa-solid fa-user" style={{fontSize:11,marginRight:5}}></i>Profile
                </button>
              </div>
            </>}
        </div>
      </div>
    </div>
  );
}

function RsAv({user, size=34, color, noCard=false}) {
  const bg = color || SPACE_COLORS[(user?.id||0) % SPACE_COLORS.length];
  const initials = (user?.username||"?").slice(0,2).toUpperCase();
  const handleClick = noCard ? undefined : (e)=>{ e.stopPropagation(); if(user?.username) openUserCard(user.username, e.currentTarget); };
  if (user?.avatar_url) return (
    <img src={user.avatar_url} style={{width:size,height:size,borderRadius:"var(--av-radius)",objectFit:"cover",flexShrink:0,border:`1px solid ${bg}33`,cursor:noCard?"default":"pointer"}} alt={user.username} onClick={handleClick}/>
  );
  return (
    <div style={{width:size,height:size,borderRadius:"var(--av-radius)",background:`${bg}22`,color:bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:Math.round(size*0.32),fontWeight:500,flexShrink:0,cursor:noCard?"default":"pointer"}} onClick={handleClick}>
      {initials}
    </div>
  );
}

// Round avatar
function Av({user, size=28}) {
  const bg = SPACE_COLORS[(user?.id||0) % SPACE_COLORS.length];
  if (user?.avatar_url) return (
    <img src={user.avatar_url} style={{width:size,height:size,borderRadius:"50%",objectFit:"cover",flexShrink:0,border:`0.5px solid ${bg}55`}} alt={user?.username}/>
  );
  return (
    <div style={{width:size,height:size,borderRadius:"50%",background:`${bg}33`,border:`0.5px solid ${bg}55`,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:Math.round(size*0.36),fontWeight:500,color:bg}}>
      {(user?.username||"?").slice(0,1).toUpperCase()}
    </div>
  );
}

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
  if (p === "/members")                return {page:"members", props:{}};
  if (p === "/saved")                  return {page:"saved", props:{}};
  const postM    = p.match(/^\/post\/(.+)$/);
  if (postM)  return {page:"post",    props:{id: postM[1]}};
  const profileM = p.match(/^\/profile\/(.+)$/);
  if (profileM) return {page:"profile", props:{username: profileM[1]}};
  const spaceM   = p.match(/^\/space\/(.+)$/);
  if (spaceM)  return {page:"feed",   props:{space: spaceM[1]}};
  const dmM      = p.match(/^\/messages\/(.+)$/);
  if (dmM)    return {page:"dm",     props:{threadId: dmM[1]}};
  return {page:"feed", props:{}};
}

function pageToUrl(page, props={}) {
  switch(page) {
    case "feed":          return props.space ? `/space/${props.space}` : "/";
    case "post":          return props.id ? `/post/${props.id}` : "/";
    case "profile":       return props.username ? `/profile/${props.username}` : "/";
    case "compose":       return "/compose";
    case "search":        return "/search";
    case "notifications": return "/notifications";
    case "messages":      return "/messages";
    case "dm":            return props.threadId ? `/messages/${props.threadId}` : "/messages";
    case "moderation":   return "/moderation";
    case "admin":         return "/admin";
    case "settings":      return "/settings";
    case "members":       return "/members";
    case "saved":         return "/saved";
    default:              return "/";
  }
}
let _cssEl = null;
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

function applyBranding(app={}, gen={}) {
  const r = document.documentElement;
  if (app.accent_color) {
    r.style.setProperty("--ac", app.accent_color);
    const vars = deriveAccentVars(app.accent_color);
    if (vars) {
      r.style.setProperty("--ac-on", vars.onAccent);   // text ON solid accent bg
      r.style.setProperty("--ac-bg", vars.acBg);        // tinted accent bg
      r.style.setProperty("--ac-border", vars.acBorder); // accent border
      r.style.setProperty("--ac-text", vars.acText);    // accent-colored text on dark bg
    }
  }
  // Background tint
  if (app.tint_color) {
    const tint = deriveTintVars(app.tint_color);
    if (tint) { r.style.setProperty("--bg",tint.bg); r.style.setProperty("--s1",tint.s1); r.style.setProperty("--s2",tint.s2); r.style.setProperty("--s3",tint.s3); }
  } else {
    r.style.setProperty("--bg","#0d0d14"); r.style.setProperty("--s1","#13121e"); r.style.setProperty("--s2","#18182a"); r.style.setProperty("--s3","#1e1c2e");
  }
  // Avatar radius: 0=square, 50=circle. Default 22%
  r.style.setProperty("--av-radius", `${app.avatar_radius ?? 22}%`);
  if (gen.site_name) document.title = gen.site_name + " · Nexus";
  if (app.custom_css) {
    if (!_cssEl) { _cssEl = document.createElement("style"); document.head.appendChild(_cssEl); }
    _cssEl.textContent = app.custom_css;
  }
  // Apply favicon
  if (gen.favicon_url) {
    let link = document.querySelector("link[rel~='icon']");
    if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
    link.href = gen.favicon_url;
  }
  const newBranding = {logo_url: gen.logo_url||null, site_name: gen.site_name||null, favicon_url: gen.favicon_url||null, hero_title: gen.hero_title||null, hero_body: gen.hero_body||null, hero_enabled: gen.hero_enabled||false};
  try { localStorage.setItem("nexus_branding", JSON.stringify(newBranding)); } catch {}
  setBrandingState(newBranding);
}

// ── Reactions ─────────────────────────────────────────────────────────────────
const REACTIONS = [
  {emoji:"❤️", label:"Love"},
  {emoji:"👍", label:"Like"},
  {emoji:"😂", label:"Haha"},
  {emoji:"😲", label:"Wow"},
  {emoji:"😭", label:"Sad"},
  {emoji:"🔥", label:"Fire"},
  {emoji:"🎉", label:"Celebrate"},
  {emoji:"👀", label:"Eyes"},
];

function ReactionButton({postId, replyId, initialReactions=[], initialUserReaction=null, currentUser, onAuthRequired}) {
  const [open, setOpen] = useState(false);
  const [reactions, setReactions] = useState(initialReactions);
  const [userReaction, setUserReaction] = useState(initialUserReaction);
  const ref = useRef();

  useEffect(()=>{ setReactions(initialReactions); },[JSON.stringify(initialReactions)]);
  useEffect(()=>{ setUserReaction(initialUserReaction); },[initialUserReaction]);

  useEffect(()=>{
    if(!open) return;
    const fn=e=>{ if(ref.current&&!ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown",fn);
    return ()=>document.removeEventListener("mousedown",fn);
  },[open]);

  const react = async(emoji) => {
    if(!currentUser){ onAuthRequired?.("login"); setOpen(false); return; }
    setOpen(false);
    const body = {emoji, ...(postId?{post_id:postId}:{reply_id:replyId})};
    if(userReaction===emoji){
      // Toggle off
      const d = await api.delete("/reactions", body);
      if(d.ok){ setReactions(d.reactions||[]); setUserReaction(null); }
    } else {
      const d = await api.post("/reactions", body);
      if(d.ok){ setReactions(d.reactions||[]); setUserReaction(d.user_reaction); }
    }
  };

  const totalCount = reactions.reduce((s,r)=>s+(r.count||0),0);

  return (
    <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
      {/* React trigger button */}
      <div className={`rx-trigger ${userReaction?"reacted":""}`} ref={ref} onClick={()=>setOpen(p=>!p)}>
        <span style={{fontSize:16,lineHeight:1}}>{userReaction||"❤️"}</span>
        {totalCount>0&&<span>{totalCount}</span>}
        {open&&(
          <div className="rx-picker" onClick={e=>e.stopPropagation()}>
            {REACTIONS.map(({emoji,label})=>(
              <div key={emoji} className={`rx-pick-btn ${userReaction===emoji?"selected":""}`}
                title={label} onClick={e=>{e.stopPropagation();react(emoji);}}>
                {emoji}
              </div>
            ))}
          </div>
        )}
      </div>
      {/* Count pills for each reaction type */}
      {reactions.filter(r=>r.count>0).map(r=>(
        <div key={r.emoji} className={`rx-pill ${userReaction===r.emoji?"mine":""}`}
          onClick={()=>react(r.emoji)} title={REACTIONS.find(x=>x.emoji===r.emoji)?.label||r.emoji}>
          <span style={{fontSize:14}}>{r.emoji}</span>
          <span>{r.count}</span>
        </div>
      ))}
    </div>
  );
}
const SLASH_ITEMS = [
  {type:"image", icon:"🖼", label:"Image",      desc:"Upload or embed"},
  {type:"code",  icon:"</>",label:"Code block", desc:"Syntax highlighted"},
  {type:"quote", icon:'"',  label:"Blockquote", desc:"Highlight a quote"},
  {type:"divider",icon:"—", label:"Divider",    desc:"Horizontal rule"},
];
// Toolbar button definitions — used by the static toolbar in RichTextArea
const TB_BTNS = [
  {type:"bold",    label:"B",    tip:"Bold",        style:{fontWeight:700},                    wrap:["**","**"]},
  {type:"italic",  label:"I",    tip:"Italic",      style:{fontStyle:"italic"},                wrap:["*","*"]},
  {type:"strike",  label:"S",    tip:"Strikethrough",style:{textDecoration:"line-through"},   wrap:["~~","~~"]},
  {sep:true},
  {type:"h1",      label:"H1",   tip:"Heading 1",   style:{fontSize:12,fontWeight:700},        wrap:["# ",""]},
  {type:"h2",      label:"H2",   tip:"Heading 2",   style:{fontSize:12,fontWeight:700},        wrap:["## ",""]},
  {sep:true},
  {type:"incode",  label:"</>",  tip:"Inline code", style:{fontFamily:"monospace",fontSize:11},wrap:["`","`"]},
  {type:"code",    label:"≡",    tip:"Code block",  style:{fontFamily:"monospace"},             wrap:["```\n","\n```"]},
  {type:"link",    label:"🔗",   tip:"Link",        style:{},                                  wrap:["[","](url)"]},
  {type:"quote",   label:"❝",    tip:"Blockquote",  style:{},                                  wrap:["> ",""]},
  {type:"divider", label:"—",    tip:"Divider",     style:{},                                  wrap:["\n---\n",""]},
  {sep:true},
  {type:"spoiler",  label:"👁",    tip:"Spoiler",     style:{},                                  wrap:["||","||"]},
  {sep:true},
  {type:"image",    label:"🖼",    tip:"Upload image", style:{},                                  wrap:null},
];
const EXPLORE_ITEMS = [
  {id:"everything", label:"Everything",   icon:"fa-border-all"},
  {id:"trending",   label:"Trending",     icon:"fa-fire"},
  {id:"notifications",label:"Notifications",icon:"fa-bell",   authOnly:true},
  {id:"messages",   label:"Messages",     icon:"fa-message", authOnly:true},
  {id:"members",    label:"Members",      icon:"fa-users"},
];
const RIGHT_WIDGETS = [
  {id:"live_activity",   label:"Live Activity"},
  {id:"spaces_by_pulse", label:"Spaces by Pulse"},
  {id:"stats",           label:"Stats"},
];
const SIDEBAR_SECTIONS = [
  {id:"explore", label:"Explore"},
  {id:"spaces",  label:"Spaces"},
  {id:"you",     label:"You"},
];
let _activeToolbar = null; // set by App when layoutCfg loads
let _slashMenu=null, _activeTA=null, _slashIdx=0;
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
  getSm().style.display="none";
  if (type === "image") {
    const input = document.getElementById("comp-img-input");
    if (input) input.click();
    return;
  }
  const lines=ta.value.split("\n");
  lines[lines.length-1]=type==="code"?"```\ncode here\n```":type==="quote"?"> ":type==="divider"?"---":"";
  ta.value=lines.join("\n");
  ta.focus(); ta.dispatchEvent(new Event("input",{bubbles:true}));
};
window._smHover = function(idx) {
  _slashIdx=idx;
  getSm().querySelectorAll(".slash-item").forEach((el,i)=>{
    el.classList.toggle("sel",i===idx);
  });
};

function RichTextArea({value, onChange, placeholder, minHeight=200, autoFocus=false, currentUser=null, toolbarItems=null}) {
  toolbarItems = toolbarItems || _activeToolbar || null;
  const taRef = useRef(); const wrapRef = useRef();
  const imgInputRef = useRef();
  const [uploading, setUploading] = useState(false);

  // Apply a format wrap to current selection or insert at cursor
  const applyFormat = (wrap) => {
    const ta = taRef.current; if (!ta) return;
    const [before, after] = wrap;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e) || "text";
    const newVal = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e);
    onChange(newVal);
    setTimeout(()=>{
      ta.focus();
      ta.setSelectionRange(s + before.length, s + before.length + sel.length);
    }, 0);
  };
  // Mention state
  const [mentionDrop, setMentionDrop] = useState(null);
  const [isFocused, setIsFocused] = useState(false);
  const [showPreview, setShowPreview] = useState(false); // {users, query, pos, x, y, selIdx}
  const mentionDebounce = useRef();
  const mentionSearch = async (q, caretPos, x, y) => {
    if (q.length === 0) { setMentionDrop(null); return; }
    const d = await api.get(`/users?q=${encodeURIComponent(q)}`).catch(()=>null);
    const users = (d?.members||[]).slice(0,6);
    if (users.length === 0) { setMentionDrop(null); return; }
    setMentionDrop({users, query:q, pos:caretPos, x, y, selIdx:0});
  };
  const insertMention = (username) => {
    const ta = taRef.current; if (!ta) return;
    const val = ta.value;
    // Find the @ that triggered the dropdown
    const before = val.slice(0, mentionDrop.pos);
    const atIdx = before.lastIndexOf("@");
    if (atIdx === -1) return;
    const after = val.slice(mentionDrop.pos);
    const newVal = val.slice(0, atIdx) + `@${username} ` + after;
    onChange(newVal);
    setMentionDrop(null);
    const newPos = atIdx + username.length + 2;
    setTimeout(()=>{ ta.focus(); ta.setSelectionRange(newPos, newPos); }, 0);
  };
  const buildSm = () => {
    const sm = getSm();
    sm.innerHTML = SLASH_ITEMS.map((item,i)=>
      `<div class="slash-item${i===0?" sel":""}" onmousedown="event.preventDefault();_smPick('${item.type}')" onmouseenter="_smHover(${i})">
        <div class="slash-icon">${item.icon}</div>
        <div><div>${item.label}</div><div class="slash-desc">${item.desc}</div></div>
      </div>`
    ).join("");
    _slashIdx=0;
  };

  const handleChange = e => {
    onChange(e.target.value);
    const ta = e.target;
    const val = ta.value;
    const caret = ta.selectionStart;
    // Check for @mention trigger
    const textBefore = val.slice(0, caret);
    const mentionMatch = textBefore.match(/@([a-zA-Z0-9_]*)$/);
    if (mentionMatch) {
      const q = mentionMatch[1];
      clearTimeout(mentionDebounce.current);
      // Get caret position for dropdown placement
      const rect = ta.getBoundingClientRect();
      mentionDebounce.current = setTimeout(()=>mentionSearch(q, caret, rect.left+16, rect.top-8), 200);
    } else {
      setMentionDrop(null);
    }
    // Slash command detection
    const last = val.split("\n").pop();
    const sm = getSm();
    if (/^\/([icbde])?$/.test(last)||last==="/") {
      _activeTA = taRef.current;
      buildSm();
      const rect = ta.getBoundingClientRect();
      sm.style.cssText=`display:block;position:fixed;left:${rect.left}px;top:${rect.top-200}px;`;
    } else { sm.style.display="none"; }
  };
  const handleKeyDown = e => {
    // Mention dropdown keyboard navigation
    if (mentionDrop) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionDrop(p=>({...p,selIdx:(p.selIdx+1)%p.users.length})); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionDrop(p=>({...p,selIdx:(p.selIdx-1+p.users.length)%p.users.length})); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(mentionDrop.users[mentionDrop.selIdx].username); return; }
      if (e.key === "Escape") { setMentionDrop(null); return; }
    }
    const sm = getSm();
    if (sm.style.display==="none") return;
    const items = SLASH_ITEMS.length;
    if (e.key==="ArrowDown"){e.preventDefault();_smHover((_slashIdx+1)%items);}
    else if (e.key==="ArrowUp"){e.preventDefault();_smHover((_slashIdx-1+items)%items);}
    else if (e.key==="Enter"){e.preventDefault();window._smPick(SLASH_ITEMS[_slashIdx].type);}
    else if (e.key==="Escape"){sm.style.display="none";}
  };
  const handleBlur = () => {
    setTimeout(()=>{ getSm().style.display="none"; setMentionDrop(null); }, 200);
  };

  const insertImageMarkdown = (webpUrl, originalUrl, filename) => {
    const ta = taRef.current; if (!ta) return;
    const alt = filename.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
    // [![alt](webpUrl)](originalUrl) — WebP embedded, original linked for lightbox
    const md = `\n[![${alt}](${webpUrl})](${originalUrl})\n`;
    const pos = ta.selectionStart;
    const newVal = value.slice(0, pos) + md + value.slice(pos);
    onChange(newVal);
    setTimeout(()=>{ ta.focus(); ta.setSelectionRange(pos+md.length, pos+md.length); }, 0);
  };

  const handleImageFile = async (file) => {
    if (!file) return;
    if (!currentUser) { toast("Sign in to upload images", "err"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", "post_image");
      const token = localStorage.getItem("nexus_token");
      const r = await fetch("/api/v1/uploads", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      const d = await r.json();
      if (d.upload) {
        insertImageMarkdown(d.url, d.original_url, file.name);
        toast("Image uploaded");
      } else {
        toast(d.error || "Upload failed", "err");
      }
    } catch(e) {
      toast("Upload failed", "err");
    } finally {
      setUploading(false);
      if (imgInputRef.current) imgInputRef.current.value = "";
    }
  };

  return (
    <div ref={wrapRef} style={{position:"relative",display:"flex",flexDirection:"column",flex:1,height:"100%"}}>
      {/* Static toolbar */}
      <div className="comp-toolbar">
        {(toolbarItems||TB_BTNS).filter(b=>!b.hidden).map((b,i)=> b.sep
          ? <div key={i} className="comp-tb-sep"/>
          : b.type==="image"
            ? <label key="image" className="comp-tb-btn" htmlFor="comp-img-input" title="Upload image" style={{cursor:"pointer"}}>
                {uploading
                  ? <i className="fa-solid fa-spinner fa-spin" style={{fontSize:11}}/>
                  : <i className="fa-solid fa-image" style={{fontSize:12}}/>}
              </label>
            : <button key={b.type} className="comp-tb-btn" title={b.tip}
                style={b.style} onMouseDown={e=>{e.preventDefault(); applyFormat(b.wrap);}}>
                {b.label}
              </button>
        )}
        <div style={{flex:1}}/>
        <button className="comp-tb-btn" title="Preview" onMouseDown={e=>{e.preventDefault();setShowPreview(p=>!p);}} style={{color:showPreview?"var(--ac)":"inherit",opacity:showPreview?1:0.6}}>
          <i className="fa-regular fa-eye" style={{fontSize:12}}/>
        </button>
      </div>
      {!value && !isFocused && <div style={{position:"absolute",top:44,left:0,fontSize:15,color:"rgba(255,255,255,0.12)",pointerEvents:"none",lineHeight:1.75,padding:"8px 4px"}}>{placeholder}</div>}
      <textarea ref={taRef} value={value} onChange={handleChange} onKeyDown={handleKeyDown}
        onFocus={()=>setIsFocused(true)} onBlur={e=>{handleBlur(e);setIsFocused(false);}} autoFocus={autoFocus}
        className="comp-ta" style={{minHeight,paddingTop:12,paddingBottom:12}}
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
      {/* Mention dropdown */}
      {/* Preview modal */}
      {showPreview&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,padding:20}}
          onClick={e=>{if(e.target===e.currentTarget)setShowPreview(false);}}>
          <div style={{background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:16,width:"100%",maxWidth:680,maxHeight:"80vh",display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 8px 40px rgba(0,0,0,0.5)"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 20px",borderBottom:"0.5px solid var(--b1)",flexShrink:0}}>
              <span style={{fontSize:13,fontWeight:500,color:"var(--t2)"}}>Preview</span>
              <button onClick={()=>setShowPreview(false)} style={{background:"none",border:"none",color:"var(--t4)",fontSize:18,cursor:"pointer",lineHeight:1}}>✕</button>
            </div>
            <div style={{overflowY:"auto",padding:"20px 24px",flex:1}}>
              {value.trim()
                ?<div className="md-body"><Md text={value}/></div>
                :<div style={{color:"var(--t5)",fontSize:13,fontStyle:"italic"}}>Nothing to preview yet.</div>}
            </div>
          </div>
        </div>
      )}
      {mentionDrop&&(
        <div className="mention-drop" style={{left:mentionDrop.x, top:mentionDrop.y, transform:"translateY(-100%)"}}>
          {mentionDrop.users.map((u,i)=>(
            <div key={u.id} className={`mention-item ${i===mentionDrop.selIdx?"sel":""}`}
              onMouseDown={e=>{e.preventDefault();insertMention(u.username);}}>
              {u.avatar_url
                ?<img className="mention-av" src={u.avatar_url} alt={u.username}/>
                :<div className="mention-av" style={{background:spaceColor({id:u.id})}}>{u.username.slice(0,2).toUpperCase()}</div>}
              <span className="mention-name">@{u.username}</span>
            </div>
          ))}
        </div>
      )}
      {/* Hidden file input — triggered by slash menu Image pick and the button below */}
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

// ── Avatar dropdown ───────────────────────────────────────────────────────────
function AvatarMenu({user, navigate, onLogout}) {
  const [open,setOpen]=useState(false); const ref=useRef();
  useEffect(()=>{
    const fn=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
    document.addEventListener("mousedown",fn); return ()=>document.removeEventListener("mousedown",fn);
  },[]);
  const initials = (user?.username||"?").slice(0,2).toUpperCase();
  return (
    <div className="av-wrap" ref={ref}>
      <div className={`av-circle ${open?"open":""}`} onClick={()=>setOpen(p=>!p)}>
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
          <i className="fa-solid fa-user" style={{color:"rgba(255,255,255,0.4)"}}></i>profile
        </div>
        <div className="av-dd-item" onClick={()=>{navigate("settings");setOpen(false);}}>
          <i className="fa-solid fa-gear" style={{color:"rgba(255,255,255,0.4)"}}></i>settings
        </div>
        {user?.role==="admin"&&<div className="av-dd-item admin-item" onClick={()=>{navigate("admin");setOpen(false);}}>
          <i className="fa-solid fa-shield-halved"></i>administration
        </div>}
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
        ? {email: form.login, password: form.password}  // backend handles email or username
        : {email: form.email, username: form.username, password: form.password};
      const d=await api.post(mode==="login"?"/auth/login":"/auth/register", body);
      if(d.access_token){api.setToken(d.access_token);onLogin(d.user);}
      else setErr(d.errors?Object.values(d.errors).flat().join(", "):d.error||"Something went wrong");
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
          {err&&<div className="ferr" style={{marginBottom:10}}>{err}</div>}
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
  useEffect(()=>{
    setBranding({logo_url:_brandingState.logo_url, site_name:_brandingState.site_name});
    onBrandingChange(b=>setBranding({logo_url:b.logo_url, site_name:b.site_name}));
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
            trending:   <SbItem key="trending" icon="fa-fire" label="Trending" targetPage="feed" targetProps={{sort:"top"}}/>,
            notifications: currentUser&&<SbItem key="notifications" icon="fa-bell" label="Notifications" targetPage="notifications" badge={notifCount}/>,
            messages:   currentUser&&<SbItem key="messages" icon="fa-message" label="Messages" targetPage="messages" badge={msgCount}/>,
            members:    <SbItem key="members" icon="fa-users" label="Members" targetPage="members"/>,
          };

          return sections.map(function(sec, si){
            var divider = si > 0 ? <div key={"div"+si} className="sb-divider"/> : null;
            if(sec.id === "explore") return <React.Fragment key="explore">
              {divider}<div className="sb-label">Explore</div>
              {exploreItems.map(function(item){return exploreMap[item.id]||null;})}
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
      <div className="tb-search" ref={searchRef} style={{position:"relative"}}>
        <i className="fa-solid fa-magnifying-glass" style={{fontSize:14,color:searching?"var(--ac)":"rgba(255,255,255,0.25)",transition:"color .2s"}}></i>
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
                    <RsAv user={p.user} size={28} color={col}/>
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
                  <RsAv user={r.user} size={28} color={spaceColor({id:r.post_id})}/>
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
          <div className="icon-btn" title="Docs">
            <i className="fa-solid fa-file-lines" style={{fontSize:16}}></i>
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
function RightPanel({spaces, liveEvents=[], layoutCfg={}, mobile=false}) {
  const [stats, setStats] = useState({members:0, threads:0});
  useEffect(()=>{ api.get("/stats").then(d=>setStats(d)).catch(()=>{}); },[]);

  const sorted = [...spaces].sort((a,b)=>(b.post_count||0)-(a.post_count||0));
  const max = sorted[0]?.post_count||1;

  var savedWidgets = layoutCfg.right_widgets;
  var widgets = savedWidgets && savedWidgets.length
    ? savedWidgets.map(function(w){return RIGHT_WIDGETS.find(function(d){return d.id===w.id;})||w;})
    : RIGHT_WIDGETS.slice();
  RIGHT_WIDGETS.forEach(function(d){if(!widgets.find(function(w){return w.id===d.id;}))widgets.push(d);});

  var liveActivityWidget = (
    <div className="rw" key="live_activity">
      <div className="rw-label">live activity</div>
        {liveEvents.length===0
          ?<div style={{fontSize:11,color:"var(--t5)",padding:"8px 0"}}>No recent activity</div>
          :liveEvents.slice(0,4).map((e,i)=>(
            <div key={i} className="live-row">
              <div className="l-av" style={{background:spaceColor({id:e.userId}),color:"#fff"}}>{(e.username||"?").slice(0,2).toUpperCase()}</div>
              <div className="l-txt"><strong>{e.username}</strong> {e.action}</div>
              <div className="l-ago">{ago(e.at)}</div>
            </div>
          ))}
    </div>
  );
  var spacesPulseWidget = sorted.length>0 ? (
    <div className="rw" key="spaces_by_pulse">
      <div className="rw-label">spaces by pulse</div>
        {sorted.slice(0,5).map(s=>{
          const col=spaceColor(s);
          const w=Math.max(8, Math.round((s.post_count||0)/max*100));
          return (
            <div key={s.id} className="pulse-row">
              <div className="p-name"><i className={`fa-solid ${s.icon||"fa-layer-group"}`} style={{fontSize:10,color:col,width:14,textAlign:"center"}}></i>{s.name.slice(0,7)}</div>
              <div className="p-bar-wrap"><div className="p-bar" style={{width:`${w}%`,background:col}}></div></div>
              <div className="p-count" style={{color:col}}>{s.post_count||0}</div>
            </div>
          );
        })}
    </div>
  ) : null;
  var statsWidget = (
    <div className="stat-grid" key="stats">
        <div className="stat-card"><div className="stat-n">{stats.threads}</div><div className="stat-l">threads</div></div>
        <div className="stat-card"><div className="stat-n" style={{color:"#34d399"}}>1</div><div className="stat-l">online</div></div>
        <div className="stat-card"><div className="stat-n">{stats.members}</div><div className="stat-l">members</div></div>
        <div className="stat-card"><div className="stat-n" style={{color:"#a78bfa"}}>—</div><div className="stat-l">your rank</div></div>
    </div>
  );
  var widgetMap = {live_activity: liveActivityWidget, spaces_by_pulse: spacesPulseWidget, stats: statsWidget};
  return (
    <div className={mobile?"mob-rightpanel-inner":"right-panel"}>
      {widgets.map(function(w){return widgetMap[w.id]||null;})}
    </div>
  );
}

// ── Feed ──────────────────────────────────────────────────────────────────────
function FeedPage({spaces, tags, currentUser, navigate, notifCount=0, msgCount=0, onLogout, spaceFilter, sortOverride, followingOnly=false, livePosts=[], liveEvents=[], onAuthRequired}) {
  const [sort,setSort]=useState(sortOverride||"latest");
  useEffect(()=>{setSort(sortOverride||"latest");},[sortOverride]);
  const [posts,setPosts]=useState([]); const [loading,setLoading]=useState(true);
  const [cursor,setCursor]=useState(null); const [hasMore,setHasMore]=useState(false);
  const [liveCount,setLiveCount]=useState(0);
  const [hoveredPost,setHoveredPost]=useState(null);
  const [openPostMenu,setOpenPostMenu]=useState(null);
  const [subscribed,setSubscribed]=useState(false);
  const [subLoading,setSubLoading]=useState(false);
  useEffect(()=>{ if(livePosts.length>0) setLiveCount(livePosts.length); },[livePosts]);
  const activeSpace = spaces.find(s=>s.slug===spaceFilter);

  const load=useCallback(async(reset=true,cur=null)=>{
    setLoading(true);
    try {
      let url=`/feed?sort=${sort}`;
      if(spaceFilter) url+=`&space=${spaceFilter}`;
      if(followingOnly) url+=`&following=true`;
      if(!reset&&cur) url+=`&cursor=${cur}`;
      const d=await api.get(url);
      if(d.error==="Please log in to view this forum"){onAuthRequired?.("login");return;}
      const np=d.posts||[];
      if(reset) setPosts(np); else setPosts(p=>[...p,...np]);
      setCursor(d.next_cursor); setHasMore(!!d.next_cursor);
    } finally { setLoading(false); }
  },[sort,spaceFilter,followingOnly]);

  useEffect(()=>{
    if(!spaceFilter) { setSubscribed(false); return; }
    api.get(`/spaces/${spaceFilter}`).then(d=>{ if(d.space) setSubscribed(d.space.subscribed||false); }).catch(()=>{});
  },[spaceFilter]);

  useEffect(()=>{setPosts([]);setLiveCount(0);load(true);},[sort,spaceFilter,followingOnly]);

  const toggleSubscribe = async () => {
    if (!spaceFilter || subLoading) return;
    setSubLoading(true);
    try {
      if (subscribed) {
        await api.delete(`/spaces/${spaceFilter}/subscribe`);
        setSubscribed(false); toast("Unfollowed");
      } else {
        await api.post(`/spaces/${spaceFilter}/subscribe`, {});
        setSubscribed(true); toast("Following!");
      }
    } finally { setSubLoading(false); }
  };

  const feedTitle = followingOnly ? "following" : activeSpace ? activeSpace.name : "everything";

  const [hero, setHero] = useState(_brandingState);
  useEffect(()=>{ return onBrandingChange(b=>setHero({...b})); },[]);

  return (
    <div className="feed-wrap">
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          {currentUser&&currentUser.email_verified===false&&currentUser.role==="member"&&(
            <div style={{background:"rgba(251,191,36,0.08)",borderBottom:"0.5px solid rgba(251,191,36,0.2)",padding:"9px 20px",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
              <i className="fa-solid fa-triangle-exclamation" style={{color:"#fbbf24",fontSize:12,flexShrink:0}}/>
              <span style={{fontSize:12,color:"rgba(251,191,36,0.85)",flex:1}}>
                Please verify your email address to post, reply, and react. Check your inbox for a verification link.
              </span>
            </div>
          )}
          {!spaceFilter&&!followingOnly&&hero.hero_enabled&&(hero.hero_title||hero.hero_body)&&(
            <div style={{padding:"32px 28px",borderBottom:"0.5px solid var(--b1)",background:"linear-gradient(180deg, var(--s2) 0%, transparent 100%)",flexShrink:0}}>
              {hero.hero_title&&<div style={{fontSize:22,fontWeight:600,color:"var(--t1)",letterSpacing:-0.4,marginBottom:hero.hero_body?8:0,lineHeight:1.3}}>{hero.hero_title}</div>}
              {hero.hero_body&&<div style={{fontSize:14,color:"var(--t3)",lineHeight:1.7,maxWidth:600}}>{hero.hero_body}</div>}
            </div>
          )}
          <div className="feed-header">
            <div className="feed-title">{feedTitle}</div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {spaceFilter && activeSpace && (
                <button onClick={toggleSubscribe} disabled={subLoading} style={{fontSize:11,padding:"4px 12px",borderRadius:20,border:`0.5px solid ${subscribed?"rgba(255,255,255,0.15)":"var(--ac-border)"}`,background:subscribed?"rgba(255,255,255,0.05)":"var(--ac-bg)",color:subscribed?"var(--t3)":"var(--ac-text)",cursor:"pointer",fontFamily:"inherit",transition:"all .15s"}}>
                  {subscribed ? "following" : "+ follow"}
                </button>
              )}
              <div className="sort-pills">
                {["latest","rising","top"].map(s=><div key={s} className={`sort-pill ${sort===s?"active":""}`} onClick={()=>setSort(s)}>{s}</div>)}
              </div>
            </div>
          </div>
          <div className="feed-list">
            {liveCount>0&&!spaceFilter&&(
              <div style={{padding:"10px 18px",background:"var(--ac-bg)",borderBottom:"0.5px solid var(--ac-border)",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}} onClick={()=>{setLiveCount(0);load(true);}}>
                <span style={{fontSize:12,color:"var(--ac-text)"}}><i className="fa-solid fa-arrow-up" style={{fontSize:10,marginRight:6}}></i>{liveCount} new {liveCount===1?"post":"posts"} — click to load</span>
              </div>
            )}
            {loading&&!posts.length?<div style={{padding:"40px",textAlign:"center",color:"var(--t5)"}}>Loading...</div>
              :posts.length===0?<div style={{padding:"60px 20px",textAlign:"center",color:"var(--t5)"}}>
                  {followingOnly
                    ?<><div style={{fontSize:28,marginBottom:12,opacity:.3}}>👀</div>
                      <div style={{fontSize:14,fontWeight:500,color:"var(--t2)",marginBottom:8}}>Nothing in your feed yet</div>
                      <div style={{fontSize:13,marginBottom:20}}>Follow some spaces to see posts here</div>
                      <button className="btn-primary" onClick={()=>navigate("feed")}>Browse everything</button></>
                    :<><div style={{fontSize:13,marginBottom:12}}>No posts yet</div>
                      <button className="btn-primary" onClick={()=>navigate("compose")}>Start the conversation</button></>}
                </div>
              :posts.map(p=>{
                const col = spaceColor(p.space||{id:p.id});
                return (
                  <div key={p.id} className="thread" style={{position:"relative"}}
                    onMouseEnter={()=>setHoveredPost(p.id)}
                    onMouseLeave={()=>{setHoveredPost(null);if(openPostMenu===p.id)setOpenPostMenu(null);}}
                    onClick={e=>{if(e.target.closest(".feed-post-menu"))return;navigate("post",{id:p.id});}}>
                    <div className="thread-main">
                      <div className="thread-accent" style={{background:col}}/>
                      <div style={{margin:"0 14px 0 18px",flexShrink:0}}><RsAv user={p.user} size={44} color={col}/></div>
                      <div className="thread-body">
                        <div className="thread-top">
                          <div className="thread-title">{p.title}</div>
                          {p.type&&p.type!=="discussion"&&<div className="thread-tag" style={{background:p.type==="announcement"?"rgba(251,191,36,0.15)":"rgba(96,165,250,0.15)",color:p.type==="announcement"?"var(--amber)":"var(--blue)"}}>{p.type}</div>}
                          {p.space&&<div className="thread-tag" style={{background:`${col}20`,color:col}}>{p.space.name}</div>}
                        </div>
                        {p.body&&<div className="thread-preview">{p.body.replace(/!\[.*?\]\(.*?\)/g,"").replace(/\[!\[.*?\]\(.*?\)\]\(.*?\)/g,"").replace(/\[[^\]]*\]\([^)]*\)/g,"").replace(/[#*`>]/g,"").trim().slice(0,120)}</div>}
                        <div className="participants-row">
                          <div className="av-stack">
                            {p.user?.avatar_url
                              ?<img src={p.user.avatar_url} style={{width:22,height:22,borderRadius:"var(--av-radius)",objectFit:"cover",border:`1px solid ${col}33`,flexShrink:0}} alt={p.user.username}/>
                              :<div className="pav" style={{background:col}}>{(p.user?.username||"?").slice(0,2).toUpperCase()}</div>}
                            {p.reply_count>0&&<div className="pav pav-more">+{Math.min(p.reply_count,9)}</div>}
                          </div>
                          <span className="part-label">{p.reply_count} {p.reply_count===1?"reply":"replies"}</span>
                        </div>
                      </div>
                      <div className="thread-meta">
                        <div className="meta-block">
                          <div className="meta-n" style={{color:col}}>{p.reaction_count||0}</div>
                          <div className="meta-l">hearts</div>
                        </div>
                        <div className="meta-div"/>
                        <div className="thread-last">
                          {p.user?.avatar_url
                              ?<img src={p.user.avatar_url} style={{width:24,height:24,borderRadius:"var(--av-radius)",objectFit:"cover",border:`1px solid ${col}33`}} alt={p.user.username}/>
                              :<div className="last-av" style={{background:col}}>{(p.user?.username||"?").slice(0,2).toUpperCase()}</div>}
                          <div className="last-ago">{ago(p.last_reply_at||p.inserted_at)}</div>
                        </div>
                      </div>
                    </div>
                    {/* 3-dot menu — visible on hover, author or mod only */}
                    {currentUser&&(currentUser.id===p.user?.id||(currentUser.role==="admin"||currentUser.role==="moderator"))&&(
                      <div className="feed-post-menu" style={{position:"absolute",top:10,right:12,zIndex:10}}
                        onClick={e=>e.stopPropagation()}>
                        <button
                          style={{width:26,height:26,borderRadius:"50%",background:openPostMenu===p.id?"var(--s3)":"transparent",border:`0.5px solid ${openPostMenu===p.id?"var(--b2)":"transparent"}`,color:"var(--t4)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,opacity:hoveredPost===p.id||openPostMenu===p.id?1:0,transition:"opacity .15s"}}
                          onClick={e=>{e.stopPropagation();setOpenPostMenu(v=>v===p.id?null:p.id);}}>
                          <i className="fa-solid fa-ellipsis"/>
                        </button>
                        {openPostMenu===p.id&&(
                          <div style={{position:"absolute",top:30,right:0,background:"var(--s3)",border:"0.5px solid var(--b2)",borderRadius:10,padding:"4px 0",minWidth:148,boxShadow:"0 4px 20px rgba(0,0,0,.4)",zIndex:20}}>
                            {currentUser.id!==p.user?.id&&(
                              <button onClick={e=>{e.stopPropagation();setOpenPostMenu(null);
                                // Report modal lives in PostPage — navigate there with report intent
                                navigate("post",{id:p.id,openReport:true});}}
                                style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--t3)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                                onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                                onMouseLeave={e=>e.currentTarget.style.background="none"}>
                                <i className="fa-solid fa-flag" style={{fontSize:11,color:"var(--t4)",width:14}}/>Report
                              </button>
                            )}
                        {(currentUser.role==="admin"||currentUser.role==="moderator")&&(
                              <button onClick={async e=>{e.stopPropagation();setOpenPostMenu(null);await api.post(`/posts/${p.id}/hide`,{});setPosts(ps=>ps.filter(x=>x.id!==p.id));toast("Post hidden");}}
                                style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                                onMouseEnter={e=>e.currentTarget.style.background="rgba(248,113,113,0.06)"}
                                onMouseLeave={e=>e.currentTarget.style.background="none"}>
                                <i className="fa-solid fa-eye-slash" style={{fontSize:11,width:14}}/>Hide post
                              </button>
                            )}
                            {(currentUser.id===p.user?.id||(currentUser.role==="admin"||currentUser.role==="moderator"))&&(
                              <button onClick={async e=>{e.stopPropagation();setOpenPostMenu(null);if(!confirm(`Delete "${p.title}"?`))return;await api.delete(`/posts/${p.id}`);setPosts(ps=>ps.filter(x=>x.id!==p.id));toast("Post deleted");}}
                                style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                                onMouseEnter={e=>e.currentTarget.style.background="rgba(248,113,113,0.06)"}
                                onMouseLeave={e=>e.currentTarget.style.background="none"}>
                                <i className="fa-solid fa-trash" style={{fontSize:11,width:14}}/>Delete post
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            {hasMore&&<div style={{textAlign:"center",padding:16}}><button className="btn-ghost" onClick={()=>load(false,cursor)} disabled={loading}>Load more</button></div>}
          </div>
      </div>
    </div>
  );
}

// ── Post view ─────────────────────────────────────────────────────────────────
function PostScrubber({replies, lastReadReplyId, postId, currentUser, onSavePosition}) {
  var trackRef = useRef(null);
  var saveTimer = useRef(null);
  var isDragging = useRef(false);
  var maxReadIdx = useRef(lastReadReplyId
    ? replies.findIndex(function(r){return r.id===lastReadReplyId;})
    : -1);

  // scrollPct: 0-100, reflects exact scroll position fluid and continuous
  var [scrollPct, setScrollPct] = useState(0);
  // readPct: high-water mark of how far the user has actually read
  var [readPct, setReadPct] = useState(function(){
    var idx = maxReadIdx.current;
    return idx >= 0 && replies.length > 1 ? (idx/(replies.length-1))*100 : 0;
  });

  function getContainer() {
    return document.querySelector('.post-content-wrap');
  }

  function pctFromScroll(container) {
    var max = container.scrollHeight - container.clientHeight;
    if(max <= 0) return 100;
    return Math.min(100, (container.scrollTop / max) * 100);
  }

  function replyIdxFromPct(pct) {
    return Math.round((pct/100) * (replies.length-1));
  }

  function jumpToIndex(ri) {
    ri = Math.max(0, Math.min(ri, replies.length-1));
    var reply = replies[ri];
    if(!reply) return;
    var container = getContainer();
    var el = document.getElementById('reply-'+reply.id);
    if(!el || !container) return;
    container.scrollTo({top: el.offsetTop - 20, behavior:'smooth'});
    if(ri > maxReadIdx.current) {
      maxReadIdx.current = ri;
      var pct = replies.length > 1 ? (ri/(replies.length-1))*100 : 100;
      setReadPct(pct);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(function(){
        if(currentUser && reply){
          api.post('/posts/'+postId+'/read-position',{last_reply_id:reply.id,reply_count:ri+1}).catch(function(){});
          if(onSavePosition) onSavePosition(reply.id, ri+1);
        }
      }, 500);
    }
  }

  useEffect(function(){
    var container = getContainer();
    if(!container || !replies.length) return;
    // Set initial scroll position
    setScrollPct(pctFromScroll(container));

    function onScroll() {
      var pct = pctFromScroll(container);
      setScrollPct(pct);

      // Advance read high-water mark
      var ri = replyIdxFromPct(pct);
      if(ri > maxReadIdx.current) {
        maxReadIdx.current = ri;
        var rPct = replies.length > 1 ? (ri/(replies.length-1))*100 : 100;
        setReadPct(rPct);
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(function(){
          var r = replies[ri];
          if(currentUser && r){
            api.post('/posts/'+postId+'/read-position',{last_reply_id:r.id,reply_count:ri+1}).catch(function(){});
            if(onSavePosition) onSavePosition(r.id, ri+1);
          }
        }, 1500);
      }
    }
    container.addEventListener('scroll', onScroll, {passive:true});
    return function(){ container.removeEventListener('scroll', onScroll); clearTimeout(saveTimer.current); };
  }, [replies.length, postId]);

  function onTrackClick(e) {
    if(isDragging.current || !trackRef.current) return;
    var rect = trackRef.current.getBoundingClientRect();
    var pct = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    var ri = replyIdxFromPct(pct);
    jumpToIndex(ri);
  }

  function onThumbMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    function onMove(me) {
      if(!trackRef.current) return;
      var rect = trackRef.current.getBoundingClientRect();
      var pct = Math.max(0, Math.min(100, ((me.clientY - rect.top) / rect.height) * 100));
      setScrollPct(pct);
      var ri = replyIdxFromPct(pct);
      var reply = replies[ri];
      if(!reply) return;
      var container = getContainer();
      var el = document.getElementById('reply-'+reply.id);
      if(el && container) container.scrollTop = el.offsetTop - 20;
    }
    function onUp() {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  var displayIdx = replyIdxFromPct(scrollPct);

  return (
    <div style={{width:44,flexShrink:0,borderLeft:"0.5px solid var(--b1)",display:"flex",flexDirection:"column",alignItems:"center",padding:"16px 0",gap:4,background:"var(--s1)",userSelect:"none"}}>
      <div style={{fontSize:10,color:"var(--t5)",marginBottom:2}}>{replies.length}</div>
      <div style={{fontSize:9,color:"var(--t5)",marginBottom:8}}>replies</div>
      {/* Full-width hit area — track is visual only, this div captures all clicks/drags */}
      <div ref={trackRef}
        onClick={onTrackClick}
        onMouseDown={onThumbMouseDown}
        style={{flex:1,width:"100%",position:"relative",cursor:"grab",margin:"4px 0",display:"flex",alignItems:"center",justifyContent:"center"}}>
        {/* Track background */}
        <div style={{position:"absolute",top:0,bottom:0,left:"50%",transform:"translateX(-50%)",width:4,background:"rgba(255,255,255,0.08)",borderRadius:2,pointerEvents:"none"}}/>
        {/* Read high-water fill */}
        <div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:4,borderRadius:2,background:"rgba(167,139,250,0.25)",height:readPct+"%",pointerEvents:"none"}}/>
        {/* Scroll position fill */}
        <div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:4,borderRadius:2,background:"var(--ac)",height:scrollPct+"%",pointerEvents:"none"}}/>
        {/* Pip per reply */}
        {replies.map(function(r,i){
          var topPct = replies.length > 1 ? (i/(replies.length-1))*100 : 50;
          return React.createElement('div',{key:r.id,title:"Reply "+(i+1),style:{
            position:"absolute",left:"50%",transform:"translateX(-50%)",
            top:topPct+"%",marginTop:-1,
            width:6,height:2,borderRadius:1,
            background:i <= displayIdx ? "rgba(167,139,250,0.6)" : "rgba(255,255,255,0.12)",
            pointerEvents:"none"
          }});
        })}
        {/* Thumb */}
        <div style={{
          position:"absolute",left:"50%",transform:"translate(-50%,-50%)",
          top:scrollPct+"%",width:14,height:14,borderRadius:"50%",
          background:"var(--ac)",border:"2px solid var(--s1)",
          zIndex:3,pointerEvents:"none"
        }}/>
      </div>
      <div style={{fontSize:10,color:"var(--t4)",marginTop:4}}>{displayIdx+1}/{replies.length}</div>
    </div>
  );
}

function PostPage({postId, currentUser, navigate, spaces, onAuthRequired, joinTopic, leaveTopic, sendEvent, openReport, scrollToReply}) {
  const [post,setPost]=useState(null); const [replies,setReplies]=useState([]);
  const [loading,setLoading]=useState(true); const [replyBody,setReplyBody]=useState("");
  const [submitting,setSubmitting]=useState(false);
  const [userReaction,setUserReaction]=useState(null);
  const [reportTarget,setReportTarget]=useState(null);
  const [reportReason,setReportReason]=useState("");
  const [reportNotes,setReportNotes]=useState("");
  const [reporting,setReporting]=useState(false);
  const [quoteTooltip,setQuoteTooltip]=useState(null);
  const [typingUsers,setTypingUsers]=useState([]);
  const [lastReadReplyId, setLastReadReplyId] = useState(null);
  const [lastReadCount, setLastReadCount] = useState(0);
  const repliesContainerRef = useRef(null);
  const [mobSheetOpen, setMobSheetOpen] = useState(false);
  const [mobReplyOpen, setMobReplyOpen] = useState(false); // usernames currently typing
  const composerRef = useRef();
  const replyBodyRef = useRef(replyBody);
  const typingTimers = useRef({});
  useEffect(()=>{ replyBodyRef.current = replyBody; },[replyBody]);

  // Join post channel for realtime replies + typing
  useEffect(()=>{
    if(!postId) return;
    joinTopic?.(`post:${postId}`);
    return ()=>{ leaveTopic?.(`post:${postId}`); };
  },[postId]);

  // Listen for realtime events
  useEffect(()=>{
    const replyFn = e => {
      if(String(e.detail.postId)===String(postId) && e.detail.reply) {
        setReplies(p=>p.some(r=>r.id===e.detail.reply.id)?p:[...p,e.detail.reply]);
        setPost(p=>p?{...p,reply_count:(p.reply_count||0)+1}:p);
      }
    };
    const typingFn = e => {
      if(e.detail.channel===`post:${postId}` && e.detail.userId!==currentUser?.id) {
        const uid = String(e.detail.userId);
        if(e.detail.started === true) {
          setTypingUsers(p=>p.includes(uid)?p:[...p,uid]);
        } else {
          setTypingUsers(p=>p.filter(u=>u!==uid));
        }
      }
    };
    window.addEventListener("nexus:new_reply", replyFn);
    window.addEventListener("nexus:typing", typingFn);
    return ()=>{ window.removeEventListener("nexus:new_reply", replyFn); window.removeEventListener("nexus:typing", typingFn); };
  },[postId,currentUser]);

  useEffect(()=>{
    (async()=>{ setLoading(true);
      try { const [pd,rd,rp]=await Promise.all([
          api.get(`/posts/${postId}`),
          api.get(`/posts/${postId}/replies`),
          currentUser?api.get(`/posts/${postId}/read-position`):Promise.resolve({})
        ]);
        setPost(pd.post); setReplies(rd.replies||[]);
        setUserReaction(pd.post?.user_reaction||null);
        if(rp.last_reply_id){setLastReadReplyId(rp.last_reply_id);setLastReadCount(rp.reply_count||0);}
      }
      finally { setLoading(false); }
    })();
  },[postId]);

  useEffect(()=>{
    if(!replies.length) return;
    if(scrollToReply){
      // From notification — go directly to that specific reply
      setTimeout(()=>{
        const el = document.getElementById(`reply-${scrollToReply}`);
        if(el) el.scrollIntoView({behavior:"smooth",block:"start"});
      },150);
    } else if(lastReadReplyId){
      // Returning to post — find the NEXT unread reply after last read position
      const lastReadIdx = replies.findIndex(r=>r.id===lastReadReplyId);
      const nextUnreadIdx = lastReadIdx >= 0 ? lastReadIdx + 1 : 0;
      const targetReply = replies[nextUnreadIdx] || replies[replies.length - 1];
      if(targetReply){
        setTimeout(()=>{
          const el = document.getElementById(`reply-${targetReply.id}`);
          if(el) el.scrollIntoView({behavior:"smooth",block:"start"});
        },150);
      }
    }
  },[replies.length, scrollToReply, lastReadReplyId]);

  const submitReply=async()=>{
    if(!replyBody.trim())return; setSubmitting(true);
    sendEvent?.(`post:${postId}`,"typing_stop",{});
    try { const d=await api.post(`/posts/${postId}/replies`,{body:replyBody});
      if(d.reply&&d.pending){setReplyBody("");toast("Your reply is pending moderator approval");}
      else if(d.reply){
        // Add optimistically but dedup against WS event which will also arrive
        setReplies(p=>p.some(r=>r.id===d.reply.id)?p:[...p,d.reply]);
        setReplyBody("");
        setPost(p=>({...p,reply_count:(p.reply_count||0)+1}));
      }
      else toast(d.error||"Failed","err"); }
    finally { setSubmitting(false); }
  };
  const submitReport=async()=>{
    if(!reportReason.trim())return; setReporting(true);
    try {
      const reasonMap = {"Spam":"spam","Harassment":"harassment","Misinformation":"misinformation","Off topic":"off_topic","Other":"other"};
      const reasonValue = reasonMap[reportReason] || "other";
      const payload = reportTarget.type==="post"
        ? {post_id:reportTarget.id, reason:reasonValue, notes:reportNotes||undefined}
        : {reply_id:reportTarget.id, reason:reasonValue, notes:reportNotes||undefined};
      const d = await api.post("/reports", payload);
      if(d.ok){setReportTarget(null); setReportReason(""); setReportNotes(""); toast("Report submitted");}
      else toast((d.errors&&JSON.stringify(d.errors))||d.error||"Failed to submit report","err");
    } finally { setReporting(false); }
  };

  // ── Quote on selection ────────────────────────────────────────────────────
  useEffect(()=>{
    const onMouseUp = ()=>{
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        setQuoteTooltip(null); return;
      }
      // Only show tooltip if selection is inside .md-body
      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const mdBody = container.nodeType===1
        ? container.closest?.(".md-body")
        : container.parentElement?.closest?.(".md-body");
      if (!mdBody) { setQuoteTooltip(null); return; }

      const rect = range.getBoundingClientRect();
      // If selection is near the top of the viewport, show tooltip below instead
      const above = rect.top > 60;
      setQuoteTooltip({
        x: rect.left + rect.width/2,
        y: above ? rect.top : rect.bottom,
        below: !above,
        text: sel.toString().trim()
      });
    };
    const onMouseDown = e=>{
      // Hide tooltip unless clicking it
      if (!e.target.closest(".quote-tooltip")) setQuoteTooltip(null);
    };
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mousedown", onMouseDown);
    return ()=>{
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousedown", onMouseDown);
    };
  },[]);

  const insertQuote = (text)=>{
    const lines = text.split("\n").map(l=>"> "+l).join("\n");
    const quote = lines + "\n\n";
    setReplyBody(prev => prev ? prev + "\n" + quote : quote);
    setQuoteTooltip(null);
    window.getSelection()?.removeAllRanges();
    // Scroll to and focus composer
    setTimeout(()=>{
      composerRef.current?.scrollIntoView({behavior:"smooth", block:"center"});
      composerRef.current?.querySelector("textarea")?.focus();
    }, 50);
  };
  const modAction=async(action)=>{
    await api.post(`/posts/${post.id}/${action}`,{});
    setPost(p=>({...p, [action]:!p[action]}));
    toast(action.charAt(0).toUpperCase()+action.slice(1)+"d");
  };


  const isMod = currentUser?.role==="admin"||currentUser?.role==="moderator";
  const [showPostMenu, setShowPostMenu] = useState(false);
  // Auto-open report modal if navigated here with openReport flag
  useEffect(()=>{
    if(openReport&&post) { setReportTarget({type:"post",id:post.id}); setReportReason(""); }
  },[openReport, post]);
  const [postMenuOpen, setPostMenuOpen] = useState(false);
  const [openReplyMenu, setOpenReplyMenu] = useState(null);
  const [editingPost, setEditingPost] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const col = spaceColor(post?.space||{id:postId});

  if(loading) return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)"}}>Loading...</div>;
  if(!post) return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)"}}>Post not found.</div>;

  return (
    <div className="post-shell">
      {/* Report modal */}
      {reportTarget&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:20}} onClick={e=>e.target===e.currentTarget&&setReportTarget(null)}>
          <div style={{background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:12,padding:24,width:"100%",maxWidth:400}}>
            <div style={{fontSize:15,fontWeight:600,color:"var(--t1)",marginBottom:4}}>Report content</div>
            <div style={{fontSize:12,color:"var(--t4)",marginBottom:14}}>Select a reason — this will be sent to moderators for review.</div>
            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12}}>
              {["Spam","Harassment","Misinformation","Off topic","Other"].map(r=>(
                <div key={r} onClick={()=>setReportReason(r)} style={{padding:"8px 12px",borderRadius:8,cursor:"pointer",fontSize:13,
                  background:reportReason===r?"var(--ac-bg)":"rgba(255,255,255,0.04)",
                  border:`0.5px solid ${reportReason===r?"var(--ac-border)":"rgba(255,255,255,0.08)"}`,
                  color:reportReason===r?"var(--ac-text)":"var(--t2)",
                  display:"flex",alignItems:"center",gap:8}}>
                  <i className={`fa-solid ${reportReason===r?"fa-circle-dot":"fa-circle"}`} style={{fontSize:11,color:reportReason===r?"var(--ac)":"var(--t5)"}}/>
                  {r}
                </div>
              ))}
            </div>
            <textarea className="fi" style={{resize:"vertical",minHeight:60,borderRadius:8,fontSize:12}} placeholder="Add more detail (optional)…" value={reportNotes} onChange={e=>setReportNotes(e.target.value)}/>
            <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}>
              <button className="btn-ghost" onClick={()=>setReportTarget(null)}>Cancel</button>
              <button className="btn-primary" onClick={submitReport} disabled={reporting||!reportReason.trim()}>{reporting?"Submitting…":"Submit report"}</button>
            </div>
          </div>
        </div>
      )}
      <div className="post-content-wrap" ref={repliesContainerRef}>
          {replies.length>0&&<MobileScrubberBar replies={replies} scrollPct={0} displayIdx={0} onClick={()=>setMobSheetOpen(true)}/>}
          <MobileScrubberSheet open={mobSheetOpen} onClose={()=>setMobSheetOpen(false)} replies={replies} scrollPct={0} displayIdx={0} onJump={(ri)=>{var r=replies[ri];if(!r)return;var el=document.getElementById("reply-"+r.id);var c=repliesContainerRef.current;if(el&&c){c.scrollTo({top:el.offsetTop-20,behavior:"smooth"});setMobSheetOpen(false);}}}/>
        <div className="post-back" onClick={()=>navigate("feed")}><i className="fa-solid fa-arrow-left"></i> back to feed</div>
        <div style={{display:"flex",alignItems:"flex-start",gap:14,marginBottom:16}}>
          <div style={{width:4,alignSelf:"stretch",background:col,borderRadius:2,flexShrink:0,minHeight:60}}/>
          <RsAv user={post.user} size={56} color={col}/>
          <div style={{flex:1}}>
            <div className="post-title">{post.title}</div>
            <div className="post-meta">
              {post.space&&<div className="thread-tag" style={{background:`${col}20`,color:col}}>{post.space.name}</div>}
              {post.type&&post.type!=="discussion"&&<div className="thread-tag" style={{background:post.type==="announcement"?"rgba(251,191,36,0.15)":"rgba(96,165,250,0.15)",color:post.type==="announcement"?"var(--amber)":"var(--blue)"}}>{post.type}</div>}
              {post.tags?.map(t=><div key={t.id} className="thread-tag" style={{background:"rgba(255,255,255,0.05)",color:"var(--t3)"}}>{t.name}</div>)}
              <span style={{fontSize:12,color:"var(--t4)",cursor:"pointer"}} onClick={()=>navigate("profile",{username:post.user?.username})}>{post.user?.username}</span>
              <span style={{fontSize:11,color:"var(--t5)"}}>{ago(post.inserted_at)}</span>

            </div>
            {editingPost
              ?<div style={{marginTop:12}}>
                <input className="fi" value={editTitle} onChange={e=>setEditTitle(e.target.value)}
                  style={{fontWeight:600,fontSize:17,marginBottom:10}} placeholder="Title"/>
                <textarea className="fi" value={editBody} onChange={e=>setEditBody(e.target.value)}
                  style={{minHeight:140,resize:"vertical",lineHeight:1.7,fontFamily:"inherit",fontSize:13}}
                  placeholder="Post body…"/>
                <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8}}>
                  <button className="btn-ghost" onClick={()=>setEditingPost(false)} style={{fontSize:12}}>Cancel</button>
                  <button className="btn-primary" style={{fontSize:12,padding:"6px 18px"}} disabled={editSaving||!editTitle.trim()||!editBody.trim()}
                    onClick={async()=>{
                      setEditSaving(true);
                      const d = await api.patch(`/posts/${post.id}`,{title:editTitle.trim(),body:editBody.trim()});
                      setEditSaving(false);
                      if(d.post){setPost(p=>({...p,title:d.post.title,body:d.post.body}));setEditingPost(false);toast("Post updated");}
                      else toast(d.error||"Failed","err");
                    }}>
                    {editSaving?"Saving…":"Save changes"}
                  </button>
                </div>
              </div>
              :<div className="post-body"><Md text={post.body}/></div>}
            <div className="reaction-row" style={{justifyContent:"flex-end",position:"relative"}} onMouseEnter={()=>setShowPostMenu(true)} onMouseLeave={()=>setShowPostMenu(false)}>
              <ReactionButton postId={post.id} initialReactions={post.reactions||[]} initialUserReaction={userReaction} currentUser={currentUser} onAuthRequired={onAuthRequired}/>
              {currentUser&&(currentUser.id===post.user?.id||isMod||currentUser.id!==post.user?.id)&&(
                <div style={{position:"relative"}}>
                  <button
                    style={{width:30,height:30,borderRadius:"50%",background:"transparent",border:"0.5px solid var(--b1)",color:"var(--t4)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",opacity:showPostMenu?1:0,transition:"opacity .15s",fontSize:14}}
                    onClick={e=>{e.stopPropagation();setPostMenuOpen(p=>!p);}}>
                    <i className="fa-solid fa-ellipsis"/>
                  </button>
                  {postMenuOpen&&<div style={{position:"absolute",bottom:36,right:0,background:"var(--s3)",border:"0.5px solid var(--b2)",borderRadius:10,padding:"4px 0",minWidth:140,zIndex:200,boxShadow:"0 4px 20px rgba(0,0,0,.4)"}}
                    onMouseLeave={()=>{setPostMenuOpen(false);setShowPostMenu(false);}}>
                    {/* Report */}
                    {currentUser.id!==post.user?.id&&<button onClick={()=>{setPostMenuOpen(false);setReportTarget({type:"post",id:post.id});setReportReason("");}} style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--t3)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                      onMouseLeave={e=>e.currentTarget.style.background="none"}>
                      <i className="fa-solid fa-flag" style={{fontSize:11,color:"var(--t4)",width:14}}/>Report
                    </button>}
                    {/* Mod actions */}
                    {isMod&&<>
                      <button onClick={()=>{setPostMenuOpen(false);modAction("pin");}} style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:post.pinned?"var(--ac-text)":"var(--t3)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                        onMouseLeave={e=>e.currentTarget.style.background="none"}>
                        <i className={`fa-solid ${post.pinned?"fa-thumbtack fa-rotate-90":"fa-thumbtack"}`} style={{fontSize:11,color:"var(--t4)",width:14}}/>{post.pinned?"Unpin":"Pin"}
                      </button>
                      <button onClick={()=>{setPostMenuOpen(false);modAction("lock");}} style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:post.locked?"var(--amber)":"var(--t3)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                        onMouseLeave={e=>e.currentTarget.style.background="none"}>
                        <i className={`fa-solid ${post.locked?"fa-lock-open":"fa-lock"}`} style={{fontSize:11,color:"var(--t4)",width:14}}/>{post.locked?"Unlock":"Lock"}
                      </button>
                      <button onClick={()=>{setPostMenuOpen(false);modAction("hide");}} style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(248,113,113,0.06)"}
                        onMouseLeave={e=>e.currentTarget.style.background="none"}>
                        <i className={`fa-solid ${post.hidden?"fa-eye":"fa-eye-slash"}`} style={{fontSize:11,color:"var(--red)",width:14}}/>{post.hidden?"Unhide":"Hide"}
                      </button>
                    </>}
                    {/* Edit — author only */}
                    {currentUser.id===post.user?.id&&<button onClick={()=>{setPostMenuOpen(false);setEditTitle(post.title||"");setEditBody(post.body||"");setEditingPost(true);}} style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--t3)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                      onMouseLeave={e=>e.currentTarget.style.background="none"}>
                      <i className="fa-solid fa-pen" style={{fontSize:11,color:"var(--t4)",width:14}}/>Edit post
                    </button>}
                    {/* Delete */}
                    {(currentUser.id===post.user?.id||isMod)&&<>
                      <div style={{height:"0.5px",background:"var(--b1)",margin:"4px 0"}}/>
                      <button onClick={async()=>{setPostMenuOpen(false);if(!confirm("Delete this post?"))return;await api.delete(`/posts/${post.id}`);navigate("feed");toast("Post deleted");}} style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(248,113,113,0.06)"}
                        onMouseLeave={e=>e.currentTarget.style.background="none"}>
                        <i className="fa-solid fa-trash" style={{fontSize:11,color:"var(--red)",width:14}}/>Delete post
                      </button>
                    </>}
                  </div>}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="replies-header">
          <span className="replies-count">{post.reply_count} {post.reply_count===1?"reply":"replies"}</span>
          <span style={{marginLeft:"auto",fontSize:11,color:"var(--t5)"}}>oldest first</span>
        </div>
        {replies.map(r=>(
          <div key={r.id} id={`reply-${r.id}`} className="reply-item">
            {r.user?.avatar_url
              ?<img src={r.user.avatar_url} className="reply-av" style={{objectFit:"cover",borderRadius:"var(--av-radius)",cursor:"pointer"}} alt={r.user.username} onClick={e=>{e.stopPropagation();openUserCard(r.user.username,e.currentTarget);}}/>
              :<div className="reply-av" style={{background:`${spaceColor({id:r.user?.id})}33`,color:spaceColor({id:r.user?.id})}}>{(r.user?.username||"?").slice(0,2).toUpperCase()}</div>}
            <div className="reply-body-wrap">
              <div className="reply-meta">
                <span className="reply-author" style={{cursor:"pointer"}} onClick={()=>navigate("profile",{username:r.user?.username})}>{r.user?.username}</span>
                <span className="reply-time">{ago(r.inserted_at)}</span>
                {currentUser&&!post.locked&&<span className="reply-quote-btn" onClick={()=>insertQuote(r.body.trim())}><i className="fa-solid fa-quote-left" style={{fontSize:9}}></i>quote</span>}
                {currentUser&&(currentUser.id!==r.user?.id||currentUser.id===r.user?.id||isMod)&&(
                  <div style={{position:"relative",marginLeft:"auto"}} onClick={e=>e.stopPropagation()}>
                    <button
                      style={{width:24,height:24,borderRadius:"50%",background:"transparent",border:"0.5px solid transparent",color:"var(--t5)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,opacity:0,transition:"opacity .15s"}}
                      className="reply-menu-btn"
                      onClick={e=>{e.stopPropagation();setOpenReplyMenu(v=>v===r.id?null:r.id);}}>
                      <i className="fa-solid fa-ellipsis"/>
                    </button>
                    {openReplyMenu===r.id&&(
                      <div style={{position:"absolute",top:28,right:0,background:"var(--s3)",border:"0.5px solid var(--b2)",borderRadius:10,padding:"4px 0",minWidth:140,zIndex:200,boxShadow:"0 4px 20px rgba(0,0,0,.4)"}}
                        onMouseLeave={()=>setOpenReplyMenu(null)}>
                        {currentUser.id!==r.user?.id&&<button onClick={()=>{setOpenReplyMenu(null);setReportTarget({type:"reply",id:r.id});setReportReason("");}}
                          style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--t3)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                          onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                          onMouseLeave={e=>e.currentTarget.style.background="none"}>
                          <i className="fa-solid fa-flag" style={{fontSize:11,color:"var(--t4)",width:14}}/>Report
                        </button>}
                        {(currentUser.id===r.user?.id||isMod)&&<>
                          {currentUser.id===r.user?.id&&<button onClick={()=>{setOpenReplyMenu(null);/* edit reply future */}}
                            style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--t3)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
                            onMouseLeave={e=>e.currentTarget.style.background="none"}>
                            <i className="fa-solid fa-pen" style={{fontSize:11,color:"var(--t4)",width:14}}/>Edit reply
                          </button>}
                          <div style={{height:"0.5px",background:"var(--b1)",margin:"4px 0"}}/>
                          <button onClick={async()=>{setOpenReplyMenu(null);if(!confirm("Delete this reply?"))return;await api.delete(`/posts/${postId}/replies/${r.id}`);setReplies(p=>p.filter(x=>x.id!==r.id));setPost(p=>({...p,reply_count:p.reply_count-1}));toast("Reply deleted");}}
                            style={{width:"100%",textAlign:"left",padding:"8px 14px",background:"none",border:"none",color:"var(--red)",cursor:"pointer",fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8}}
                            onMouseEnter={e=>e.currentTarget.style.background="rgba(248,113,113,0.06)"}
                            onMouseLeave={e=>e.currentTarget.style.background="none"}>
                            <i className="fa-solid fa-trash" style={{fontSize:11,color:"var(--red)",width:14}}/>Delete reply
                          </button>
                        </>}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="reply-text"><Md text={r.body}/></div>
              <div className="reaction-row" style={{marginTop:6,justifyContent:"flex-end"}}>
                <ReactionButton replyId={r.id} initialReactions={r.reactions||[]} initialUserReaction={r.user_reaction||null} currentUser={currentUser} onAuthRequired={onAuthRequired}/>
              </div>
            </div>
          </div>
        ))}
        {quoteTooltip&&(
          <div className="quote-tooltip"
            style={{
              left: quoteTooltip.x,
              top: quoteTooltip.below ? quoteTooltip.y+8 : quoteTooltip.y-8,
              transform: quoteTooltip.below ? "translate(-50%,0)" : "translate(-50%,-100%)"
            }}
            onMouseDown={e=>{e.preventDefault();insertQuote(quoteTooltip.text);}}>
            <i className="fa-solid fa-quote-left" style={{fontSize:10}}></i> Quote
          </div>
        )}
        {currentUser&&!post.locked&&(<>
          {typingUsers.length>0&&<div style={{padding:"4px 0 6px",fontSize:12,color:"var(--t5)",display:"flex",alignItems:"center",gap:6}}>
            <span style={{display:"flex",gap:3}}>{[0,1,2].map(i=><span key={i} style={{width:4,height:4,borderRadius:"50%",background:"var(--t4)",display:"inline-block",animation:`bounce .9s ${i*0.15}s infinite`}}/>)}</span>
            {typingUsers.length===1?"Someone is":"Multiple people are"} typing…
          </div>}
          <div style={{marginTop:20,paddingBottom:32}} ref={composerRef}>
            <div className="reply-box">
              <RichTextArea value={replyBody} onChange={v=>{const wasT=replyBodyRef.current.length>0;const isT=v.length>0;setReplyBody(v);if(isT&&!wasT)sendEvent?.(`post:${postId}`,"typing_start",{});else if(!isT&&wasT)sendEvent?.(`post:${postId}`,"typing_stop",{});}} placeholder="Write a reply…" minHeight={120} currentUser={currentUser}/>
              <div className="reply-box-foot">
                <button className="btn-primary" style={{marginLeft:"auto",fontSize:13,padding:"7px 20px"}} onClick={submitReply} disabled={submitting||!replyBody.trim()}>{submitting?"…":"Reply"}</button>
              </div>
            </div>
          </div>
        </>)}
      </div>
      <div className="desk-scrubber">{replies.length>0&&currentUser&&<PostScrubber
        replies={replies}
        lastReadReplyId={lastReadReplyId}
        postId={postId}
        currentUser={currentUser}
        onSavePosition={(replyId,count)=>{setLastReadReplyId(replyId);setLastReadCount(count);}}
      />}</div>
      {currentUser&&!post?.locked&&<div className="mob-reply-bar" style={{bottom:"calc(54px + env(safe-area-inset-bottom))"}}>
        {!mobReplyOpen
          ? <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 14px"}}>
              <div className="mob-reply-fake" onClick={()=>setMobReplyOpen(true)}>Write a reply…</div>
              <button className="btn-primary" style={{fontSize:12,padding:"7px 16px",flexShrink:0}} onClick={()=>setMobReplyOpen(true)}>Reply</button>
            </div>
          : <div>
              <RichTextArea value={replyBody} onChange={v=>{const wasT=replyBodyRef.current.length>0;const isT=v.length>0;setReplyBody(v);if(isT&&!wasT)sendEvent?.(`post:${postId}`,"typing_start",{});else if(!isT&&wasT)sendEvent?.(`post:${postId}`,"typing_stop",{});}} placeholder="Write a reply…" minHeight={100} currentUser={currentUser} autoFocus={true}/>
              <div style={{display:"flex",justifyContent:"flex-end",gap:8,padding:"6px 12px",borderTop:"0.5px solid var(--b1)"}}>
                <button className="btn-ghost" style={{fontSize:12}} onClick={()=>{setMobReplyOpen(false);setReplyBody("");}}>Cancel</button>
                <button className="btn-primary" style={{fontSize:12,padding:"6px 16px"}} disabled={submitting||!replyBody.trim()} onClick={async()=>{await submitReply();setMobReplyOpen(false);}}>Reply</button>
              </div>
            </div>}
      </div>}
    </div>
  );
}

// ── Composer ──────────────────────────────────────────────────────────────────
function ComposePage({spaces, tags, navigate, currentUser}) {
  const [title,setTitle]=useState(""); const [body,setBody]=useState("");
  const [spaceId,setSpaceId]=useState(spaces[0]?.id||"");
  const [postType,setPostType]=useState("discussion");
  const [selTags,setSelTags]=useState([]); const [showTags,setShowTags]=useState(false);
  const [loading,setLoading]=useState(false);
  const tagPickerRef=useRef();
  const toggleTag=id=>setSelTags(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);

  // Close tag picker when clicking outside
  useEffect(()=>{
    const fn=e=>{if(tagPickerRef.current&&!tagPickerRef.current.contains(e.target))setShowTags(false);};
    document.addEventListener("mousedown",fn); return ()=>document.removeEventListener("mousedown",fn);
  },[]);

  const submit=async()=>{
    if(!title.trim()){toast("Title required","err");return;}
    if(!spaceId){toast("Select a space","err");return;}
    setLoading(true);
    try { const d=await api.post("/posts",{title,body,type:postType,space_id:parseInt(spaceId),tag_ids:selTags});
      if(d.post&&d.pending){toast("Your post is pending moderator approval","ok");navigate("feed");}
      else if(d.post){toast("Post published!");navigate("post",{id:d.post.id});}
      else toast(d.error||"Failed","err"); }
    finally { setLoading(false); }
  };
  return (
    <div className="composer-shell">
      <div style={{height:48,borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"center",padding:"0 28px",flexShrink:0}}>
        <span style={{fontSize:12,color:"var(--t4)",cursor:"pointer",display:"flex",alignItems:"center",gap:6}} onClick={()=>navigate("feed")}>
          <i className="fa-solid fa-arrow-left"></i> back to feed
        </span>
      </div>
      <div className="composer-inner">
        <input className="comp-title-input" placeholder="Thread title…" value={title} onChange={e=>setTitle(e.target.value)} autoFocus/>
        <div className="comp-meta-row">
          <select className="comp-sel" value={spaceId} onChange={e=>setSpaceId(e.target.value)}>
            <option value="">Select space…</option>
            {spaces.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="comp-sel" value={postType} onChange={e=>setPostType(e.target.value)}>
            <option value="discussion">Discussion</option>
            <option value="question">Question</option>
            <option value="announcement">Announcement</option>
          </select>
          {selTags.map(id=>{const t=tags.find(x=>x.id===id);return t?<span key={id} className="comp-tag-pill" onClick={()=>toggleTag(id)}>#{t.name} ✕</span>:null;})}
          <div ref={tagPickerRef} style={{position:"relative"}}>
            <div className="comp-tag-add" onClick={()=>setShowTags(p=>!p)}>+ tag</div>
            {showTags&&tags.length>0&&<div style={{position:"absolute",top:"100%",left:0,background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:10,padding:8,zIndex:30,minWidth:160,marginTop:4}}>
              {tags.map(t=><div key={t.id} onClick={()=>toggleTag(t.id)} style={{padding:"6px 10px",fontSize:12,cursor:"pointer",color:selTags.includes(t.id)?"var(--ac-text)":"var(--t3)",borderRadius:6,display:"flex",alignItems:"center",gap:8}}>
                {selTags.includes(t.id)&&<i className="fa-solid fa-check" style={{fontSize:10,color:"var(--ac)"}}></i>}
                #{t.name}
              </div>)}
            </div>}
          </div>
        </div>
        <div className="comp-body-area">
          <RichTextArea value={body} onChange={setBody} placeholder="What's on your mind…" minHeight={240} autoFocus={false} currentUser={currentUser}/>
        </div>
        <div className="comp-footer">
          <span className="comp-char">{body.length} characters</span>
          <button className="btn-primary" style={{marginLeft:"auto"}} onClick={submit} disabled={loading||!title.trim()}>{loading?"Publishing…":"Publish"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Search ────────────────────────────────────────────────────────────────────
function SearchPage({navigate, tags, initialQ=""}) {
  const [q,setQ]=useState(initialQ); const [results,setResults]=useState(null); const [loading,setLoading]=useState(false);
  const debounceRef=useRef();
  const search=useCallback(async(val)=>{
    if(!val.trim()){setResults(null);return;}
    setLoading(true);
    try{const d=await api.get(`/search?q=${encodeURIComponent(val)}`);setResults(d);}
    finally{setLoading(false);}
  },[]);
  const onChange=e=>{
    const val=e.target.value; setQ(val);
    clearTimeout(debounceRef.current);
    if(!val.trim()){setResults(null);return;}
    debounceRef.current=setTimeout(()=>search(val),300);
  };
  useEffect(()=>{if(initialQ)search(initialQ);},[]);
  const hasResults = results && ((results.posts?.length||0) + (results.replies?.length||0)) > 0;
  return (
    <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
      <div style={{height:48,borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"center",padding:"0 24px",flexShrink:0}}>
        <span style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>Search</span>
      </div>
      <div className="search-wrap">
        <div className="search-bar">
          <i className="fa-solid fa-magnifying-glass" style={{fontSize:14,color:loading?"var(--ac)":"rgba(255,255,255,0.25)",transition:"color .2s",flexShrink:0}}></i>
          <input className="fi" style={{flex:1,border:"none",background:"transparent",paddingLeft:0}} placeholder="Search threads and replies…" value={q} onChange={onChange} autoFocus/>
          {loading&&<span style={{fontSize:12,color:"var(--t5)",flexShrink:0}}>searching…</span>}
        </div>
        {loading&&<div style={{textAlign:"center",color:"var(--t5)",padding:"40px 0"}}>Searching…</div>}
        {results&&!hasResults&&<div style={{textAlign:"center",color:"var(--t5)",padding:"40px 0"}}>No results for "{q}"</div>}
        {hasResults&&<>
          {results.posts?.length>0&&<>
            <div style={{fontSize:10,fontWeight:500,color:"var(--t5)",letterSpacing:".07em",textTransform:"uppercase",padding:"14px 0 8px"}}>Threads</div>
            {results.posts.map(p=>{
              const col=spaceColor(p.space||{id:p.id});
              return (
                <div key={p.id} className="thread" onClick={()=>navigate("post",{id:p.id})}>
                  <div className="thread-main">
                    <div className="thread-accent" style={{background:col}}/>
                    <RsAv user={p.user} size={34} color={col}/>
                    <div className="thread-body">
                      <div className="thread-top">
                        <div className="thread-title">{p.title}</div>
                        {p.space&&<div className="thread-tag" style={{background:`${col}20`,color:col}}>{p.space.name}</div>}
                      </div>
                      <div className="participants-row"><span className="part-label">{p.user?.username} · {ago(p.inserted_at)}</span></div>
                    </div>
                  </div>
                </div>
              );
            })}
          </>}
          {results.replies?.length>0&&<>
            <div style={{fontSize:10,fontWeight:500,color:"var(--t5)",letterSpacing:".07em",textTransform:"uppercase",padding:"14px 0 8px"}}>Replies</div>
            {results.replies.map(r=>{
              const col=spaceColor({id:r.post_id});
              return (
                <div key={r.id} className="thread" onClick={()=>navigate("post",{id:r.post_id})}>
                  <div className="thread-main">
                    <div className="thread-accent" style={{background:col}}/>
                    <RsAv user={r.user} size={34} color={col}/>
                    <div className="thread-body">
                      <div className="thread-top">
                        <div className="thread-title" style={{fontSize:13,fontWeight:400}}>{r.body?.replace(/!?\[[[^\]]*\]\([^)]*\)/g,"").replace(/[#*`>]/g,"").slice(0,120)}</div>
                        {r.post&&<div className="thread-tag" style={{background:"rgba(255,255,255,0.05)",color:"var(--t3)"}}>in: {r.post.title?.slice(0,30)}</div>}
                      </div>
                      <div className="participants-row"><span className="part-label">{r.user?.username} · {ago(r.inserted_at)}</span></div>
                    </div>
                  </div>
                </div>
              );
            })}
          </>}
        </>}
      </div>
    </div>
  );
}

// ── Notifications ─────────────────────────────────────────────────────────────
function NotificationsPage({navigate}) {
  const [notifs,setNotifs]=useState([]); const [loading,setLoading]=useState(true);
  useEffect(()=>{api.get("/notifications").then(d=>{setNotifs(d.notifications||[]);setLoading(false);});},[]);
  const markAll=async()=>{await api.post("/notifications/read-all",{});setNotifs(p=>p.map(n=>({...n,read:true})));toast("All marked as read");};
  const deleteAll=async()=>{if(!confirm("Delete all notifications?"))return;await api.delete("/notifications");setNotifs([]);toast("Notifications cleared");};
  const deleteOne=async(e,id)=>{e.stopPropagation();await api.delete(`/notifications/${id}`);setNotifs(p=>p.filter(n=>n.id!==id));};
  const markRead=async n=>{
    if(!n.read){await api.patch(`/notifications/${n.id}/read`,{});setNotifs(p=>p.map(x=>x.id===n.id?{...x,read:true}:x));}
    if(n.type==="dm"&&n.data?.thread_id) navigate("dm",{threadId:n.data.thread_id,threadName:n.actor?.username||"DM"});
    else if(n.post_id) navigate("post",{id:n.post_id, scrollToReply:n.reply_id||null});
    else if(n.reply_id) api.get(`/posts/by-reply/${n.reply_id}`).then(d=>{ if(d.post_id) navigate("post",{id:d.post_id, scrollToReply:n.reply_id}); }).catch(()=>{});
  };
  const TYPE={reply:"replied to your post",mention:"mentioned you",reaction:"reacted to your post",dm:"sent you a message",announcement:"posted an announcement"};
  const ICON={reply:"fa-reply",mention:"fa-at",reaction:"fa-heart",dm:"fa-message",announcement:"fa-bullhorn"};
  const ICON_COLOR={reply:"var(--ac)",mention:"var(--blue)",reaction:"var(--red)",dm:"var(--green)",announcement:"var(--amber)"};
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{height:48,display:"flex",alignItems:"center",padding:"0 24px",gap:10,flexShrink:0,borderBottom:"0.5px solid var(--b1)"}}>
        <button className="mob-icon-btn" onClick={()=>window.history.back()} style={{marginRight:4}}><i className="fa-solid fa-arrow-left"/></button>
        <span style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>Notifications</span>
        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
          {notifs.some(n=>!n.read)&&<button className="btn-ghost" style={{fontSize:11}} onClick={markAll}>Mark all read</button>}
          {notifs.length>0&&<button className="btn-ghost" style={{fontSize:11,color:"var(--red)"}} onClick={deleteAll}>Clear all</button>}
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",width:"100%"}}>
        {loading?<div style={{padding:"40px",textAlign:"center",color:"var(--t5)"}}>Loading…</div>
          :notifs.length===0?<div style={{padding:"60px",textAlign:"center",color:"var(--t5)"}}>No notifications yet</div>
          :notifs.map(n=>(
            <div key={n.id} className={`notif-item ${n.read?"":"unread"}`} onClick={()=>markRead(n)} style={{position:"relative"}}>
              <div className="notif-pip" style={{background:n.read?"transparent":"var(--ac)"}}/>
              <div style={{width:32,height:32,borderRadius:"50%",background:`${ICON_COLOR[n.type]||"var(--ac)"}18`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <i className={`fa-solid ${ICON[n.type]||"fa-bell"}`} style={{fontSize:12,color:ICON_COLOR[n.type]||"var(--ac)"}}></i>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:13}}><strong style={{color:"var(--t1)"}}>{n.actor?.username||"Someone"}</strong> <span style={{color:"var(--t3)"}}>{TYPE[n.type]||n.type}</span></div>
                <div style={{fontSize:12,color:"var(--t5)",marginTop:3}}>{ago(n.inserted_at)}</div>
              </div>
              <div onClick={e=>deleteOne(e,n.id)} title="Delete"
                style={{opacity:0,transition:"opacity .15s",fontSize:12,color:"var(--t5)",cursor:"pointer",padding:"4px 8px",borderRadius:6,flexShrink:0}}
                onMouseEnter={e=>{e.currentTarget.style.opacity=1;e.currentTarget.style.color="var(--red)";}}
                onMouseLeave={e=>{e.currentTarget.style.opacity=0;}}>
                <i className="fa-solid fa-xmark"/>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

// ── Profile ───────────────────────────────────────────────────────────────────
function ProfilePage({username, currentUser, navigate}) {
  const [posts,setPosts]=useState([]);
  const [replies,setReplies]=useState([]);
  const [user,setUser]=useState(null);
  const [loading,setLoading]=useState(true);
  const [tab,setTab]=useState("posts");
  const [uploadingAvatar,setUploadingAvatar]=useState(false);
  const [uploadingCover,setUploadingCover]=useState(false);
  const [coverExpanded,setCoverExpanded]=useState(false);
  const isOwn = currentUser?.username === username;

  useEffect(()=>{
    (async()=>{
      setLoading(true);
      try {
        const [userData, feedData] = await Promise.all([
          api.get(`/users/${username}`),
          api.get(`/feed?sort=latest&user=${encodeURIComponent(username)}`)
        ]);
        setUser(userData.user || {username});
        setPosts(feedData.posts || []);
      } catch { setUser({username}); }
      finally { setLoading(false); }
    })();
  },[username]);

  const col = spaceColor({id:user?.id||0});

  const handleAvatarUpload = async (file) => {
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("type", "avatar");
      const token = localStorage.getItem("nexus_token");
      const r = await fetch("/api/v1/uploads", {method:"POST", headers:{Authorization:`Bearer ${token}`}, body:fd});
      const d = await r.json();
      if (d.upload) { setUser(p=>({...p, avatar_url: d.url})); toast("Avatar updated"); }
      else toast(d.error||"Upload failed", "err");
    } finally { setUploadingAvatar(false); }
  };

  const handleCoverUpload = async (file) => {
    if (!file) return;
    setUploadingCover(true);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("type", "cover_image");
      const token = localStorage.getItem("nexus_token");
      const r = await fetch("/api/v1/uploads", {method:"POST", headers:{Authorization:`Bearer ${token}`}, body:fd});
      const d = await r.json();
      if (d.upload) { setUser(p=>({...p, cover_url: d.url})); toast("Cover updated"); }
      else toast(d.error||"Upload failed", "err");
    } finally { setUploadingCover(false); }
  };

  const startDM = async () => {
    const d = await api.post("/threads/direct", {username});
    if(d.thread) navigate("dm", {threadId:d.thread.id, threadName:username});
    else toast(d.error||"Could not start conversation","err");
  };

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{flex:1,overflowY:"auto"}}>
        {/* Cover */}
        <div className={`profile-cover${coverExpanded?" expanded":""}`}>
          {user?.cover_url
            ?<img src={user.cover_url} style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover"}} alt="cover"/>
            :<svg viewBox="0 0 680 160" preserveAspectRatio="xMidYMid slice" style={{position:"absolute",inset:0,width:"100%",height:"100%"}}>
              <rect width="680" height="160" fill="#13121e"/>
              {[0,40,80,120,160].map(y=><line key={y} x1="0" y1={y} x2="680" y2={y+160} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5"/>)}
              {[0,80,160,240,320,400,480,560].map(x=><line key={x} x1={x} y1="0" x2={x+160} y2="160" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5"/>)}
              <circle cx="120" cy="60" r="60" fill="none" stroke={`${col}30`} strokeWidth="0.5"/>
              <circle cx="480" cy="100" r="80" fill="none" stroke={`${col}20`} strokeWidth="0.5"/>
            </svg>}
          <div className="profile-cover-gradient"/>
          {isOwn&&<label className="profile-cover-edit" style={{opacity:uploadingCover?.5:1}}>
            <input type="file" accept="image/jpeg,image/png,image/webp" style={{display:"none"}} onChange={e=>handleCoverUpload(e.target.files[0])}/>
            {uploadingCover
              ?<><i className="fa-solid fa-spinner fa-spin" style={{marginRight:5}}></i>Uploading…</>
              :<><i className="fa-solid fa-camera" style={{marginRight:5}}></i>Edit cover</>}
          </label>}
          {user?.cover_url&&<div className="profile-cover-expand" onClick={()=>setCoverExpanded(p=>!p)}>
            <i className={`fa-solid fa-${coverExpanded?"compress":"expand"}`} style={{fontSize:10}}></i>
            {coverExpanded?"Collapse":"Expand"}
          </div>}
        </div>

        <div className="profile-info-wrap">
          <div className="profile-av-row">
            {/* Avatar */}
            <div style={{position:"relative",display:"inline-block"}}>
              {user?.avatar_url
                ?<img src={user.avatar_url} style={{width:96,height:96,borderRadius:"var(--av-radius)",objectFit:"cover",border:"2px solid var(--bg)",display:"block"}} alt={username}/>
                :<div className="profile-av-ring">{(username||"?").slice(0,2).toUpperCase()}</div>}
              {isOwn&&<label style={{position:"absolute",inset:0,borderRadius:"var(--av-radius)",background:"rgba(0,0,0,0)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",transition:"background .15s"}}
                onMouseEnter={e=>e.currentTarget.style.background="rgba(0,0,0,.45)"}
                onMouseLeave={e=>e.currentTarget.style.background="rgba(0,0,0,0)"}>
                <input type="file" accept="image/jpeg,image/png,image/webp" style={{display:"none"}} onChange={e=>handleAvatarUpload(e.target.files[0])}/>
                {uploadingAvatar
                  ?<i className="fa-solid fa-spinner fa-spin" style={{color:"#fff",fontSize:16}}></i>
                  :<i className="fa-solid fa-camera" style={{color:"#fff",fontSize:16,opacity:0,transition:"opacity .15s"}} ref={el=>{if(el){el.closest("label").onmouseenter=()=>el.style.opacity=1;el.closest("label").onmouseleave=()=>el.style.opacity=0;}}}></i>}
              </label>}
            </div>
            {!isOwn&&<div style={{display:"flex",gap:8,marginBottom:4}}>
              <button className="btn-ghost" style={{fontSize:12,padding:"6px 14px"}} onClick={startDM}>Message</button>
            </div>}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
            <div className="profile-name">{username}</div>
            {user?.role&&user.role!=="member"&&<div className="thread-tag" style={{background:`${col}20`,color:col}}>{user.role}</div>}
          </div>
          <div className="profile-handle">@{username?.toLowerCase()} · joined {fmtDate(user?.inserted_at)}</div>
          {user?.bio&&<div style={{fontSize:13,color:"var(--t3)",lineHeight:1.6,margin:"8px 0 2px",maxWidth:480}}>{user.bio}</div>}
          <div className="profile-stats">
            <div className="p-stat"><div className="p-stat-n">{posts.length}</div><div className="p-stat-l">Posts</div></div>
            <div className="p-stat"><div className="p-stat-n">{posts.reduce((s,p)=>s+(p.reaction_count||0),0)}</div><div className="p-stat-l">Reactions</div></div>
            <div className="p-stat"><div className="p-stat-n">{posts.reduce((s,p)=>s+(p.reply_count||0),0)}</div><div className="p-stat-l">Replies</div></div>
          </div>
        </div>
        <div className="profile-tabs">
          {["posts"].map(t=><div key={t} className={`p-tab ${tab===t?"active":""}`} onClick={()=>setTab(t)}>{t}</div>)}
        </div>
        <div style={{padding:"0 28px"}}>
          {loading?<div style={{padding:"40px",textAlign:"center",color:"var(--t5)"}}>Loading…</div>
            :posts.length===0?<div style={{padding:"40px",textAlign:"center",color:"var(--t5)"}}>No posts yet</div>
            :posts.map(p=>{
              const pc=spaceColor(p.space||{id:p.id});
              return (
                <div key={p.id} className="thread" onClick={()=>navigate("post",{id:p.id})}>
                  <div className="thread-main">
                    <div className="thread-accent" style={{background:pc}}/>
                    <RsAv user={p.user} size={34} color={pc}/>
                    <div className="thread-body">
                      <div className="thread-top"><div className="thread-title">{p.title}</div>{p.space&&<div className="thread-tag" style={{background:`${pc}20`,color:pc}}>{p.space.name}</div>}</div>
                      {p.body&&<div className="thread-preview">{p.body.replace(/!\[.*?\]\(.*?\)/g,"").replace(/\[!\[.*?\]\(.*?\)\]\(.*?\)/g,"").replace(/\[[^\]]*\]\([^)]*\)/g,"").replace(/[#*`>]/g,"").trim().slice(0,120)}</div>}
                      <div className="participants-row"><span className="part-label">{p.reply_count} replies · {ago(p.inserted_at)}</span></div>
                    </div>
                    <div className="thread-meta">
                      <div className="meta-block"><div className="meta-n" style={{color:pc}}>{p.reaction_count||0}</div><div className="meta-l">hearts</div></div>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

// ── Messages ──────────────────────────────────────────────────────────────────
function DMInboxPage({currentUser, navigate, onOpen}) {
  const [threads,setThreads]=useState([]); const [loading,setLoading]=useState(true);
  const [readIds,setReadIds]=useState(new Set());
  const [dmSearch,setDmSearch]=useState("");
  useEffect(()=>{
    onOpen?.();
    setLoading(true);
    api.get("/threads").then(d=>{setThreads(d.threads||[]);setLoading(false);});
  },[]);
  const tname=t=>{ if(t.kind==="group") return t.name||"Group"; const o=t.members?.find(m=>m.user_id!==currentUser?.id); return o?.user?.username||"Unknown"; };
  const openThread=t=>{
    setReadIds(p=>new Set([...p,t.id]));
    api.post(`/threads/${t.id}/read`,{}).catch(()=>{});
    navigate("dm",{threadId:t.id,threadName:tname(t),threadImage:t.kind==="group"?t.image_url:null});
  };
  const filtered = dmSearch ? threads.filter(t=>tname(t).toLowerCase().includes(dmSearch.toLowerCase())) : threads;
  const unread=filtered.filter(t=>t.unread_count>0&&!readIds.has(t.id));
  const read=filtered.filter(t=>!t.unread_count||t.unread_count===0||readIds.has(t.id));
  const ThreadRow=({t})=>(
    <div className="thread-row" onClick={()=>openThread(t)}>
      {t.kind==="group"&&t.image_url
        ?<div className="thr-av" style={{backgroundImage:`url(${t.image_url})`,backgroundSize:"cover",backgroundPosition:"center"}}></div>
        :<div className="thr-av" style={{background:spaceColor({id:t.id})+"33",color:spaceColor({id:t.id})}}>{tname(t).slice(0,2).toUpperCase()}</div>
      }
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:2}}>
          <div className="thr-name" style={{fontWeight:t.unread_count&&!readIds.has(t.id)?500:400}}>{tname(t)}</div>
          <div style={{fontSize:11,color:"var(--t5)",whiteSpace:"nowrap",marginLeft:8}}>{ago(t.last_message_at||t.inserted_at)}</div>
        </div>
        <div className="thr-preview">{t.last_message||"Start a conversation…"}</div>
      </div>
      {t.unread_count>0&&!readIds.has(t.id)&&<div className="thr-unread">{t.unread_count}</div>}
    </div>
  );
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{height:48,borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"center",padding:"0 24px",flexShrink:0}}>
        <button className="mob-icon-btn" onClick={()=>window.history.back()} style={{marginRight:4}}><i className="fa-solid fa-arrow-left"/></button>
        <span style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>Messages</span>
        <button className="btn-ghost" style={{marginLeft:"auto",fontSize:12,padding:"5px 14px"}} onClick={()=>navigate("dm-new")}>+ New</button>
      </div>
      <div className="dm-shell">
        <div className="dm-sidebar">
          <div className="dm-search">
            <div className="dm-search-inner">
              <i className="fa-solid fa-magnifying-glass" style={{fontSize:11,color:"rgba(255,255,255,0.2)"}}></i>
              <input placeholder="Search messages…" value={dmSearch} onChange={e=>setDmSearch(e.target.value)}/>
            </div>
          </div>
          <div style={{flex:1,overflowY:"auto"}}>
            {loading?<div style={{padding:"20px",textAlign:"center",color:"var(--t5)"}}>Loading…</div>
              :threads.length===0?<div style={{padding:"40px 20px",textAlign:"center",color:"var(--t5)"}}>No messages yet</div>
              :<>
                {unread.length>0&&<><div style={{padding:"8px 14px 4px",fontSize:10,color:"var(--t5)",letterSpacing:".06em",textTransform:"uppercase"}}>Unread</div>{unread.map(t=><ThreadRow key={t.id} t={t}/>)}</>}
                {read.length>0&&<><div style={{padding:"8px 14px 4px",fontSize:10,color:"var(--t5)",letterSpacing:".06em",textTransform:"uppercase",marginTop:unread.length?6:0}}>{unread.length>0?"Earlier":"All"}</div>{read.map(t=><ThreadRow key={t.id} t={t}/>)}</>}
              </>}
          </div>
        </div>

      </div>
    </div>
  );
}

function DMPage({threadId, threadName, threadImage, currentUser, navigate, joinTopic, leaveTopic, sendEvent}) {
  const [messages,setMessages]=useState([]); const [text,setText]=useState(""); const [sending,setSending]=useState(false); const [uploading,setUploading]=useState(false); const [typing,setTyping]=useState(false); const endRef=useRef(); const imgRef=useRef(); const typingRef=useRef();
  const [resolvedName,setResolvedName]=useState(threadName||"");
  const [resolvedImage,setResolvedImage]=useState(threadImage||null);
  const [thread,setThread]=useState(null);
  const [showSettings,setShowSettings]=useState(false);
  useEffect(()=>{
    wasTypingRef.current = false;
    api.get(`/threads/${threadId}/messages`).then(d=>{setMessages(d.messages||[]);setTimeout(()=>endRef.current?.scrollIntoView(),50)});
    api.post(`/threads/${threadId}/read`,{}).catch(()=>{});
    // Fetch thread metadata to get name and image_url (covers refresh case where props are missing)
    api.get(`/threads/${threadId}`).then(d=>{
      if(d.thread){
        const t=d.thread;
        const name = t.kind==="group" ? (t.name||"Group") : (t.members?.find(m=>m.user_id!==currentUser?.id)?.user?.username||threadName||"");
        setResolvedName(name);
        if(t.image_url) setResolvedImage(t.image_url);
        setThread(t);
      }
    }).catch(()=>{});
    joinTopic?.(`dm:${threadId}`);
    return ()=>{
      // Send typing_stop when leaving a thread so the indicator clears for the other user
      if (wasTypingRef.current) sendEvent?.(`dm:${threadId}`, "typing_stop", {});
      wasTypingRef.current = false;
      leaveTopic?.(`dm:${threadId}`);
    };
  },[threadId]);

  useEffect(()=>{
    const fn = e => {
      if(String(e.detail.threadId)===String(threadId) && e.detail.message) {
        const msg = e.detail.message;
        setMessages(p=>{
          // Deduplicate by id (compare as strings to handle int/string mismatch)
          if(p.some(m=>String(m.id)===String(msg.id))) return p;
          return [...p, msg];
        });
        setTimeout(()=>endRef.current?.scrollIntoView(),50);
      }
    };
    const typingFn = e => {
      if(e.detail.channel===`dm:${threadId}` && e.detail.userId!==currentUser?.id) {
        setTyping(e.detail.started === true);
      }
    };
    window.addEventListener("nexus:dm_message", fn);
    window.addEventListener("nexus:typing", typingFn);
    return ()=>{ window.removeEventListener("nexus:dm_message", fn); window.removeEventListener("nexus:typing", typingFn); };
  },[threadId,currentUser]);

  const wasTypingRef = useRef(false);
  const onTextChange = e => {
    const val = e.target.value;
    setText(val);
    if (val.length > 0 && !wasTypingRef.current) {
      wasTypingRef.current = true;
      sendEvent?.(`dm:${threadId}`, "typing_start", {});
    } else if (val.length === 0 && wasTypingRef.current) {
      wasTypingRef.current = false;
      sendEvent?.(`dm:${threadId}`, "typing_stop", {});
    }
  };
  const send=async e=>{e.preventDefault();if(!text.trim())return;setSending(true);const body=text;setText("");wasTypingRef.current=false;sendEvent?.(`dm:${threadId}`,"typing_stop",{});try{await api.post(`/threads/${threadId}/messages`,{body});setTimeout(()=>endRef.current?.scrollIntoView(),50);}catch{setText(body);}finally{setSending(false);}};
  const sendImage=async file=>{
    if(!file)return;
    setUploading(true);
    try{
      const fd=new FormData(); fd.append("file",file); fd.append("type","post_image");
      const token=localStorage.getItem("nexus_token");
      const r=await fetch("/api/v1/uploads",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:fd});
      const up=await r.json();
      if(up.url){
        const body=`[![image](${up.url})](${up.original_url||up.url})`;
        await api.post(`/threads/${threadId}/messages`,{body});
        setTimeout(()=>endRef.current?.scrollIntoView(),50);
      } else toast(up.error||"Upload failed","err");
    }catch{toast("Upload failed","err");}
    finally{setUploading(false);if(imgRef.current)imgRef.current.value="";}
  };
  return (
    <>
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{height:48,borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"center",padding:"0 24px",gap:10,flexShrink:0}}>
        <span style={{fontSize:12,color:"var(--t4)",cursor:"pointer"}} onClick={()=>navigate("messages")}>← Messages</span>
        {resolvedImage&&<div style={{width:28,height:28,borderRadius:"50%",backgroundImage:`url(${resolvedImage})`,backgroundSize:"cover",backgroundPosition:"center",flexShrink:0}}/>}
        <span style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>{resolvedName}</span>
        {thread?.kind==="group"&&(thread?.creator_id===currentUser?.id||!thread?.creator_id)&&(
          <button onClick={()=>setShowSettings(true)} style={{marginLeft:"auto",width:30,height:30,borderRadius:"50%",background:"transparent",border:"none",cursor:"pointer",color:"var(--t4)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}} title="Group settings">
            <i className="fa-solid fa-gear" style={{fontSize:14}}/>
          </button>
        )}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px",display:"flex",flexDirection:"column",gap:2}}>
        {messages.map((m,i)=>{
          const mine=m.user?.id===currentUser?.id;
          const prev=messages[i-1];
          const prevDay=prev?new Date(prev.inserted_at):null;
          const thisDay=m.inserted_at?new Date(m.inserted_at):null;
          const showDaySep=!prev||(thisDay&&prevDay&&(thisDay.getFullYear()!==prevDay.getFullYear()||thisDay.getMonth()!==prevDay.getMonth()||thisDay.getDate()!==prevDay.getDate()));
          return (
            <React.Fragment key={m.id}>
              {showDaySep&&<div style={{display:"flex",alignItems:"center",gap:10,margin:"12px 0 8px"}}>
                <div style={{flex:1,height:"0.5px",background:"var(--b1)"}}></div>
                <div style={{fontSize:11,color:"var(--t5)",fontWeight:500,whiteSpace:"nowrap"}}>{fmtDaySep(m.inserted_at)}</div>
                <div style={{flex:1,height:"0.5px",background:"var(--b1)"}}></div>
              </div>}
              <div className={mine?"mine":"theirs"} style={{display:"flex",flexDirection:"column",gap:2,marginBottom:4,alignItems:mine?"flex-end":"flex-start"}}>
                <div style={{display:"flex",alignItems:"flex-end",gap:6,flexDirection:mine?"row-reverse":"row",maxWidth:"72vw"}}>
                  <div className="bubble"><Md text={m.body}/></div>
                </div>
                <div style={{fontSize:10,color:"var(--t5)",paddingLeft:mine?0:4,paddingRight:mine?4:0}}>{fmtMsgTime(m.inserted_at)}</div>
              </div>
            </React.Fragment>
          );
        })}
        <div ref={endRef}/>
      </div>
      {typing&&<div className="theirs" style={{display:"flex",flexDirection:"column",gap:2,marginBottom:4,alignItems:"flex-start",padding:"0 20px"}}>
        <div style={{display:"flex",alignItems:"flex-end",gap:6}}>
          <div className="bubble" style={{display:"flex",alignItems:"center",gap:5,padding:"10px 16px",minWidth:56}}>
            {[0,1,2].map(i=><span key={i} style={{width:7,height:7,borderRadius:"50%",background:"var(--t3)",display:"inline-block",animation:`bounce 1.2s ${i*0.2}s infinite`}}/>)}
          </div>
        </div>
      </div>}
      <form onSubmit={send} style={{borderTop:"0.5px solid var(--b1)",padding:"10px 20px",display:"flex",alignItems:"flex-end",gap:8,flexShrink:0}}>
        <input ref={imgRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" style={{display:"none"}} onChange={e=>sendImage(e.target.files[0])}/>
        <button type="button" title="Attach image" onClick={()=>imgRef.current?.click()}
          style={{width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,0.05)",border:"0.5px solid var(--b2)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,color:"var(--t4)"}}>
          {uploading
            ?<i className="fa-solid fa-spinner fa-spin" style={{fontSize:12}}/>
            :<i className="fa-solid fa-image" style={{fontSize:13}}/>}
        </button>
        <div style={{flex:1,background:"rgba(255,255,255,0.04)",border:"0.5px solid var(--b2)",borderRadius:20,padding:"8px 16px"}}>
          <input style={{width:"100%",background:"transparent",border:"none",outline:"none",fontSize:13,color:"var(--t2)",fontFamily:"inherit"}} placeholder={`Message ${resolvedName||"…"}`} value={text} onChange={onTextChange}/>
        </div>
        <button type="submit" style={{width:36,height:36,borderRadius:"50%",background:"var(--ac)",border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}} disabled={!text.trim()||sending}>
          <i className="fa-solid fa-paper-plane" style={{fontSize:12,color:"var(--ac-on)"}}></i>
        </button>
      </form>
    </div>        {showSettings&&thread&&<GroupSettingsModal
      thread={thread}
      currentUser={currentUser}
      onClose={()=>setShowSettings(false)}
      onUpdate={(updates)=>{
        if(updates.name) setResolvedName(updates.name);
        if(updates.image_url) setResolvedImage(updates.image_url);
        setThread(t=>({...t,...updates}));
      }}
    />}
    </>
  );
}

function GroupSettingsModal({thread, currentUser, onClose, onUpdate}) {
  const [name,setName]=useState(thread.name||"");
  const [members,setMembers]=useState(thread.members||[]);
  const [addUsername,setAddUsername]=useState("");
  const [addResults,setAddResults]=useState([]);
  const [searching,setSearching]=useState(false);
  const [saving,setSaving]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [previewImage,setPreviewImage]=useState(thread.image_url||null);
  const [imageFile,setImageFile]=useState(null);
  const imgRef=useRef();
  const debounceRef=useRef();

  const searchUsers=val=>{
    setAddUsername(val);
    clearTimeout(debounceRef.current);
    if(!val.trim()){setAddResults([]);return;}
    setSearching(true);
    debounceRef.current=setTimeout(async()=>{
      try{
        const d=await api.get(`/users?q=${encodeURIComponent(val)}`);
        const existing=new Set(members.map(m=>m.user_id));
        setAddResults((d.members||[]).filter(u=>!existing.has(u.id)&&u.id!==currentUser?.id));
      }finally{setSearching(false);}
    },200);
  };

  const addMember=async user=>{
    const d=await api.post(`/threads/${thread.id}/members`,{username:user.username});
    if(d.ok){
      setMembers(p=>[...p,{user_id:user.id,user:{id:user.id,username:user.username,avatar_url:user.avatar_url}}]);
      setAddUsername("");setAddResults([]);
    } else toast(d.error||"Failed","err");
  };

  const removeMember=async userId=>{
    const d=await api.delete(`/threads/${thread.id}/members/${userId}`);
    if(d.ok) setMembers(p=>p.filter(m=>m.user_id!==userId));
    else toast(d.error||"Failed","err");
  };

  const save=async()=>{
    setSaving(true);
    try{
      // Update name if changed
      if(name.trim()&&name!==thread.name){
        const d=await api.patch(`/threads/${thread.id}`,{name:name.trim()});
        if(d.thread) onUpdate({name:name.trim()});
        else{toast(d.error||"Failed","err");return;}
      }
      // Upload new image if selected
      if(imageFile){
        setUploading(true);
        const fd=new FormData();
        fd.append("file",imageFile);
        fd.append("type","group_image");
        fd.append("thread_id",String(thread.id));
        const token=localStorage.getItem("nexus_token");
        const upRes=await fetch("/api/v1/uploads",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:fd});
        const upData=await upRes.json();
        setUploading(false);
        if(upData.url) onUpdate({image_url:upData.url});
        else{toast("Image upload failed","err");return;}
      }
      toast("Group updated");
      onClose();
    }finally{setSaving(false);setUploading(false);}
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:400,padding:20}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:16,padding:24,width:"100%",maxWidth:440,display:"flex",flexDirection:"column",gap:16}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{fontSize:15,fontWeight:600,color:"var(--t1)"}}>Group settings</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"var(--t4)",fontSize:18,cursor:"pointer",lineHeight:1}}>✕</button>
        </div>

        {/* Avatar */}
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <input ref={imgRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" style={{display:"none"}}
            onChange={e=>{const f=e.target.files[0];if(f){setImageFile(f);setPreviewImage(URL.createObjectURL(f));}}}/>
          <div onClick={()=>imgRef.current?.click()} style={{width:64,height:64,borderRadius:"50%",flexShrink:0,cursor:"pointer",
            background:previewImage?`url(${previewImage}) center/cover`:"rgba(255,255,255,0.06)",
            border:"1.5px dashed var(--b2)",
            display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
            {!previewImage&&<i className="fa-solid fa-camera" style={{fontSize:18,color:"var(--t5)"}}/>}
          </div>
          <div>
            <div style={{fontSize:13,fontWeight:500,color:"var(--t2)"}}>Group photo</div>
            <div style={{fontSize:11,color:"var(--t5)",marginTop:2}}>Click to change</div>
          </div>
        </div>

        {/* Name */}
        <div>
          <label style={{fontSize:12,color:"var(--t4)",display:"block",marginBottom:6}}>Group name</label>
          <input className="fi" value={name} onChange={e=>setName(e.target.value)} placeholder="Group name…"/>
        </div>

        {/* Members */}
        <div>
          <label style={{fontSize:12,color:"var(--t4)",display:"block",marginBottom:6}}>Members</label>
          <div style={{border:"0.5px solid var(--b1)",borderRadius:10,overflow:"hidden",marginBottom:8}}>
            {members.map((m,i)=>(
              <div key={m.user_id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderBottom:i<members.length-1?"0.5px solid var(--b1)":"none"}}>
                <div style={{width:28,height:28,borderRadius:"50%",background:"var(--ac)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"var(--ac-on)",fontWeight:600,flexShrink:0}}>
                  {(m.user?.username||"?").slice(0,2).toUpperCase()}
                </div>
                <span style={{flex:1,fontSize:13,color:"var(--t2)"}}>{m.user?.username}</span>
                {m.user_id===thread.creator_id
                  ?<span style={{fontSize:10,color:"var(--ac-text)",background:"var(--ac-bg)",border:"0.5px solid var(--ac-border)",borderRadius:20,padding:"2px 8px"}}>owner</span>
                  :<span style={{fontSize:11,color:"var(--red)",cursor:"pointer"}} onClick={()=>removeMember(m.user_id)}>Remove</span>
                }
              </div>
            ))}
          </div>
          {/* Add member search */}
          <div style={{position:"relative"}}>
            <input className="fi" placeholder="Add by username…" value={addUsername} onChange={e=>searchUsers(e.target.value)}
              style={{fontSize:12,padding:"7px 12px"}}/>
            {searching&&<i className="fa-solid fa-spinner fa-spin" style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",color:"var(--t5)",fontSize:11}}/>}
          </div>
          {addResults.length>0&&(
            <div style={{border:"0.5px solid var(--b1)",borderRadius:8,overflow:"hidden",marginTop:4}}>
              {addResults.map((u,i)=>(
                <div key={u.id} onClick={()=>addMember(u)}
                  style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px",cursor:"pointer",
                    borderBottom:i<addResults.length-1?"0.5px solid var(--b1)":"none",
                    background:"transparent"}}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.04)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <div style={{width:24,height:24,borderRadius:"50%",background:"var(--ac)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"var(--ac-on)",fontWeight:600}}>
                    {u.username.slice(0,2).toUpperCase()}
                  </div>
                  <span style={{fontSize:12,color:"var(--t1)"}}>{u.username}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:4}}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{fontSize:13,padding:"7px 20px"}} onClick={save} disabled={saving||uploading||!name.trim()}>
            {saving||uploading?"Saving…":"Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DMNewPage({navigate, currentUser}) {
  const [mode,setMode]=useState("direct");
  const [query,setQuery]=useState("");
  const [results,setResults]=useState([]);
  const [searching,setSearching]=useState(false);
  const [selected,setSelected]=useState([]);
  const [groupName,setGroupName]=useState("");
  const [groupImage,setGroupImage]=useState(null); // {url, file} preview before thread exists
  const [loading,setLoading]=useState(false);
  const groupImgRef=useRef();
  const debounceRef=useRef();

  const search=val=>{
    setQuery(val);
    clearTimeout(debounceRef.current);
    if(!val.trim()){setResults([]);return;}
    setSearching(true);
    debounceRef.current=setTimeout(async()=>{
      try{const d=await api.get(`/users?q=${encodeURIComponent(val)}`);setResults((d.members||[]).filter(u=>u.id!==currentUser?.id));}
      finally{setSearching(false);}
    },200);
  };

  const startDirect=async user=>{
    setLoading(true);
    try{const d=await api.post("/threads/direct",{username:user.username});if(d.thread)navigate("dm",{threadId:d.thread.id,threadName:user.username});else toast(d.error||"Failed","err");}
    finally{setLoading(false);}
  };

  const toggleSelect=user=>setSelected(p=>p.find(u=>u.id===user.id)?p.filter(u=>u.id!==user.id):[...p,user]);

  const startGroup=async()=>{
    if(!groupName.trim()||selected.length===0)return;
    setLoading(true);
    try{
      const d=await api.post("/threads/group",{name:groupName,members:selected.map(u=>u.username)});
      if(!d.thread){toast(d.error||"Failed","err");return;}
      // Upload the group image if one was selected
      let serverImageUrl = null;
      if(groupImage?.file && d.thread?.id){
        const fd=new FormData();
        fd.append("file",groupImage.file);
        fd.append("type","group_image");
        fd.append("thread_id",String(d.thread.id));
        const token=localStorage.getItem("nexus_token");
        const upRes=await fetch("/api/v1/uploads",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:fd});
        const upData=await upRes.json();
        serverImageUrl = upData.url || null;
      }
      navigate("dm",{threadId:d.thread.id,threadName:groupName,threadImage:serverImageUrl||groupImage?.url||null});
    }finally{setLoading(false);}
  };

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column"}}>
      <div style={{height:48,borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"center",padding:"0 24px",gap:12,flexShrink:0}}>
        <span style={{fontSize:12,color:"var(--t4)",cursor:"pointer"}} onClick={()=>navigate("messages")}>← Messages</span>
        <span style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>New message</span>
      </div>
      <div style={{maxWidth:480,width:"100%",margin:"0 auto",padding:"24px 20px",display:"flex",flexDirection:"column",gap:16}}>
        <div style={{display:"flex",background:"rgba(255,255,255,0.04)",border:"0.5px solid var(--b1)",borderRadius:10,padding:3,gap:3}}>
          {["direct","group"].map(m=>(
            <button key={m} onClick={()=>{setMode(m);setQuery("");setResults([]);setSelected([]);}}
              style={{flex:1,padding:"7px 0",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:500,
                background:mode===m?"var(--s2)":"transparent",color:mode===m?"var(--t1)":"var(--t4)",
                boxShadow:mode===m?"0 1px 3px rgba(0,0,0,.3)":"none",transition:"all .15s"}}>
              {m==="direct"?"Direct message":"Group chat"}
            </button>
          ))}
        </div>

        {mode==="group"&&<input className="fi" placeholder="Group name…" value={groupName} onChange={e=>setGroupName(e.target.value)} autoFocus/>}

        {mode==="group"&&(
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <input ref={groupImgRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" style={{display:"none"}}
              onChange={e=>{const f=e.target.files[0];if(f)setGroupImage({file:f,url:URL.createObjectURL(f)});}}/>
            <div onClick={()=>groupImgRef.current?.click()} style={{width:56,height:56,borderRadius:"50%",flexShrink:0,cursor:"pointer",
              background:groupImage?.url?`url(${groupImage.url}) center/cover`:"rgba(255,255,255,0.06)",
              border:"1.5px dashed var(--b2)",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
              {!groupImage?.url&&<i className="fa-solid fa-camera" style={{fontSize:16,color:"var(--t5)"}}/>}
            </div>
            <div>
              <div style={{fontSize:13,color:"var(--t2)",fontWeight:500}}>Group photo</div>
              <div style={{fontSize:11,color:"var(--t5)",marginTop:2}}>{groupImage?.url?"Click to change":"Optional"}</div>
            </div>
            {groupImage?.url&&<span style={{fontSize:11,color:"var(--t4)",cursor:"pointer",marginLeft:"auto"}} onClick={()=>setGroupImage(null)}>Remove</span>}
          </div>
        )}

        <div style={{position:"relative"}}>
          <input className="fi" placeholder={mode==="direct"?"Search by username…":"Add people…"}
            value={query} onChange={e=>search(e.target.value)} autoFocus={mode==="direct"}/>
          {searching&&<i className="fa-solid fa-spinner fa-spin" style={{position:"absolute",right:14,top:"50%",transform:"translateY(-50%)",color:"var(--t5)",fontSize:12}}/>}
        </div>

        {mode==="group"&&selected.length>0&&(
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {selected.map(u=>(
              <div key={u.id} style={{display:"flex",alignItems:"center",gap:6,background:"rgba(167,139,250,0.15)",border:"0.5px solid rgba(167,139,250,0.3)",borderRadius:20,padding:"4px 10px 4px 6px"}}>
                <span style={{fontSize:12,color:"var(--t2)"}}>{u.username}</span>
                <span style={{fontSize:11,color:"var(--t5)",cursor:"pointer"}} onClick={()=>toggleSelect(u)}>✕</span>
              </div>
            ))}
          </div>
        )}

        {results.length>0&&(
          <div style={{border:"0.5px solid var(--b1)",borderRadius:10,overflow:"hidden"}}>
            {results.map((u,i)=>{
              const isSel=!!selected.find(s=>s.id===u.id);
              return (
                <div key={u.id} onClick={()=>mode==="direct"?startDirect(u):toggleSelect(u)}
                  style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",cursor:"pointer",
                    background:isSel?"rgba(167,139,250,0.08)":"transparent",
                    borderBottom:i<results.length-1?"0.5px solid var(--b1)":"none"}}>
                  <div style={{width:32,height:32,borderRadius:"50%",background:"var(--ac)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"var(--ac-on)",fontWeight:600,flexShrink:0}}>
                    {u.username.slice(0,2).toUpperCase()}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:500,color:"var(--t1)"}}>{u.username}</div>
                    {u.role&&u.role!=="member"&&<div style={{fontSize:11,color:"var(--t4)"}}>{u.role}</div>}
                  </div>
                  {mode==="group"&&(
                    <div style={{width:18,height:18,borderRadius:"50%",border:`1.5px solid ${isSel?"var(--ac)":"var(--b2)"}`,background:isSel?"var(--ac)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      {isSel&&<i className="fa-solid fa-check" style={{fontSize:9,color:"var(--ac-on)"}}/>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {results.length===0&&query.length>0&&!searching&&(
          <div style={{textAlign:"center",padding:"24px 0",color:"var(--t5)",fontSize:13}}>No users found</div>
        )}

        {mode==="group"&&(
          <button className="btn-primary" style={{width:"100%",borderRadius:10,padding:10}}
            disabled={loading||selected.length===0||!groupName.trim()} onClick={startGroup}>
            {loading?"…":`Create group with ${selected.length} member${selected.length!==1?"s":""}`}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Admin ─────────────────────────────────────────────────────────────────────
// ── Admin Tags CRUD ───────────────────────────────────────────────────────────
// ── Shared form helpers (defined outside components to prevent re-render focus loss) ──
function F({label, hint, children}) {
  return <div style={{marginBottom:14}}><label className="f-label">{label}</label>{children}{hint&&<div className="f-hint">{hint}</div>}</div>;
}
function Tgl({on, onChange, label, desc}) {
  return (
    <div className="toggle-row">
      <div><div style={{fontSize:15,color:"var(--t2)"}}>{label}</div>{desc&&<div style={{fontSize:13,color:"var(--t5)",marginTop:3}}>{desc}</div>}</div>
      <div className="tgl" style={{background:on?"var(--ac)":"rgba(255,255,255,0.1)"}} onClick={()=>onChange(!on)}>
        <div className="tgl-knob" style={{left:on?23:3,background:on?"#fff":"rgba(255,255,255,0.4)"}}/>
      </div>
    </div>
  );
}

function TagsAdmin({tags, onRefresh}) {
  const [editing,setEditing]=useState(null);
  const [form,setForm]=useState({name:"",slug:"",description:"",color:"#a78bfa"});
  const [saving,setSaving]=useState(false);

  const autoSlug=name=>name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  const openNew=()=>{ setForm({name:"",slug:"",description:"",color:"#a78bfa"}); setEditing("new"); };
  const openEdit=t=>{ setForm({name:t.name,slug:t.slug,description:t.description||"",color:t.color||"#a78bfa"}); setEditing(t); };
  const close=()=>setEditing(null);
  const COLORS=["#a78bfa","#f472b6","#34d399","#60a5fa","#fbbf24","#f87171","#ec4899","#10b981","#8b5cf6","#0ea5e9"];

  const save=async()=>{
    setSaving(true);
    try {
      if(editing==="new"){
        const d=await api.post("/tags",form);
        if(d.tag){toast("Tag created");onRefresh();close();}
        else toast(d.error||"Failed","err");
      } else {
        const d=await api.patch(`/tags/${editing.slug}`,form);
        if(d.tag){toast("Tag updated");onRefresh();close();}
        else toast(d.error||"Failed","err");
      }
    } finally { setSaving(false); }
  };

  const del=async t=>{
    if(!confirm(`Delete tag "#${t.name}"?`))return;
    await api.delete(`/tags/${t.slug}`);
    toast("Tag deleted"); onRefresh();
  };

  return <>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <div className="fgt" style={{margin:0}}>Tags</div>
      <button className="btn-primary" style={{fontSize:12,padding:"5px 14px"}} onClick={openNew}>+ New tag</button>
    </div>
    <div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden",marginBottom:editing?"16px":"0"}}>
      {tags.length===0?<div style={{padding:"16px 14px",color:"var(--t5)",fontSize:13}}>No tags yet</div>
        :<table className="atbl"><thead><tr><th>Name</th><th>Slug</th><th>Posts</th><th></th></tr></thead>
          <tbody>{tags.map(t=>(
            <tr key={t.id}>
              <td><div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:t.color||"var(--ac)",flexShrink:0}}></span>
                <span style={{fontWeight:500,color:"var(--t1)"}}>#{t.name}</span>
              </div></td>
              <td style={{color:"var(--t5)",fontFamily:"monospace",fontSize:11}}>{t.slug}</td>
              <td>{t.post_count||0}</td>
              <td style={{textAlign:"right"}}>
                <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}><button onClick={()=>openEdit(t)} style={{fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20,border:"0.5px solid rgba(96,165,250,0.25)",background:"rgba(96,165,250,0.12)",color:"#60a5fa",cursor:"pointer",fontFamily:"inherit"}}>edit</button><button onClick={()=>del(t)} style={{fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20,border:"0.5px solid rgba(248,113,113,0.25)",background:"rgba(248,113,113,0.12)",color:"#f87171",cursor:"pointer",fontFamily:"inherit"}}>delete</button></div>
              </td>
            </tr>
          ))}</tbody>
        </table>}
    </div>
    {editing&&<div style={{background:"rgba(255,255,255,0.02)",border:"0.5px solid var(--b2)",borderRadius:12,padding:20}}>
      <div style={{fontSize:13,fontWeight:500,color:"var(--t1)",marginBottom:16}}>{editing==="new"?"New tag":"Edit tag"}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
        <div><label className="f-label">Name</label><input className="fi" value={form.name} onChange={e=>{const n=e.target.value;setForm(p=>({...p,name:n,slug:editing==="new"?autoSlug(n):p.slug}));}}/></div>
        <div><label className="f-label">Slug</label><input className="fi" value={form.slug} onChange={e=>setForm(p=>({...p,slug:e.target.value}))} style={{fontFamily:"monospace"}}/></div>
      </div>
      <div style={{marginBottom:12}}><label className="f-label">Description</label><input className="fi" value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} placeholder="Optional description"/></div>
      <div style={{marginBottom:16}}><label className="f-label">Color</label>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:4}}>
          {COLORS.map(c=><div key={c} onClick={()=>setForm(p=>({...p,color:c}))} style={{width:22,height:22,borderRadius:"50%",background:c,cursor:"pointer",border:`2px solid ${form.color===c?"#fff":"transparent"}`,transition:"border-color .1s"}}/>)}
        </div>
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button className="btn-ghost" onClick={close}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving||!form.name.trim()||!form.slug.trim()}>{saving?"Saving…":"Save tag"}</button>
      </div>
    </div>}
  </>;
}

// ── Admin Spaces CRUD ─────────────────────────────────────────────────────────
function SpacesAdmin({spaces, onRefresh, layoutCfg={}, setLayoutCfg}) {
  const [editing,setEditing]=useState(null); // null | "new" | space object
  const [form,setForm]=useState({name:"",slug:"",description:"",color:"#a78bfa",icon:"fa-layer-group",visibility:"public"});
  const [saving,setSaving]=useState(false);

  var savedOrder = layoutCfg.spaces_order || [];
  var orderedForEditor = (function(){
    var ordered = spaces.slice();
    if(savedOrder.length) ordered.sort(function(a,b){var ai=savedOrder.indexOf(a.id);var bi=savedOrder.indexOf(b.id);if(ai===-1)return 1;if(bi===-1)return -1;return ai-bi;});
    return ordered;
  })();
  function saveSpacesOrder(ordered) {
    var next = Object.assign({}, layoutCfg, {spaces_order: ordered.map(function(s){return s.id;})});
    if(setLayoutCfg) setLayoutCfg(next);
    api.patch("/admin/settings/layout", {value: next}).catch(function(){});
  }

  const openNew=()=>{ setForm({name:"",slug:"",description:"",color:"#a78bfa",icon:"fa-layer-group",visibility:"public"}); setEditing("new"); };
  const openEdit=s=>{ setForm({name:s.name,slug:s.slug,description:s.description||"",color:s.color||"#a78bfa",icon:s.icon||"fa-layer-group",visibility:s.visibility}); setEditing(s); };
  const close=()=>setEditing(null);

  const autoSlug=name=>name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");

  const save=async()=>{
    setSaving(true);
    try {
      if(editing==="new") {
        const d=await api.post("/admin/spaces",form);
        if(d.space){toast("Space created");onRefresh();close();}
        else toast(d.errors?Object.values(d.errors).flat().join(", "):d.error||"Failed","err");
      } else {
        // Explicitly build payload to avoid any stale closure issues with form state
        const payload={name:form.name,slug:form.slug,description:form.description||"",color:form.color,icon:form.icon||"fa-layer-group",visibility:form.visibility};
        const d=await api.patch(`/admin/spaces/${editing.slug}`,payload);
        if(d.space){toast("Space updated");onRefresh();close();}
        else toast(d.errors?Object.values(d.errors).flat().join(", "):d.error||"Failed","err");
      }
    } finally { setSaving(false); }
  };

  const del=async(s)=>{
    if(!confirm(`Delete space "${s.name}"? This cannot be undone.`))return;
    await api.delete(`/admin/spaces/${s.slug}`);
    toast("Space deleted"); onRefresh();
  };

  const COLORS=["#a78bfa","#f472b6","#34d399","#60a5fa","#fbbf24","#f87171","#ec4899","#10b981","#8b5cf6","#0ea5e9"];

  return <>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <div className="fgt" style={{margin:0}}>Spaces</div>
      <button className="btn-primary" style={{fontSize:12,padding:"5px 14px"}} onClick={openNew}>+ New space</button>
    </div>
    <div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden",marginBottom:editing?"16px":"0"}}>
      {spaces.length===0?<div style={{padding:"16px 14px",color:"var(--t5)",fontSize:13}}>No spaces yet</div>
        :<table className="atbl"><thead><tr><th>Name</th><th>Slug</th><th>Visibility</th><th>Posts</th><th></th></tr></thead>
          <caption style={{captionSide:"top",textAlign:"left",paddingBottom:8}}>
            <div className="fgt" style={{marginBottom:6}}>Sidebar order</div>
            <div style={{fontSize:12,color:"var(--t4)",marginBottom:10}}>Drag to reorder how spaces appear in the left sidebar.</div>
            <DragList
              items={orderedForEditor}
              onChange={saveSpacesOrder}
              renderItem={function(s){
                var col=s.color||spaceColor(s);
                return React.createElement('div',{style:{display:"flex",alignItems:"center",gap:10,flex:1}},
                  React.createElement('i',{className:"fa-solid "+(s.icon||"fa-layer-group"),style:{fontSize:13,color:col,width:16,textAlign:"center"}}),
                  React.createElement('span',{style:{fontSize:13,color:"var(--t2)",fontWeight:500}},s.name)
                );
              }}
            />
            <div className="fgt" style={{marginTop:20,marginBottom:6}}>All spaces</div>
          </caption>
          <tbody>{spaces.map(s=>(
            <tr key={s.id}>
              <td><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{width:8,height:8,borderRadius:"50%",background:s.color||spaceColor(s),flexShrink:0}}></span><span style={{fontWeight:500,color:"var(--t1)"}}>{s.name}</span></div></td>
              <td style={{color:"var(--t5)",fontFamily:"monospace",fontSize:11}}>{s.slug}</td>
              <td><span style={{fontSize:10,padding:"2px 8px",borderRadius:20,background:"rgba(255,255,255,0.05)",color:"var(--t3)"}}>{s.visibility}</span></td>
              <td>{s.post_count||0}</td>
              <td style={{textAlign:"right"}}>
                <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}><button onClick={()=>openEdit(s)} style={{fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20,border:"0.5px solid rgba(96,165,250,0.25)",background:"rgba(96,165,250,0.12)",color:"#60a5fa",cursor:"pointer",fontFamily:"inherit"}}>edit</button><button onClick={()=>del(s)} style={{fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20,border:"0.5px solid rgba(248,113,113,0.25)",background:"rgba(248,113,113,0.12)",color:"#f87171",cursor:"pointer",fontFamily:"inherit"}}>delete</button></div>
              </td>
            </tr>
          ))}</tbody>
        </table>}
    </div>
    {editing&&<div style={{background:"rgba(255,255,255,0.02)",border:"0.5px solid var(--b2)",borderRadius:12,padding:20}}>
      <div style={{fontSize:13,fontWeight:500,color:"var(--t1)",marginBottom:16}}>{editing==="new"?"New space":"Edit space"}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
        <div><label className="f-label">Name</label><input className="fi" value={form.name} onChange={e=>{const n=e.target.value;setForm(p=>({...p,name:n,slug:editing==="new"?autoSlug(n):p.slug}));}}/></div>
        <div><label className="f-label">Slug</label><input className="fi" value={form.slug} onChange={e=>setForm(p=>({...p,slug:e.target.value}))} style={{fontFamily:"monospace"}}/></div>
      </div>
      <div style={{marginBottom:12}}><label className="f-label">Description</label><input className="fi" value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} placeholder="Optional description"/></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
        <div><label className="f-label">Visibility</label>
          <select className="fi" value={form.visibility} onChange={e=>setForm(p=>({...p,visibility:e.target.value}))}>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </div>
        <div><label className="f-label">Icon <span style={{fontSize:10,color:"var(--t5)"}}>(Font Awesome class)</span></label>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <div style={{width:36,height:36,borderRadius:8,background:"rgba(255,255,255,0.05)",border:"0.5px solid var(--b2)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <i className={`fa-solid ${form.icon||"fa-layer-group"}`} style={{fontSize:15,color:form.color||"#a78bfa"}}></i>
            </div>
            <input className="fi" value={form.icon||""} onChange={e=>setForm(p=>({...p,icon:e.target.value}))} placeholder="fa-layer-group" style={{fontFamily:"monospace",fontSize:12}}/>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
            {["fa-layer-group","fa-code","fa-gamepad","fa-music","fa-film","fa-book","fa-globe","fa-flask","fa-paint-brush","fa-bolt","fa-heart","fa-star","fa-comments","fa-trophy","fa-wrench","fa-rocket","fa-leaf","fa-camera","fa-graduation-cap","fa-briefcase"].map(ic=>(
              <div key={ic} onClick={()=>setForm(p=>({...p,icon:ic}))} title={ic}
                style={{width:28,height:28,borderRadius:6,background:form.icon===ic?"var(--ac-bg)":"rgba(255,255,255,0.04)",border:`1px solid ${form.icon===ic?"var(--ac-border)":"transparent"}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",transition:"all .1s"}}>
                <i className={`fa-solid ${ic}`} style={{fontSize:12,color:form.icon===ic?form.color||"#a78bfa":"var(--t4)"}}></i>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{marginBottom:16}}>
        <label className="f-label">Color</label>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <input type="color" value={form.color||"#a78bfa"} onChange={e=>setForm(p=>({...p,color:e.target.value}))}
            style={{width:40,height:36,borderRadius:8,border:"0.5px solid var(--b2)",background:"none",cursor:"pointer",padding:2}}/>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {COLORS.map(c=><div key={c} onClick={()=>setForm(p=>({...p,color:c}))} style={{width:24,height:24,borderRadius:"50%",background:c,cursor:"pointer",border:`2px solid ${form.color===c?"#fff":"transparent"}`,transition:"border-color .1s"}}/>)}
          </div>
          <input className="fi" value={form.color||""} onChange={e=>setForm(p=>({...p,color:e.target.value}))}
            style={{fontFamily:"monospace",fontSize:12,width:100}} placeholder="#a78bfa"/>
        </div>
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button className="btn-ghost" onClick={close}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving||!form.name.trim()||!form.slug.trim()}>{saving?"Saving…":"Save space"}</button>
      </div>
    </div>}
  </>;
}

function formatUptime(seconds) {
  if (!seconds) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function ColorPicker({value, onChange}) {
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

// ── Email verification page ─────────────────────────────────────────────────
function VerifyEmailPage({token, navigate, onVerified}) {
  const [status, setStatus] = useState("loading");

  useEffect(()=>{
    if (!token) { setStatus("error"); return; }
    api.request("GET", `/auth/verify-email?token=${encodeURIComponent(token)}`, null, false, true)
      .then(d => { if (d.ok) setStatus("ok"); else setStatus("error"); })
      .catch(() => setStatus("error"));
  }, [token]);

  return (
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:40}}>
      <div style={{maxWidth:400,width:"100%",textAlign:"center"}}>
        {status==="loading"&&<>
          <i className="fa-solid fa-spinner fa-spin" style={{fontSize:32,color:"var(--ac)",marginBottom:16,display:"block"}}/>
          <div style={{fontSize:15,color:"var(--t3)"}}>Verifying your email…</div>
        </>}
        {status==="ok"&&<>
          <i className="fa-solid fa-circle-check" style={{fontSize:40,color:"var(--green)",marginBottom:16,display:"block"}}/>
          <div style={{fontSize:18,fontWeight:600,color:"var(--t1)",marginBottom:8}}>Email verified!</div>
          <div style={{fontSize:13,color:"var(--t3)",marginBottom:24}}>Your email has been confirmed. You can now fully participate in the forum.</div>
          <button className="btn-primary" style={{padding:"10px 28px",borderRadius:20}} onClick={()=>{onVerified?.();navigate("feed");}}>Go to forum</button>
        </>}
        {status==="error"&&<>
          <i className="fa-solid fa-circle-xmark" style={{fontSize:40,color:"var(--red)",marginBottom:16,display:"block"}}/>
          <div style={{fontSize:18,fontWeight:600,color:"var(--t1)",marginBottom:8}}>Verification failed</div>
          <div style={{fontSize:13,color:"var(--t3)",marginBottom:24}}>This link may have expired or already been used. Try registering again or contact support.</div>
          <button className="btn-primary" style={{padding:"10px 28px",borderRadius:20}} onClick={()=>navigate("feed")}>Go to forum</button>
        </>}
      </div>
    </div>
  );
}

// ── Shared report card component ─────────────────────────────────────────────
function ReportCard({r, onAction, isAdmin}) {
  const urgent = r.status === "pending" && (r._count || 1) >= 3;
  const resolved = r.status !== "pending";
  const typeColor = {post:"#f87171", reply:"#93c5fd", user:"#fbbf24"}[r.content_type] || "var(--t4)";
  const typeBg = {post:"rgba(248,113,113,0.15)", reply:"rgba(96,165,250,0.12)", user:"rgba(251,191,36,0.12)"}[r.content_type] || "rgba(255,255,255,0.06)";

  return (
    <div style={{background:urgent?"rgba(248,113,113,0.03)":"rgba(255,255,255,0.025)",
      border:`0.5px solid ${urgent?"rgba(248,113,113,0.25)":resolved?"var(--b1)":"rgba(255,255,255,0.07)"}`,
      borderRadius:12,padding:"14px 16px",marginBottom:10,display:"flex",gap:14,
      alignItems:"flex-start",opacity:resolved?0.55:1}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
          {resolved
            ? <span style={{fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:20,background:"rgba(52,211,153,0.1)",color:"#34d399",textTransform:"uppercase",letterSpacing:"0.4px"}}>resolved</span>
            : <span style={{fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:20,background:typeBg,color:typeColor,textTransform:"uppercase",letterSpacing:"0.4px"}}>{r.content_type}</span>
          }
          <span style={{fontSize:13,fontWeight:500,color:"rgba(255,255,255,0.75)"}}>{r.reason}</span>
        </div>
        {r.excerpt&&<div style={{fontSize:13,color:"var(--t3)",lineHeight:1.6,marginBottom:8,fontStyle:"italic",borderLeft:"2px solid rgba(255,255,255,0.1)",paddingLeft:10}}>
          "{r.excerpt.length > 140 ? r.excerpt.slice(0,140)+"…" : r.excerpt}"
        </div>}
        <div style={{display:"flex",alignItems:"center",gap:8,fontSize:11,color:"var(--t5)",flexWrap:"wrap"}}>
          {r.content_user&&<>
            <div style={{width:18,height:18,borderRadius:5,background:"var(--ac)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,fontWeight:500,color:"var(--ac-on)",flexShrink:0}}>
              {(r.content_user.username||"?").slice(0,2).toUpperCase()}
            </div>
            <span>by {r.content_user.username}</span>
            <span>·</span>
          </>}
          {r.space_name&&<><span>in {r.space_name}</span><span>·</span></>}
          <span>reported by {r.reporter?.username}</span>
          <span>·</span>
          <span>{ago(r.inserted_at)}</span>
          {resolved&&r.reviewer&&<><span>·</span><span>resolved by {r.reviewer.username}</span></>}
        </div>
      </div>
      {!resolved&&<div style={{display:"flex",flexDirection:"column",gap:6,flexShrink:0,alignItems:"flex-end"}}>
        <div style={{fontSize:11,color:"var(--t5)",textAlign:"center"}}>
          <span style={{display:"block",fontSize:16,fontWeight:600,color:"rgba(248,113,113,0.8)",lineHeight:1}}>{r._count||1}</span>
          report{(r._count||1)!==1?"s":""}
        </div>
        {r.post_id&&<button onClick={()=>onAction?.("view",r)} style={{fontSize:11,fontWeight:500,padding:"5px 13px",borderRadius:20,cursor:"pointer",background:"rgba(167,139,250,0.15)",color:"#c4b5fd",border:"0.5px solid rgba(167,139,250,0.25)"}}>view post</button>}
        <button onClick={()=>onAction?.("remove",r)} style={{fontSize:11,fontWeight:500,padding:"5px 13px",borderRadius:20,cursor:"pointer",background:"rgba(248,113,113,0.15)",color:"#f87171",border:"0.5px solid rgba(248,113,113,0.25)"}}>remove</button>
        <button onClick={()=>onAction?.("dismiss",r)} style={{fontSize:11,fontWeight:500,padding:"5px 13px",borderRadius:20,cursor:"pointer",background:"rgba(255,255,255,0.05)",color:"var(--t4)",border:"0.5px solid var(--b1)"}}>dismiss</button>
      </div>}
      {resolved&&<div style={{fontSize:11,color:"var(--t5)",textAlign:"center",flexShrink:0}}>
        <span style={{display:"block",fontSize:16,color:"rgba(52,211,153,0.7)",lineHeight:1}}>✓</span>done
      </div>}
    </div>
  );
}

// ── Forum-facing ModerationPage (mods + admins, no audit log) ─────────────────
function ModerationPage({currentUser, navigate}) {
  const [tab, setTab] = useState("reports");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [sort, setSort] = useState("newest");
  const [reports, setReports] = useState([]);
  const [hidden, setHidden] = useState([]);
  const [banned, setBanned] = useState([]);
  const [loading, setLoading] = useState(false);

  const isMod = currentUser?.role === "moderator" || currentUser?.role === "admin";
  if (!isMod) return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)"}}>Access denied</div>;

  const load = useCallback(async() => {
    setLoading(true);
    try {
      if (tab === "reports") {
        const d = await api.get(`/reports?status=${statusFilter}&sort=${sort}`);
        setReports(d.reports || []);
      } else if (tab === "flagged") {
        const d = await api.get("/moderation/hidden");
        setHidden(d.items || []);
      } else if (tab === "banned") {
        const d = await api.get("/admin/users?status=banned");
        setBanned(d.users || []);
      }
    } finally { setLoading(false); }
  }, [tab, statusFilter, sort]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (action, r) => {
    if (action === "view") {
      if (r.post_id) navigate("post", {postId: r.post_id});
      return;
    }
    const status = action === "remove" ? "actioned" : "dismissed";
    if (action === "remove") {
      if (!confirm("Remove this content?")) return;
      if (r.post_id) await api.post(`/posts/${r.post_id}/hide`, {});
      else if (r.reply_id) await api.post(`/posts/${r.post_id}/replies/${r.reply_id}/hide`, {});
    }
    await api.patch(`/reports/${r.id}`, {status});
    setReports(p => p.map(x => x.id === r.id ? {...x, status} : x));
    toast(action === "remove" ? "Content removed" : "Report dismissed");
  };

  const pendingCount = reports.filter(r => r.status === "pending").length;
  const tabs = [
    {k:"reports",  icon:"fa-flag",              label:"reports",         badge:pendingCount, badgeColor:"red"},
    {k:"flagged",  icon:"fa-triangle-exclamation", label:"flagged posts", badge:hidden.length, badgeColor:"amber"},
    {k:"banned",   icon:"fa-user-slash",         label:"banned members", badge:null},
  ];

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* Header */}
      <div style={{padding:"22px 28px 0",borderBottom:"0.5px solid var(--b1)",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:4}}>
          <div>
            <div style={{fontSize:20,fontWeight:600,color:"var(--t1)",letterSpacing:-0.3}}>Moderation</div>
            <div style={{fontSize:13,color:"var(--t4)",marginBottom:14}}>Review reports and flagged content across all spaces.</div>
          </div>
          <div style={{fontSize:11,fontWeight:500,background:"rgba(167,139,250,0.12)",color:"#c4b5fd",border:"0.5px solid rgba(167,139,250,0.25)",borderRadius:20,padding:"4px 11px",display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
            <i className="fa-solid fa-shield-halved" style={{fontSize:10}}/>
            {currentUser?.role}
          </div>
        </div>
        <div style={{display:"flex",gap:0}}>
          {tabs.map(t=>(
            <div key={t.k} onClick={()=>setTab(t.k)}
              style={{fontSize:13,color:tab===t.k?"var(--ac)":"var(--t4)",padding:"0 18px 12px",cursor:"pointer",
                borderBottom:`1.5px solid ${tab===t.k?"var(--ac)":"transparent"}`,marginBottom:-0.5,
                display:"flex",alignItems:"center",gap:7}}>
              <i className={`fa-solid ${t.icon}`} style={{fontSize:11}}/>
              {t.label}
              {t.badge>0&&<span style={{fontSize:10,fontWeight:500,borderRadius:20,padding:"1px 7px",
                background:t.badgeColor==="red"?"rgba(248,113,113,0.2)":"rgba(251,191,36,0.15)",
                color:t.badgeColor==="red"?"#f87171":"#fbbf24"}}>{t.badge}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Body */}
      <div style={{flex:1,overflowY:"auto",padding:"20px 28px"}}>
        {tab==="reports"&&<>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,flexWrap:"wrap"}}>
            {["pending","actioned","dismissed"].map(s=>(
              <div key={s} onClick={()=>setStatusFilter(s)}
                style={{fontSize:11,padding:"5px 13px",borderRadius:20,cursor:"pointer",
                  background:statusFilter===s?"rgba(167,139,250,0.1)":"transparent",
                  border:`0.5px solid ${statusFilter===s?"rgba(167,139,250,0.3)":"rgba(255,255,255,0.1)"}`,
                  color:statusFilter===s?"#c4b5fd":"var(--t4)"}}>
                {s} <span style={{opacity:0.6}}>{statusFilter===s?reports.length:""}</span>
              </div>
            ))}
            <select value={sort} onChange={e=>setSort(e.target.value)}
              style={{marginLeft:"auto",fontSize:12,color:"var(--t4)",background:"rgba(255,255,255,0.04)",border:"0.5px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"5px 10px",fontFamily:"inherit",outline:"none"}}>
              <option value="newest">newest first</option>
              <option value="oldest">oldest first</option>
            </select>
          </div>
          {loading?<div style={{color:"var(--t5)",fontSize:13,padding:"20px 0"}}>Loading…</div>
            :reports.length===0?<div style={{textAlign:"center",padding:"40px 0",color:"var(--t5)",fontSize:13}}>
              <i className="fa-solid fa-check-circle" style={{fontSize:28,display:"block",marginBottom:10,opacity:0.3}}/>
              No {statusFilter} reports
            </div>
            :reports.map(r=><ReportCard key={r.id} r={r} onAction={handleAction} isAdmin={currentUser?.role==="admin"}/>)
          }
        </>}

        {tab==="flagged"&&<>
          {loading?<div style={{color:"var(--t5)",fontSize:13,padding:"20px 0"}}>Loading…</div>
            :hidden.length===0?<div style={{textAlign:"center",padding:"40px 0",color:"var(--t5)",fontSize:13}}>
              <i className="fa-solid fa-check-circle" style={{fontSize:28,display:"block",marginBottom:10,opacity:0.3}}/>
              No hidden content
            </div>
            :hidden.map((item,i)=>(
              <div key={`${item.type}-${item.id}`} style={{background:"rgba(255,255,255,0.025)",border:"0.5px solid var(--b1)",borderRadius:12,padding:"14px 16px",marginBottom:10,display:"flex",gap:14,alignItems:"flex-start"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",gap:8,marginBottom:6,alignItems:"center"}}>
                    <span style={{fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:20,textTransform:"uppercase",letterSpacing:"0.4px",
                      background:item.type==="post"?"rgba(248,113,113,0.15)":"rgba(96,165,250,0.12)",
                      color:item.type==="post"?"#f87171":"#93c5fd"}}>{item.type}</span>
                    {item.space_name&&<span style={{fontSize:11,color:"var(--t5)"}}>in {item.space_name}</span>}
                  </div>
                  <div style={{fontSize:13,color:"var(--t3)",lineHeight:1.6,fontStyle:"italic",borderLeft:"2px solid rgba(255,255,255,0.1)",paddingLeft:10,marginBottom:8}}>
                    "{item.body?.slice(0,140)}{(item.body?.length||0)>140?"…":""}"
                  </div>
                  <div style={{fontSize:11,color:"var(--t5)"}}>by {item.user?.username} · hidden {ago(item.hidden_at)}</div>
                </div>
              </div>
            ))}
        </>}

        {tab==="banned"&&<>
          {loading?<div style={{color:"var(--t5)",fontSize:13,padding:"20px 0"}}>Loading…</div>
            :banned.length===0?<div style={{textAlign:"center",padding:"40px 0",color:"var(--t5)",fontSize:13}}>
              <i className="fa-solid fa-check-circle" style={{fontSize:28,display:"block",marginBottom:10,opacity:0.3}}/>
              No banned members
            </div>
            :<div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden"}}>
              {banned.map((u,i)=>(
                <div key={u.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 16px",borderBottom:i<banned.length-1?"0.5px solid var(--b1)":"none"}}>
                  <div style={{width:32,height:32,borderRadius:`${22}%`,background:"var(--red)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:600,color:"#fff",flexShrink:0}}>
                    {(u.username||"?").slice(0,2).toUpperCase()}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:500,color:"var(--t1)"}}>{u.username}</div>
                    <div style={{fontSize:11,color:"var(--t5)"}}>{u.email}</div>
                  </div>
                  <div style={{fontSize:11,color:"var(--t5)"}}>banned {ago(u.updated_at||u.inserted_at)}</div>
                  {(currentUser?.role==="admin")&&<span style={{fontSize:11,color:"var(--green)",cursor:"pointer",marginLeft:8}}
                    onClick={async()=>{await api.delete(`/moderation/users/${u.username}/ban`);setBanned(p=>p.filter(x=>x.id!==u.id));toast("User unbanned");}}>
                    unban
                  </span>}
                </div>
              ))}
            </div>}
        </>}
      </div>
    </div>
  );
}

function AdminModerationPanel({reports, setReports, modLogs, users, setUsers, currentUser, navigate}) {
  const [tab, setTab] = useState("reports");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [sort, setSort] = useState("newest");
  const [hidden, setHidden] = useState([]);
  const [loadingHidden, setLoadingHidden] = useState(false);

  useEffect(()=>{
    if(tab==="flagged"&&hidden.length===0){
      setLoadingHidden(true);
      api.get("/moderation/hidden").then(d=>{setHidden(d.items||[]);}).finally(()=>setLoadingHidden(false));
    }
  },[tab]);

  const filtered = reports.filter(r=>statusFilter==="all"?true:r.status===statusFilter);
  const sorted = [...filtered].sort((a,b)=>sort==="oldest"
    ?new Date(a.inserted_at)-new Date(b.inserted_at)
    :new Date(b.inserted_at)-new Date(a.inserted_at));

  const pendingCount = reports.filter(r=>r.status==="pending").length;
  const bannedUsers = users.filter(u=>u.status==="banned");

  const handleAction = async(action, r) => {
    if(action==="view"){if(r.post_id)navigate("post",{postId:r.post_id});return;}
    const status = action==="remove"?"actioned":"dismissed";
    if(action==="remove"){
      if(!confirm("Remove this content?"))return;
      if(r.post_id) await api.post(`/posts/${r.post_id}/hide`,{});
    }
    await api.patch(`/reports/${r.id}`,{status});
    setReports(p=>p.map(x=>x.id===r.id?{...x,status}:x));
    toast(action==="remove"?"Content removed":"Report dismissed");
  };

  const tabs = [
    {k:"reports",  icon:"fa-flag",              label:"reports",      badge:pendingCount},
    {k:"flagged",  icon:"fa-triangle-exclamation",label:"flagged posts",badge:null},
    {k:"banned",   icon:"fa-user-slash",         label:"banned members",badge:bannedUsers.length||null},
    {k:"audit",    icon:"fa-clock-rotate-left",  label:"audit log",   badge:null},
  ];

  return (
    <div>
      <div style={{display:"flex",gap:0,borderBottom:"0.5px solid var(--b1)",marginBottom:20}}>
        {tabs.map(t=>(
          <div key={t.k} onClick={()=>setTab(t.k)}
            style={{fontSize:13,color:tab===t.k?"var(--ac)":"var(--t4)",padding:"0 16px 10px",cursor:"pointer",
              borderBottom:`1.5px solid ${tab===t.k?"var(--ac)":"transparent"}`,marginBottom:-0.5,
              display:"flex",alignItems:"center",gap:6}}>
            <i className={`fa-solid ${t.icon}`} style={{fontSize:11}}/>
            {t.label}
            {t.badge>0&&<span style={{fontSize:10,fontWeight:500,borderRadius:20,padding:"1px 6px",background:"rgba(248,113,113,0.2)",color:"#f87171"}}>{t.badge}</span>}
          </div>
        ))}
      </div>

      {tab==="reports"&&<>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,flexWrap:"wrap"}}>
          {["pending","actioned","dismissed"].map(s=>(
            <div key={s} onClick={()=>setStatusFilter(s)}
              style={{fontSize:11,padding:"5px 13px",borderRadius:20,cursor:"pointer",
                background:statusFilter===s?"rgba(167,139,250,0.1)":"transparent",
                border:`0.5px solid ${statusFilter===s?"rgba(167,139,250,0.3)":"rgba(255,255,255,0.1)"}`,
                color:statusFilter===s?"#c4b5fd":"var(--t4)"}}>
              {s}
            </div>
          ))}
          <select value={sort} onChange={e=>setSort(e.target.value)}
            style={{marginLeft:"auto",fontSize:12,color:"var(--t4)",background:"rgba(255,255,255,0.04)",border:"0.5px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"5px 10px",fontFamily:"inherit",outline:"none"}}>
            <option value="newest">newest first</option>
            <option value="oldest">oldest first</option>
          </select>
        </div>
        {sorted.length===0
          ?<div style={{padding:"24px 0",color:"var(--t5)",fontSize:13}}>✓ No {statusFilter} reports</div>
          :sorted.map(r=><ReportCard key={r.id} r={r} onAction={handleAction} isAdmin={true}/>)
        }
      </>}

      {tab==="flagged"&&<>
        {loadingHidden?<div style={{color:"var(--t5)",fontSize:13,padding:"20px 0"}}>Loading…</div>
          :hidden.length===0?<div style={{padding:"24px 0",color:"var(--t5)",fontSize:13}}>✓ No hidden content</div>
          :hidden.map(item=>(
            <div key={`${item.type}-${item.id}`} style={{background:"rgba(255,255,255,0.025)",border:"0.5px solid var(--b1)",borderRadius:12,padding:"14px 16px",marginBottom:10,display:"flex",gap:14}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",gap:8,marginBottom:6}}>
                  <span style={{fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:20,textTransform:"uppercase",
                    background:item.type==="post"?"rgba(248,113,113,0.15)":"rgba(96,165,250,0.12)",
                    color:item.type==="post"?"#f87171":"#93c5fd"}}>{item.type}</span>
                  {item.space_name&&<span style={{fontSize:11,color:"var(--t5)"}}>in {item.space_name}</span>}
                </div>
                <div style={{fontSize:13,color:"var(--t3)",lineHeight:1.6,fontStyle:"italic",borderLeft:"2px solid rgba(255,255,255,0.1)",paddingLeft:10,marginBottom:6}}>
                  "{item.body?.slice(0,160)}{(item.body?.length||0)>160?"…":""}"
                </div>
                <div style={{fontSize:11,color:"var(--t5)"}}>by {item.user?.username} · hidden {ago(item.hidden_at)}</div>
              </div>
            </div>
          ))}
      </>}

      {tab==="banned"&&<>
        {bannedUsers.length===0
          ?<div style={{padding:"24px 0",color:"var(--t5)",fontSize:13}}>✓ No banned members</div>
          :<div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden"}}>
            {bannedUsers.map((u,i)=>(
              <div key={u.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderBottom:i<bannedUsers.length-1?"0.5px solid var(--b1)":"none"}}>
                <div style={{width:30,height:30,borderRadius:"22%",background:"var(--red)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:600,color:"#fff",flexShrink:0}}>
                  {(u.username||"?").slice(0,2).toUpperCase()}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:500,color:"var(--t1)"}}>{u.username}</div>
                  <div style={{fontSize:11,color:"var(--t5)"}}>{u.email}</div>
                </div>
                <div style={{fontSize:11,color:"var(--t5)"}}>joined {fmtDate(u.inserted_at)}</div>
                <span style={{fontSize:11,color:"var(--green)",cursor:"pointer"}}
                  onClick={async()=>{await api.delete(`/moderation/users/${u.username}/ban`);setUsers(p=>p.map(x=>x.id===u.id?{...x,status:"active"}:x));toast("User unbanned");}}>
                  unban
                </span>
              </div>
            ))}
          </div>}
      </>}

      {tab==="audit"&&<>
        <div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden"}}>
          {modLogs.length===0
            ?<div style={{padding:"16px 14px",color:"var(--t5)",fontSize:13}}>No actions yet</div>
            :modLogs.slice(0,50).map(l=>(
              <div key={l.id} style={{display:"flex",alignItems:"baseline",gap:10,padding:"9px 14px",borderBottom:"0.5px solid var(--b1)"}}>
                <div style={{fontSize:11,color:"var(--t5)",minWidth:70,flexShrink:0}}>{ago(l.inserted_at)}</div>
                <div style={{fontSize:12,color:"var(--ac-text)",minWidth:90,flexShrink:0}}>{l.moderator?.username}</div>
                <div style={{fontSize:12,color:"var(--t3)",flex:1}}>{l.action}{l.reason&&` — ${l.reason}`}</div>
                {l.target_user&&<div style={{fontSize:11,color:"var(--t5)",flexShrink:0}}>→ {l.target_user.username}</div>}
              </div>
            ))}
        </div>
      </>}
    </div>
  );
}


// ── Simple drag-to-reorder list (reorder only, no hide/remove) ────────────────
function DragList({items, renderItem, onChange}) {
  var [dragging, setDragging] = React.useState(null);
  var [dragOver, setDragOver] = React.useState(null);

  function move(from, to) {
    if(from === to) return;
    var next = items.slice();
    var item = next.splice(from, 1)[0];
    next.splice(to, 0, item);
    onChange(next);
  }

  return React.createElement('div', {style:{display:"flex",flexDirection:"column",gap:4}},
    items.map(function(item, idx) {
      var isOver = dragOver === idx;
      var isDragging = dragging === idx;
      return React.createElement('div', {
        key: item.id || idx,
        draggable: true,
        onDragStart: function(e){e.dataTransfer.effectAllowed="move"; setDragging(idx);},
        onDragOver:  function(e){e.preventDefault(); setDragOver(idx);},
        onDragLeave: function(){setDragOver(null);},
        onDrop:      function(e){e.preventDefault(); if(dragging!==null) move(dragging,idx); setDragging(null); setDragOver(null);},
        onDragEnd:   function(){setDragging(null); setDragOver(null);},
        style:{
          display:"flex", alignItems:"center", gap:12, padding:"10px 14px",
          borderRadius:10, cursor:"grab",
          border:"0.5px solid "+(isOver?"var(--ac-border)":"var(--b1)"),
          background: isDragging?"rgba(255,255,255,0.01)": isOver?"var(--ac-bg)":"rgba(255,255,255,0.03)",
          opacity: isDragging ? 0.5 : 1,
          transition:"border-color .1s, background .1s"
        }
      },
        React.createElement('i',{className:"fa-solid fa-grip-vertical",style:{fontSize:11,color:"var(--t5)",flexShrink:0}}),
        renderItem(item, idx)
      );
    })
  );
}

// ── Layout admin with tabs ─────────────────────────────────────────────────────
function LayoutAdmin({layoutCfg, setLayoutCfg}) {
  var [tab, setTab] = React.useState("composer");

  function update(key, val) {
    var next = Object.assign({}, layoutCfg);
    next[key] = val;
    setLayoutCfg(next);
    if(key === "toolbar") _activeToolbar = val;
  }

  // Get ordered list with defaults for any missing ids
  function orderedList(key, defaults) {
    var saved = layoutCfg[key];
    if(!saved || !saved.length) return defaults.slice();
    // Merge: keep saved order, append any new defaults not in saved
    var result = saved.map(function(s) {
      return defaults.find(function(d){return d.id===s.id;}) || s;
    });
    defaults.forEach(function(d) {
      if(!result.find(function(r){return r.id===d.id;})) result.push(d);
    });
    return result;
  }

  var TABS = [
    {id:"composer",  label:"Composer toolbar"},
    {id:"left",      label:"Left sidebar"},
    {id:"right",     label:"Right sidebar"},
  ];

  return React.createElement('div', null,
    // Tab bar
    React.createElement('div', {style:{display:"flex",gap:0,borderBottom:"0.5px solid var(--b1)",marginBottom:24}},
      TABS.map(function(t) {
        var active = tab === t.id;
        return React.createElement('button', {
          key: t.id,
          onClick: function(){setTab(t.id);},
          style:{
            padding:"10px 20px", background:"none", border:"none",
            borderBottom: active ? "2px solid var(--ac)" : "2px solid transparent",
            color: active ? "var(--ac-text)" : "var(--t4)",
            fontWeight: active ? 500 : 400,
            fontSize:13, cursor:"pointer", fontFamily:"inherit",
            marginBottom:-1, transition:"color .1s"
          }
        }, t.label);
      })
    ),

    // Composer tab
    tab === "composer" && React.createElement('div', null,
      React.createElement('div', {className:"page-sub"}, "Drag to reorder. Toggle to show or hide. Changes apply to all composers and reply boxes."),
      React.createElement(ToolbarEditor, {
        items: layoutCfg.toolbar || TB_BTNS,
        onChange: function(items){update("toolbar", items);}
      })
    ),

    // Left sidebar tab
    tab === "left" && React.createElement('div', null,
      React.createElement('div', {className:"fgt"}, "Section order"),
      React.createElement('div', {className:"page-sub"}, "Drag to reorder the sidebar sections. Moderation and Admin Panel always stay at the bottom."),
      React.createElement(DragList, {
        items: orderedList("sidebar_sections", SIDEBAR_SECTIONS),
        onChange: function(items){update("sidebar_sections", items);},
        renderItem: function(item) {
          return React.createElement('span', {style:{fontSize:13,color:"var(--t2)",fontWeight:500}}, item.label);
        }
      }),
      React.createElement('div', {className:"fgt", style:{marginTop:28}}, "Explore items"),
      React.createElement('div', {className:"page-sub"}, "Drag to reorder the items within the Explore section."),
      React.createElement(DragList, {
        items: orderedList("explore_items", EXPLORE_ITEMS),
        onChange: function(items){update("explore_items", items);},
        renderItem: function(item) {
          return React.createElement('div', {style:{display:"flex",alignItems:"center",gap:10,flex:1}},
            React.createElement('i', {className:"fa-solid "+item.icon, style:{fontSize:13,color:"var(--t4)",width:16,textAlign:"center"}}),
            React.createElement('span', {style:{fontSize:13,color:"var(--t2)",fontWeight:500}}, item.label),
            item.authOnly && React.createElement('span', {style:{fontSize:10,color:"var(--t5)",background:"rgba(255,255,255,0.05)",padding:"1px 7px",borderRadius:20,border:"0.5px solid var(--b1)"}}, "logged in only")
          );
        }
      })
    ),

    // Right sidebar tab
    tab === "right" && React.createElement('div', null,
      React.createElement('div', {className:"fgt"}, "Widget order"),
      React.createElement('div', {className:"page-sub"}, "Drag to reorder the widgets in the right sidebar."),
      React.createElement(DragList, {
        items: orderedList("right_widgets", RIGHT_WIDGETS),
        onChange: function(items){update("right_widgets", items);},
        renderItem: function(item) {
          return React.createElement('span', {style:{fontSize:13,color:"var(--t2)",fontWeight:500}}, item.label);
        }
      })
    )
  );
}

function ToolbarEditor({items, onChange}) {
  var [dragging, setDragging] = React.useState(null);
  var [dragOver, setDragOver] = React.useState(null);
  var list = items.map(function(item, i) {
    return Object.assign({}, item, {_id: item.type || ('sep-'+i)});
  });

  function move(fromIdx, toIdx) {
    if(fromIdx === toIdx) return;
    var next = list.slice();
    var item = next.splice(fromIdx, 1)[0];
    next.splice(toIdx, 0, item);
    onChange(next.map(function(x){var c=Object.assign({},x);delete c._id;return c;}));
  }

  function toggle(idx) {
    var next = list.map(function(x){return Object.assign({},x);});
    next[idx].hidden = !next[idx].hidden;
    onChange(next.map(function(x){var c=Object.assign({},x);delete c._id;return c;}));
  }

  function removeItem(idx) {
    var next = list.filter(function(_,i){return i!==idx;});
    onChange(next.map(function(x){var c=Object.assign({},x);delete c._id;return c;}));
  }

  function addSep() {
    var next = list.concat([{sep:true}]);
    onChange(next.map(function(x){var c=Object.assign({},x);delete c._id;return c;}));
  }

  function reset() {
    onChange(TB_BTNS);
    _activeToolbar = null;
  }

  return (
    <div>
      <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:14}}>
        {list.map(function(item, idx){
          var isSep = !!item.sep;
          var isDraggingThis = dragging === idx;
          var isOver = dragOver === idx;
          return (
            <div key={item._id+idx}
              draggable={true}
              onDragStart={function(e){e.dataTransfer.effectAllowed="move";setDragging(idx);}}
              onDragOver={function(e){e.preventDefault();e.dataTransfer.dropEffect="move";setDragOver(idx);}}
              onDragLeave={function(){setDragOver(null);}}
              onDrop={function(e){e.preventDefault();if(dragging!==null)move(dragging,idx);setDragging(null);setDragOver(null);}}
              onDragEnd={function(){setDragging(null);setDragOver(null);}}
              style={{
                display:"flex",alignItems:"center",gap:12,padding:"10px 14px",
                borderRadius:10,border:"0.5px solid "+(isOver?"var(--ac-border)":"var(--b1)"),
                background:isDraggingThis?"rgba(255,255,255,0.02)":isOver?"var(--ac-bg)":"rgba(255,255,255,0.03)",
                cursor:"grab",opacity:item.hidden?0.45:1,transition:"border-color .1s,background .1s"
              }}>
              <i className="fa-solid fa-grip-vertical" style={{fontSize:11,color:"var(--t5)",flexShrink:0}}/>
              {isSep
                ? <div style={{flex:1,display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:24,height:16,borderRight:"1.5px solid var(--b2)",flexShrink:0}}/>
                    <span style={{fontSize:12,color:"var(--t4)"}}>Separator</span>
                  </div>
                : <div style={{flex:1,display:"flex",alignItems:"center",gap:10}}>
                    <div style={{minWidth:28,height:28,borderRadius:6,border:"0.5px solid var(--b1)",background:"rgba(255,255,255,0.04)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:"var(--t3)",fontWeight:500,...(item.style||{})}}>
                      {item.label}
                    </div>
                    <div>
                      <div style={{fontSize:13,color:"var(--t2)",fontWeight:500}}>{item.tip}</div>
                      <div style={{fontSize:11,color:"var(--t5)",marginTop:1,fontFamily:"monospace"}}>{item.type==="image"?"file upload":item.wrap?item.wrap[0]+(item.wrap[0]?'…':'')+(item.wrap[1]||''):''}</div>
                    </div>
                  </div>}
              {/* Toggle visible */}
              <button onClick={function(){toggle(idx);}} title={item.hidden?"Show":"Hide"}
                style={{background:"none",border:"none",cursor:"pointer",color:item.hidden?"var(--t5)":"var(--ac)",fontSize:14,padding:"2px 6px",borderRadius:6,flexShrink:0}}>
                <i className={"fa-solid "+(item.hidden?"fa-toggle-off":"fa-toggle-on")}/>
              </button>
              {/* Remove */}
              <button onClick={function(){removeItem(idx);}} title="Remove from toolbar"
                style={{background:"none",border:"none",cursor:"pointer",color:"var(--t5)",fontSize:12,padding:"2px 6px",borderRadius:6,flexShrink:0}}
                onMouseEnter={function(e){e.currentTarget.style.color="var(--red)";}}
                onMouseLeave={function(e){e.currentTarget.style.color="var(--t5)";}}>
                <i className="fa-solid fa-xmark"/>
              </button>
            </div>
          );
        })}
      </div>
      <div style={{display:"flex",gap:8}}>
        <button className="btn-ghost" style={{fontSize:12}} onClick={addSep}>
          <i className="fa-solid fa-grip-lines" style={{marginRight:6}}/>Add separator
        </button>
        <button className="btn-ghost" style={{fontSize:12,marginLeft:"auto",color:"var(--t4)"}} onClick={reset}>
          Reset to defaults
        </button>
      </div>
      {/* Live preview */}
      <div style={{marginTop:20}}>
        <div style={{fontSize:12,color:"var(--t4)",marginBottom:8}}>Preview</div>
        <div className="reply-box" style={{pointerEvents:"none",opacity:0.8}}>
          <div className="comp-toolbar">
            {list.filter(function(b){return !b.hidden;}).map(function(b,i){
              return b.sep
                ? React.createElement('div',{key:"sep"+i,className:"comp-tb-sep"})
                : React.createElement('button',{key:b.type+i,className:"comp-tb-btn",style:b.style||{}},b.label);
            })}
            <div style={{flex:1}}/>
            <button className="comp-tb-btn" style={{opacity:0.6}}><i className="fa-regular fa-eye" style={{fontSize:12}}/></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminPage({currentUser, navigate, onSpacesUpdated, layoutCfg={}, setLayoutCfg}) {
  const [sec,setSec]=useState("overview");
  const [stats,setStats]=useState(null); const [users,setUsers]=useState([]);
  const [queueStats,setQueueStats]=useState(null);
  const [sysStats,setSysStats]=useState(null);
  const [spaces,setSpaces]=useState([]); const [tags,setTags]=useState([]);
  const [reports,setReports]=useState([]); const [modLogs,setModLogs]=useState([]);
  const [showCreateUser,setShowCreateUser]=useState(false);
  const [newUser,setNewUser]=useState({username:"",email:"",password:"",role:"member",skip_verification:false});
  const [general,setGeneral]=useState({}); const [branding,setBranding]=useState({});
  const [emailCfg,setEmailCfg]=useState({}); const [saving,setSaving]=useState(false);
  const [uploadCfg,setUploadCfg]=useState({});
  const [regCfg,setRegCfg]=useState({});
  const [postCfg,setPostCfg]=useState({});
  const [pendingItems,setPendingItems]=useState([]);
  const [uploadStats,setUploadStats]=useState(null);
  const [uploads,setUploads]=useState([]);
  const [uploadFilter,setUploadFilter]=useState("");

  const fetchUploadData=()=>{
    api.get("/admin/uploads/stats").then(d=>setUploadStats(d.stats));
    api.get("/admin/uploads"+(uploadFilter?`?type=${uploadFilter}`:``)).then(d=>setUploads(d.uploads||[]));
  };

  useEffect(()=>{
    if(currentUser?.role!=="admin")return;
    api.get("/admin/dashboard").then(d=>setStats(d.stats));
    const fetchLive=()=>{
      api.get("/admin/queues").then(d=>setQueueStats(d));
      api.get("/admin/system").then(d=>setSysStats(d.system));
    };
    fetchLive();
    const liveInterval=setInterval(fetchLive,10000);
    api.get("/admin/uploads/stats").then(d=>setUploadStats(d.stats));
    api.get("/admin/users").then(d=>setUsers(d.users||[]));
    api.get("/spaces").then(d=>setSpaces(d.spaces||[]));
    api.get("/tags").then(d=>setTags(d.tags||[]));
    Promise.all(["pending","actioned","dismissed"].map(s=>api.get(`/reports?status=${s}`))).then(results=>{
      setReports(results.flatMap(d=>d.reports||[]));
    });
    api.get("/moderation/log").then(d=>setModLogs(d.logs||[]));
    api.get("/admin/settings").then(d=>{const s=d.settings||{};setGeneral(s.general||{});setBranding(s.appearance||{});setEmailCfg(s.email||{});setUploadCfg(s.uploads||{});setRegCfg(s.registration||{});setPostCfg(s.posting||{});});

    return ()=>clearInterval(liveInterval);
  },[currentUser]);

  useEffect(()=>{
    if(currentUser?.role!=="admin")return;
    if(sec==="storage") fetchUploadData();
    if(sec==="moderation") api.get("/admin/pending").then(d=>setPendingItems(d.pending||[]));
  },[sec, uploadFilter]);

  if(!currentUser||currentUser.role!=="admin") return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)"}}>Access denied</div>;
  const saveSection=async(key,value)=>{setSaving(true);try{await api.patch(`/admin/settings/${key}`,{value});toast("Saved");if(key==="appearance")applyBranding(value,general);}finally{setSaving(false);}};

  const NAV_SECTIONS = [
    {label:"forum settings", items:[
      {k:"overview",   icon:"fa-chart-line",     label:"overview"},
      {k:"forum-info", icon:"fa-circle-info",     label:"forum info"},
      {k:"appearance", icon:"fa-swatchbook",      label:"appearance"},
      {k:"layout",     icon:"fa-table-columns",    label:"layout"},
      {k:"email",      icon:"fa-envelope",        label:"email"},
      {k:"permissions",icon:"fa-shield",          label:"permissions"},
      {k:"moderation", icon:"fa-lock",            label:"moderation"},
      {k:"extensions", icon:"fa-plug",            label:"extensions", badge:0},
    ]},
    {label:"manage", items:[
      {k:"members",    icon:"fa-users",           label:"members"},
      {k:"spaces",     icon:"fa-layer-group",     label:"spaces"},
      {k:"tags",       icon:"fa-tag",             label:"tags"},
      {k:"reports",    icon:"fa-flag",            label:"reports", badge:reports.filter(r=>r.status==="pending").length},
      {k:"badges",     icon:"fa-medal",           label:"badges"},
    ]},
    {label:"system", items:[
      {k:"storage",    icon:"fa-database",        label:"storage"},
      {k:"logs",       icon:"fa-file-lines",      label:"logs"},
      {k:"updates",    icon:"fa-rotate",          label:"updates"},
    ]},
  ];


  return (
    <>
    <div className="admin-shell">
      <div className="admin-sidenav">
        <div className="admin-topbar" style={{borderBottom:"0.5px solid var(--b1)"}}>
          <span className="logo-text">nexus<em>.</em></span>
          <div className="admin-badge"><i className="fa-solid fa-shield-halved" style={{fontSize:13}}></i>administration</div>
        </div>
        <div className="admin-sidenav-scroll">
          {NAV_SECTIONS.map(ns=>(
            <div key={ns.label}>
              <div className="admin-sn-label">{ns.label}</div>
              {ns.items.map(item=>(
                <div key={item.k} className={`admin-sn-item ${sec===item.k?"active":""}`} onClick={()=>setSec(item.k)}>
                  <i className={`fa-solid ${item.icon}`}></i>
                  <span className="admin-sn-item-name">{item.label}</span>
                  {item.badge>0&&<span className="admin-sn-badge">{item.badge}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{padding:"10px 12px",borderTop:"0.5px solid var(--b1)"}}>
          <div className="admin-sn-item" onClick={()=>navigate("feed")}>
            <i className="fa-solid fa-arrow-left"></i>
            <span className="admin-sn-item-name">view forum</span>
          </div>
        </div>
      </div>
      <div className="admin-content-wrap">
        <div className="admin-topbar">
          <div style={{flex:1}}/>
          <button className="btn-ghost" onClick={()=>{ api.get("/admin/settings").then(d=>{const s=d.settings||{};setGeneral(s.general||{});setBranding(s.appearance||{});setEmailCfg(s.email||{});}); toast("Discarded"); }}>Discard</button>
          <button className="btn-primary" onClick={()=>{
            if(sec==="appearance") saveSection("appearance",branding);
            else if(sec==="email") saveSection("email",emailCfg);
            else if(sec==="layout") saveSection("layout",layoutCfg);
            else if(sec==="forum-info") saveSection("general",general);
            else if(sec==="permissions") { saveSection("registration",regCfg); saveSection("posting",postCfg); }
            else if(sec==="moderation") saveSection("moderation",general);
            else toast("No changes to save for this section");
          }} disabled={saving}>{saving?"…":"Save changes"}</button>
        </div>
        <div className="admin-content-body">

          {sec==="overview"&&<>
            <div className="page-sub">A snapshot of your community's health and activity.</div>

            {/* ── Top stat cards ── */}
            <div className="admin-stat-row">
              {[
                {icon:"fa-users",        color:"#a78bfa", n:stats?.users?.total??0,          label:"total members",    delta:`+${stats?.extended?.members?.new_month??0} this month`},
                {icon:"fa-user-plus",    color:"#34d399", n:stats?.extended?.members?.new_week??0, label:"new this week",  delta:`+${stats?.extended?.members?.new_month??0} this month`},
                {icon:"fa-pen-to-square",color:"#60a5fa", n:stats?.content?.posts??0,         label:"total posts",      delta:`+${stats?.extended?.content?.posts_week??0} this week`},
                {icon:"fa-reply",        color:"#f472b6", n:stats?.content?.replies??0,       label:"total replies",    delta:`+${stats?.extended?.content?.replies_week??0} this week`},
                {icon:"fa-eye-slash",    color:"#fbbf24", n:stats?.extended?.members?.lurkers??0, label:"lurkers",      delta:`${stats?.extended?.members?.active??0} have posted`},
                {icon:"fa-flag",         color:"#f87171", n:stats?.moderation?.pending_reports??0, label:"pending reports", delta:`${stats?.extended?.pending?.posts??0} posts pending`},
              ].map((c,i)=>(
                <div key={i} className="admin-stat-card">
                  <div className="asc-icon" style={{background:`${c.color}18`}}><i className={`fa-solid ${c.icon}`} style={{color:c.color,fontSize:15}}/></div>
                  <div className="asc-n" style={{color:c.color}}>{c.n.toLocaleString()}</div>
                  <div className="asc-l">{c.label}</div>
                  <div className="asc-delta delta-up">{c.delta}</div>
                </div>
              ))}
            </div>

            {/* ── Posts per day sparkline ── */}
            <div className="fgt" style={{marginTop:24}}>Post activity — last 30 days</div>
            <div style={{border:"0.5px solid var(--b1)",borderRadius:12,padding:"16px 20px",marginBottom:4}}>
              {(()=>{
                const data = stats?.extended?.content?.posts_per_day||[];
                if(!data.length) return <div style={{color:"var(--t5)",fontSize:12,padding:"8px 0"}}>No post data yet</div>;
                const max = Math.max(...data.map(d=>d.count),1);
                const today = new Date().toISOString().slice(0,10);
                // Build a full 30-day array filling missing dates with 0
                const days = Array.from({length:30},(_,i)=>{
                  const d = new Date(); d.setDate(d.getDate()-29+i);
                  const key = d.toISOString().slice(0,10);
                  const found = data.find(x=>String(x.date)===key);
                  return {date:key, count:found?.count||0};
                });
                return (
                  <div style={{display:"flex",alignItems:"flex-end",gap:3,height:60}}>
                    {days.map((d,i)=>(
                      <div key={i} title={`${d.date}: ${d.count} posts`} style={{flex:1,minWidth:0,
                        height:`${Math.max((d.count/max)*100,2)}%`,
                        background:d.date===today?"var(--ac)":"rgba(167,139,250,0.35)",
                        borderRadius:"2px 2px 0 0",transition:"height .2s",cursor:"default"}}/>
                    ))}
                  </div>
                );
              })()}
              <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--t5)",marginTop:6}}>
                <span>30 days ago</span><span>today</span>
              </div>
            </div>

            {/* ── Space activity + Top contributors ── */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginTop:20}}>
              <div>
                <div className="fgt" style={{marginBottom:10}}>Most active spaces (30 days)</div>
                <div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden"}}>
                  {(stats?.extended?.space_activity||[]).length===0
                    ?<div style={{padding:"14px 16px",color:"var(--t5)",fontSize:12}}>No data yet</div>
                    :(stats?.extended?.space_activity||[]).map((s,i,arr)=>{
                      const max=arr[0]?.count||1;
                      return (
                        <div key={s.space_id} style={{padding:"9px 14px",borderBottom:i<arr.length-1?"0.5px solid var(--b1)":"none"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                            <span style={{fontSize:12,color:"var(--t2)",fontWeight:500}}>{s.name}</span>
                            <span style={{fontSize:11,color:"var(--t4)"}}>{s.count} posts</span>
                          </div>
                          <div style={{height:3,background:"var(--b1)",borderRadius:2}}>
                            <div style={{height:3,background:"var(--ac)",borderRadius:2,width:`${(s.count/max)*100}%`,transition:"width .3s"}}/>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
              <div>
                <div className="fgt" style={{marginBottom:10}}>Top contributors this week</div>
                <div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden"}}>
                  {(stats?.extended?.top_contributors||[]).length===0
                    ?<div style={{padding:"14px 16px",color:"var(--t5)",fontSize:12}}>No posts this week</div>
                    :(stats?.extended?.top_contributors||[]).map((u,i,arr)=>(
                      <div key={u.user_id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",borderBottom:i<arr.length-1?"0.5px solid var(--b1)":"none"}}>
                        <div style={{width:7,height:7,borderRadius:"50%",background:"var(--ac)",opacity:1-(i*0.15),flexShrink:0}}/>
                        <div style={{width:28,height:28,borderRadius:`${22}%`,background:"var(--ac)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"var(--ac-on)",fontWeight:600,flexShrink:0}}>
                          {(u.username||"?").slice(0,2).toUpperCase()}
                        </div>
                        <span style={{flex:1,fontSize:12,color:"var(--t2)"}}>{u.username}</span>
                        <span style={{fontSize:11,color:"var(--t4)"}}>{u.count} post{u.count!==1?"s":""}</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {/* ── Queue health ── */}
            <div className="fgt" style={{marginTop:24}}>Job queue health</div>
            <div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden",marginBottom:4}}>
              <div style={{display:"grid",gridTemplateColumns:"1.2fr repeat(5,1fr)",padding:"8px 14px",borderBottom:"0.5px solid var(--b1)",fontSize:11,color:"var(--t5)",fontWeight:500}}>
                <span>Queue</span><span>Available</span><span>Executing</span><span>Scheduled</span><span>Retrying</span><span>Discarded</span>
              </div>
              {queueStats?Object.entries(queueStats.queues||{}).map(([q,s])=>(
                <div key={q} style={{display:"grid",gridTemplateColumns:"1.2fr repeat(5,1fr)",padding:"9px 14px",borderBottom:"0.5px solid var(--b1)",fontSize:12,alignItems:"center"}}>
                  <span style={{color:"var(--t1)",fontWeight:500}}>{q}</span>
                  <span style={{color:"var(--green)"}}>{s.available||0}</span>
                  <span style={{color:s.executing>0?"var(--ac)":"var(--t4)"}}>{s.executing||0}</span>
                  <span style={{color:"var(--t3)"}}>{s.scheduled||0}</span>
                  <span style={{color:s.retryable>0?"var(--amber)":"var(--t4)"}}>{s.retryable||0}</span>
                  <span style={{color:s.discarded>0?"var(--red)":"var(--t4)"}}>{s.discarded||0}</span>
                </div>
              )):<div style={{padding:"14px 16px",color:"var(--t5)",fontSize:12}}>Loading…</div>}
            </div>

            {/* ── System health ── */}
            <div className="fgt" style={{marginTop:24}}>System health</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:4}}>
              {[
                {label:"Total memory",    value:sysStats?`${(sysStats.memory.total/1048576).toFixed(1)} MB`:"—",   color:"#60a5fa"},
                {label:"Process memory",  value:sysStats?`${(sysStats.memory.processes/1048576).toFixed(1)} MB`:"—", color:"#a78bfa"},
                {label:"Processes",       value:sysStats?`${sysStats.process_count} / ${sysStats.process_limit}`:"—", color:"#34d399"},
                {label:"Uptime",          value:sysStats?formatUptime(sysStats.uptime_seconds):"—",                 color:"#fbbf24"},
                {label:"Schedulers",      value:sysStats?`${sysStats.schedulers} online`:"—",                       color:"#f472b6"},
                {label:"OTP release",     value:sysStats?`OTP ${sysStats.otp_release}`:"—",                        color:"#f87171"},
                {label:"Binary memory",   value:sysStats?`${(sysStats.memory.binary/1048576).toFixed(1)} MB`:"—",  color:"#60a5fa"},
                {label:"ETS memory",      value:sysStats?`${(sysStats.memory.ets/1048576).toFixed(1)} MB`:"—",     color:"#a78bfa"},
              ].map((s,i)=>(
                <div key={i} style={{background:"var(--s2)",border:"0.5px solid var(--b1)",borderRadius:10,padding:"12px 14px"}}>
                  <div style={{fontSize:10,color:"var(--t5)",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"}}>{s.label}</div>
                  <div style={{fontSize:14,fontWeight:600,color:s.color}}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* ── Storage ── */}
            <div className="fgt" style={{marginTop:24}}>Storage</div>
            <div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden"}}>
              {uploadStats?<>
                <div style={{display:"grid",gridTemplateColumns:"1.5fr 1fr 1fr",padding:"8px 14px",borderBottom:"0.5px solid var(--b1)",fontSize:11,color:"var(--t5)",fontWeight:500}}>
                  <span>Type</span><span>Files</span><span>Size</span>
                </div>
                {Object.entries(uploadStats.by_type||{}).map(([type,data])=>(
                  <div key={type} style={{display:"grid",gridTemplateColumns:"1.5fr 1fr 1fr",padding:"8px 14px",borderBottom:"0.5px solid var(--b1)",fontSize:12}}>
                    <span style={{color:"var(--t2)"}}>{type.replace("_"," ")}</span>
                    <span style={{color:"var(--t3)"}}>{data.count}</span>
                    <span style={{color:"var(--t3)"}}>{(data.bytes/1048576).toFixed(1)} MB</span>
                  </div>
                ))}
                <div style={{display:"grid",gridTemplateColumns:"1.5fr 1fr 1fr",padding:"9px 14px",fontSize:12,fontWeight:500}}>
                  <span style={{color:"var(--t1)"}}>Total</span>
                  <span style={{color:"var(--ac)"}}>{uploadStats.total_count}</span>
                  <span style={{color:"var(--ac)"}}>{(uploadStats.total_bytes/1048576).toFixed(1)} MB</span>
                </div>
              </>:<div style={{padding:"14px 16px",color:"var(--t5)",fontSize:12}}>Loading…</div>}
            </div>
          </>}

          {(sec==="forum-info")&&<>
            <div className="fgt">Forum identity</div>
            <F label="Forum name" hint="Appears in the browser tab and emails"><input className="fi" value={general.site_name||""} onChange={e=>setGeneral(p=>({...p,site_name:e.target.value}))} placeholder="Nexus"/></F>
            <F label="Forum description"><input className="fi" value={general.site_description||""} onChange={e=>setGeneral(p=>({...p,site_description:e.target.value}))} placeholder="A short description…"/></F>
            <F label="Base URL"><input className="fi" value={general.base_url||""} onChange={e=>setGeneral(p=>({...p,base_url:e.target.value}))} placeholder="forum.example.com"/></F>

            <div className="fgt" style={{marginTop:20}}>Homepage hero</div>
            <F label="Show hero banner" hint="Displays a welcome banner above the post feed on the homepage">
              <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
                <div className={`tgl-track ${general.hero_enabled?"on":""}`} onClick={()=>setGeneral(p=>({...p,hero_enabled:!p.hero_enabled}))} style={{width:36,height:20,borderRadius:10,background:general.hero_enabled?"var(--ac)":"rgba(255,255,255,0.1)",position:"relative",cursor:"pointer",transition:"background .2s",flexShrink:0}}>
                  <div style={{position:"absolute",top:3,left:general.hero_enabled?18:3,width:14,height:14,borderRadius:"50%",background:"#fff",transition:"left .2s"}}/>
                </div>
                <span style={{fontSize:12,color:"var(--t3)"}}>{general.hero_enabled?"Enabled":"Disabled"}</span>
              </label>
            </F>
            <F label="Hero headline" hint="Large text displayed prominently in the banner">
              <input className="fi" value={general.hero_title||""} onChange={e=>setGeneral(p=>({...p,hero_title:e.target.value}))} placeholder="Welcome to our community"/>
            </F>
            <F label="Hero body text" hint="Supporting text below the headline">
              <textarea className="fi" value={general.hero_body||""} onChange={e=>setGeneral(p=>({...p,hero_body:e.target.value}))} placeholder="A place to discuss ideas, share knowledge, and connect." style={{resize:"vertical",minHeight:72,lineHeight:1.6}}/>
            </F>

            <div className="fgt" style={{marginTop:20}}>Site logo</div>
            <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:8}}>
              {general.logo_url
                ?<img src={general.logo_url} style={{height:48,borderRadius:8,border:"0.5px solid var(--b2)",background:"var(--bg2)",padding:4}} alt="logo"/>
                :<div style={{width:48,height:48,borderRadius:8,border:"0.5px dashed var(--b2)",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)",fontSize:11}}>none</div>}
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                <label style={{cursor:"pointer"}}>
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" style={{display:"none"}} onChange={async e=>{
                    const f=e.target.files[0]; if(!f)return;
                    const fd=new FormData(); fd.append("file",f); fd.append("type","logo");
                    const token=localStorage.getItem("nexus_token");
                    const r=await fetch("/api/v1/uploads",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:fd});
                    const d=await r.json();
                    if(d.upload){setGeneral(p=>({...p,logo_url:d.original_url}));toast("Logo uploaded");}
                    else toast(d.error||"Upload failed");
                  }}/>
                  <span className="btn-ghost" style={{fontSize:12,pointerEvents:"none"}}>
                    <i className="fa-solid fa-arrow-up-from-bracket" style={{marginRight:6}}></i>Upload logo
                  </span>
                </label>
                {general.logo_url&&<span className="btn-ghost" style={{fontSize:12,color:"var(--red)",cursor:"pointer"}} onClick={()=>setGeneral(p=>({...p,logo_url:null}))}>Remove</span>}
              </div>
              <div style={{fontSize:11,color:"var(--t5)",lineHeight:1.5}}>PNG or SVG recommended.<br/>Max 400px wide.</div>
            </div>

            <div className="fgt" style={{marginTop:20}}>Favicon</div>
            <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:8}}>
              {general.favicon_url
                ?<img src={general.favicon_url} style={{width:32,height:32,borderRadius:4,border:"0.5px solid var(--b2)",background:"var(--bg2)",padding:2}} alt="favicon"/>
                :<div style={{width:32,height:32,borderRadius:4,border:"0.5px dashed var(--b2)",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)",fontSize:10}}>none</div>}
              <label style={{cursor:"pointer"}}>
                <input type="file" accept="image/x-icon,image/png,image/svg+xml,image/webp" style={{display:"none"}} onChange={async e=>{
                  const f=e.target.files[0]; if(!f)return;
                  const fd=new FormData(); fd.append("file",f); fd.append("type","favicon");
                  const token=localStorage.getItem("nexus_token");
                  const r=await fetch("/api/v1/uploads",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:fd});
                  const d=await r.json();
                  if(d.upload){setGeneral(p=>({...p,favicon_url:d.original_url}));toast("Favicon uploaded");}
                  else toast(d.error||"Upload failed");
                }}/>
                <span className="btn-ghost" style={{fontSize:12,pointerEvents:"none"}}>
                  <i className="fa-solid fa-arrow-up-from-bracket" style={{marginRight:6}}></i>Upload favicon
                </span>
              </label>
              <div style={{fontSize:11,color:"var(--t5)",lineHeight:1.5}}>.ico or 32×32 PNG.<br/>Shown in browser tabs.</div>
            </div>
          </>}

          {sec==="appearance"&&<>
            <div className="fgt">Colors</div>
            <F label="Accent color" hint="Used for buttons, active states, and highlights">
              <ColorPicker
                value={branding.accent_color||"#a78bfa"}
                onChange={v=>{
                  setBranding(p=>({...p,accent_color:v}));
                  if(/^#[0-9a-fA-F]{6}$/.test(v)){const vars=deriveAccentVars(v);if(vars){const r=document.documentElement;r.style.setProperty("--ac",v);r.style.setProperty("--ac-on",vars.onAccent);r.style.setProperty("--ac-bg",vars.acBg);r.style.setProperty("--ac-border",vars.acBorder);r.style.setProperty("--ac-text",vars.acText);}}
                }}
              />
            </F>
            <F label="Background tint" hint="Adds a subtle color tint to dark surfaces. Use near-black for no tint.">
              <ColorPicker
                value={branding.tint_color||"#0d0d14"}
                onChange={v=>{
                  setBranding(p=>({...p,tint_color:v}));
                  if(/^#[0-9a-fA-F]{6}$/.test(v)){const tint=deriveTintVars(v);if(tint){const r=document.documentElement;r.style.setProperty("--bg",tint.bg);r.style.setProperty("--s1",tint.s1);r.style.setProperty("--s2",tint.s2);r.style.setProperty("--s3",tint.s3);}}
                }}
              />
            </F>
            <div className="fgt" style={{marginTop:16}}>Avatars</div>
            <F label="Avatar shape" hint="Controls roundness of all avatars across the forum">
              <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:6}}>
                <input type="range" min="0" max="50" value={branding.avatar_radius??22}
                  onChange={e=>{const v=parseInt(e.target.value);setBranding(p=>({...p,avatar_radius:v}));document.documentElement.style.setProperty("--av-radius",`${v}%`);}}
                  style={{flex:1,accentColor:"var(--ac)"}}/>
                <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
                  {["#a78bfa","#60a5fa","#34d399"].map((c,i)=>(
                    <div key={i} style={{width:32,height:32,borderRadius:`${branding.avatar_radius??22}%`,background:c,flexShrink:0,transition:"border-radius .15s"}}/>
                  ))}
                </div>
                <span style={{fontSize:12,color:"var(--t4)",minWidth:36,textAlign:"right"}}>{branding.avatar_radius??22}%</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--t5)",paddingRight:148}}>
                <span>■ Square</span><span>Rounded</span><span>● Circle</span>
              </div>
            </F>
            <div className="fgt" style={{marginTop:16}}>Custom CSS</div>
            <textarea className="fi" style={{fontFamily:"monospace",fontSize:12,minHeight:100,resize:"vertical",lineHeight:1.6,color:"var(--ac-text)"}} value={branding.custom_css||""} onChange={e=>setBranding(p=>({...p,custom_css:e.target.value}))} placeholder="/* Additional styles */"/>
          </>}

          {sec==="moderation"&&<AdminModerationPanel
            reports={reports} setReports={setReports}
            modLogs={modLogs} users={users} setUsers={setUsers}
            currentUser={currentUser} navigate={navigate}
          />}

          {sec==="members"&&<>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <div className="fgt" style={{marginBottom:0}}>All members</div>
              <button className="btn-primary" style={{fontSize:12,padding:"6px 16px"}} onClick={()=>{setNewUser({username:"",email:"",password:"",role:"member",skip_verification:false});setShowCreateUser(true);}}>+ New member</button>
            </div>
            <div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden"}}>
              <table className="atbl"><thead><tr><th>Member</th><th>Role</th><th>Joined</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>{users.map(u=>(
                  <tr key={u.id}>
                    <td style={{fontWeight:500,color:"var(--t1)"}}>{u.username}<div style={{fontSize:11,color:"var(--t5)"}}>{u.email}</div></td>
                    <td><select style={{background:"rgba(255,255,255,0.05)",border:"0.5px solid var(--b1)",borderRadius:6,padding:"3px 8px",fontSize:11,color:"var(--t1)",fontFamily:"inherit",outline:"none",cursor:"pointer"}} value={u.role} onChange={async e=>{await api.patch(`/admin/users/${u.id}/role`,{role:e.target.value});setUsers(p=>p.map(x=>x.id===u.id?{...x,role:e.target.value}:x));toast("Role updated");}} disabled={u.id===currentUser.id}><option value="member">member</option><option value="moderator">moderator</option><option value="admin">admin</option></select></td>
                    <td style={{color:"var(--t5)",fontSize:11}}>{fmtDate(u.inserted_at)}</td>
                    <td><span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:12}}><span style={{width:6,height:6,borderRadius:"50%",background:u.status==="active"?"var(--green)":"var(--red)"}}></span>{u.status}</span></td>
                    <td style={{textAlign:"right"}}>
                      {u.id!==currentUser.id&&<>
                        <div style={{display:"flex",gap:6,justifyContent:"flex-end",flexWrap:"wrap",alignItems:"center"}}>
                          {!u.email_verified&&<button onClick={async()=>{const d=await api.patch(`/admin/users/${u.id}/verify-email`,{});if(d.ok){setUsers(p=>p.map(x=>x.id===u.id?{...x,email_verified:true}:x));toast("Email verified");}else toast(d.error||"Failed","err");}} style={{fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20,border:"0.5px solid rgba(96,165,250,0.25)",background:"rgba(96,165,250,0.12)",color:"#60a5fa",cursor:"pointer",fontFamily:"inherit"}}>verify email</button>}
                          {u.email_verified&&<span style={{fontSize:10,color:"var(--green)",display:"flex",alignItems:"center",gap:3}}><i className="fa-solid fa-circle-check" style={{fontSize:10}}/>verified</span>}
                          {u.status==="banned"
                            ?<button onClick={async()=>{await api.delete(`/moderation/users/${u.username}/ban`);setUsers(p=>p.map(x=>x.id===u.id?{...x,status:"active"}:x));toast("User unbanned");}} style={{fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20,border:"0.5px solid rgba(52,211,153,0.25)",background:"rgba(52,211,153,0.12)",color:"#34d399",cursor:"pointer",fontFamily:"inherit"}}>unban</button>
                            :<button onClick={async()=>{if(!confirm(`Ban ${u.username}?`))return;await api.post(`/moderation/users/${u.username}/ban`,{reason:"Admin action"});setUsers(p=>p.map(x=>x.id===u.id?{...x,status:"banned"}:x));toast("User banned");}} style={{fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20,border:"0.5px solid rgba(248,113,113,0.25)",background:"rgba(248,113,113,0.12)",color:"#f87171",cursor:"pointer",fontFamily:"inherit"}}>ban</button>}
                          {u.status==="suspended"
                            ?<button onClick={async()=>{await api.delete(`/moderation/users/${u.username}/suspend`);setUsers(p=>p.map(x=>x.id===u.id?{...x,status:"active"}:x));toast("Suspension lifted");}} style={{fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20,border:"0.5px solid rgba(52,211,153,0.25)",background:"rgba(52,211,153,0.12)",color:"#34d399",cursor:"pointer",fontFamily:"inherit"}}>unsuspend</button>
                            :<button onClick={async()=>{if(!confirm(`Suspend ${u.username}?`))return;await api.post(`/moderation/users/${u.username}/suspend`,{reason:"Admin action"});setUsers(p=>p.map(x=>x.id===u.id?{...x,status:"suspended"}:x));toast("User suspended");}} style={{fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20,border:"0.5px solid rgba(251,191,36,0.25)",background:"rgba(251,191,36,0.12)",color:"#fbbf24",cursor:"pointer",fontFamily:"inherit"}}>suspend</button>}
                          <button onClick={async()=>{if(!confirm(`Permanently delete ${u.username}? This cannot be undone.`))return;const d=await api.delete(`/admin/users/${u.id}`);if(d.ok){setUsers(p=>p.filter(x=>x.id!==u.id));toast("User deleted");}else toast(d.error||"Failed","err");}} style={{fontSize:11,fontWeight:500,padding:"3px 10px",borderRadius:20,border:"0.5px solid rgba(248,113,113,0.15)",background:"rgba(248,113,113,0.07)",color:"rgba(248,113,113,0.6)",cursor:"pointer",fontFamily:"inherit"}}>delete</button>
                        </div>
                      </>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </>}

          {sec==="email"&&<>
            <div className="fgt">Delivery provider</div>
            <F label="Provider">
              <select className="fi" value={emailCfg.provider||"smtp"} onChange={e=>setEmailCfg(p=>({...p,provider:e.target.value}))}>
                <option value="smtp">SMTP</option>
                <option value="postmark">Postmark</option>
                <option value="resend">Resend</option>
                <option value="mailgun">Mailgun</option>
              </select>
            </F>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <F label="From address"><input className="fi" value={emailCfg.from_address||""} onChange={e=>setEmailCfg(p=>({...p,from_address:e.target.value}))} placeholder="hello@yourdomain.com"/></F>
              <F label="From name"><input className="fi" value={emailCfg.from_name||""} onChange={e=>setEmailCfg(p=>({...p,from_name:e.target.value}))} placeholder="Nexus"/></F>
            </div>
            {(emailCfg.provider==="smtp"||!emailCfg.provider)&&<>
              <div className="fgt" style={{marginTop:16}}>SMTP credentials</div>
              <F label="SMTP host"><input className="fi" value={emailCfg.smtp_host||""} onChange={e=>setEmailCfg(p=>({...p,smtp_host:e.target.value}))} placeholder="smtp.example.com"/></F>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <F label="Port"><input className="fi" value={emailCfg.smtp_port||""} onChange={e=>setEmailCfg(p=>({...p,smtp_port:e.target.value}))} placeholder="587"/></F>
                <F label="Encryption">
                  <select className="fi" value={emailCfg.smtp_encryption||"tls"} onChange={e=>setEmailCfg(p=>({...p,smtp_encryption:e.target.value}))}>
                    <option value="tls">STARTTLS (587)</option>
                    <option value="ssl">SSL/TLS (465)</option>
                    <option value="none">None (25)</option>
                  </select>
                </F>
              </div>
              <F label="SMTP username"><input className="fi" value={emailCfg.smtp_username||""} onChange={e=>setEmailCfg(p=>({...p,smtp_username:e.target.value}))} placeholder="username or email"/></F>
              <F label="SMTP password"><input className="fi" type="password" value={emailCfg.smtp_password||""} onChange={e=>setEmailCfg(p=>({...p,smtp_password:e.target.value}))} placeholder="••••••••"/></F>
            </>}
            {emailCfg.provider==="postmark"&&<>
              <div className="fgt" style={{marginTop:16}}>Postmark credentials</div>
              <F label="Server API token" hint="Found in your Postmark account under API Tokens"><input className="fi" value={emailCfg.api_key||""} onChange={e=>setEmailCfg(p=>({...p,api_key:e.target.value}))} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"/></F>
            </>}
            {emailCfg.provider==="resend"&&<>
              <div className="fgt" style={{marginTop:16}}>Resend credentials</div>
              <F label="API key" hint="Found in your Resend dashboard"><input className="fi" value={emailCfg.api_key||""} onChange={e=>setEmailCfg(p=>({...p,api_key:e.target.value}))} placeholder="re_xxxxxxxxxxxx"/></F>
            </>}
            {emailCfg.provider==="mailgun"&&<>
              <div className="fgt" style={{marginTop:16}}>Mailgun credentials</div>
              <F label="API key"><input className="fi" value={emailCfg.api_key||""} onChange={e=>setEmailCfg(p=>({...p,api_key:e.target.value}))} placeholder="key-xxxxxxxxxxxx"/></F>
              <F label="Domain"><input className="fi" value={emailCfg.mailgun_domain||""} onChange={e=>setEmailCfg(p=>({...p,mailgun_domain:e.target.value}))} placeholder="mg.yourdomain.com"/></F>
            </>}
            <div style={{marginTop:20,paddingTop:16,borderTop:"0.5px solid var(--b1)",display:"flex",alignItems:"center",gap:10}}>
              <button className="btn-ghost" style={{fontSize:12}} onClick={async()=>{
                const d=await api.post("/admin/test-email",{});
                if(d.ok) toast("Test email sent — check your inbox");
                else toast(d.error||"Failed to send test email","err");
              }}>Send test email</button>
              <span style={{fontSize:11,color:"var(--t5)"}}>Sends to your account email address</span>
            </div>
          </>}

          {sec==="spaces"&&<SpacesAdmin spaces={spaces} onRefresh={()=>{ api.get("/spaces").then(d=>setSpaces(d.spaces||[])); onSpacesUpdated?.(); }} layoutCfg={layoutCfg} setLayoutCfg={setLayoutCfg}/>}
          {sec==="tags"&&<TagsAdmin tags={tags} onRefresh={()=>api.get("/tags").then(d=>setTags(d.tags||[]))}/>}

          {sec==="permissions"&&<>
            <div className="fgt">Registration</div>
            <Tgl label="Allow public registration" desc="Anyone can sign up for an account" on={regCfg.open!==false} onChange={v=>setRegCfg(p=>({...p,open:v}))}/>
            <Tgl label="Require email verification" desc="Users must verify their email before posting" on={!!regCfg.require_email_verification} onChange={v=>setRegCfg(p=>({...p,require_email_verification:v}))}/>
            <F label="Minimum account age to post" hint="Hours a new account must exist before posting. 0 = no minimum.">
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <input className="fi" type="number" min="0" max="8760" style={{width:80}} value={regCfg.min_account_age_hours||0} onChange={e=>setRegCfg(p=>({...p,min_account_age_hours:parseInt(e.target.value)||0}))}/>
                <span style={{fontSize:13,color:"var(--t4)"}}>hours</span>
              </div>
            </F>

            <div className="fgt" style={{marginTop:20}}>Posting</div>
            <Tgl label="Allow guest browsing" desc="Non-logged-in users can read the forum. Disabling redirects guests to login." on={postCfg.guest_browsing!==false} onChange={v=>setPostCfg(p=>({...p,guest_browsing:v}))}/>
            <Tgl label="New users can post immediately" desc="If off, new user posts are queued for moderator approval." on={postCfg.instant_post!==false} onChange={v=>setPostCfg(p=>({...p,instant_post:v}))}/>
            <F label="Max posts per hour" hint="Per-user rate limit. 0 = unlimited.">
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <input className="fi" type="number" min="0" max="100" style={{width:80}} value={postCfg.max_posts_per_hour||0} onChange={e=>setPostCfg(p=>({...p,max_posts_per_hour:parseInt(e.target.value)||0}))}/>
                <span style={{fontSize:13,color:"var(--t4)"}}>per hour</span>
              </div>
            </F>
            <F label="Who can create spaces">
              <select className="fi" value={postCfg.who_can_create_spaces||"admin"} onChange={e=>setPostCfg(p=>({...p,who_can_create_spaces:e.target.value}))}>
                <option value="admin">Admins only</option>
                <option value="moderator">Moderators and admins</option>
                <option value="member">All members</option>
              </select>
            </F>
            <F label="Who can upload images">
              <select className="fi" value={postCfg.who_can_upload||"member"} onChange={e=>setPostCfg(p=>({...p,who_can_upload:e.target.value}))}>
                <option value="admin">Admins only</option>
                <option value="moderator">Moderators and admins</option>
                <option value="member">All members</option>
              </select>
            </F>
            <div style={{display:"flex",gap:8,marginTop:8}}>
              <button className="btn-primary" style={{fontSize:12,padding:"6px 18px"}} onClick={async()=>{setSaving(true);try{await api.patch("/admin/settings/registration",{value:regCfg});await api.patch("/admin/settings/posting",{value:postCfg});toast("Permissions saved");}finally{setSaving(false);}}} disabled={saving}>{saving?"…":"Save permissions"}</button>
            </div>
          </>}

          {sec==="moderation"&&<>
            <div className="fgt">Pending approval</div>
            {pendingItems.length===0
              ?<div style={{fontSize:13,color:"var(--t5)",padding:"12px 0",marginBottom:16}}>No content pending approval</div>
              :<div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden",marginBottom:20}}>
                {pendingItems.map(item=>(
                  <div key={`${item.type}-${item.id}`} style={{padding:"12px 16px",borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"flex-start",gap:12}}>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                        <span style={{fontSize:10,background:"var(--bg3)",borderRadius:4,padding:"2px 6px",color:"var(--t4)"}}>{item.type}</span>
                        <span style={{fontSize:12,color:"var(--t4)"}}>{item.user?.username}</span>
                        <span style={{fontSize:11,color:"var(--t5)"}}>{ago(item.inserted_at)}</span>
                      </div>
                      {item.title&&<div style={{fontSize:13,fontWeight:500,color:"var(--t1)",marginBottom:4}}>{item.title}</div>}
                      <div style={{fontSize:12,color:"var(--t3)",lineHeight:1.5}}>{item.body?.slice(0,200)}</div>
                    </div>
                    <div style={{display:"flex",gap:8,flexShrink:0}}>
                      <button className="btn-ghost" style={{fontSize:11,padding:"4px 12px",color:"var(--green)"}} onClick={async()=>{
                        await api.post(`/admin/pending/${item.type}/${item.id}/approve`,{});
                        setPendingItems(p=>p.filter(x=>!(x.type===item.type&&x.id===item.id)));
                        toast("Approved");
                      }}>Approve</button>
                      <button className="btn-ghost" style={{fontSize:11,padding:"4px 12px",color:"var(--red)"}} onClick={async()=>{
                        if(!confirm("Reject and delete this content?"))return;
                        await api.delete(`/admin/pending/${item.type}/${item.id}`);
                        setPendingItems(p=>p.filter(x=>!(x.type===item.type&&x.id===item.id)));
                        toast("Rejected");
                      }}>Reject</button>
                    </div>
                  </div>
                ))}
              </div>}
            <div className="fgt">Content rules</div>
            <Tgl label="Auto-hide reported content" desc="Content with 3+ reports is automatically hidden pending review" on={!!general.auto_hide_reported} onChange={v=>setGeneral(p=>({...p,auto_hide_reported:v}))}/>
            <Tgl label="Notify mods of new reports" desc="Send email to moderators when content is reported" on={!!general.notify_mods_reports} onChange={v=>setGeneral(p=>({...p,notify_mods_reports:v}))}/>
            <div className="fgt" style={{marginTop:16}}>Audit log</div>
            <div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden"}}>
              {modLogs.length===0?<div style={{padding:"16px 14px",color:"var(--t5)",fontSize:13}}>No actions yet</div>
                :modLogs.slice(0,20).map(l=>(
                  <div key={l.id} style={{display:"flex",alignItems:"baseline",gap:10,padding:"9px 14px",borderBottom:"0.5px solid var(--b1)"}}>
                    <div style={{fontSize:11,color:"var(--t5)",minWidth:70}}>{ago(l.inserted_at)}</div>
                    <div style={{fontSize:12,color:"var(--ac-text)",minWidth:90}}>{l.moderator?.username}</div>
                    <div style={{fontSize:12,color:"var(--t3)",flex:1}}>{l.action}{l.reason&&` — ${l.reason}`}</div>
                  </div>
                ))}
            </div>
          </>}

          {sec==="badges"&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--t5)"}}>
            <i className="fa-solid fa-medal" style={{fontSize:28,opacity:.3,marginBottom:12,display:"block"}}></i>
            Badge system coming soon
          </div>}

          {sec==="storage"&&<>
            {/* Upload Settings */}
            <div className="fgt">Upload settings</div>
            <F label="Max file size" hint="Per-file limit for all uploads">
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <input className="fi" type="number" min="1" max="100" style={{width:80}} value={uploadCfg.max_size_mb||5} onChange={e=>setUploadCfg(p=>({...p,max_size_mb:parseInt(e.target.value)||5}))}/>
                <span style={{fontSize:13,color:"var(--t4)"}}>MB</span>
              </div>
            </F>
            <F label="Max image width" hint="Images wider than this are resized on upload. Avatars always max at 400px.">
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <input className="fi" type="number" min="400" max="4000" style={{width:100}} value={uploadCfg.max_width||1200} onChange={e=>setUploadCfg(p=>({...p,max_width:parseInt(e.target.value)||1200}))}/>
                <span style={{fontSize:13,color:"var(--t4)"}}>px wide</span>
              </div>
            </F>
            <F label="Convert to WebP" hint="Serve smaller WebP versions embedded in posts. Originals are always kept.">
              <Tgl label="Enabled" on={uploadCfg.convert_to_webp!==false} onChange={v=>setUploadCfg(p=>({...p,convert_to_webp:v}))}/>
            </F>
            {uploadCfg.convert_to_webp!==false&&<F label="WebP quality" hint="1–100. 80–90 is a good balance of size and quality.">
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <input type="range" min="50" max="100" value={uploadCfg.webp_quality||85} onChange={e=>setUploadCfg(p=>({...p,webp_quality:parseInt(e.target.value)}))} style={{flex:1,accentColor:"var(--ac)"}}/>
                <span style={{fontSize:13,color:"var(--ac)",fontVariantNumeric:"tabular-nums",minWidth:28}}>{uploadCfg.webp_quality||85}</span>
              </div>
            </F>}
            <div style={{display:"flex",gap:8,marginTop:4}}>
              <button className="btn-primary" style={{fontSize:12,padding:"6px 18px"}} onClick={async()=>{setSaving(true);try{await api.patch("/admin/settings/uploads",{value:uploadCfg});toast("Upload settings saved");}finally{setSaving(false);}}} disabled={saving}>{saving?"…":"Save upload settings"}</button>
            </div>

            {/* Storage stats */}
            <div className="fgt" style={{marginTop:28}}>Storage usage</div>
            {uploadStats
              ?<>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10,marginBottom:20}}>
                  {[
                    {k:"post_image", label:"Post images", icon:"fa-image"},
                    {k:"avatar",     label:"Avatars",     icon:"fa-circle-user"},
                    {k:"logo",       label:"Logos",       icon:"fa-palette"},
                    {k:"favicon",    label:"Favicons",    icon:"fa-star"},
                  ].map(({k,label,icon})=>{
                    const s=uploadStats.by_type?.[k]||{count:0,bytes:0};
                    return <div key={k} style={{background:"var(--bg2)",borderRadius:10,padding:"12px 14px",border:"0.5px solid var(--b1)"}}>
                      <i className={`fa-solid ${icon}`} style={{fontSize:14,color:"var(--ac)",marginBottom:6,display:"block"}}></i>
                      <div style={{fontSize:18,fontWeight:600,color:"var(--t1)"}}>{s.count}</div>
                      <div style={{fontSize:11,color:"var(--t5)"}}>{label}</div>
                      <div style={{fontSize:12,color:"var(--t5)",marginTop:3}}>{fmtBytes(s.bytes)}</div>
                    </div>;
                  })}
                </div>
                <div style={{fontSize:12,color:"var(--t4)",marginBottom:20}}>
                  Total: <strong style={{color:"var(--t2)"}}>{uploadStats.total_count} files</strong> · <strong style={{color:"var(--t2)"}}>{fmtBytes(uploadStats.total_bytes)}</strong>
                </div>
              </>
              :<div style={{fontSize:13,color:"var(--t5)",padding:"12px 0"}}>Loading stats…</div>}

            {/* Upload browser */}
            <div className="fgt" style={{marginTop:8}}>All uploads</div>
            <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
              {["","post_image","avatar","logo","favicon"].map(f=>(
                <button key={f} className={uploadFilter===f?"btn-primary":"btn-ghost"} style={{fontSize:11,padding:"4px 12px",borderRadius:20}} onClick={()=>setUploadFilter(f)}>
                  {f||"all"}
                </button>
              ))}
              <button className="btn-ghost" style={{fontSize:11,padding:"4px 12px",borderRadius:20,marginLeft:"auto"}} onClick={fetchUploadData}>
                <i className="fa-solid fa-rotate" style={{marginRight:4}}></i>Refresh
              </button>
            </div>
            {uploads.length===0
              ?<div style={{padding:"20px 0",color:"var(--t5)",fontSize:13}}>No uploads yet</div>
              :<div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden"}}>
                <table className="atbl">
                  <thead><tr><th style={{width:48}}>File</th><th>Name</th><th>Type</th><th>Size</th><th>Dims</th><th>By</th><th>Date</th><th style={{width:40}}></th></tr></thead>
                  <tbody>
                    {uploads.map(u=>(
                      <tr key={u.id}>
                        <td>
                          {u.url&&<img src={u.url} style={{width:36,height:36,objectFit:"cover",borderRadius:4,border:"0.5px solid var(--b1)"}} alt=""/>}
                        </td>
                        <td style={{maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:11,color:"var(--t3)"}}>{u.original_name}</td>
                        <td><span style={{fontSize:10,background:"var(--bg3)",borderRadius:4,padding:"2px 6px",color:"var(--t4)"}}>{u.upload_type}</span></td>
                        <td style={{fontSize:11,color:"var(--t5)"}}>{fmtBytes(u.size_bytes)}</td>
                        <td style={{fontSize:11,color:"var(--t5)"}}>{u.width&&u.height?`${u.width}×${u.height}`:"-"}</td>
                        <td style={{fontSize:11,color:"var(--t4)"}}>{u.user?.username||"-"}</td>
                        <td style={{fontSize:11,color:"var(--t5)"}}>{ago(u.inserted_at)}</td>
                        <td>
                          <span style={{fontSize:11,color:"var(--red)",cursor:"pointer"}} onClick={async()=>{
                            if(!confirm("Delete this file?"))return;
                            await api.delete(`/admin/uploads/${u.id}`);
                            setUploads(p=>p.filter(x=>x.id!==u.id));
                            fetchUploadData();
                            toast("Deleted");
                          }}>✕</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
          </>}

          {sec==="layout"&&<LayoutAdmin layoutCfg={layoutCfg} setLayoutCfg={setLayoutCfg}/>}
          {(sec==="logs"||sec==="updates")&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--t5)"}}>
            <i className="fa-solid fa-tools" style={{fontSize:28,opacity:.3,marginBottom:12,display:"block"}}></i>
            This section is not yet available
          </div>}

        </div>
      </div>
    </div>
    {/* Create User Modal */}
    {showCreateUser&&(
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:400,padding:20}} onClick={e=>e.target===e.currentTarget&&setShowCreateUser(false)}>
        <div style={{background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:16,padding:24,width:"100%",maxWidth:420,display:"flex",flexDirection:"column",gap:14}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{fontSize:15,fontWeight:600,color:"var(--t1)"}}>Create member</div>
            <button onClick={()=>setShowCreateUser(false)} style={{background:"none",border:"none",color:"var(--t4)",fontSize:18,cursor:"pointer"}}>✕</button>
          </div>
          <div><label style={{fontSize:12,color:"var(--t4)",display:"block",marginBottom:6}}>Username</label><input className="fi" value={newUser.username} onChange={e=>setNewUser(p=>({...p,username:e.target.value}))} placeholder="username"/></div>
          <div><label style={{fontSize:12,color:"var(--t4)",display:"block",marginBottom:6}}>Email</label><input className="fi" type="email" value={newUser.email} onChange={e=>setNewUser(p=>({...p,email:e.target.value}))} placeholder="user@example.com"/></div>
          <div><label style={{fontSize:12,color:"var(--t4)",display:"block",marginBottom:6}}>Password</label><input className="fi" type="password" value={newUser.password} onChange={e=>setNewUser(p=>({...p,password:e.target.value}))} placeholder="Temporary password"/></div>
          <div><label style={{fontSize:12,color:"var(--t4)",display:"block",marginBottom:6}}>Role</label>
            <select className="fi" value={newUser.role} onChange={e=>setNewUser(p=>({...p,role:e.target.value}))} style={{fontFamily:"inherit"}}>
              <option value="member">Member</option><option value="moderator">Moderator</option><option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label style={{fontSize:12,color:"var(--t4)",display:"block",marginBottom:8}}>Email verification</label>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {[{v:true,label:"Skip — mark as verified immediately",desc:"User can post right away"},{v:false,label:"Require email verification",desc:"User receives a verification email first"}].map(function(opt){return (
                <div key={String(opt.v)} onClick={()=>setNewUser(p=>({...p,skip_verification:opt.v}))}
                  style={{padding:"10px 12px",borderRadius:8,cursor:"pointer",border:`0.5px solid ${newUser.skip_verification===opt.v?"var(--ac-border)":"rgba(255,255,255,0.08)"}`,background:newUser.skip_verification===opt.v?"var(--ac-bg)":"rgba(255,255,255,0.03)"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
                    <i className={`fa-solid ${newUser.skip_verification===opt.v?"fa-circle-dot":"fa-circle"}`} style={{fontSize:11,color:newUser.skip_verification===opt.v?"var(--ac)":"var(--t5)"}}/>
                    <span style={{fontSize:13,color:"var(--t2)",fontWeight:500}}>{opt.label}</span>
                  </div>
                  <div style={{fontSize:11,color:"var(--t5)",paddingLeft:19}}>{opt.desc}</div>
                </div>
              );})}
            </div>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:4}}>
            <button className="btn-ghost" onClick={()=>setShowCreateUser(false)}>Cancel</button>
            <button className="btn-primary" style={{fontSize:13,padding:"7px 20px"}}
              disabled={!newUser.username.trim()||!newUser.email.trim()||!newUser.password.trim()}
              onClick={async()=>{
                const d=await api.post("/admin/users",{...newUser});
                if(d.user){setUsers(p=>[...p,d.user]);setShowCreateUser(false);toast("User created");}
                else toast((d.errors&&Object.values(d.errors).flat().join(", "))||d.error||"Failed","err");
              }}>
              Create member
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// ── Saved ─────────────────────────────────────────────────────────────────────
// ── Settings ──────────────────────────────────────────────────────────────────
function SettingsPage({currentUser, onUpdate, navigate}) {
  const [tab,setTab]=useState("profile");
  const [profile,setProfile]=useState({username:currentUser?.username||"",bio:currentUser?.bio||""});
  const [pw,setPw]=useState({current:"",next:"",confirm:""});
  const [saving,setSaving]=useState(false);
  const [pwErr,setPwErr]=useState(null);

  const saveProfile=async()=>{
    setSaving(true);
    try {
      const d=await api.patch("/auth/me",{username:profile.username,bio:profile.bio});
      if(d.user){onUpdate(d.user);toast("Profile updated");}
      else toast(d.error||Object.values(d.errors||{}).flat().join(", ")||"Failed","err");
    } finally { setSaving(false); }
  };

  const savePassword=async()=>{
    setPwErr(null);
    if(pw.next!==pw.confirm){setPwErr("Passwords don't match");return;}
    if(pw.next.length<8){setPwErr("Password must be at least 8 characters");return;}
    setSaving(true);
    try {
      const d=await api.patch("/auth/me",{current_password:pw.current,new_password:pw.next});
      if(d.ok){toast("Password updated");setPw({current:"",next:"",confirm:""});}
      else setPwErr(d.error||"Failed");
    } finally { setSaving(false); }
  };

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{height:48,borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"center",padding:"0 24px",flexShrink:0}}>
        <span style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>Settings</span>
      </div>
      <div style={{flex:1,display:"flex",overflow:"hidden"}}>
        {/* Settings sidenav */}
        <div style={{width:180,borderRight:"0.5px solid var(--b1)",padding:"12px 0",flexShrink:0}}>
          {[{k:"profile",icon:"fa-user",label:"Profile"},{k:"password",icon:"fa-lock",label:"Password"},{k:"notifications",icon:"fa-bell",label:"Notifications"}].map(s=>(
            <div key={s.k} className={`sb-item ${tab===s.k?"active":""}`} onClick={()=>setTab(s.k)}>
              <i className={`fa-solid ${s.icon}`}></i>
              <span className="sb-item-name">{s.label}</span>
            </div>
          ))}
        </div>
        {/* Settings content */}
        <div style={{flex:1,overflow:"auto",padding:"24px 32px",maxWidth:560}}>
          {tab==="profile"&&<>
            <div style={{fontSize:15,fontWeight:600,color:"var(--t1)",marginBottom:20}}>Profile</div>
            <F label="Username" hint="Changing your username will affect your profile URL">
              <input className="fi" value={profile.username} onChange={e=>setProfile(p=>({...p,username:e.target.value}))}/>
            </F>
            <F label="Bio">
              <textarea className="fi" style={{resize:"vertical",minHeight:80}} value={profile.bio} onChange={e=>setProfile(p=>({...p,bio:e.target.value}))} placeholder="Tell the community a bit about yourself…"/>
            </F>
            <button className="btn-primary" onClick={saveProfile} disabled={saving}>{saving?"Saving…":"Save profile"}</button>
          </>}

          {tab==="password"&&<>
            <div style={{fontSize:15,fontWeight:600,color:"var(--t1)",marginBottom:20}}>Change password</div>
            <F label="Current password">
              <input className="fi" type="password" placeholder="••••••••" value={pw.current} onChange={e=>setPw(p=>({...p,current:e.target.value}))}/>
            </F>
            <F label="New password" hint="Minimum 8 characters">
              <input className="fi" type="password" placeholder="••••••••" value={pw.next} onChange={e=>setPw(p=>({...p,next:e.target.value}))}/>
            </F>
            <F label="Confirm new password">
              <input className="fi" type="password" placeholder="••••••••" value={pw.confirm} onChange={e=>setPw(p=>({...p,confirm:e.target.value}))}/>
            </F>
            {pwErr&&<div className="ferr" style={{marginBottom:12}}>{pwErr}</div>}
            <button className="btn-primary" onClick={savePassword} disabled={saving||!pw.current||!pw.next}>{saving?"Saving…":"Update password"}</button>
          </>}

          {tab==="notifications"&&<>
            <div style={{fontSize:15,fontWeight:600,color:"var(--t1)",marginBottom:20}}>Notification preferences</div>
            <div style={{fontSize:13,color:"var(--t4)"}}>Notification preferences coming soon. You currently receive notifications for replies and reactions to your posts.</div>
          </>}
        </div>
      </div>
    </div>
  );
}

function SavedPage({navigate}) {
  // Saved posts would require a bookmarks API — stub for now showing empty state
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{height:48,borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"center",padding:"0 24px",flexShrink:0}}>
        <span style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>Saved</span>
      </div>
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:"var(--t5)"}}>
        <i className="fa-solid fa-bookmark" style={{fontSize:28,opacity:.3}}></i>
        <div style={{fontSize:13}}>No saved posts yet</div>
        <div style={{fontSize:12,color:"var(--t5)"}}>Bookmark posts to find them here</div>
      </div>
    </div>
  );
}

// ── Members ───────────────────────────────────────────────────────────────────
function MemberCard({m, navigate, currentUser}) {
  const col = spaceColor({id:m.id});
  const ROLE_COLOR = {admin:"var(--amber)", moderator:"var(--ac)", member:"var(--t5)"};
  const ROLE_BG    = {admin:"rgba(251,191,36,.15)", moderator:"var(--ac-bg)", member:"rgba(255,255,255,0.05)"};
  const [fullUser, setFullUser] = useState(null);
  const stats = fullUser ? {post_count:fullUser.post_count||0,reply_count:fullUser.reply_count||0,reactions_received:fullUser.reactions_received||0} : null;

  useEffect(()=>{
    api.get(`/users/${m.username}`).then(d=>{
      if(d.user) setFullUser(d.user);
    });
  },[m.username]);

  const cover_url = fullUser?.cover_url || m.cover_url;
  const bio = fullUser?.bio || m.bio;

  const startDM = async e => {
    e.stopPropagation();
    const d = await api.post("/threads/direct",{username:m.username});
    if(d.thread) navigate("dm",{threadId:d.thread.id,threadName:m.username});
    else toast(d.error||"Could not start conversation","err");
  };

  return (
    <div style={{background:"var(--s2)",border:"0.5px solid var(--b1)",borderRadius:16,overflow:"hidden",
      cursor:"pointer",transition:"border-color .15s, box-shadow .15s",boxShadow:"none"}}
      onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--b2)";e.currentTarget.style.boxShadow="0 6px 24px rgba(0,0,0,.3)";}}
      onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--b1)";e.currentTarget.style.boxShadow="none";}}>
      {/* Cover */}
      <div style={{height:90,position:"relative",background:cover_url?`url(${cover_url}) center/cover`:`linear-gradient(135deg,#1e1c2e,#312e55)`}}>
        <div style={{position:"absolute",bottom:-36,left:16}}>
          {m.avatar_url
            ?<img src={m.avatar_url} style={{width:72,height:72,borderRadius:"var(--av-radius)",border:"3px solid var(--s2)",objectFit:"cover"}} alt={m.username}/>
            :<div style={{width:72,height:72,borderRadius:"var(--av-radius)",border:"3px solid var(--s2)",background:col,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:600,color:"#fff"}}>
              {m.username.slice(0,2).toUpperCase()}
            </div>}
        </div>
      </div>
      {/* Body */}
      <div style={{padding:"10px 16px 16px",paddingTop:44}}>
        {/* Name + role */}
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:4}}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:15,fontWeight:500,color:"var(--t1)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
              onClick={()=>navigate("profile",{username:m.username})}>{m.username}</div>
            <div style={{fontSize:12,color:"var(--t5)",marginTop:2}}>Joined {fmtDate(m.inserted_at)}</div>
          </div>
          {m.role&&m.role!=="member"&&<div style={{fontSize:11,padding:"3px 8px",borderRadius:6,background:ROLE_BG[m.role],color:ROLE_COLOR[m.role],border:`0.5px solid ${ROLE_COLOR[m.role]}44`,flexShrink:0}}>{m.role}</div>}
        </div>
        {/* Bio */}
        {bio&&<p style={{fontSize:13,color:"var(--t3)",margin:"0 0 10px",lineHeight:1.5,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{bio}</p>}
        {/* Stats */}
        <div style={{display:"flex",gap:6,marginBottom:10}}>
          <div className="ucard-stat"><div className="ucard-stat-n">{stats?stats.post_count:"·"}</div><div className="ucard-stat-l">posts</div></div>
          <div className="ucard-stat"><div className="ucard-stat-n">{stats?stats.reply_count:"·"}</div><div className="ucard-stat-l">replies</div></div>
          <div className="ucard-stat"><div className="ucard-stat-n" style={{color:"var(--ac)"}}>{stats?stats.reactions_received:"·"}</div><div className="ucard-stat-l">reactions</div></div>
        </div>
        {/* Last seen */}
        {m.last_seen_at&&<div style={{fontSize:12,color:"var(--t5)",marginBottom:10,display:"flex",alignItems:"center",gap:5}}>
          <i className="fa-solid fa-clock" style={{fontSize:10}}/>Active {ago(m.last_seen_at)}
        </div>}
        {/* Actions */}
        <div style={{display:"flex",gap:7}}>
          {currentUser&&currentUser.username!==m.username&&<button className="btn-ghost" style={{flex:1,fontSize:13,padding:"8px 0",borderRadius:8}} onClick={startDM}>
            <i className="fa-solid fa-message" style={{fontSize:11,marginRight:5}}/>Message
          </button>}
          <button className="btn-ghost" style={{flex:1,fontSize:13,padding:"8px 0",borderRadius:8}} onClick={()=>navigate("profile",{username:m.username})}>
            <i className="fa-solid fa-user" style={{fontSize:11,marginRight:5}}/>Profile
          </button>
        </div>
      </div>
    </div>
  );
}

function MembersPage({navigate, currentUser}) {
  const [members,setMembers]=useState([]); const [loading,setLoading]=useState(true); const [q,setQ]=useState("");
  useEffect(()=>{
    const endpoint = currentUser?.role === "admin" ? "/admin/users" : "/users";
    api.get(endpoint).then(d=>{
      setMembers(d.users || d.members || []);
      setLoading(false);
    }).catch(()=>setLoading(false));
  },[currentUser]);
  const filtered = members.filter(m=>!q||m.username?.toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* Header */}
      <div style={{padding:"18px 24px 14px",borderBottom:"0.5px solid var(--b1)",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <div>
            <div style={{fontSize:18,fontWeight:600,color:"var(--t1)",letterSpacing:-0.3}}>Members</div>
            <div style={{fontSize:12,color:"var(--t5)",marginTop:2}}>{members.length} total</div>
          </div>
        </div>
        <div style={{background:"rgba(255,255,255,0.04)",border:"0.5px solid var(--b1)",borderRadius:20,display:"flex",alignItems:"center",padding:"7px 14px",gap:8,maxWidth:360}}>
          <i className="fa-solid fa-magnifying-glass" style={{fontSize:11,color:"var(--t5)"}}/>
          <input style={{background:"transparent",border:"none",outline:"none",fontSize:13,color:"var(--t2)",fontFamily:"inherit",flex:1}} placeholder="Search members…" value={q} onChange={e=>setQ(e.target.value)}/>
        </div>
      </div>
      {/* Grid */}
      <div style={{flex:1,overflowY:"auto",padding:"20px 24px"}}>
        {loading
          ?<div style={{padding:"40px",textAlign:"center",color:"var(--t5)"}}>Loading…</div>
          :filtered.length===0
            ?<div style={{padding:"40px",textAlign:"center",color:"var(--t5)"}}>No members found</div>
            :<div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14}}>
              {filtered.map(m=><MemberCard key={m.id} m={m} navigate={navigate} currentUser={currentUser}/>)}
            </div>}
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
          if (event === "new_notification" && topic === `notifications:${userId}`) {
            if (payload?.type === "dm") onNewMsgRef.current?.();
            else onNewNotifRef.current?.();
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
function AuthModalForm({mode, onLogin, onSwitch, registrationOpen=true}) {
  const [form,setForm]=useState({login:"",email:"",username:"",password:""});
  const [showPw,setShowPw]=useState(false);
  const [remember,setRemember]=useState(true);
  const [err,setErr]=useState(null); const [loading,setLoading]=useState(false);
  const submit=async e=>{
    e.preventDefault(); setLoading(true); setErr(null);
    try {
      const body = mode==="login"
        ? {email: form.login, password: form.password, remember_me: remember}
        : {email: form.email, username: form.username, password: form.password};
      const d=await api.post(mode==="login"?"/auth/login":"/auth/register", body);
      if(d.access_token){api.setToken(d.access_token);onLogin(d.user);}
      else setErr(d.errors?Object.values(d.errors).flat().join(", "):d.error||"Something went wrong");
    } finally { setLoading(false); }
  };
  return (
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
      {mode==="login"&&<label className="remember-row">
        <input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>
        <span>Remember me</span>
      </label>}
      {err&&<div className="ferr" style={{marginBottom:10}}>{err}</div>}
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

function MobileTopBar({onHamburger, onRight, branding}) {
  return (
    <div className="mob-topbar">
      <button className="mob-icon-btn" onClick={onHamburger} aria-label="Menu">
        <i className="fa-solid fa-bars"/>
      </button>
      <div className="mob-topbar-logo">
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
          {currentUser.avatar_url
            ? <img src={currentUser.avatar_url} style={{width:28,height:28,borderRadius:"var(--av-radius)",objectFit:"cover"}} alt={currentUser.username}/>
            : <i className="fa-solid fa-circle-user"/>}
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
      {registrationOpen
        ? <button className="mob-tab" onClick={()=>onAuthRequired?.("register")}>
            <i className="fa-solid fa-user-plus"/>
            <span className="mob-tab-label">Sign up</span>
          </button>
        : <button className="mob-tab" onClick={()=>onAuthRequired?.("login")}>
            <i className="fa-solid fa-arrow-right-to-bracket"/>
            <span className="mob-tab-label">Login</span>
          </button>}
    </div>
  );
}

function MobileUserMenu({user, navigate, onLogout, open, onClose}) {
  if(!user) return null;
  return (
    <div className={`mob-user-overlay ${open?"open":""}`}>
      <div className="mob-overlay-head">
        <span className="mob-overlay-title">Account</span>
        <button className="mob-icon-btn" onClick={onClose}><i className="fa-solid fa-xmark"/></button>
      </div>
      <div style={{padding:"20px 16px",borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"center",gap:14}}>
        {user.avatar_url
          ? <img src={user.avatar_url} style={{width:56,height:56,borderRadius:"var(--av-radius)",objectFit:"cover"}} alt={user.username}/>
          : <div style={{width:56,height:56,borderRadius:"var(--av-radius)",background:spaceColor({id:user.id}),display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:600,color:"#fff"}}>{(user.username||"?").slice(0,2).toUpperCase()}</div>}
        <div>
          <div style={{fontSize:16,fontWeight:600,color:"var(--t1)"}}>{user.username}</div>
          <div style={{fontSize:12,color:"var(--t5)",marginTop:2}}>@{user.username?.toLowerCase()} · {user.role}</div>
        </div>
      </div>
      {[
        {icon:"fa-user",label:"Profile",action:()=>{navigate("profile",{username:user.username});onClose();}},
        {icon:"fa-gear",label:"Settings",action:()=>{navigate("settings");onClose();}},
        ...(user.role==="admin"?[{icon:"fa-shield-halved",label:"Admin Panel",action:()=>{navigate("admin");onClose();}}]:[]),
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
function MobileScrubberBar({replies, scrollPct, displayIdx, onClick}) {
  return (
    <div className="mob-scrubber-bar" onClick={onClick}>
      <i className="fa-solid fa-list" style={{fontSize:11,color:"var(--t5)",flexShrink:0}}/>
      <div className="mob-scrubber-track">
        <div className="mob-scrubber-fill" style={{width:scrollPct+"%"}}/>
      </div>
      <span className="mob-scrubber-label">{displayIdx+1}/{replies.length}</span>
      <i className="fa-solid fa-chevron-up" style={{fontSize:10,color:"var(--t5)",flexShrink:0}}/>
    </div>
  );
}

function MobileScrubberSheet({open, onClose, replies, scrollPct, displayIdx, onJump}) {
  const trackRef = React.useRef();
  function handleTrack(e) {
    if(!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const pct = Math.max(0,Math.min(100,((e.clientY-rect.top)/rect.height)*100));
    onJump(Math.round((pct/100)*(replies.length-1)));
  }
  return (
    <div className={`mob-sheet ${open?"open":""}`}>
      <div className="mob-sheet-handle" onClick={onClose}/>
      <div style={{padding:"0 20px 8px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontSize:13,fontWeight:500,color:"var(--t1)"}}>Jump to reply</span>
        <span style={{fontSize:12,color:"var(--t4)"}}>{displayIdx+1} of {replies.length}</span>
      </div>
      <div style={{display:"flex",gap:16,padding:"0 20px 20px",alignItems:"stretch"}}>
        {/* Vertical track */}
        <div ref={trackRef} onClick={handleTrack}
          style={{width:44,background:"rgba(255,255,255,0.04)",border:"0.5px solid var(--b1)",borderRadius:10,position:"relative",cursor:"pointer",minHeight:200}}>
          <div style={{position:"absolute",left:"50%",top:0,bottom:0,width:4,transform:"translateX(-50%)",background:"rgba(255,255,255,0.08)",borderRadius:2}}/>
          <div style={{position:"absolute",left:"50%",top:0,width:4,transform:"translateX(-50%)",background:"var(--ac)",height:scrollPct+"%",borderRadius:2,transition:"height .2s"}}/>
          <div style={{position:"absolute",left:"50%",transform:"translate(-50%,-50%)",top:scrollPct+"%",width:16,height:16,borderRadius:"50%",background:"var(--ac)",border:"2px solid var(--bg)"}}/>
        </div>
        {/* Reply list */}
        <div style={{flex:1,overflow:"auto",maxHeight:260}}>
          {replies.map(function(r,i){
            var isActive = i===displayIdx;
            return React.createElement('div',{
              key:r.id, onClick:function(){onJump(i);},
              style:{padding:"10px 12px",borderRadius:8,marginBottom:4,cursor:"pointer",
                background:isActive?"var(--ac-bg)":"rgba(255,255,255,0.03)",
                border:"0.5px solid "+(isActive?"var(--ac-border)":"transparent")}
            },
              React.createElement('div',{style:{fontSize:12,fontWeight:500,color:isActive?"var(--ac-text)":"var(--t2)"}},
                (r.user?.username||"?")),
              React.createElement('div',{style:{fontSize:11,color:"var(--t5)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}},
                r.body?.slice(0,50)||"")
            );
          })}
        </div>
      </div>
    </div>
  );
}

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
  const [authChecked,setAuthChecked]=useState(()=>!!(localStorage.getItem("nexus_token")&&localStorage.getItem("nexus_user")));
  const [spaces,setSpaces]=useState([]);
  const [tags,setTags]=useState([]);
  const initial = urlToPage(window.location.pathname);
  const [page,setPage]=useState(initial.page);
  const [pageProps,setPageProps]=useState(initial.props);
  const [notifCount,setNotifCount]=useState(0);
  const [msgCount,setMsgCount]=useState(0);
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
        setPage(e.state.page);
        setPageProps(e.state.props||{});
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

  const {joinTopic, leaveTopic, sendEvent} = useSocket(
    api.token,
    currentUser?.id,
    useCallback(post=>{
      setLivePosts(p=>[post,...p]);
      setLiveEvents(p=>[{username:post.user?.username,userId:post.user?.id,action:`posted in ${post.space?.name||"general"}`,at:new Date().toISOString()},...p].slice(0,10));
    },[]),
    useCallback(()=>setNotifCount(c=>c+1),[]),
    useCallback(()=>setMsgCount(c=>c+1),[]),
    useCallback(count=>setNotifCount(count),[])
  );

  useEffect(()=>{
    if(api.token) api.request("GET", "/auth/me", null, true, true).then(d=>{
      if(d.user) updateCurrentUser(d.user);
      else if(d.error) { api.setToken(null); updateCurrentUser(null); }
      // If d is empty (network hiccup), keep existing cached user
      setAuthChecked(true);
    }).catch(()=>setAuthChecked(true));
    else setAuthChecked(true);
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
    api.get("/branding").then(d=>{const s=d.settings||{};applyBranding(s.appearance||{},s.general||{});setRegistrationOpen((s.registration||{}).open!==false);setAppBranding({...s.appearance||{},...s.general||{}});
      const lc=s.layout||{};
      if(lc.toolbar){var saved=lc.toolbar;var merged=saved.slice();TB_BTNS.forEach(function(def){if(def.sep)return;var exists=saved.some(function(s){return s.type===def.type;});if(!exists)merged.push(def);});lc.toolbar=merged;_activeToolbar=merged;}
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
    pollNotif(); pollMsg(); pollMod();
    const interval = setInterval(()=>{ pollNotif(); pollMsg(); pollMod(); }, 60000);
    return () => clearInterval(interval);
  },[currentUser]);

  useEffect(()=>{const fn=()=>{updateCurrentUser(null);setPage("feed");};window.addEventListener("nexus:logout",fn);return ()=>window.removeEventListener("nexus:logout",fn);},[]);

  const logout=()=>{api.post("/auth/logout",{});api.setToken(null);updateCurrentUser(null);window.history.pushState({},"","/");navigate("feed");};

  const [lb, setLb] = useLightbox();
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
      case "saved":       return requireAuth(<SavedPage navigate={navigate}/>);
      case "settings":    return requireAuth(<SettingsPage currentUser={currentUser} onUpdate={u=>updateCurrentUser(u)} navigate={navigate}/>);
      case "compose":     return requireAuth(<ComposePage spaces={spaces} tags={tags} navigate={navigate} currentUser={currentUser}/>);
      case "notifications": return requireAuth(<NotificationsPage navigate={navigate}/>);
      case "messages":    return requireAuth(<DMInboxPage key={msgPageKey} currentUser={currentUser} navigate={navigate} onOpen={()=>setMsgCount(0)}/>);
      case "dm":          return requireAuth(<DMPage threadId={pageProps.threadId} threadName={pageProps.threadName} threadImage={pageProps.threadImage} currentUser={currentUser} navigate={navigate} joinTopic={joinTopic} leaveTopic={leaveTopic} sendEvent={sendEvent}/>);
      case "dm-new":      return requireAuth(<DMNewPage navigate={navigate} currentUser={currentUser}/>);
      case "members":     return <MembersPage navigate={navigate} currentUser={currentUser}/>;
      case "post":        return <PostPage postId={pageProps.id} currentUser={currentUser} navigate={navigate} spaces={spaces} onAuthRequired={m=>setAuthModal(m)} joinTopic={joinTopic} leaveTopic={leaveTopic} sendEvent={sendEvent} openReport={pageProps.openReport} scrollToReply={pageProps.scrollToReply}/>;
      case "search":      return <SearchPage navigate={navigate} tags={tags} initialQ={pageProps?.q||""}/>;
      case "profile":     return <ProfilePage username={pageProps.username||currentUser?.username} currentUser={currentUser} navigate={navigate}/>;
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
            <Sidebar currentUser={currentUser} spaces={spaces} page={page} pageProps={pageProps} navigate={p=>{setMobLeftOpen(false);navigate(p);}} onLogout={logout} notifCount={notifCount} msgCount={msgCount} modReportCount={modReportCount} onAuthRequired={m=>setAuthModal(m)} layoutCfg={layoutCfg} mobile={true}/>
          </div>
        </div>
        <div className={`mob-overlay right ${mobRightOpen?"open":""}`}>
          <div className="mob-overlay-head">
            <span className="mob-overlay-title">Activity</span>
            <button className="mob-icon-btn" onClick={()=>setMobRightOpen(false)}><i className="fa-solid fa-xmark"/></button>
          </div>
          <div className="mob-overlay-body">
            <RightPanel spaces={spaces} liveEvents={liveEvents} layoutCfg={layoutCfg} mobile={true}/>
          </div>
        </div>
        <MobileUserMenu user={currentUser} navigate={navigate} onLogout={logout} open={mobUserOpen} onClose={()=>setMobUserOpen(false)}/>
        <MobileSearchOverlay open={mobSearchOpen} onClose={()=>setMobSearchOpen(false)} navigate={navigate}/>
        <MobileTopBar onHamburger={()=>setMobLeftOpen(true)} onRight={()=>setMobRightOpen(true)} branding={appBranding}/>
        <MobileTabBar currentUser={currentUser} navigate={navigate} page={page} notifCount={notifCount} msgCount={msgCount} onCompose={()=>navigate("compose")} onSearch={()=>setMobSearchOpen(true)} onProfile={()=>setMobUserOpen(true)} onAuthRequired={m=>setAuthModal(m)} registrationOpen={registrationOpen}/>
      <div className="app-shell">
        <Sidebar currentUser={currentUser} spaces={spaces} page={page} pageProps={pageProps} navigate={navigate} onLogout={logout} notifCount={notifCount} msgCount={msgCount} modReportCount={modReportCount} onAuthRequired={m=>setAuthModal(m)} layoutCfg={layoutCfg}/>
        <div className="main-area">
          <TopBar currentUser={currentUser} navigate={navigate} onLogout={logout} notifCount={notifCount} msgCount={msgCount} modReportCount={modReportCount} onSearch={q=>navigate("search",{q})} onAuthRequired={m=>setAuthModal(m)} registrationOpen={registrationOpen}/>
          <div className="page-area" style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            {renderPage()}
          </div>
        </div>
        <RightPanel spaces={spaces} liveEvents={liveEvents} layoutCfg={layoutCfg}/>
      </div>
      </div>
      {lb&&<Lightbox src={lb.src} originalSrc={lb.originalSrc} onClose={()=>setLb(null)}/>}
      {userCard&&<UserCardPopover card={userCard} setCard={setUserCard} currentUser={currentUser} navigate={navigate}/>}
      {authModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,padding:20}} onClick={e=>e.target===e.currentTarget&&setAuthModal(null)}>
          <div style={{width:"100%",maxWidth:440,background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:20,padding:40,position:"relative"}}>
            <button onClick={()=>setAuthModal(null)} style={{position:"absolute",top:16,right:18,background:"none",border:"none",color:"var(--t4)",fontSize:20,cursor:"pointer",lineHeight:1}}>✕</button>
            <div style={{textAlign:"center",marginBottom:28}}>
              <div style={{width:48,height:48,borderRadius:"50%",background:"linear-gradient(135deg,#a78bfa,#ec4899)",margin:"0 auto 12px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:"#fff",fontWeight:500}}>N</div>
              <div style={{fontSize:22,fontWeight:600,color:"var(--t1)"}}>{authModal==="login"?"Welcome back":"Create account"}</div>
              <div style={{fontSize:14,color:"var(--t4)",marginTop:6}}>{authModal==="login"?"Sign in to continue":"Join the community"}</div>
            </div>
            <AuthModalForm mode={authModal} onLogin={u=>{updateCurrentUser(u);setAuthModal(null);}} onSwitch={m=>setAuthModal(m)} registrationOpen={registrationOpen}/>
          </div>
        </div>
      )}
      <Toasts/>
    </>
  );
}

const root = document.getElementById("root");
if (root) ReactDOM.createRoot(root).render(<App/>);
