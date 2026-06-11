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

// Extract raw URL from either a plain URL or a GFM auto-linked <a href="url">url</a>.
// Named links like <a href="url">some text</a> are NOT bare URLs — only match
// when the visible text exactly equals the href (GFM bare autolink behaviour).
function extractBareUrl(text) {
  const stripped = text.trim();
  if (/^https?:\/\/[^\s<>"]+$/.test(stripped)) return stripped;
  const m = stripped.match(/^<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([^<]*)<\/a>$/);
  if (m && m[2].trim() === m[1].trim()) return m[1];
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
function getTwitterId(url) {
  const m = url.match(/(?:twitter\.com|x\.com)\/[^/]+\/status(?:es)?\/(\d+)/);
  return m ? m[1] : null;
}
function getSpotifyEmbed(url) {
  const m = url.match(/open\.spotify\.com\/(track|album|playlist|episode)\/([A-Za-z0-9]+)/);
  if (!m) return null;
  return { type: m[1], id: m[2] };
}
function makeTwitterEmbed(tweetId) {
  return `<div class="md-x-embed" data-tweet-id="${tweetId}"><div class="md-x-loading"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.741l7.73-8.835L1.254 2.25H8.08l4.259 5.631 5.905-5.631zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg> Loading post…</div></div>`;
}
function makeSpotifyEmbed(type, id) {
  return `<div class="md-spotify-embed"><iframe src="https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" frameborder="0"></iframe></div>`;
}
function tryMediaEmbed(url) {
  const ytId = getYouTubeId(url); if (ytId) return makeYtEmbed(ytId);
  const vmId = getVimeoId(url);   if (vmId) return makeVmEmbed(vmId);
  const twId = getTwitterId(url); if (twId) return makeTwitterEmbed(twId);
  const sp   = getSpotifyEmbed(url); if (sp) return makeSpotifyEmbed(sp.type, sp.id);
  if (isVideoUrl(url)) return `<div class="md-embed-video"><video controls preload="metadata" style="max-width:100%;border-radius:10px;"><source src="${url}"/></video></div>`;
  if (isAudioUrl(url)) return `<audio controls preload="metadata" style="width:100%;margin:8px 0;"><source src="${url}"/></audio>`;
  return null;
}

function isUnfurlable(url) {
  if (!url) return false;
  if (getYouTubeId(url) || getVimeoId(url) || getTwitterId(url) || getSpotifyEmbed(url)) return false;
  if (isVideoUrl(url) || isAudioUrl(url)) return false;
  if (/\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i.test(url)) return false;
  return true;
}

function makeLinkPreviewSentinel(url) {
  const encoded = url.replace(/"/g, "&quot;");
  return `<div class="md-link-preview pending" data-url="${encoded}"></div>`;
}

// ── Custom marked renderer ────────────────────────────────────────────────────

const mdRenderer = new marked.Renderer();

// Paragraph override — detect bare media URLs and render embeds
mdRenderer.paragraph = function(text) {
  const bareUrl = extractBareUrl(text);
  if (bareUrl) {
    const embed = tryMediaEmbed(bareUrl);
    if (embed) return embed;
    if (isUnfurlable(bareUrl)) return makeLinkPreviewSentinel(bareUrl);
  }

  // Emoji-only line detection — defined here so it works both for whole
  // paragraphs and for individual br-split lines within a paragraph.
  const EMOJI_ONLY_RE = /^[\s\u200d\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F1FF}\u{FE00}-\u{FE0F}\u{1F3FB}-\u{1F3FF}\u2194-\u21AA\u231A-\u231B\u23E9-\u23FA\u25AA-\u25FE\u2600-\u27BF\u2934-\u2935\u2B00-\u2BFF\u3030\u303D\u3297\u3299]+$/u;

  // breaks:true means single-newline lines arrive as <br>-separated chunks.
  const BR = /<br\s*\/?>\n?/i;
  if (BR.test(text)) {
    const parts = text.split(BR).map(part => {
      const url = extractBareUrl(part.trim());
      if (url) {
        const embed = tryMediaEmbed(url);
        if (embed) return embed;
        if (isUnfurlable(url)) return makeLinkPreviewSentinel(url);
      }
      return part;
    });

    const isEmbed = p =>
      p.startsWith('<div class="yt-lite') || p.startsWith('<div class="md-embed') ||
      p.startsWith('<audio') || p.startsWith('<div class="md-embed-video') ||
      p.startsWith('<div class="md-x-embed') || p.startsWith('<div class="md-spotify-embed') ||
      p.startsWith('<div class="md-link-preview');

    // If any part is a block-level element or an emoji-only line, render each
    // part individually so they aren't collapsed into a single <p>.
    const hasBlockPart = parts.some(p => isEmbed(p) || EMOJI_ONLY_RE.test(p.trim()));
    if (hasBlockPart) {
      return parts.map(p => {
        if (!p.trim()) return '';
        if (isEmbed(p)) return p;
        if (EMOJI_ONLY_RE.test(p.trim())) return `<p class="md-emoji-block">${p}</p>`;
        return `<p>${p}</p>`;
      }).join('');
    }

    // No block parts — fall through to render as a single paragraph below
    // (the original joined-with-<br> behaviour for plain multi-line text).
  }

  const isEmojiOnly = EMOJI_ONLY_RE.test(text);
  return isEmojiOnly ? `<p class="md-emoji-block">${text}</p>` : `<p>${text}</p>`;
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

// ── [grid]...[/grid] block extension ─────────────────────────────────────────
// Renders images inside [grid]...[/grid] tags as a responsive CSS grid gallery.
// Each grid gets a unique data-gallery ID so its images form an isolated
// lightbox gallery rather than merging with other images in the post.
// Images are rendered at natural aspect ratio — no cropping.
let _gridCounter = 0;
marked.use({
  extensions: [{
    name: "grid",
    level: "block",
    start(src) { return src.indexOf("[grid]"); },
    tokenizer(src) {
      const m = src.match(/^\[grid\]([\s\S]*?)\[\/grid\]/);
      if (m) return { type: "grid", raw: m[0], content: m[1] };
    },
    renderer(token) {
      // Parse image markdown lines within the block.
      // Each image is either [![alt](webp)](original) or ![alt](src).
      // We extract src and data-original from each.
      const galleryId = "grid-" + (++_gridCounter);
      const imgRe = /\[!\[([^\]]*)\]\(([^)]+)\)\]\(([^)]+)\)|!\[([^\]]*)\]\(([^)]+)\)/g;
      let match;
      let imgs = "";
      while ((match = imgRe.exec(token.content)) !== null) {
        if (match[2] && match[3]) {
          // [![alt](webp)](original)
          const alt     = match[1].replace(/"/g, "&quot;");
          const webpSrc = match[2];
          const origSrc = match[3];
          imgs += `<img src="${webpSrc}" data-original="${origSrc}" alt="${alt}" loading="lazy"/>`;
        } else if (match[5]) {
          // ![alt](src) — no separate original
          const alt = match[4].replace(/"/g, "&quot;");
          const src = match[5];
          imgs += `<img src="${src}" data-original="${src}" alt="${alt}" loading="lazy"/>`;
        }
      }
      if (!imgs) return "";
      return `<div class="md-grid" data-gallery="${galleryId}">${imgs}</div>`;
    },
  }],
});

// ── Public API ────────────────────────────────────────────────────────────────

// Regex matching emoji unicode ranges — covers the vast majority of emoji
// including skin-tone and ZWJ sequences without false-positives on regular text.
const EMOJI_RE = /(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F1FF}\u{FE00}-\u{FE0F}][\u{1F3FB}-\u{1F3FF}\u{FE0E}\u{FE0F}]?(?:\u{200D}(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}][\u{1F3FB}-\u{1F3FF}]?))*|[\u2194-\u21AA\u231A\u231B\u23E9-\u23F3\u23F8-\u23FA\u25AA\u25AB\u25B6\u25C0\u25FB-\u25FE\u2614\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26FA\u26FD\u2702\u2705\u2708-\u270D\u270F\u2712\u2714\u2716\u271D\u2721\u2728\u2733\u2734\u2744\u2747\u274C\u274E\u2753-\u2755\u2757\u2763\u2764\u2795-\u2797\u27A1\u27B0\u27BF\u2934\u2935\u2B05-\u2B07\u2B1B\u2B1C\u2B50\u2B55\u3030\u303D\u3297\u3299])/gu;

function wrapEmoji(html) {
  // Only wrap emoji in text nodes — avoid touching attribute values, URLs, or
  // already-wrapped spans. Split on tags and replace only in text segments.
  return html.replace(/(<[^>]+>)|([^<]+)/g, (match, tag, text) => {
    if (tag) return tag;
    return text.replace(EMOJI_RE, (e) => `<span class="md-emoji">${e}</span>`);
  });
}

export function renderMd(t) {
  if (!t) return "";
  t = t.replace(/\|\|(.+?)\|\|/g, (m, inner) =>
    `<span class="spoiler" onclick="this.classList.toggle('revealed')">${inner}</span>`
  );
  const raw = marked.parse(t);
  const withEmoji = wrapEmoji(raw);
  return DOMPurify.sanitize(withEmoji, {
    ADD_TAGS: ["iframe","video","source","audio","svg","path","span"],
    ADD_ATTR: ["data-original","data-lightbox-link","data-gallery","data-id","data-tweet-id","data-url","allowfullscreen","loading","frameborder","src","controls","preload","allow","viewBox","d","fill","width","height","class","onclick"]
  });
}

export function Md({ text }) {
  return <div dangerouslySetInnerHTML={{__html: renderMd(text)}} className="md-body" />;
}
