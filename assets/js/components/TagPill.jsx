// ── TagPill ───────────────────────────────────────────────────────────────────
// Shared pill for post tags, rendered in the feed thread list and at the top of
// a post. Both places used to style tags independently and had already drifted:
// the post page hardcoded a grey fill and ignored the tag's colour entirely.
// One component so that can't happen again.
//
// Colour treatment matches the Space chip: the tag's hex as the text colour and
// the same hex with a "20" alpha suffix (~12.5%) as the fill.
//
// The "#" prefix distinguishes a tag from the Space chip, which sits in the same
// card and is uppercase. It also matches how FeedPage already renders an active
// tag filter in the page heading.

// Tag.changeset validates ^#[0-9a-fA-F]{6}$ and defaults to #5B4EF5, so colour
// should always be a bare 6-digit hex. Guard anyway — appending "20" to anything
// else produces an invalid colour and the pill silently loses its fill.
const FALLBACK = "#5B4EF5";
const isHex6 = (c) => /^#[0-9a-fA-F]{6}$/.test(c || "");

export function TagPill({ tag }) {
  const col = isHex6(tag?.color) ? tag.color : FALLBACK;
  return (
    <span className="post-tag" style={{ background: `${col}20`, color: col }}>
      #{tag?.name}
    </span>
  );
}

// Renders up to `max` tags followed by a neutral "+N" chip. Returns null rather
// than an empty container when a post has no tags, so the flex gap on the row
// above doesn't leave a stray space.
export function TagPills({ tags, max = 3 }) {
  const list = tags || [];
  if (list.length === 0) return null;
  const shown  = list.slice(0, max);
  const hidden = list.length - shown.length;
  return (
    <div className="thread-post-tags">
      {shown.map((t) => <TagPill key={t.id} tag={t} />)}
      {hidden > 0 && <span className="post-tag post-tag-more">+{hidden}</span>}
    </div>
  );
}
