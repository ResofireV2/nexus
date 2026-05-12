// ── Link Preview Card ─────────────────────────────────────────────────────────
// Hydrates .md-link-preview.pending sentinel divs produced by Markdown.jsx.
// Checks localStorage first, falls back to /api/v1/link_previews?url=...
// Renders the variant-B card: full-width image, domain + favicon, title, desc.

const LP_CACHE_KEY   = "nexus_lp_cache";
const LP_CACHE_MAX   = 300;

function lpCacheGet(url) {
  try {
    const store = JSON.parse(localStorage.getItem(LP_CACHE_KEY) || "{}");
    return store[url] || null;
  } catch { return null; }
}

function lpCacheSet(url, data) {
  try {
    const store = JSON.parse(localStorage.getItem(LP_CACHE_KEY) || "{}");
    store[url] = { ...data, _at: Date.now() };
    const keys = Object.keys(store);
    if (keys.length > LP_CACHE_MAX) {
      keys.sort((a, b) => (store[a]._at || 0) - (store[b]._at || 0));
      keys.slice(0, keys.length - LP_CACHE_MAX).forEach(k => delete store[k]);
    }
    localStorage.setItem(LP_CACHE_KEY, JSON.stringify(store));
  } catch {}
}

function renderLinkPreviewCard(node, data) {
  const image    = data.image_url   || null;
  const favicon  = data.favicon_url || null;
  const title    = data.title       || data.domain || "";
  const desc     = data.description || null;
  const domain   = data.site_name   || data.domain || "";
  const url      = data.url;

  const faviconHtml = favicon
    ? `<img src="${escHtml(favicon)}" alt="" width="14" height="14" style="border-radius:2px;object-fit:contain;flex-shrink:0;" onerror="this.style.display='none'">`
    : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;opacity:.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;

  const imageHtml = image
    ? `<div style="width:100%;aspect-ratio:1.91/1;overflow:hidden;background:var(--bg2);max-height:220px;">
         <img src="${escHtml(image)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" loading="lazy" onerror="this.closest('[data-lp-img]').style.display='none'" />
       </div>`
    : "";

  const descHtml = desc
    ? `<div style="font-size:12px;color:var(--t4);line-height:1.5;margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escHtml(desc)}</div>`
    : "";

  node.innerHTML = `
    <a href="${escHtml(url)}" target="_blank" rel="noopener"
       style="display:block;text-decoration:none;border:0.5px solid var(--b1);border-radius:12px;overflow:hidden;background:var(--bg2);cursor:pointer;">
      ${imageHtml ? `<div data-lp-img>${imageHtml}</div>` : ""}
      <div style="padding:10px 14px 12px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
          ${faviconHtml}
          <span style="font-size:11px;color:var(--t4);">${escHtml(domain)}</span>
        </div>
        <div style="font-size:14px;font-weight:500;color:var(--t1);line-height:1.4;">${escHtml(title)}</div>
        ${descHtml}
      </div>
    </a>`;

  node.classList.remove("pending");
}

function escHtml(str) {
  if (!str) return "";
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function renderLinkPreviewError(node, url) {
  node.innerHTML = `
    <a href="${escHtml(url)}" target="_blank" rel="noopener"
       style="display:flex;align-items:center;gap:8px;padding:12px 14px;text-decoration:none;border:0.5px solid var(--b1);border-radius:12px;font-size:13px;color:var(--t4);">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;opacity:.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      ${escHtml(url)}
    </a>`;
  node.classList.remove("pending");
}

// Map of url -> [node, ...] waiting for a preview_ready signal
const _lpPending = new Map();

// Call this with extracted URLs immediately after a post/reply is submitted,
// before the DOM nodes exist. hydrateLinkPreviews will then skip the initial
// API call for these URLs and wait for the WebSocket signal instead.
function registerFreshUrls(urls) {
  (urls || []).forEach(url => {
    if (!_lpPending.has(url)) _lpPending.set(url, []);
  });
}

function fetchPreview(url, node) {
  fetch(`/api/v1/link_previews?url=${encodeURIComponent(url)}`)
    .then(r => {
      if (!r.ok) throw new Error("not_found");
      return r.json();
    })
    .then(data => {
      if (!data.preview) throw new Error("empty");
      lpCacheSet(url, data.preview);
      // Resolve all nodes waiting on this URL
      const nodes = _lpPending.get(url) || [node];
      _lpPending.delete(url);
      nodes.forEach(n => renderLinkPreviewCard(n, data.preview));
    })
    .catch(() => {
      _lpPending.delete(url);
      renderLinkPreviewError(node, url);
    });
}

// Called by nexus.jsx when a link_preview_ready WebSocket event arrives
function onLinkPreviewReady(url) {
  if (!_lpPending.has(url)) return;
  const nodes = _lpPending.get(url);
  _lpPending.delete(url);
  // Fetch once for all waiting nodes
  fetch(`/api/v1/link_previews?url=${encodeURIComponent(url)}`)
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(data => {
      if (!data.preview) return;
      lpCacheSet(url, data.preview);
      nodes.forEach(n => renderLinkPreviewCard(n, data.preview));
    })
    .catch(() => nodes.forEach(n => renderLinkPreviewError(n, url)));
}

function hydrateLinkPreviews(root) {
  const nodes = (root || document).querySelectorAll(".md-link-preview.pending[data-url]");
  nodes.forEach(node => {
    node.classList.remove("pending");
    node.classList.add("loading");

    const url = node.getAttribute("data-url");
    if (!url) return;

    const cached = lpCacheGet(url);
    if (cached) {
      renderLinkPreviewCard(node, cached);
      return;
    }

    // If this URL was pre-registered as fresh (just submitted), skip the
    // immediate API call entirely and wait for the WebSocket signal.
    if (_lpPending.has(url)) {
      _lpPending.get(url).push(node);
      return;
    }

    // Otherwise try immediately — preview likely already exists in DB.
    fetch(`/api/v1/link_previews?url=${encodeURIComponent(url)}`)
      .then(r => {
        if (r.status === 404) {
          // Not ready yet — register for WebSocket notification
          if (!_lpPending.has(url)) _lpPending.set(url, []);
          _lpPending.get(url).push(node);
          return null;
        }
        if (!r.ok) throw new Error("error");
        return r.json();
      })
      .then(data => {
        if (!data) return;
        if (!data.preview) throw new Error("empty");
        lpCacheSet(url, data.preview);
        renderLinkPreviewCard(node, data.preview);
      })
      .catch(() => renderLinkPreviewError(node, url));
  });
}

// MutationObserver — fires whenever new .md-link-preview nodes appear in the DOM
const _lpObserver = new MutationObserver(() => {
  if (document.querySelector(".md-link-preview.pending[data-url]")) {
    hydrateLinkPreviews();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  hydrateLinkPreviews();
  _lpObserver.observe(document.body, { childList: true, subtree: true });
});

export { hydrateLinkPreviews, onLinkPreviewReady, registerFreshUrls };
