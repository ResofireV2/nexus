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
    if (ytId) return `<div class="md-embed"><iframe src="https://www.youtube-nocookie.com/embed/${ytId}" allowfullscreen loading="lazy" frameborder="0"></iframe></div>`;
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

function renderMd(t) { return t ? DOMPurify.sanitize(marked.parse(t), {
  ADD_TAGS: ["iframe", "video", "source", "audio"],
  ADD_ATTR: ["data-original", "data-lightbox-link", "allowfullscreen", "loading", "frameborder", "src", "controls", "preload"]
}) : ""; }
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

// Global lightbox state — lifted outside React so md-body img clicks can trigger it
let _lbSetState = null;
function useLightbox() {
  const [lb, setLb] = useState(null);
  useEffect(()=>{ _lbSetState = setLb; return ()=>{ _lbSetState=null; }; }, []);
  return [lb, setLb];
}
// Attach delegated click handler to .md-body images once at module load
document.addEventListener("click", e => {
  // Handle click on image directly
  const img = e.target.closest(".md-body img");
  if (!img) return;
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
  async request(method, path, body, retry=true) {
    const h = {"Content-Type":"application/json"};
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    const res = await fetch(`/api/v1${path}`, {method, headers:h, body: body ? JSON.stringify(body) : undefined, credentials:"include"});
    if (res.status === 401 && retry && path !== "/auth/refresh" && path !== "/auth/login") {
      // Try refreshing the token once
      const refreshed = await this.tryRefresh();
      if (refreshed) return this.request(method, path, body, false);
      this.setToken(null);
      window.dispatchEvent(new Event("nexus:logout"));
    }
    return res.json();
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
  delete: p => api.request("DELETE", p),
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
.app-shell{display:flex;height:100vh;overflow:hidden;}
.sidebar{width:220px;min-width:220px;background:var(--bg);border-right:0.5px solid var(--b1);display:flex;flex-direction:column;height:100vh;flex-shrink:0;overflow:hidden;}
.sb-logo{height:48px;display:flex;align-items:center;padding:0 18px;border-bottom:0.5px solid var(--b1);flex-shrink:0;}
.sb-scroll{flex:1;overflow-y:auto;padding:10px 0;}
.sb-label{font-size:10px;font-weight:500;color:var(--t5);letter-spacing:.8px;text-transform:uppercase;padding:0 16px;margin-bottom:4px;margin-top:14px;}
.sb-label:first-child{margin-top:2px;}
.sb-item{display:flex;align-items:center;gap:10px;padding:8px 16px;cursor:pointer;position:relative;transition:background .1s;}
.sb-item:hover{background:rgba(255,255,255,0.04);}
.sb-item.active{background:var(--ac-bg);}
.sb-item.active::before{content:'';position:absolute;left:0;top:4px;bottom:4px;width:2.5px;background:var(--ac);border-radius:0 2px 2px 0;}
.sb-item i{width:16px;text-align:center;font-size:13px;flex-shrink:0;color:var(--t3);}
.sb-item.active i{color:var(--ac);}
.sb-item-name{font-size:13px;color:var(--t3);flex:1;}
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
.icon-btn{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.05);border:0.5px solid rgba(255,255,255,0.09);display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;flex-shrink:0;transition:background .1s;color:rgba(255,255,255,0.55);}
.icon-btn:hover{background:rgba(255,255,255,0.09);}
.icon-badge{position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:var(--ac);border:1.5px solid var(--bg);}
.icon-badge.green{background:var(--green);}
.write-btn{font-size:13px;color:#0d0d14;background:var(--ac);border:none;border-radius:24px;padding:9px 22px;font-weight:500;cursor:pointer;white-space:nowrap;transition:opacity .1s;}
.write-btn:hover{opacity:.9;}

/* Avatar menu */
.av-wrap{position:relative;margin-left:2px;}
.av-circle{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#a78bfa,#ec4899);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:500;color:#fff;cursor:pointer;border:2px solid transparent;transition:border-color .15s;flex-shrink:0;overflow:hidden;}
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
.right-panel{width:220px;min-width:220px;border-left:0.5px solid var(--b1);padding:16px 14px;display:flex;flex-direction:column;gap:16px;overflow-y:auto;flex-shrink:0;}
.rw{border-radius:12px;border:0.5px solid rgba(255,255,255,0.08);padding:13px 14px;}
.rw-label{font-size:10px;font-weight:500;color:var(--t5);text-transform:uppercase;letter-spacing:.8px;margin-bottom:11px;}
.live-row{display:flex;align-items:flex-start;gap:8px;padding:5px 0;}
.l-av{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:500;color:#fff;flex-shrink:0;margin-top:1px;}
.l-txt{font-size:11px;color:var(--t3);line-height:1.5;flex:1;}
.l-txt strong{color:var(--t2);font-weight:500;}
.l-ago{font-size:10px;color:var(--t5);flex-shrink:0;margin-top:2px;}
.pulse-row{display:flex;align-items:center;gap:8px;padding:5px 0;}
.p-name{font-size:11px;color:var(--t3);width:68px;flex-shrink:0;display:flex;align-items:center;gap:6px;}
.p-bar-wrap{flex:1;height:3px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;}
.p-bar{height:3px;border-radius:3px;}
.p-count{font-size:10px;color:var(--t4);width:24px;text-align:right;flex-shrink:0;}
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.stat-card{background:rgba(255,255,255,0.04);border-radius:8px;padding:10px 12px;}
.stat-n{font-size:18px;font-weight:500;color:#e8e4ff;line-height:1;}
.stat-l{font-size:10px;color:var(--t4);margin-top:3px;}

/* Post view */
.post-shell{flex:1;display:flex;overflow:hidden;}
.post-content-wrap{flex:1;overflow-y:auto;padding:24px 28px;}
.post-back{font-size:12px;color:var(--t4);cursor:pointer;display:flex;align-items:center;gap:6px;margin-bottom:18px;transition:color .1s;}
.post-back:hover{color:var(--t2);}
.post-title{font-size:20px;font-weight:600;color:var(--t1);letter-spacing:-.3px;line-height:1.35;margin-bottom:12px;}
.post-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px;}
.post-body{font-size:14px;color:var(--t3);line-height:1.75;padding-bottom:18px;border-bottom:0.5px solid var(--b1);}
.reaction-row{display:flex;gap:6px;padding:12px 0;flex-wrap:wrap;}
.rx-btn{font-size:12px;color:var(--t4);padding:4px 11px;border:0.5px solid rgba(255,255,255,0.1);border-radius:20px;cursor:pointer;background:rgba(255,255,255,0.03);transition:all .1s;}
.rx-btn:hover{border-color:var(--b2);color:var(--t2);}
.rx-btn.lit{background:var(--ac-bg);color:var(--ac-text);border-color:var(--ac-border);}
.replies-header{display:flex;align-items:center;padding:10px 0 6px;border-bottom:0.5px solid var(--b1);}
.replies-count{font-size:12px;color:var(--t3);}
.reply-item{padding:14px 0;border-bottom:0.5px solid rgba(255,255,255,0.04);display:flex;gap:12px;}
.reply-av{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:500;color:#fff;flex-shrink:0;margin-top:1px;}
.reply-body-wrap{flex:1;}
.reply-meta{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
.reply-author{font-size:13px;font-weight:500;color:var(--t2);}
.reply-time{font-size:11px;color:var(--t5);}
.reply-text{font-size:13px;color:var(--t3);line-height:1.65;}

/* Composer */
.composer-shell{flex:1;overflow-y:auto;padding:0;}
.composer-inner{max-width:680px;margin:0 auto;padding:32px 28px 40px;}
.comp-title-input{width:100%;background:transparent;border:none;outline:none;font-size:22px;font-weight:600;color:var(--t1);font-family:inherit;letter-spacing:-.3px;margin-bottom:8px;}
.comp-title-input::placeholder{color:rgba(255,255,255,0.15);}
.comp-meta-row{display:flex;align-items:center;gap:8px;padding:10px 0 16px;border-bottom:0.5px solid var(--b1);flex-wrap:wrap;margin-bottom:20px;}
.comp-sel{font-size:12px;padding:4px 12px;border-radius:20px;border:0.5px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:var(--t3);cursor:pointer;font-family:inherit;outline:none;}
.comp-tag-pill{font-size:11px;padding:3px 10px;border-radius:20px;background:var(--ac-bg);color:var(--ac-text);border:0.5px solid var(--ac-border);cursor:pointer;}
.comp-tag-add{font-size:12px;padding:4px 12px;border-radius:20px;border:0.5px solid rgba(255,255,255,0.08);background:transparent;color:var(--t4);cursor:pointer;}
.comp-body-area{position:relative;min-height:240px;}
.comp-ta{width:100%;background:transparent;border:none;outline:none;font-size:15px;color:var(--t3);line-height:1.75;font-family:inherit;resize:none;min-height:240px;caret-color:var(--ac);}
.comp-ta::placeholder{color:rgba(255,255,255,0.12);}
.comp-footer{display:flex;align-items:center;gap:10px;padding-top:16px;border-top:0.5px solid var(--b1);margin-top:16px;}
.comp-char{font-size:11px;color:var(--t5);}

/* Buttons */
.btn-primary{font-size:13px;padding:7px 20px;border-radius:20px;background:var(--ac);color:#0d0d14;border:none;cursor:pointer;font-family:inherit;font-weight:500;transition:opacity .1s;}
.btn-primary:hover{opacity:.9;}
.btn-primary:disabled{opacity:.4;cursor:not-allowed;}
.btn-ghost{font-size:12px;padding:6px 16px;border-radius:20px;background:transparent;border:0.5px solid rgba(255,255,255,0.12);color:var(--t3);cursor:pointer;font-family:inherit;transition:all .1s;}
.btn-ghost:hover{color:var(--t1);border-color:var(--b2);}

/* Tags / space pills */
.sp-tag{font-size:9px;font-weight:500;padding:2px 8px;border-radius:20px;text-transform:uppercase;letter-spacing:.4px;}

/* Reply box */
.reply-box{border:0.5px solid rgba(255,255,255,0.1);border-radius:12px;background:rgba(255,255,255,0.02);overflow:hidden;margin-top:16px;}
.reply-box-ta{width:100%;background:transparent;border:none;outline:none;font-size:13px;color:var(--t2);font-family:inherit;resize:none;min-height:72px;line-height:1.6;padding:14px 16px;caret-color:var(--ac);}
.reply-box-ta::placeholder{color:rgba(255,255,255,0.15);}
.reply-box-foot{padding:8px 12px;border-top:0.5px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:10px;}
.ed-toggle{display:flex;border:0.5px solid rgba(255,255,255,0.1);border-radius:20px;overflow:hidden;}
.ed-opt{font-size:11px;padding:3px 11px;color:var(--t4);cursor:pointer;}
.ed-opt.active{background:rgba(255,255,255,0.08);color:var(--t2);}

/* Floating rich text toolbar */
.float-tb{position:fixed;background:var(--s2);border:0.5px solid var(--b2);border-radius:999px;display:flex;align-items:center;gap:2px;padding:4px 8px;z-index:9999;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,.6);}
.float-tb-btn{font-size:12px;color:var(--t3);padding:4px 9px;border-radius:999px;cursor:pointer;border:none;background:transparent;font-family:inherit;transition:all .1s;}
.float-tb-btn:hover{background:rgba(255,255,255,0.08);color:var(--t1);}
.float-tb-sep{width:0.5px;height:14px;background:var(--b2);margin:0 2px;}
.slash-menu{position:fixed;background:var(--s2);border:0.5px solid var(--b2);border-radius:12px;width:214px;overflow:hidden;z-index:9999;box-shadow:0 6px 24px rgba(0,0,0,.6);}
.slash-item{display:flex;align-items:center;gap:10px;padding:9px 12px;font-size:13px;color:var(--t3);cursor:pointer;border-bottom:0.5px solid var(--b1);transition:background .1s;}
.slash-item:last-child{border-bottom:none;}
.slash-item:hover,.slash-item.sel{background:rgba(255,255,255,0.05);color:var(--t1);}
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
.admin-shell{display:flex;height:100vh;overflow:hidden;}
.admin-topbar{height:48px;background:var(--bg);border-bottom:0.5px solid var(--b1);display:flex;align-items:center;padding:0 20px;gap:12px;flex-shrink:0;}
.admin-badge{font-size:10px;font-weight:500;background:rgba(251,191,36,.15);color:var(--amber);border:0.5px solid rgba(251,191,36,.3);border-radius:20px;padding:3px 9px;display:flex;align-items:center;gap:5px;}
.admin-sidenav{width:220px;min-width:220px;border-right:0.5px solid var(--b1);display:flex;flex-direction:column;overflow:hidden;}
.admin-sidenav-scroll{flex:1;overflow-y:auto;padding:12px 0;}
.admin-sn-label{font-size:10px;font-weight:500;color:var(--t5);letter-spacing:.8px;text-transform:uppercase;padding:0 16px;margin-bottom:4px;margin-top:14px;}
.admin-sn-label:first-child{margin-top:2px;}
.admin-sn-item{display:flex;align-items:center;gap:10px;padding:8px 16px;cursor:pointer;position:relative;transition:background .1s;}
.admin-sn-item:hover{background:rgba(255,255,255,0.04);}
.admin-sn-item.active{background:var(--ac-bg);}
.admin-sn-item.active::before{content:'';position:absolute;left:0;top:4px;bottom:4px;width:2.5px;background:var(--ac);border-radius:0 2px 2px 0;}
.admin-sn-item i{width:16px;text-align:center;font-size:12px;flex-shrink:0;color:var(--t4);}
.admin-sn-item.active i{color:var(--ac);}
.admin-sn-item-name{font-size:13px;color:var(--t3);flex:1;}
.admin-sn-item.active .admin-sn-item-name{color:var(--ac-text);font-weight:500;}
.admin-sn-badge{font-size:10px;background:rgba(248,113,113,0.2);color:var(--red);border-radius:20px;padding:1px 7px;font-weight:500;}
.admin-content-wrap{flex:1;display:flex;flex-direction:column;overflow:hidden;}
.admin-content-header{padding:0 28px;height:52px;border-bottom:0.5px solid var(--b1);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
.admin-content-title{font-size:15px;font-weight:600;color:var(--t1);letter-spacing:-.2px;}
.admin-content-body{flex:1;overflow-y:auto;padding:24px 28px;}

/* Admin content bits */
.page-sub{font-size:13px;color:var(--t4);margin-bottom:20px;}
.admin-stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px;}
.admin-stat-card{background:rgba(255,255,255,0.03);border:0.5px solid rgba(255,255,255,0.08);border-radius:14px;padding:16px 18px;transition:border-color .1s;}
.admin-stat-card:hover{border-color:rgba(255,255,255,0.14);}
.asc-icon{width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;margin-bottom:10px;}
.asc-n{font-size:22px;font-weight:600;color:var(--t1);letter-spacing:-.5px;line-height:1;margin-bottom:4px;}
.asc-l{font-size:12px;color:var(--t4);}
.asc-delta{font-size:11px;margin-top:4px;display:flex;align-items:center;gap:4px;}
.delta-up{color:var(--green);}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;}
.panel{background:rgba(255,255,255,0.02);border:0.5px solid var(--b1);border-radius:14px;padding:18px 20px;}
.panel-title{font-size:13px;font-weight:500;color:var(--t3);margin-bottom:14px;display:flex;align-items:justify-content:space-between;}
.fgt{font-size:11px;color:var(--t3);letter-spacing:.05em;text-transform:uppercase;margin-bottom:12px;padding-bottom:8px;border-bottom:0.5px solid var(--b1);}
.f-label{font-size:12px;color:var(--t3);margin-bottom:5px;display:block;}
.f-hint{font-size:11px;color:var(--t5);margin-top:3px;}
.toggle-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:0.5px solid rgba(255,255,255,0.04);}
.toggle-row:last-child{border-bottom:none;}
.tgl{width:36px;height:20px;border-radius:20px;position:relative;cursor:pointer;transition:background .2s;}
.tgl-knob{position:absolute;top:3px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .2s;}
.atbl{width:100%;border-collapse:collapse;}
.atbl th{text-align:left;font-size:10px;color:var(--t5);padding:6px 10px;letter-spacing:.05em;text-transform:uppercase;border-bottom:0.5px solid var(--b1);}
.atbl td{padding:9px 10px;font-size:12px;color:var(--t3);border-bottom:0.5px solid rgba(255,255,255,0.04);}
.atbl tr:last-child td{border-bottom:none;}
.atbl tr:hover td{background:rgba(255,255,255,0.02);}

/* Notifications */
.notif-item{display:flex;align-items:flex-start;gap:12px;padding:14px 20px;border-bottom:0.5px solid var(--b1);cursor:pointer;transition:background .1s;}
.notif-item:hover{background:rgba(255,255,255,0.02);}
.notif-item.unread{background:rgba(167,139,250,0.04);}
.notif-pip{width:6px;height:6px;border-radius:50%;flex-shrink:0;margin-top:5px;}

/* DM */
.dm-shell{flex:1;display:flex;overflow:hidden;}
.dm-sidebar{width:260px;min-width:260px;border-right:0.5px solid var(--b1);display:flex;flex-direction:column;overflow:hidden;}
.dm-search{padding:10px 14px;border-bottom:0.5px solid var(--b1);flex-shrink:0;}
.dm-search-inner{background:rgba(255,255,255,0.04);border:0.5px solid rgba(255,255,255,0.09);border-radius:20px;display:flex;align-items:center;padding:7px 13px;gap:8px;}
.dm-search-inner input{background:transparent;border:none;outline:none;font-size:12px;color:var(--t2);font-family:inherit;flex:1;}
.dm-search-inner input::placeholder{color:var(--t5);}
.thread-row{display:flex;align-items:center;gap:12px;padding:11px 14px;cursor:pointer;border-bottom:0.5px solid rgba(255,255,255,0.04);transition:background .1s;}
.thread-row:hover,.thread-row.active{background:rgba(255,255,255,0.03);}
.thr-av{width:38px;height:38px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:500;color:#fff;}
.thr-name{font-size:13px;font-weight:500;color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.thr-preview{font-size:12px;color:var(--t5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.thr-unread{min-width:18px;height:18px;border-radius:20px;background:var(--ac);color:#fff;font-size:10px;font-weight:600;display:flex;align-items:center;justify-content:center;padding:0 5px;flex-shrink:0;}
.bubble{max-width:72%;padding:9px 13px;font-size:13px;line-height:1.5;border-radius:18px;word-break:break-word;}
.mine .bubble{background:var(--ac);color:#0d0d14;font-weight:500;border-bottom-right-radius:4px;}
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
.profile-av-ring{width:80px;height:80px;border-radius:50%;border:3px solid var(--bg);display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:#fff;flex-shrink:0;background:linear-gradient(135deg,#a78bfa,#ec4899);}
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
.md-body blockquote{border-left:2px solid var(--ac-border);padding-left:14px;color:var(--t4);margin:10px 0;}
.md-body strong{color:var(--t1);font-weight:600;}
.md-body a{color:var(--blue);}
.md-body ul,.md-body ol{padding-left:20px;margin-bottom:10px;}
.md-body img{max-width:100%;max-height:480px;border-radius:10px;border:0.5px solid var(--b1);display:block;margin:10px 0;cursor:zoom-in;object-fit:contain;background:var(--bg2);}
.md-body a:has(img){display:inline-block;}
.md-embed{position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:12px;margin:12px 0;background:var(--bg2);border:0.5px solid var(--b1);}
.md-embed iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:none;border-radius:12px;}
.md-embed-video{margin:12px 0;}
/* Lightbox */
.lb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out;}
.lb-overlay img{max-width:calc(100vw - 48px);max-height:calc(100vh - 80px);border-radius:10px;object-fit:contain;box-shadow:0 8px 48px rgba(0,0,0,.6);}
.lb-close{position:fixed;top:16px;right:20px;font-size:24px;color:rgba(255,255,255,.7);cursor:pointer;line-height:1;z-index:10000;}
.lb-close:hover{color:#fff;}
.lb-orig{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);font-size:12px;color:rgba(255,255,255,.5);cursor:pointer;}
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

// Space colors mapped to accent
const SPACE_COLORS = ["#a78bfa","#f472b6","#34d399","#60a5fa","#fbbf24","#f87171","#ec4899","#10b981"];
function spaceColor(space) { return space?.color || SPACE_COLORS[(space?.id||0) % SPACE_COLORS.length]; }

// Rounded-square avatar
function RsAv({user, size=34, color}) {
  const bg = color || SPACE_COLORS[(user?.id||0) % SPACE_COLORS.length];
  const initials = (user?.username||"?").slice(0,2).toUpperCase();
  if (user?.avatar_url) return (
    <img src={user.avatar_url} style={{width:size,height:size,borderRadius:Math.round(size*0.28),objectFit:"cover",flexShrink:0,border:`1px solid ${bg}33`}} alt={user.username}/>
  );
  return (
    <div style={{width:size,height:size,borderRadius:Math.round(size*0.28),background:`${bg}22`,color:bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:Math.round(size*0.32),fontWeight:500,flexShrink:0}}>
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
  if (p === "/messages")               return {page:"dm", props:{}};
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
    case "dm":            return props.threadId ? `/messages/${props.threadId}` : "/messages";
    case "admin":         return "/admin";
    case "settings":      return "/settings";
    case "members":       return "/members";
    case "saved":         return "/saved";
    default:              return "/";
  }
}
let _cssEl = null;
let _brandingState = {logo_url: null, site_name: null, favicon_url: null};
let _brandingListeners = [];
function onBrandingChange(fn) { _brandingListeners.push(fn); }
function setBrandingState(state) {
  _brandingState = {..._brandingState, ...state};
  _brandingListeners.forEach(fn => fn(_brandingState));
}

function applyBranding(app={}, gen={}) {
  const r = document.documentElement;
  if (app.accent_color) r.style.setProperty("--ac", app.accent_color);
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
  setBrandingState({logo_url: gen.logo_url||null, site_name: gen.site_name||null, favicon_url: gen.favicon_url||null});
}

// ── Rich Text Area ────────────────────────────────────────────────────────────
const SLASH_ITEMS = [
  {type:"image", icon:"🖼", label:"Image",      desc:"Upload or embed"},
  {type:"code",  icon:"</>",label:"Code block", desc:"Syntax highlighted"},
  {type:"quote", icon:'"',  label:"Blockquote", desc:"Highlight a quote"},
  {type:"divider",icon:"—", label:"Divider",    desc:"Horizontal rule"},
];
const TB_BTNS = [
  {type:"bold",   label:"B",   style:{fontWeight:700},                wrap:["**","**"]},
  {type:"italic", label:"I",   style:{fontStyle:"italic"},            wrap:["*","*"]},
  {type:"strike", label:"S",   style:{textDecoration:"line-through"}, wrap:["~~","~~"]},
  {sep:true},
  {type:"h1",     label:"H1",  style:{fontSize:11},                   wrap:["# ",""]},
  {type:"h2",     label:"H2",  style:{fontSize:11},                   wrap:["## ",""]},
  {sep:true},
  {type:"incode", label:"</>", style:{fontFamily:"monospace",fontSize:10}, wrap:["`","`"]},
  {type:"link",   label:"🔗",  style:{},                              wrap:["[","](url)"]},
];
let _floatTb=null, _slashMenu=null, _activeTA=null, _slashIdx=0;
function getTb() {
  if (!_floatTb) {
    _floatTb = document.createElement("div");
    _floatTb.className = "float-tb";
    _floatTb.style.display = "none";
    _floatTb.innerHTML = TB_BTNS.map(b => b.sep
      ? `<div class="float-tb-sep"></div>`
      : `<button class="float-tb-btn" data-type="${b.type}" style="${Object.entries(b.style).map(([k,v])=>`${k.replace(/[A-Z]/g,m=>'-'+m.toLowerCase())}:${v}`).join(';')}" onmousedown="event.preventDefault();_tbApply('${b.type}')">${b.label}</button>`
    ).join("");
    document.body.appendChild(_floatTb);
  }
  return _floatTb;
}
function getSm() {
  if (!_slashMenu) {
    _slashMenu = document.createElement("div");
    _slashMenu.className = "slash-menu";
    _slashMenu.style.display = "none";
    document.body.appendChild(_slashMenu);
  }
  return _slashMenu;
}
window._tbApply = function(type) {
  const ta = _activeTA; if (!ta) return;
  const b = TB_BTNS.find(x=>x.type===type); if (!b) return;
  const [before,after] = b.wrap;
  const s=ta.selectionStart, e=ta.selectionEnd;
  const sel=ta.value.slice(s,e)||"text";
  ta.value=ta.value.slice(0,s)+before+sel+after+ta.value.slice(e);
  ta.focus(); ta.setSelectionRange(s+before.length,s+before.length+sel.length);
  getTb().style.display="none";
  ta.dispatchEvent(new Event("input",{bubbles:true}));
};
window._smPick = function(type) {
  const ta = _activeTA; if (!ta) return;
  getSm().style.display="none";
  if (type === "image") {
    // Trigger the hidden file input attached to the active textarea's composer
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

function RichTextArea({value, onChange, placeholder, minHeight=200, autoFocus=false, currentUser=null}) {
  const taRef = useRef(); const wrapRef = useRef();
  const imgInputRef = useRef();
  const [uploading, setUploading] = useState(false);
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
  const handleSel = () => {
    const ta = taRef.current; if (!ta) return;
    _activeTA = ta;
    if (ta.selectionStart===ta.selectionEnd) { getTb().style.display="none"; return; }
    const rect = ta.getBoundingClientRect();
    const tb = getTb();
    const tbW = 260;
    const left = Math.max(rect.left, Math.min(rect.left+rect.width/2-tbW/2, rect.right-tbW));
    tb.style.cssText=`display:flex;position:fixed;top:${rect.top-48}px;left:${left}px;`;
  };
  const handleChange = e => {
    onChange(e.target.value);
    const last = e.target.value.split("\n").pop();
    const sm = getSm();
    if (/^\/(i|c|b|d|e)?$/.test(last)||last==="/") {
      _activeTA = taRef.current;
      buildSm();
      const rect = taRef.current.getBoundingClientRect();
      sm.style.cssText=`display:block;position:fixed;left:${rect.left}px;top:${rect.top-200}px;`;
    } else { sm.style.display="none"; }
  };
  const handleKeyDown = e => {
    const sm = getSm();
    if (sm.style.display==="none") return;
    const items = SLASH_ITEMS.length;
    if (e.key==="ArrowDown"){e.preventDefault();_smHover((_slashIdx+1)%items);}
    else if (e.key==="ArrowUp"){e.preventDefault();_smHover((_slashIdx-1+items)%items);}
    else if (e.key==="Enter"){e.preventDefault();window._smPick(SLASH_ITEMS[_slashIdx].type);}
    else if (e.key==="Escape"){sm.style.display="none";}
  };
  const handleBlur = () => {
    setTimeout(()=>{ getTb().style.display="none"; getSm().style.display="none"; }, 200);
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
    <div ref={wrapRef} style={{position:"relative"}}>
      {!value && <div style={{position:"absolute",top:0,left:0,fontSize:15,color:"rgba(255,255,255,0.12)",pointerEvents:"none",lineHeight:1.75}}>{placeholder}</div>}
      <textarea ref={taRef} value={value} onChange={handleChange} onKeyDown={handleKeyDown}
        onMouseUp={handleSel} onKeyUp={handleSel} onBlur={handleBlur} autoFocus={autoFocus}
        className="comp-ta" style={{minHeight}}
        onPaste={e=>{
          // Handle paste of image files directly into textarea
          const file = Array.from(e.clipboardData?.files||[]).find(f=>f.type.startsWith("image/"));
          if (file) { e.preventDefault(); handleImageFile(file); }
        }}
        onDrop={e=>{
          const file = Array.from(e.dataTransfer?.files||[]).find(f=>f.type.startsWith("image/"));
          if (file) { e.preventDefault(); handleImageFile(file); }
        }}
        onDragOver={e=>e.preventDefault()}
      />
      {/* Hidden file input — triggered by slash menu Image pick and the button below */}
      <input
        id="comp-img-input"
        ref={imgInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
        style={{display:"none"}}
        onChange={e=>handleImageFile(e.target.files[0])}
      />
      <div style={{display:"flex",alignItems:"center",gap:8,paddingTop:8,borderTop:"0.5px solid var(--b1)",marginTop:4}}>
        <label className={`comp-img-btn ${uploading?"uploading":""}`} htmlFor="comp-img-input" title="Upload image (or paste/drop)">
          {uploading
            ? <><i className="fa-solid fa-spinner fa-spin" style={{fontSize:11}}></i> Uploading…</>
            : <><i className="fa-solid fa-image" style={{fontSize:11}}></i> Add image</>}
        </label>
        <span style={{fontSize:11,color:"var(--t5)",marginLeft:2}}>or paste / drag &amp; drop</span>
      </div>
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
          <div className="fg"><label className="fl">Password</label><input className="fi" type="password" placeholder="••••••••" value={form.password} onChange={e=>setForm(p=>({...p,password:e.target.value}))} required/></div>
          {err&&<div className="ferr" style={{marginBottom:10}}>{err}</div>}
          <button className="btn-primary" style={{width:"100%",borderRadius:10,padding:"10px"}} disabled={loading}>{loading?"...":mode==="login"?"Sign in":"Create account"}</button>
        </form>
        <div className="auth-switch">{mode==="login"?<>No account? <span className="link" onClick={()=>{setMode("register");setErr(null);}}>Sign up</span></>:<>Have an account? <span className="link" onClick={()=>{setMode("login");setErr(null);}}>Sign in</span></>}</div>
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({currentUser, spaces, page, pageProps, navigate, onLogout, notifCount=0, msgCount=0, onAuthRequired}) {
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
    <div className="sidebar">
      <div className="sb-logo" style={{cursor:"pointer"}} onClick={()=>navigate("feed",{})}>
        {branding.logo_url
          ?<img src={branding.logo_url} style={{height:32,maxWidth:140,objectFit:"contain"}} alt={branding.site_name||"nexus"}/>
          :<span className="logo-text">{branding.site_name||<>nexus<em>.</em></>}</span>}
      </div>
      <div className="sb-scroll">
        <div className="sb-label">Explore</div>
        <SbItem icon="fa-border-all" label="Everything" targetPage="feed" targetProps={{}}/>
        <SbItem icon="fa-fire" label="Trending" targetPage="feed" targetProps={{sort:"top"}}/>
        {currentUser&&<SbItem icon="fa-bell" label="Notifications" targetPage="notifications" badge={notifCount}/>}
        {currentUser&&<SbItem icon="fa-message" label="Messages" targetPage="messages" badge={msgCount}/>}
        <SbItem icon="fa-magnifying-glass" label="Search" targetPage="search"/>
        <SbItem icon="fa-users" label="Members" targetPage="members"/>
        <div className="sb-divider"/>
        <div className="sb-label">Spaces</div>
        {spaces.map(s=>{
          const col = spaceColor(s);
          const active = page==="feed" && pageProps?.space===s.slug;
          return (
            <div key={s.id} className={`sb-item ${active?"active":""}`} onClick={()=>navigate("feed",{space:s.slug})}>
              <i className="fa-solid fa-layer-group" style={{color:active?col:undefined}}></i>
              <span className="sb-item-name">{s.name}</span>
              {s.post_count>0&&<span className="sb-item-count">{s.post_count}</span>}
            </div>
          );
        })}
        {currentUser&&<>
          <div className="sb-divider"/>
          <div className="sb-label">You</div>
          <SbItem icon="fa-rss" label="Following" targetPage="following" count={null}/>
          <SbItem icon="fa-bookmark" label="Saved" targetPage="saved" count={null}/>
          <SbItem icon="fa-pen-to-square" label="Your Threads" targetPage="profile" targetProps={{username:currentUser?.username}} count={null}/>
        </>}
        {currentUser?.role==="admin"&&<>
          <div className="sb-divider"/>
          <SbItem icon="fa-shield-halved" label="Admin Panel" targetPage="admin"/>
        </>}
        {!currentUser&&<>
          <div className="sb-divider"/>
          <div style={{padding:"12px 16px",display:"flex",flexDirection:"column",gap:8}}>
            <button onClick={()=>onAuthRequired?.("login")} style={{width:"100%",padding:"8px",borderRadius:8,background:"transparent",border:"0.5px solid var(--b2)",color:"var(--t3)",cursor:"pointer",fontFamily:"inherit",fontSize:12}}>Log in</button>
            <button onClick={()=>onAuthRequired?.("register")} style={{width:"100%",padding:"8px",borderRadius:8,background:"var(--ac)",border:"none",color:"#0d0d14",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:500}}>Sign up</button>
          </div>
        </>}
      </div>
    </div>
  );
}

// ── Shared topbar ─────────────────────────────────────────────────────────────
function TopBar({currentUser, navigate, onLogout, notifCount=0, msgCount=0, onSearch, onAuthRequired}) {
  const [q,setQ]=useState("");
  return (
    <div className="topbar">
      <div className="tb-search">
        <i className="fa-solid fa-magnifying-glass" style={{fontSize:14,color:"rgba(255,255,255,0.25)"}}></i>
        <input placeholder="search threads…" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&onSearch?.(q)}/>
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
          <button onClick={()=>onAuthRequired?.("login")} style={{fontSize:12,padding:"6px 16px",borderRadius:20,background:"transparent",border:"0.5px solid var(--b2)",color:"var(--t3)",cursor:"pointer",fontFamily:"inherit"}}>Log in</button>
          <button onClick={()=>onAuthRequired?.("register")} className="write-btn">Sign up</button>
        </>}
      </div>
    </div>
  );
}

// ── Right Panel ───────────────────────────────────────────────────────────────
function RightPanel({spaces, liveEvents=[]}) {
  const [stats, setStats] = useState({members:0, threads:0});
  useEffect(()=>{ api.get("/stats").then(d=>setStats(d)).catch(()=>{}); },[]);

  const sorted = [...spaces].sort((a,b)=>(b.post_count||0)-(a.post_count||0));
  const max = sorted[0]?.post_count||1;

  return (
    <div className="right-panel">
      <div className="rw">
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
      {sorted.length>0&&<div className="rw">
        <div className="rw-label">spaces by pulse</div>
        {sorted.slice(0,5).map(s=>{
          const col=spaceColor(s);
          const w=Math.max(8, Math.round((s.post_count||0)/max*100));
          return (
            <div key={s.id} className="pulse-row">
              <div className="p-name"><i className="fa-solid fa-layer-group" style={{fontSize:10,color:col,width:14,textAlign:"center"}}></i>{s.name.slice(0,7)}</div>
              <div className="p-bar-wrap"><div className="p-bar" style={{width:`${w}%`,background:col}}></div></div>
              <div className="p-count" style={{color:col}}>{s.post_count||0}</div>
            </div>
          );
        })}
      </div>}
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-n">{stats.threads}</div><div className="stat-l">threads</div></div>
        <div className="stat-card"><div className="stat-n" style={{color:"#34d399"}}>1</div><div className="stat-l">online</div></div>
        <div className="stat-card"><div className="stat-n">{stats.members}</div><div className="stat-l">members</div></div>
        <div className="stat-card"><div className="stat-n" style={{color:"#a78bfa"}}>—</div><div className="stat-l">your rank</div></div>
      </div>
    </div>
  );
}

// ── Feed ──────────────────────────────────────────────────────────────────────
function FeedPage({spaces, tags, currentUser, navigate, notifCount=0, msgCount=0, onLogout, spaceFilter, sortOverride, followingOnly=false, livePosts=[], liveEvents=[], onAuthRequired}) {
  const [sort,setSort]=useState(sortOverride||"latest");
  const [posts,setPosts]=useState([]); const [loading,setLoading]=useState(true);
  const [cursor,setCursor]=useState(null); const [hasMore,setHasMore]=useState(false);
  const [liveCount,setLiveCount]=useState(0);
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
      const d=await api.get(url); const np=d.posts||[];
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

  return (
    <div className="feed-wrap">
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
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
                  <div key={p.id} className="thread" onClick={()=>navigate("post",{id:p.id})}>
                    <div className="thread-main">
                      <div className="thread-accent" style={{background:col}}/>
                      <div style={{margin:"0 14px 0 18px",flexShrink:0}}><RsAv user={p.user} size={34} color={col}/></div>
                      <div className="thread-body">
                        <div className="thread-top">
                          <div className="thread-title">{p.title}</div>
                          {p.type&&p.type!=="discussion"&&<div className="thread-tag" style={{background:p.type==="announcement"?"rgba(251,191,36,0.15)":"rgba(96,165,250,0.15)",color:p.type==="announcement"?"var(--amber)":"var(--blue)"}}>{p.type}</div>}
                          {p.space&&<div className="thread-tag" style={{background:`${col}20`,color:col}}>{p.space.name}</div>}
                        </div>
                        {p.body&&<div className="thread-preview">{p.body.replace(/!\[.*?\]\(.*?\)/g,"").replace(/\[!\[.*?\]\(.*?\)\]\(.*?\)/g,"").replace(/\[[^\]]*\]\([^)]*\)/g,"").replace(/[#*`>]/g,"").trim().slice(0,120)}</div>}
                        <div className="participants-row">
                          <div className="av-stack">
                            <div className="pav" style={{background:col}}>{(p.user?.username||"?").slice(0,2).toUpperCase()}</div>
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
                          <div className="last-av" style={{background:col}}>{(p.user?.username||"?").slice(0,2).toUpperCase()}</div>
                          <div className="last-ago">{ago(p.last_reply_at||p.inserted_at)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            {hasMore&&<div style={{textAlign:"center",padding:16}}><button className="btn-ghost" onClick={()=>load(false,cursor)} disabled={loading}>Load more</button></div>}
          </div>
        </div>
        <RightPanel spaces={spaces} liveEvents={liveEvents}/>
      </div>
    </div>
  );
}

// ── Post view ─────────────────────────────────────────────────────────────────
function PostPage({postId, currentUser, navigate, spaces}) {
  const [post,setPost]=useState(null); const [replies,setReplies]=useState([]);
  const [loading,setLoading]=useState(true); const [replyBody,setReplyBody]=useState("");
  const [edMode,setEdMode]=useState("markdown"); const [submitting,setSubmitting]=useState(false);
  const [myRx,setMyRx]=useState(new Set());
  const [rxCounts,setRxCounts]=useState({});
  const [replyRxCounts,setReplyRxCounts]=useState({}); // {replyId: {emoji: count}}
  const [reportTarget,setReportTarget]=useState(null);
  const [reportReason,setReportReason]=useState("");
  const [reporting,setReporting]=useState(false);

  useEffect(()=>{
    (async()=>{ setLoading(true);
      try { const [pd,rd]=await Promise.all([api.get(`/posts/${postId}`),api.get(`/posts/${postId}/replies`)]);
        setPost(pd.post); setReplies(rd.replies||[]);
        const counts={};
        (pd.post?.reactions||[]).forEach(r=>{ counts[r.emoji]=r.count||0; });
        setRxCounts(counts);
        // Build per-reply emoji counts
        const rCounts={};
        (rd.replies||[]).forEach(reply=>{
          rCounts[reply.id]={};
          (reply.reactions||[]).forEach(rx=>{ rCounts[reply.id][rx.emoji]=rx.count||0; });
        });
        setReplyRxCounts(rCounts);
      }
      finally { setLoading(false); }
    })();
  },[postId]);

  const submitReply=async()=>{
    if(!replyBody.trim())return; setSubmitting(true);
    try { const d=await api.post(`/posts/${postId}/replies`,{body:replyBody});
      if(d.reply){setReplies(p=>[...p,d.reply]);setReplyBody("");setPost(p=>({...p,reply_count:p.reply_count+1}));}
      else toast(d.error||"Failed","err"); }
    finally { setSubmitting(false); }
  };
  const submitReport=async()=>{
    if(!reportReason.trim())return; setReporting(true);
    try {
      const payload = reportTarget.type==="post"
        ? {post_id:reportTarget.id, reason:reportReason}
        : {reply_id:reportTarget.id, reason:reportReason};
      await api.post("/reports", payload);
      setReportTarget(null); setReportReason(""); toast("Report submitted");
    } finally { setReporting(false); }
  };

  const isMod = currentUser?.role==="admin"||currentUser?.role==="moderator";
  const modAction=async(action)=>{
    await api.post(`/posts/${post.id}/${action}`,{});
    setPost(p=>({...p, [action]:!p[action]}));
    toast(action.charAt(0).toUpperCase()+action.slice(1)+"d");
  };
  const react=async(emoji, replyId=null)=>{
    const k=`${emoji}-${replyId||"post"}`; if(myRx.has(k))return;
    const payload = replyId ? {emoji, reply_id:replyId} : {emoji, post_id:post.id};
    await api.post("/reactions", payload);
    setMyRx(p=>new Set([...p,k]));
    if(!replyId) {
      setRxCounts(p=>({...p, [emoji]:(p[emoji]||0)+1}));
      setPost(p=>({...p,reaction_count:p.reaction_count+1}));
    } else {
      setReplyRxCounts(p=>({...p, [replyId]:{...(p[replyId]||{}), [emoji]:((p[replyId]||{})[emoji]||0)+1}}));
      setReplies(p=>p.map(r=>r.id===replyId?{...r,reaction_count:(r.reaction_count||0)+1}:r));
    }
  };

  const col = spaceColor(post?.space||{id:postId});

  if(loading) return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)"}}>Loading...</div>;
  if(!post) return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)"}}>Post not found.</div>;

  return (
    <div className="post-shell">
      {/* Report modal */}
      {reportTarget&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:20}} onClick={e=>e.target===e.currentTarget&&setReportTarget(null)}>
          <div style={{background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:12,padding:24,width:"100%",maxWidth:400}}>
            <div style={{fontSize:14,fontWeight:600,color:"var(--t1)",marginBottom:16}}>Report content</div>
            <textarea className="fi" style={{resize:"vertical",minHeight:80,borderRadius:8}} placeholder="Describe why this content violates the rules…" value={reportReason} onChange={e=>setReportReason(e.target.value)}/>
            <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}>
              <button className="btn-ghost" onClick={()=>setReportTarget(null)}>Cancel</button>
              <button className="btn-primary" onClick={submitReport} disabled={reporting||!reportReason.trim()}>{reporting?"Submitting…":"Submit report"}</button>
            </div>
          </div>
        </div>
      )}
      <div className="post-content-wrap">
        <div className="post-back" onClick={()=>navigate("feed")}><i className="fa-solid fa-arrow-left" style={{fontSize:11}}></i> back to feed</div>
        <div style={{display:"flex",alignItems:"flex-start",gap:14,marginBottom:16}}>
          <div style={{width:4,alignSelf:"stretch",background:col,borderRadius:2,flexShrink:0,minHeight:60}}/>
          <div style={{flex:1}}>
            <div className="post-title">{post.title}</div>
            <div className="post-meta">
              {post.space&&<div className="thread-tag" style={{background:`${col}20`,color:col}}>{post.space.name}</div>}
              {post.type&&post.type!=="discussion"&&<div className="thread-tag" style={{background:post.type==="announcement"?"rgba(251,191,36,0.15)":"rgba(96,165,250,0.15)",color:post.type==="announcement"?"var(--amber)":"var(--blue)"}}>{post.type}</div>}
              {post.tags?.map(t=><div key={t.id} className="thread-tag" style={{background:"rgba(255,255,255,0.05)",color:"var(--t3)"}}>{t.name}</div>)}
              <span style={{fontSize:12,color:"var(--t4)",cursor:"pointer"}} onClick={()=>navigate("profile",{username:post.user?.username})}>{post.user?.username}</span>
              <span style={{fontSize:11,color:"var(--t5)"}}>{ago(post.inserted_at)}</span>
              <span style={{marginLeft:"auto",display:"flex",gap:10,alignItems:"center"}}>
                {/* Report — shown to non-authors */}
                {currentUser&&currentUser?.id!==post.user?.id&&(
                  <span style={{fontSize:11,color:"var(--t4)",cursor:"pointer"}} onClick={()=>{setReportTarget({type:"post",id:post.id});setReportReason("");}}>report</span>
                )}
                {/* Mod actions */}
                {isMod&&<>
                  <span style={{fontSize:11,color:post.pinned?"var(--ac-text)":"var(--t4)",cursor:"pointer"}} onClick={()=>modAction("pin")}>{post.pinned?"unpin":"pin"}</span>
                  <span style={{fontSize:11,color:post.locked?"var(--amber)":"var(--t4)",cursor:"pointer"}} onClick={()=>modAction("lock")}>{post.locked?"unlock":"lock"}</span>
                  <span style={{fontSize:11,color:"var(--red)",cursor:"pointer"}} onClick={()=>modAction("hide")}>{post.hidden?"unhide":"hide"}</span>
                </>}
                {/* Delete — author or mod */}
                {(currentUser?.id===post.user?.id||isMod)&&(
                  <span style={{fontSize:11,color:"var(--red)",cursor:"pointer"}} onClick={async()=>{if(!confirm("Delete this post?"))return;await api.delete(`/posts/${post.id}`);navigate("feed");toast("Post deleted");}}>delete</span>
                )}
              </span>
            </div>
            <div className="post-body"><Md text={post.body}/></div>
            <div className="reaction-row">
              {["+1","❤","🔥","🎉","💡"].map(e=><div key={e} className={`rx-btn ${myRx.has(`${e}-post`)?"lit":""}`} onClick={()=>react(e)}>{e} · {rxCounts[e]||0}</div>)}
            </div>
          </div>
        </div>
        <div className="replies-header">
          <span className="replies-count">{post.reply_count} {post.reply_count===1?"reply":"replies"}</span>
          <span style={{marginLeft:"auto",fontSize:11,color:"var(--t5)"}}>oldest first</span>
        </div>
        {replies.map(r=>(
          <div key={r.id} className="reply-item">
            <div className="reply-av" style={{background:`${spaceColor({id:r.user?.id})}33`,color:spaceColor({id:r.user?.id})}}>
              {(r.user?.username||"?").slice(0,2).toUpperCase()}
            </div>
            <div className="reply-body-wrap">
              <div className="reply-meta">
                <span className="reply-author" style={{cursor:"pointer"}} onClick={()=>navigate("profile",{username:r.user?.username})}>{r.user?.username}</span>
                <span className="reply-time">{ago(r.inserted_at)}</span>
                <span style={{marginLeft:"auto",display:"flex",gap:10,alignItems:"center"}}>
                  {currentUser&&currentUser?.id!==r.user?.id&&(
                    <span style={{fontSize:11,color:"var(--t4)",cursor:"pointer"}} onClick={()=>{setReportTarget({type:"reply",id:r.id});setReportReason("");}}>report</span>
                  )}
                  {(currentUser?.id===r.user?.id||isMod)&&(
                    <span style={{fontSize:11,color:"var(--red)",cursor:"pointer"}} onClick={async()=>{if(!confirm("Delete this reply?"))return;await api.delete(`/posts/${postId}/replies/${r.id}`);setReplies(p=>p.filter(x=>x.id!==r.id));setPost(p=>({...p,reply_count:p.reply_count-1}));toast("Reply deleted");}}>delete</span>
                  )}
                </span>
              </div>
              <div className="reply-text"><Md text={r.body}/></div>
              <div className="reaction-row" style={{marginTop:8}}>
                {["+1","❤","🔥"].map(e=><div key={e} className={`rx-btn ${myRx.has(`${e}-${r.id}`)?"lit":""}`} onClick={()=>react(e,r.id)} style={{fontSize:11,padding:"3px 9px"}}>{e} · {(replyRxCounts[r.id]||{})[e]||0}</div>)}
              </div>
            </div>
          </div>
        ))}
        {currentUser&&!post.locked&&(
          <div style={{marginTop:20,paddingBottom:32}}>
            <div className="reply-box">
              <RichTextArea value={replyBody} onChange={setReplyBody} placeholder="Write a reply…" minHeight={72} currentUser={currentUser}/>
              <div className="reply-box-foot">
                <div className="ed-toggle">
                  <div className={`ed-opt ${edMode==="markdown"?"active":""}`} onClick={()=>setEdMode("markdown")}>Markdown</div>
                  <div className={`ed-opt ${edMode==="rich"?"active":""}`} onClick={()=>setEdMode("rich")}>Rich text</div>
                </div>
                <button className="btn-primary" style={{marginLeft:"auto",fontSize:12,padding:"6px 16px"}} onClick={submitReply} disabled={submitting||!replyBody.trim()}>{submitting?"…":"Reply"}</button>
              </div>
            </div>
          </div>
        )}
      </div>
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
      if(d.post){toast("Post published!");navigate("post",{id:d.post.id});}
      else toast(d.error||"Failed","err"); }
    finally { setLoading(false); }
  };
  return (
    <div className="composer-shell">
      <div style={{height:48,borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"center",padding:"0 28px",flexShrink:0}}>
        <span style={{fontSize:12,color:"var(--t4)",cursor:"pointer",display:"flex",alignItems:"center",gap:6}} onClick={()=>navigate("feed")}>
          <i className="fa-solid fa-arrow-left" style={{fontSize:11}}></i> back to feed
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
  const search=async()=>{if(!q.trim())return;setLoading(true);setResults(null);try{const d=await api.get(`/search?q=${encodeURIComponent(q)}`);setResults(d);}finally{setLoading(false);}};
  useEffect(()=>{if(initialQ)search();},[]);
  const hasResults = results && ((results.posts?.length||0) + (results.replies?.length||0)) > 0;
  return (
    <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
      <div style={{height:48,borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"center",padding:"0 24px",flexShrink:0}}>
        <span style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>Search</span>
      </div>
      <div className="search-wrap">
        <div className="search-bar">
          <input className="fi" style={{flex:1}} placeholder="Search threads and replies…" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&search()} autoFocus/>
          <button className="btn-primary" onClick={search} disabled={loading}>Search</button>
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
  const markRead=async n=>{
    if(!n.read){await api.patch(`/notifications/${n.id}/read`,{});setNotifs(p=>p.map(x=>x.id===n.id?{...x,read:true}:x));}
    if(n.type==="dm"&&n.data?.thread_id) navigate("dm",{threadId:n.data.thread_id,threadName:n.actor?.username||"DM"});
    else if(n.post_id) navigate("post",{id:n.post_id});
    else if(n.reply_id) api.get(`/posts/by-reply/${n.reply_id}`).then(d=>{ if(d.post_id) navigate("post",{id:d.post_id}); }).catch(()=>{});
  };
  const TYPE={reply:"replied to your post",mention:"mentioned you",reaction:"reacted to your post",dm:"sent you a message",announcement:"posted an announcement"};
  const ICON={reply:"fa-reply",mention:"fa-at",reaction:"fa-heart",dm:"fa-message",announcement:"fa-bullhorn"};
  const ICON_COLOR={reply:"var(--ac)",mention:"var(--blue)",reaction:"var(--red)",dm:"var(--green)",announcement:"var(--amber)"};
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{height:48,display:"flex",alignItems:"center",padding:"0 24px",gap:10,flexShrink:0,borderBottom:"0.5px solid var(--b1)"}}>
        <span style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>Notifications</span>
        {notifs.some(n=>!n.read)&&<button className="btn-ghost" style={{marginLeft:"auto",fontSize:11}} onClick={markAll}>Mark all read</button>}
      </div>
      <div style={{flex:1,overflowY:"auto",maxWidth:640,width:"100%"}}>
        {loading?<div style={{padding:"40px",textAlign:"center",color:"var(--t5)"}}>Loading…</div>
          :notifs.length===0?<div style={{padding:"60px",textAlign:"center",color:"var(--t5)"}}>No notifications yet</div>
          :notifs.map(n=>(
            <div key={n.id} className={`notif-item ${n.read?"":"unread"}`} onClick={()=>markRead(n)}>
              <div className="notif-pip" style={{background:n.read?"transparent":"var(--ac)"}}/>
              <div style={{width:32,height:32,borderRadius:"50%",background:`${ICON_COLOR[n.type]||"var(--ac)"}18`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <i className={`fa-solid ${ICON[n.type]||"fa-bell"}`} style={{fontSize:12,color:ICON_COLOR[n.type]||"var(--ac)"}}></i>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:13}}><strong style={{color:"var(--t1)"}}>{n.actor?.username||"Someone"}</strong> <span style={{color:"var(--t3)"}}>{TYPE[n.type]||n.type}</span></div>
                <div style={{fontSize:11,color:"var(--t5)",marginTop:2}}>{ago(n.inserted_at)}</div>
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
                ?<img src={user.avatar_url} style={{width:64,height:64,borderRadius:12,objectFit:"cover",border:"2px solid var(--bg)",display:"block"}} alt={username}/>
                :<div className="profile-av-ring">{(username||"?").slice(0,2).toUpperCase()}</div>}
              {isOwn&&<label style={{position:"absolute",inset:0,borderRadius:12,background:"rgba(0,0,0,0)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",transition:"background .15s"}}
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
    api.get("/threads").then(d=>{setThreads(d.threads||[]);setLoading(false);});
  },[]);
  const tname=t=>{const o=t.members?.find(m=>m.user_id!==currentUser?.id);return o?.user?.username||"Unknown";};
  const openThread=t=>{
    setReadIds(p=>new Set([...p,t.id]));
    api.post(`/threads/${t.id}/read`,{}).catch(()=>{});
    navigate("dm",{threadId:t.id,threadName:tname(t)});
  };
  const filtered = dmSearch ? threads.filter(t=>tname(t).toLowerCase().includes(dmSearch.toLowerCase())) : threads;
  const unread=filtered.filter(t=>t.unread_count>0&&!readIds.has(t.id));
  const read=filtered.filter(t=>!t.unread_count||t.unread_count===0||readIds.has(t.id));
  const ThreadRow=({t})=>(
    <div className="thread-row" onClick={()=>openThread(t)}>
      <div className="thr-av" style={{background:spaceColor({id:t.id})+"33",color:spaceColor({id:t.id})}}>{tname(t).slice(0,2).toUpperCase()}</div>
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
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)",fontSize:13}}>Select a conversation</div>
      </div>
    </div>
  );
}

function DMPage({threadId, threadName, currentUser, navigate}) {
  const [messages,setMessages]=useState([]); const [text,setText]=useState(""); const [sending,setSending]=useState(false); const endRef=useRef();
  useEffect(()=>{
    api.get(`/threads/${threadId}/messages`).then(d=>{setMessages(d.messages||[]);setTimeout(()=>endRef.current?.scrollIntoView(),50)});
    api.post(`/threads/${threadId}/read`,{}).catch(()=>{});
  },[threadId]);
  const send=async e=>{e.preventDefault();if(!text.trim())return;setSending(true);try{const d=await api.post(`/threads/${threadId}/messages`,{body:text});if(d.message){setMessages(p=>[...p,d.message]);setText("");setTimeout(()=>endRef.current?.scrollIntoView(),50);}}finally{setSending(false);}};
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{height:48,borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"center",padding:"0 24px",gap:10,flexShrink:0}}>
        <span style={{fontSize:12,color:"var(--t4)",cursor:"pointer"}} onClick={()=>navigate("messages")}>← Messages</span>
        <span style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>{threadName}</span>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px",display:"flex",flexDirection:"column",gap:2}}>
        {messages.map(m=>{
          const mine=m.user_id===currentUser?.id;
          return (
            <div key={m.id} className={mine?"mine":"theirs"} style={{display:"flex",flexDirection:"column",gap:2,marginBottom:8,alignItems:mine?"flex-end":"flex-start"}}>
              <div style={{display:"flex",alignItems:"flex-end",gap:6,flexDirection:mine?"row-reverse":"row"}}>
                <div className="bubble">{m.body}</div>
              </div>
            </div>
          );
        })}
        <div ref={endRef}/>
      </div>
      <form onSubmit={send} style={{borderTop:"0.5px solid var(--b1)",padding:"10px 20px",display:"flex",alignItems:"flex-end",gap:8,flexShrink:0}}>
        <div style={{flex:1,background:"rgba(255,255,255,0.04)",border:"0.5px solid var(--b2)",borderRadius:20,padding:"8px 16px"}}>
          <input style={{width:"100%",background:"transparent",border:"none",outline:"none",fontSize:13,color:"var(--t2)",fontFamily:"inherit"}} placeholder={`Message ${threadName}…`} value={text} onChange={e=>setText(e.target.value)}/>
        </div>
        <button type="submit" style={{width:36,height:36,borderRadius:"50%",background:"var(--ac)",border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}} disabled={!text.trim()||sending}>
          <i className="fa-solid fa-paper-plane" style={{fontSize:12,color:"#0d0d14"}}></i>
        </button>
      </form>
    </div>
  );
}

function DMNewPage({navigate}) {
  const [username,setUsername]=useState(""); const [loading,setLoading]=useState(false);
  const start=async e=>{e.preventDefault();if(!username.trim())return;setLoading(true);try{const d=await api.post("/threads/direct",{username});if(d.thread)navigate("dm",{threadId:d.thread.id,threadName:username});else toast(d.error||"User not found","err");}finally{setLoading(false);}};
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column"}}>
      <div style={{height:48,borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"center",padding:"0 24px",flexShrink:0}}>
        <span style={{fontSize:12,color:"var(--t4)",cursor:"pointer"}} onClick={()=>navigate("messages")}>← Messages</span>
      </div>
      <div style={{maxWidth:400,margin:"40px auto",padding:"0 20px"}}>
        <div style={{fontSize:16,fontWeight:600,marginBottom:20,color:"var(--t1)"}}>New message</div>
        <form onSubmit={start}>
          <div className="fg"><label className="fl">Username</label><input className="fi" placeholder="Search by username…" value={username} onChange={e=>setUsername(e.target.value)} autoFocus/></div>
          <button className="btn-primary" disabled={loading||!username.trim()}>{loading?"…":"Start conversation"}</button>
        </form>
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
      <div><div style={{fontSize:13,color:"var(--t2)"}}>{label}</div>{desc&&<div style={{fontSize:11,color:"var(--t5)",marginTop:2}}>{desc}</div>}</div>
      <div className="tgl" style={{background:on?"var(--ac)":"rgba(255,255,255,0.1)"}} onClick={()=>onChange(!on)}>
        <div className="tgl-knob" style={{left:on?18:3,background:on?"#fff":"rgba(255,255,255,0.4)"}}/>
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
                <span style={{fontSize:11,color:"var(--blue)",cursor:"pointer",marginRight:12}} onClick={()=>openEdit(t)}>edit</span>
                <span style={{fontSize:11,color:"var(--red)",cursor:"pointer"}} onClick={()=>del(t)}>delete</span>
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
function SpacesAdmin({spaces, onRefresh}) {
  const [editing,setEditing]=useState(null); // null | "new" | space object
  const [form,setForm]=useState({name:"",slug:"",description:"",color:"#a78bfa",visibility:"public"});
  const [saving,setSaving]=useState(false);

  const openNew=()=>{ setForm({name:"",slug:"",description:"",color:"#a78bfa",visibility:"public"}); setEditing("new"); };
  const openEdit=s=>{ setForm({name:s.name,slug:s.slug,description:s.description||"",color:s.color||"#a78bfa",visibility:s.visibility}); setEditing(s); };
  const close=()=>setEditing(null);

  const autoSlug=name=>name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");

  const save=async()=>{
    setSaving(true);
    try {
      if(editing==="new") {
        const d=await api.post("/spaces",form);
        if(d.space){toast("Space created");onRefresh();close();}
        else toast(d.error||"Failed","err");
      } else {
        const d=await api.patch(`/spaces/${editing.slug}`,form);
        if(d.space){toast("Space updated");onRefresh();close();}
        else toast(d.error||"Failed","err");
      }
    } finally { setSaving(false); }
  };

  const del=async(s)=>{
    if(!confirm(`Delete space "${s.name}"? This cannot be undone.`))return;
    await api.delete(`/spaces/${s.slug}`);
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
          <tbody>{spaces.map(s=>(
            <tr key={s.id}>
              <td><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{width:8,height:8,borderRadius:"50%",background:s.color||spaceColor(s),flexShrink:0}}></span><span style={{fontWeight:500,color:"var(--t1)"}}>{s.name}</span></div></td>
              <td style={{color:"var(--t5)",fontFamily:"monospace",fontSize:11}}>{s.slug}</td>
              <td><span style={{fontSize:10,padding:"2px 8px",borderRadius:20,background:"rgba(255,255,255,0.05)",color:"var(--t3)"}}>{s.visibility}</span></td>
              <td>{s.post_count||0}</td>
              <td style={{textAlign:"right"}}>
                <span style={{fontSize:11,color:"var(--blue)",cursor:"pointer",marginRight:12}} onClick={()=>openEdit(s)}>edit</span>
                <span style={{fontSize:11,color:"var(--red)",cursor:"pointer"}} onClick={()=>del(s)}>delete</span>
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
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
        <div><label className="f-label">Visibility</label>
          <select className="fi" value={form.visibility} onChange={e=>setForm(p=>({...p,visibility:e.target.value}))}>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </div>
        <div><label className="f-label">Color</label>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:4}}>
            {COLORS.map(c=><div key={c} onClick={()=>setForm(p=>({...p,color:c}))} style={{width:22,height:22,borderRadius:"50%",background:c,cursor:"pointer",border:`2px solid ${form.color===c?"#fff":"transparent"}`,transition:"border-color .1s"}}/>)}
          </div>
        </div>
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button className="btn-ghost" onClick={close}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving||!form.name.trim()||!form.slug.trim()}>{saving?"Saving…":"Save space"}</button>
      </div>
    </div>}
  </>;
}

function AdminPage({currentUser, navigate, onSpacesUpdated}) {
  const [sec,setSec]=useState("overview");
  const [stats,setStats]=useState(null); const [users,setUsers]=useState([]);
  const [spaces,setSpaces]=useState([]); const [tags,setTags]=useState([]);
  const [reports,setReports]=useState([]); const [modLogs,setModLogs]=useState([]);
  const [general,setGeneral]=useState({}); const [branding,setBranding]=useState({});
  const [emailCfg,setEmailCfg]=useState({}); const [saving,setSaving]=useState(false);
  const [uploadCfg,setUploadCfg]=useState({});
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
    api.get("/admin/users").then(d=>setUsers(d.users||[]));
    api.get("/spaces").then(d=>setSpaces(d.spaces||[]));
    api.get("/tags").then(d=>setTags(d.tags||[]));
    api.get("/reports").then(d=>setReports(d.reports||[]));
    api.get("/moderation/log").then(d=>setModLogs(d.logs||[]));
    api.get("/admin/settings").then(d=>{const s=d.settings||{};setGeneral(s.general||{});setBranding(s.appearance||{});setEmailCfg(s.email||{});setUploadCfg(s.uploads||{});});
  },[currentUser]);

  useEffect(()=>{
    if(currentUser?.role!=="admin")return;
    if(sec==="storage") fetchUploadData();
  },[sec, uploadFilter]);

  if(!currentUser||currentUser.role!=="admin") return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)"}}>Access denied</div>;
  const saveSection=async(key,value)=>{setSaving(true);try{await api.patch(`/admin/settings/${key}`,{value});toast("Saved");if(key==="appearance")applyBranding(value,general);}finally{setSaving(false);}};

  const NAV_SECTIONS = [
    {label:"forum settings", items:[
      {k:"overview",   icon:"fa-chart-line",     label:"overview"},
      {k:"forum-info", icon:"fa-circle-info",     label:"forum info"},
      {k:"branding",   icon:"fa-palette",         label:"branding"},
      {k:"appearance", icon:"fa-swatchbook",      label:"appearance"},
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
    <div className="admin-shell">
      <div className="admin-sidenav">
        <div className="admin-topbar" style={{borderBottom:"0.5px solid var(--b1)",height:48}}>
          <span className="logo-text">nexus<em>.</em></span>
          <div className="admin-badge"><i className="fa-solid fa-shield-halved" style={{fontSize:9}}></i>administration</div>
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
            <i className="fa-solid fa-arrow-left" style={{fontSize:11}}></i>
            <span className="admin-sn-item-name">view forum</span>
          </div>
        </div>
      </div>
      <div className="admin-content-wrap">
        <div className="admin-topbar">
          <div style={{flex:1}}/>
          <button className="btn-ghost" style={{fontSize:11}} onClick={()=>{ api.get("/admin/settings").then(d=>{const s=d.settings||{};setGeneral(s.general||{});setBranding(s.appearance||{});setEmailCfg(s.email||{});}); toast("Discarded"); }}>Discard</button>
          <button className="btn-primary" style={{fontSize:12,padding:"6px 18px"}} onClick={()=>{
            if(sec==="branding"||sec==="appearance") saveSection("appearance",branding);
            else if(sec==="email") saveSection("email",emailCfg);
            else if(sec==="forum-info") saveSection("general",general);
            else if(sec==="permissions") saveSection("permissions",general);
            else if(sec==="moderation") saveSection("moderation",general);
            else toast("No changes to save for this section");
          }} disabled={saving}>{saving?"…":"Save changes"}</button>
        </div>
        <div className="admin-content-body">

          {sec==="overview"&&<>
            <div className="page-sub">A snapshot of your community's health and activity.</div>
            <div className="admin-stat-row">
              {[
                {icon:"fa-users",color:"#a78bfa",n:stats?.users?.total??0,label:"total members",delta:"+0 this month"},
                {icon:"fa-circle-dot",color:"#34d399",n:stats?.users?.active??1,label:"online right now",delta:`peak: ${stats?.users?.total??1}`},
                {icon:"fa-comments",color:"#60a5fa",n:stats?.content?.posts??0,label:"threads total",delta:`+${stats?.content?.posts_today??0} today`},
                {icon:"fa-heart",color:"#fbbf24",n:0,label:"hearts given",delta:"+0 this week"},
              ].map((c,i)=>(
                <div key={i} className="admin-stat-card">
                  <div className="asc-icon" style={{background:`${c.color}18`}}><i className={`fa-solid ${c.icon}`} style={{color:c.color,fontSize:13}}></i></div>
                  <div className="asc-n" style={{color:c.color}}>{c.n.toLocaleString()}</div>
                  <div className="asc-l">{c.label}</div>
                  <div className="asc-delta delta-up">{c.delta}</div>
                </div>
              ))}
            </div>
          </>}

          {(sec==="forum-info")&&<>
            <div className="fgt">Forum identity</div>
            <F label="Forum name" hint="Appears in the browser tab and emails"><input className="fi" value={general.site_name||""} onChange={e=>setGeneral(p=>({...p,site_name:e.target.value}))} placeholder="Nexus"/></F>
            <F label="Forum description"><input className="fi" value={general.site_description||""} onChange={e=>setGeneral(p=>({...p,site_description:e.target.value}))} placeholder="A short description…"/></F>
            <F label="Base URL"><input className="fi" value={general.base_url||""} onChange={e=>setGeneral(p=>({...p,base_url:e.target.value}))} placeholder="forum.example.com"/></F>

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

          {(sec==="branding"||sec==="appearance")&&<>\
            <div className="fgt">Colors</div>
            <F label="Accent color" hint="Used for buttons, active states, and highlights">
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:36,height:36,borderRadius:8,background:branding.accent_color||"#a78bfa",border:"0.5px solid var(--b2)",cursor:"pointer",flexShrink:0}}/>
                <input className="fi" value={branding.accent_color||""} onChange={e=>setBranding(p=>({...p,accent_color:e.target.value}))} placeholder="#a78bfa" style={{fontFamily:"monospace"}}/>
              </div>
            </F>
            <div className="fgt" style={{marginTop:16}}>Custom CSS</div>
            <textarea className="fi" style={{fontFamily:"monospace",fontSize:12,minHeight:100,resize:"vertical",lineHeight:1.6,color:"var(--ac-text)"}} value={branding.custom_css||""} onChange={e=>setBranding(p=>({...p,custom_css:e.target.value}))} placeholder="/* Additional styles */"/>
          </>}

          {sec==="moderation"&&<>
            <div className="fgt">Mod queue</div>
            {reports.filter(r=>r.status==="pending").length===0
              ?<div style={{padding:"20px 0",color:"var(--t5)",fontSize:13}}>✓ No pending reports</div>
              :<div style={{border:"0.5px solid var(--b1)",borderRadius:12,overflow:"hidden",marginBottom:16}}>
                <table className="atbl"><thead><tr><th>Reported by</th><th>Content</th><th>Reason</th><th>Date</th><th></th></tr></thead>
                  <tbody>{reports.map(r=><tr key={r.id}><td>{r.reporter?.username}</td><td style={{color:"var(--ac-text)",cursor:"pointer"}}>{r.post_id?`Post #${r.post_id}`:`Reply #${r.reply_id}`}</td><td>{r.reason}</td><td style={{color:"var(--t5)",fontSize:11}}>{ago(r.inserted_at)}</td><td><span style={{color:"var(--blue)",cursor:"pointer",fontSize:11}} onClick={async()=>{await api.patch(`/reports/${r.id}`,{status:"actioned"});setReports(p=>p.filter(x=>x.id!==r.id));toast("Actioned");}}>Review</span></td></tr>)}</tbody>
                </table>
              </div>}
            <div className="fgt" style={{marginTop:20}}>Audit log</div>
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

          {sec==="members"&&<>
            <div className="fgt">All members</div>
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
                        {u.status==="banned"
                          ?<span style={{fontSize:11,color:"var(--green)",cursor:"pointer",marginRight:8}} onClick={async()=>{await api.delete(`/moderation/users/${u.username}/ban`);setUsers(p=>p.map(x=>x.id===u.id?{...x,status:"active"}:x));toast("User unbanned");}}>unban</span>
                          :<span style={{fontSize:11,color:"var(--red)",cursor:"pointer",marginRight:8}} onClick={async()=>{if(!confirm(`Ban ${u.username}?`))return;await api.post(`/moderation/users/${u.username}/ban`,{reason:"Admin action"});setUsers(p=>p.map(x=>x.id===u.id?{...x,status:"banned"}:x));toast("User banned");}}>ban</span>}
                        {u.status==="suspended"
                          ?<span style={{fontSize:11,color:"var(--green)",cursor:"pointer"}} onClick={async()=>{await api.delete(`/moderation/users/${u.username}/suspend`);setUsers(p=>p.map(x=>x.id===u.id?{...x,status:"active"}:x));toast("Suspension lifted");}}>unsuspend</span>
                          :<span style={{fontSize:11,color:"var(--amber)",cursor:"pointer"}} onClick={async()=>{if(!confirm(`Suspend ${u.username}?`))return;await api.post(`/moderation/users/${u.username}/suspend`,{reason:"Admin action"});setUsers(p=>p.map(x=>x.id===u.id?{...x,status:"suspended"}:x));toast("User suspended");}}>suspend</span>}
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

          {sec==="spaces"&&<SpacesAdmin spaces={spaces} onRefresh={()=>{ api.get("/spaces").then(d=>setSpaces(d.spaces||[])); onSpacesUpdated?.(); }}/>}
          {sec==="tags"&&<TagsAdmin tags={tags} onRefresh={()=>api.get("/tags").then(d=>setTags(d.tags||[]))}/>}

          {sec==="permissions"&&<>
            <div className="fgt">Registration</div>
            <Tgl label="Allow public registration" desc="Anyone can sign up for an account" on={general.allow_registration!==false} onChange={v=>setGeneral(p=>({...p,allow_registration:v}))}/>
            <Tgl label="Require email verification" desc="Users must verify their email before posting" on={!!general.require_email_verification} onChange={v=>setGeneral(p=>({...p,require_email_verification:v}))}/>
            <div className="fgt" style={{marginTop:16}}>Posting</div>
            <Tgl label="Allow guest browsing" desc="Non-logged-in users can read the forum" on={general.guest_browsing!==false} onChange={v=>setGeneral(p=>({...p,guest_browsing:v}))}/>
            <Tgl label="New users can post immediately" desc="No approval period for new accounts" on={general.instant_post!==false} onChange={v=>setGeneral(p=>({...p,instant_post:v}))}/>
          </>}

          {sec==="moderation"&&<>
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
                      <div style={{fontSize:11,color:"var(--t5)",marginTop:2}}>{fmtBytes(s.bytes)}</div>
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

          {(sec==="logs"||sec==="updates")&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--t5)"}}>
            <i className="fa-solid fa-tools" style={{fontSize:28,opacity:.3,marginBottom:12,display:"block"}}></i>
            This section is not yet available
          </div>}

        </div>
      </div>
    </div>
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
function MembersPage({navigate, currentUser}) {
  const [members,setMembers]=useState([]); const [loading,setLoading]=useState(true); const [q,setQ]=useState("");
  useEffect(()=>{
    // Admins get full list with emails; regular users get the public list
    const endpoint = currentUser?.role === "admin" ? "/admin/users" : "/users";
    api.get(endpoint).then(d=>{
      setMembers(d.users || d.members || []);
      setLoading(false);
    }).catch(()=>setLoading(false));
  },[currentUser]);
  const filtered = members.filter(m=>!q||m.username?.toLowerCase().includes(q.toLowerCase()));
  const ROLE_COLORS = {admin:"#fbbf24", moderator:"#a78bfa", member:null};
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{height:48,borderBottom:"0.5px solid var(--b1)",display:"flex",alignItems:"center",padding:"0 24px",gap:12,flexShrink:0}}>
        <span style={{fontSize:14,fontWeight:500,color:"var(--t1)"}}>Members</span>
        <span style={{fontSize:12,color:"var(--t5)"}}>{members.length} total</span>
      </div>
      <div style={{padding:"14px 24px 10px",borderBottom:"0.5px solid var(--b1)",flexShrink:0}}>
        <div style={{background:"rgba(255,255,255,0.04)",border:"0.5px solid var(--b1)",borderRadius:20,display:"flex",alignItems:"center",padding:"7px 14px",gap:8,maxWidth:320}}>
          <i className="fa-solid fa-magnifying-glass" style={{fontSize:11,color:"var(--t5)"}}></i>
          <input style={{background:"transparent",border:"none",outline:"none",fontSize:13,color:"var(--t2)",fontFamily:"inherit",flex:1}} placeholder="Search members…" value={q} onChange={e=>setQ(e.target.value)}/>
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"8px 24px"}}>
        {loading?<div style={{padding:"40px",textAlign:"center",color:"var(--t5)"}}>Loading…</div>
          :filtered.length===0?<div style={{padding:"40px",textAlign:"center",color:"var(--t5)"}}>No members found</div>
          :filtered.map(m=>{
            const col = spaceColor({id:m.id});
            const roleColor = ROLE_COLORS[m.role];
            return (
              <div key={m.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"0.5px solid rgba(255,255,255,0.04)",cursor:"pointer"}} onClick={()=>navigate("profile",{username:m.username})}>
                <div style={{width:38,height:38,borderRadius:"50%",background:`${col}33`,border:`0.5px solid ${col}55`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:500,color:col,flexShrink:0}}>
                  {m.username.slice(0,2).toUpperCase()}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:13,fontWeight:500,color:"var(--t2)"}}>{m.username}</span>
                    {roleColor&&<span style={{fontSize:9,fontWeight:500,padding:"2px 7px",borderRadius:20,background:`${roleColor}18`,color:roleColor,border:`0.5px solid ${roleColor}40`,textTransform:"uppercase",letterSpacing:".4px"}}>{m.role}</span>}
                  </div>
                  <div style={{fontSize:11,color:"var(--t5)",marginTop:2}}>joined {fmtDate(m.inserted_at)}</div>
                </div>
                <div style={{width:7,height:7,borderRadius:"50%",background:m.status==="active"?"var(--green)":"rgba(255,255,255,0.15)",flexShrink:0}}></div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function useSocket(token, userId, onNewPost, onNewNotif, onNewMsg, onUnreadCount) {
  const wsRef = useRef(null);
  const heartbeatRef = useRef(null);
  const refSeq = useRef(1);

  useEffect(() => {
    if (!token || !userId) return;
    const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/socket/websocket?token=${token}&vsn=2.0.0`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const send = (msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));

    ws.onopen = () => {
      // Join feed:global for new posts
      send([null, String(refSeq.current++), "feed:global", "phx_join", {}]);
      // Join personal notification channel
      send([null, String(refSeq.current++), `notifications:${userId}`, "phx_join", {}]);
      // Heartbeat every 30s
      heartbeatRef.current = setInterval(() => send([null, String(refSeq.current++), "phoenix", "heartbeat", {}]), 30000);
    };

    ws.onmessage = (e) => {
      try {
        const [, , topic, event, payload] = JSON.parse(e.data);
        if (event === "new_post" && topic === "feed:global") onNewPost?.(payload);
        if (event === "new_notification" && topic === `notifications:${userId}`) {
          if (payload?.type === "dm") onNewMsg?.();
          else onNewNotif?.();
        }
        if (event === "unread_count" && topic === `notifications:${userId}`) onUnreadCount?.(payload?.count||0);
      } catch {}
    };

    ws.onerror = () => {};
    ws.onclose = () => { clearInterval(heartbeatRef.current); };

    return () => {
      clearInterval(heartbeatRef.current);
      ws.close();
    };
  }, [token, userId]);
}

// ── Guest Prompt ──────────────────────────────────────────────────────────────
function GuestPrompt({onAuthRequired}) {
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,color:"var(--t5)"}}>
      <i className="fa-solid fa-lock" style={{fontSize:28,opacity:.3}}></i>
      <div style={{fontSize:14,color:"var(--t2)",fontWeight:500}}>Sign in to continue</div>
      <div style={{display:"flex",gap:10}}>
        <button className="btn-ghost" onClick={()=>onAuthRequired("login")}>Log in</button>
        <button className="btn-primary" onClick={()=>onAuthRequired("register")}>Sign up</button>
      </div>
    </div>
  );
}

// ── Auth Modal Form ───────────────────────────────────────────────────────────
function AuthModalForm({mode, onLogin, onSwitch}) {
  const [form,setForm]=useState({login:"",email:"",username:"",password:""});
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
      <div className="fg"><label className="fl">Password</label><input className="fi" type="password" placeholder="••••••••" value={form.password} onChange={e=>setForm(p=>({...p,password:e.target.value}))} required/></div>
      {mode==="login"&&<label className="remember-row">
        <input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>
        <span>Remember me</span>
      </label>}
      {err&&<div className="ferr" style={{marginBottom:10}}>{err}</div>}
      <button className="btn-primary" style={{width:"100%",borderRadius:12,padding:"12px",marginBottom:18,fontSize:15}} disabled={loading}>{loading?"...":mode==="login"?"Sign in":"Create account"}</button>
      <div style={{textAlign:"center",fontSize:13,color:"var(--t4)"}}>
        {mode==="login"
          ?<>No account? <span className="link" onClick={()=>{onSwitch("register");setErr(null);}}>Sign up</span></>
          :<>Have an account? <span className="link" onClick={()=>{onSwitch("login");setErr(null);}}>Sign in</span></>}
      </div>
    </form>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
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
  const [authChecked,setAuthChecked]=useState(false);
  const [spaces,setSpaces]=useState([]);
  const [tags,setTags]=useState([]);
  const initial = urlToPage(window.location.pathname);
  const [page,setPage]=useState(initial.page);
  const [pageProps,setPageProps]=useState(initial.props);
  const [notifCount,setNotifCount]=useState(0);
  const [msgCount,setMsgCount]=useState(0);
  const [livePosts,setLivePosts]=useState([]);
  const [liveEvents,setLiveEvents]=useState([]);
  const [authModal,setAuthModal]=useState(null); // null | "login" | "register"

  const navigate=useCallback((p,props={})=>{
    const url = pageToUrl(p, props);
    window.history.pushState({page:p, props}, "", url);
    setPage(p);setPageProps(props);window.scrollTo(0,0);
  },[]);

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

  useSocket(
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
    if(api.token) api.get("/auth/me").then(d=>{if(d.user)updateCurrentUser(d.user);setAuthChecked(true);}).catch(()=>setAuthChecked(true));
    else setAuthChecked(true);
  },[]);

  useEffect(()=>{loadSpaces();api.get("/tags").then(d=>setTags(d.tags||[]));},[]);

  useEffect(()=>{
    if(!currentUser) return;
    api.get("/admin/settings").then(d=>{const s=d.settings||{};applyBranding(s.appearance||{},s.general||{});}).catch(()=>{});
  },[currentUser]);

  useEffect(()=>{
    if(!currentUser) return;
    const pollNotif = () => api.get("/notifications/unread").then(d=>setNotifCount(d.count||0)).catch(()=>{});
    const pollMsg   = () => api.get("/threads/unread").then(d=>setMsgCount(d.unread||0)).catch(()=>{});
    pollNotif(); pollMsg();
    const interval = setInterval(()=>{ pollNotif(); pollMsg(); }, 60000);
    return () => clearInterval(interval);
  },[currentUser]);

  useEffect(()=>{const fn=()=>{updateCurrentUser(null);setPage("feed");};window.addEventListener("nexus:logout",fn);return ()=>window.removeEventListener("nexus:logout",fn);},[]);

  const logout=()=>{api.post("/auth/logout",{});api.setToken(null);updateCurrentUser(null);window.history.pushState({},"","/");navigate("feed");};

  const [lb, setLb] = useLightbox();

  if(!authChecked) return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--t5)"}}>Loading…</div>;

  // Admin gets its own full shell
  if(page==="admin"&&currentUser) return <><AdminPage currentUser={currentUser} navigate={navigate} onSpacesUpdated={loadSpaces}/><Toasts/></>;

  const renderPage=()=>{
    const requireAuth = (el) => {
      if(!currentUser) return <GuestPrompt onAuthRequired={m=>setAuthModal(m)}/>;
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
      case "messages":    return requireAuth(<DMInboxPage currentUser={currentUser} navigate={navigate} onOpen={()=>setMsgCount(0)}/>);
      case "dm":          return requireAuth(<DMPage threadId={pageProps.threadId} threadName={pageProps.threadName} currentUser={currentUser} navigate={navigate}/>);
      case "dm-new":      return requireAuth(<DMNewPage navigate={navigate}/>);
      case "members":     return <MembersPage navigate={navigate} currentUser={currentUser}/>;
      case "post":        return <PostPage postId={pageProps.id} currentUser={currentUser} navigate={navigate} spaces={spaces}/>;
      case "search":      return <SearchPage navigate={navigate} tags={tags} initialQ={pageProps?.q||""}/>;
      case "profile":     return <ProfilePage username={pageProps.username||currentUser?.username} currentUser={currentUser} navigate={navigate}/>;
      default:            return <FeedPage spaces={spaces} tags={tags} currentUser={currentUser} navigate={navigate} notifCount={notifCount} msgCount={msgCount} onLogout={logout} livePosts={livePosts} liveEvents={liveEvents}/>;
    }
  };

  return (
    <>
      <div className="app-shell">
        <Sidebar currentUser={currentUser} spaces={spaces} page={page} pageProps={pageProps} navigate={navigate} onLogout={logout} notifCount={notifCount} msgCount={msgCount} onAuthRequired={m=>setAuthModal(m)}/>
        <div className="main-area">
          <TopBar currentUser={currentUser} navigate={navigate} onLogout={logout} notifCount={notifCount} msgCount={msgCount} onSearch={q=>navigate("search",{q})} onAuthRequired={m=>setAuthModal(m)}/>
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            {renderPage()}
          </div>
        </div>
      </div>
      {lb&&<Lightbox src={lb.src} originalSrc={lb.originalSrc} onClose={()=>setLb(null)}/>}
      {authModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,padding:20}} onClick={e=>e.target===e.currentTarget&&setAuthModal(null)}>
          <div style={{width:"100%",maxWidth:440,background:"var(--s2)",border:"0.5px solid var(--b2)",borderRadius:20,padding:40,position:"relative"}}>
            <button onClick={()=>setAuthModal(null)} style={{position:"absolute",top:16,right:18,background:"none",border:"none",color:"var(--t4)",fontSize:20,cursor:"pointer",lineHeight:1}}>✕</button>
            <div style={{textAlign:"center",marginBottom:28}}>
              <div style={{width:48,height:48,borderRadius:"50%",background:"linear-gradient(135deg,#a78bfa,#ec4899)",margin:"0 auto 12px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:"#fff",fontWeight:500}}>N</div>
              <div style={{fontSize:22,fontWeight:600,color:"var(--t1)"}}>{authModal==="login"?"Welcome back":"Create account"}</div>
              <div style={{fontSize:14,color:"var(--t4)",marginTop:6}}>{authModal==="login"?"Sign in to continue":"Join the community"}</div>
            </div>
            <AuthModalForm mode={authModal} onLogin={u=>{updateCurrentUser(u);setAuthModal(null);}} onSwitch={m=>setAuthModal(m)}/>
          </div>
        </div>
      )}
      <Toasts/>
    </>
  );
}

const root = document.getElementById("root");
if (root) ReactDOM.createRoot(root).render(<App/>);
