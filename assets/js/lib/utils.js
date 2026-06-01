// ── Shared utility functions ──────────────────────────────────────────────────
// Extracted from nexus.jsx. Import from here, never redefine inline.

export const SPACE_COLORS = [
  "#a78bfa","#f472b6","#34d399","#60a5fa","#fbbf24","#f87171",
  "#ec4899","#10b981","#fb923c","#38bdf8","#a3e635","#e879f9"
];

export function spaceColor(space) {
  return space?.color || SPACE_COLORS[(space?.id || 0) % SPACE_COLORS.length];
}

// Single source of truth for user avatar color.
// Uses avatar_color stored at registration, falls back to deterministic hash.
export function userColor(user) {
  if (!user) return SPACE_COLORS[0];
  if (user.avatar_color) return user.avatar_color;
  const id = user.id ?? user.user_id ?? 0;
  return SPACE_COLORS[id % SPACE_COLORS.length];
}

// Relative time — "now", "5m", "3h", "2d", or compact date
export function ago(d) {
  if (!d) return "";
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60)     return "now";
  if (s < 3600)   return `${Math.floor(s / 60)}m`;
  if (s < 86400)  return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  const dt = new Date(d);
  const now = new Date();
  const m = dt.getMonth() + 1;
  const day = dt.getDate();
  const y = dt.getFullYear();
  if (y === now.getFullYear()) return `${m}-${day}`;
  return `${m}-${day}-${String(y).slice(2)}`;
}

// "June 2025"
export function fmtDate(d) {
  if (!d) return "recently";
  return new Date(d).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// "3:42 PM"
export function fmtMsgTime(d) {
  if (!d) return "";
  return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

// "Today" / "Yesterday" / weekday / "June 5" / "June 5, 2024"
export function fmtDaySep(d) {
  if (!d) return "";
  const date = new Date(d);
  const now  = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth()    &&
    a.getDate()     === b.getDate();
  if (sameDay(date, now))       return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  if (now - date < 7 * 86400 * 1000)
    return date.toLocaleDateString("en-US", { weekday: "long" });
  if (date.getFullYear() === now.getFullYear())
    return date.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// Format API error responses into a readable string.
// Handles both shapes the backend returns:
//   {error: "some message"}           -> returns the string as-is
//   {errors: {field: ["msg", ...]}}   -> returns "Field: msg\nOther field: msg"
// Field names are capitalised and underscores replaced with spaces.
export function formatApiErrors(d, fallback = "Something went wrong") {
  if (!d) return fallback;
  if (d.errors && typeof d.errors === "object") {
    const parts = Object.entries(d.errors)
      .flatMap(([field, msgs]) => {
        const label = field.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());
        const messages = Array.isArray(msgs) ? msgs : [msgs];
        return messages.map(m => `${label}: ${m}`);
      });
    if (parts.length) return parts.join("\n");
  }
  if (d.error && typeof d.error === "string") return d.error;
  return fallback;
}

// "1.4 MB", "320 KB", etc.
export function fmtBytes(b) {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (b >= 1024 && i < 3) { b /= 1024; i++; }
  return `${b.toFixed(i ? 1 : 0)} ${u[i]}`;
}

// ── Link preview URL extraction ───────────────────────────────────────────────
// Mirror of the backend skip logic. Extracts bare URLs from post/reply bodies
// that will receive link preview cards, so the frontend can pre-register them
// as "fresh" before the DOM renders.
// Shared between PostPage and ComposePage — single source of truth.
const _skipUnfurl = [
  /(?:youtube\.com\/(?:watch|embed|shorts)|youtu\.be\/)/i,
  /vimeo\.com\/(?:video\/)?[0-9]+/i,
  /(?:twitter\.com|x\.com)\/[^/]+\/status/i,
  /open\.spotify\.com\/(?:track|album|playlist|episode)\//i,
  /\.(mp4|webm|ogg|mov|mp3|wav|flac|m4a)(\?.*)?$/i,
  /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i,
];
export function extractUnfurlableUrls(body) {
  if (!body) return [];
  const matches = body.match(/(?<![(\[!])(https?:\/\/[^\s<>")\]]+)/g) || [];
  return [...new Set(matches)]
    .filter(u => !_skipUnfurl.some(r => r.test(u)))
    .slice(0, 3);
}
