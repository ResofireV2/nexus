import { marked } from "marked";
import DOMPurify from "dompurify";

// ── Markdown rendering ────────────────────────────────────────────────────────
// Single source of truth for all markdown parsing, sanitization, and
// media embedding. Import `Md` for rendering and `renderMd` for raw HTML.
//
// Usage:
//   import { Md } from "../components/Markdown";
//   <Md text={post.body} />

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

// ── Media embed helpers ───────────────────────────────────────────────────────

function getYouTubeId(url) {
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}
function getVimeoId(url) {
  const m = url.match(/vimeo\.com\/(?:video\/)?([0-9]+)/);
  return m ? m[1] : null;
}
function isVideoUrl(url) { return /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url); }
function isAudioUrl(url) { return /\.(mp3|ogg|wav|flac|m4a)(\?.*)?$/i.test(url); }

// Extract raw URL from either a plain URL or a GFM auto-linked <a href="url">url</a>
function extractBareUrl(text) {
  const stripped = text.trim();
  if (/^https?:\/\/[^\s<>"]+$/.test(stripped)) return stripped;
  const m = stripped.match(/^<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>.*<\/a>$/);
  if (m) return m[1];
  return null;
}

function makeYtEmbed(ytId) {
  return `<div class="yt-lite" data-id="${ytId}">
      <img class="yt-thumb" src="https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg" alt="YouTube video" loading="lazy" onerror="this.src='https://i.ytimg.com/vi/${ytId}/hqdefault.jpg'"/>
      <div class="yt-play"><svg viewBox="0 0 68 48" width="68" height="48"><path d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55c-2.93.78-4.63 3.26-5.42 6.19C.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z" fill="#f00"/><path d="M45 24 27 14v20" fill="#fff"/></svg></div>
    </div>`;
}
function makeVmEmbed(vmId) {
  return `<div class="md-embed"><iframe src="https://player.vimeo.com/video/${vmId}" allowfullscreen loading="lazy" frameborder="0"></iframe></div>`;
}
function tryMediaEmbed(url) {
  const ytId = getYouTubeId(url); if (ytId) return makeYtEmbed(ytId);
  const vmId = getVimeoId(url);   if (vmId) return makeVmEmbed(vmId);
  if (isVideoUrl(url)) return `<div class="md-embed-video"><video controls preload="metadata" style="max-width:100%;border-radius:10px;"><source src="${url}"/></video></div>`;
  if (isAudioUrl(url)) return `<audio controls preload="metadata" style="width:100%;margin:8px 0;"><source src="${url}"/></audio>`;
  return null;
}

// ── Custom marked renderer ────────────────────────────────────────────────────

const mdRenderer = new marked.Renderer();

// Paragraph override — detect bare media URLs and render embeds
mdRenderer.paragraph = function(text) {
  const bareUrl = extractBareUrl(text);
  if (bareUrl) {
    const embed = tryMediaEmbed(bareUrl);
    if (embed) return embed;
  }

  // breaks:true means single-newline lines arrive as <br>-separated chunks
  const BR = /<br\s*\/?>\n?/i;
  if (BR.test(text)) {
    const parts = text.split(BR).map(part => {
      const url = extractBareUrl(part.trim());
      if (url) { const embed = tryMediaEmbed(url); if (embed) return embed; }
      return part;
    });
    const textParts  = parts.filter(p => !p.startsWith('<div class="yt-lite') && !p.startsWith('<div class="md-embed') && !p.startsWith('<audio') && !p.startsWith('<div class="md-embed-video'));
    const embedParts = parts.filter(p =>  p.startsWith('<div class="yt-lite') ||  p.startsWith('<div class="md-embed') ||  p.startsWith('<audio') ||  p.startsWith('<div class="md-embed-video'));
    if (embedParts.length > 0) {
      const textHtml = textParts.filter(p => p.trim()).join('<br>\n');
      return (textHtml ? `<p>${textHtml}</p>` : '') + embedParts.join('');
    }
  }

  return `<p>${text}</p>`;
};

// Link override — lightbox for image links, external for regular links
mdRenderer.link = function(href, title, text) {
  if (text && text.includes('<img ')) return text.replace('<img ', `<img data-original="${href}" `);
  if (href && href.startsWith('#'))   return `<a class="reply-ref-link" href="${href}">${text}</a>`;
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

// ── Public API ────────────────────────────────────────────────────────────────

export function renderMd(t) {
  if (!t) return "";
  t = t.replace(/\|\|(.+?)\|\|/g, (m, inner) =>
    `<span class="spoiler" onclick="this.classList.toggle('revealed')">${inner}</span>`
  );
  return DOMPurify.sanitize(marked.parse(t), {
    ADD_TAGS: ["iframe","video","source","audio","svg","path","span"],
    ADD_ATTR: ["data-original","data-lightbox-link","data-id","allowfullscreen","loading","frameborder","src","controls","preload","viewBox","d","fill","width","height","class","onclick"]
  });
}

export function Md({ text }) {
  return <div dangerouslySetInnerHTML={{__html: renderMd(text)}} className="md-body" />;
}
