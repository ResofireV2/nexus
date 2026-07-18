// Shared scrubber model.
//
// Single source of truth for mapping between scroll position and reply index,
// used by the desktop panel, the mobile pill and the mobile jump sheet.
//
// The previous implementation derived the reply index from scroll percentage
// (`round(pct * (n - 1))`) and spaced the pips evenly, which assumes every
// reply is the same height. On real threads — one-liners next to long replies
// with images — the counter, the pips and the content on screen disagreed.
// Everything here works from measured offsets instead.

import { useState, useEffect, useRef, useCallback } from "react";

// Jumping scrolls a reply to `offset - JUMP_OFFSET`. Detection uses the same
// constant, which makes jump and detect exact inverses: jump to reply N and the
// counter reads N. Changing one without the other reintroduces the drift.
export const JUMP_OFFSET = 20;

// Tolerance for "scrolled to the very bottom" (sub-pixel scroll positions).
const BOTTOM_EPS = 2;

// Below this many replies every pip is drawn; above it they are thinned so a
// long thread doesn't render hundreds of overlapping 2px divs.
export const PIP_BUDGET = 120;

function clampPct(p) {
  return p < 0 ? 0 : p > 100 ? 100 : p;
}

// Measure each reply's offset inside the container's scroll coordinate space.
//
// Deliberately uses getBoundingClientRect deltas rather than `el.offsetTop`:
// offsetTop is relative to the nearest *positioned* ancestor, which is not
// necessarily the scroll container, so it silently produced wrong jumps if any
// ancestor became position:relative.
export function measureOffsets(container, replies) {
  if (!container || !replies || !replies.length) return [];
  const cTop = container.getBoundingClientRect().top;
  const sTop = container.scrollTop;
  const out = new Array(replies.length);
  let prev = 0;
  for (let i = 0; i < replies.length; i++) {
    const el = document.getElementById("reply-" + replies[i].id);
    if (el) prev = el.getBoundingClientRect().top - cTop + sTop;
    // A reply that isn't in the DOM yet inherits the previous offset rather
    // than 0, so the map stays monotonic and the binary search stays valid.
    out[i] = prev;
  }
  return out;
}

// Last reply whose top edge has passed the reading line. Binary search, so this
// is cheap enough to run on every scroll frame even on very long threads.
export function indexFromScrollTop(offsets, scrollTop, atBottom) {
  const n = offsets.length;
  if (!n) return 0;
  // At the end of the thread there is no scroll left, so the top-of-viewport
  // reply would stick several short of the last one while the user is looking
  // straight at it.
  if (atBottom) return n - 1;
  const probe = scrollTop + JUMP_OFFSET + 1;
  let lo = 0, hi = n - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] <= probe) { ans = mid; lo = mid + 1; }
    else { hi = mid - 1; }
  }
  return ans;
}

export function scrollTopForIndex(offsets, i) {
  if (!offsets.length) return 0;
  const idx = Math.max(0, Math.min(i, offsets.length - 1));
  return Math.max(0, (offsets[idx] || 0) - JUMP_OFFSET);
}

// Track position for each reply, expressed as the thumb position you'd have
// when that reply is current. This makes pip, thumb and counter agree, and it
// means clicking exactly on a pip lands exactly on that reply.
export function pipPercents(offsets, maxScroll) {
  if (!offsets.length) return [];
  if (maxScroll <= 0) return offsets.map(() => 0);
  return offsets.map((o) => clampPct(((o - JUMP_OFFSET) / maxScroll) * 100));
}

// Thin a pip list so no two are closer than minGapPct, always keeping the first
// and last. Returns [{pct, i}].
export function thinPips(pcts, minGapPct) {
  const out = [];
  if (!pcts.length) return out;
  let last = -Infinity;
  for (let i = 0; i < pcts.length; i++) {
    if (pcts[i] - last >= minGapPct) { out.push({ pct: pcts[i], i }); last = pcts[i]; }
  }
  const lastIdx = pcts.length - 1;
  if (!out.length || out[out.length - 1].i !== lastIdx) {
    out.push({ pct: pcts[lastIdx], i: lastIdx });
  }
  return out;
}

// Tracks scroll position and current reply for a scroll container.
//
// Returns `index` (real, measured), `scrollPct` (continuous thumb position),
// `pips` (track positions), plus jump and drag controls. Scroll handling is
// rAF-throttled and suspended while dragging so the drag and the scroll
// listener can't fight over the thumb.
export function useScrubberModel(containerRef, replies) {
  const repliesRef = useRef(replies);
  repliesRef.current = replies;

  const offsetsRef  = useRef([]);
  const maxScrollRef = useRef(0);
  const draggingRef = useRef(false);
  const dirtyRef    = useRef(true);
  const rafRef      = useRef(0);

  const [scrollPct, setScrollPct] = useState(0);
  const [index, setIndex]         = useState(0);
  const [pips, setPips]           = useState([]);

  const remeasure = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    const offsets = measureOffsets(c, repliesRef.current);
    offsetsRef.current  = offsets;
    maxScrollRef.current = Math.max(0, c.scrollHeight - c.clientHeight);
    dirtyRef.current = false;
    setPips(pipPercents(offsets, maxScrollRef.current));
  }, [containerRef]);

  const sync = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    if (dirtyRef.current) remeasure();
    const st  = c.scrollTop;
    const max = maxScrollRef.current;
    const atBottom = st >= c.scrollHeight - c.clientHeight - BOTTOM_EPS;
    setScrollPct(max > 0 ? clampPct((st / max) * 100) : 0);
    setIndex(indexFromScrollTop(offsetsRef.current, st, atBottom));
  }, [containerRef, remeasure]);

  const schedule = useCallback((force) => {
    if (!force && draggingRef.current) return;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      sync();
    });
  }, [sync]);

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return undefined;

    dirtyRef.current = true;
    schedule(true);

    const onScroll  = () => schedule(false);
    const invalidate = () => { dirtyRef.current = true; schedule(true); };

    c.addEventListener("scroll", onScroll, { passive: true });
    // Replies containing images change height after load, which invalidates the
    // offset map. `load` doesn't bubble, so listen in the capture phase.
    c.addEventListener("load", invalidate, true);
    window.addEventListener("resize", invalidate);

    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(invalidate);
      ro.observe(c);
    }

    return () => {
      c.removeEventListener("scroll", onScroll);
      c.removeEventListener("load", invalidate, true);
      window.removeEventListener("resize", invalidate);
      if (ro) ro.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [containerRef, replies.length, schedule]);

  const jumpTo = useCallback((i, smooth) => {
    const c = containerRef.current;
    if (!c) return;
    if (dirtyRef.current) remeasure();
    c.scrollTo({
      top: scrollTopForIndex(offsetsRef.current, i),
      behavior: smooth === false ? "auto" : "smooth",
    });
  }, [containerRef, remeasure]);

  // Continuous drag: scroll to the exact fraction under the pointer rather than
  // snapping to reply boundaries, which is what made dragging feel notchy.
  const dragStart = useCallback(() => {
    draggingRef.current = true;
    if (dirtyRef.current) remeasure();
  }, [remeasure]);

  const dragTo = useCallback((pct) => {
    const c = containerRef.current;
    if (!c) return;
    const p = clampPct(pct);
    c.scrollTop = (p / 100) * maxScrollRef.current;
    setScrollPct(p);
    setIndex(indexFromScrollTop(offsetsRef.current, c.scrollTop, p >= 100));
  }, [containerRef]);

  const dragEnd = useCallback(() => {
    draggingRef.current = false;
    schedule(true);
  }, [schedule]);

  return { scrollPct, index, pips, jumpTo, dragStart, dragTo, dragEnd, remeasure };
}

// Keyboard navigation for the scrubber, shared by the desktop panel and the
// mobile sheet so both behave identically. Returns the target reply index, or
// null if the key isn't one we handle (so the caller knows not to preventDefault).
export const PAGE_STEP = 10;

export function keyboardTargetIndex(key, index, count) {
  if (!count) return null;
  let next;
  switch (key) {
    case "ArrowDown":
    case "ArrowRight": next = index + 1; break;
    case "ArrowUp":
    case "ArrowLeft":  next = index - 1; break;
    case "PageDown":   next = index + PAGE_STEP; break;
    case "PageUp":     next = index - PAGE_STEP; break;
    case "Home":       next = 0; break;
    case "End":        next = count - 1; break;
    default: return null;
  }
  return Math.max(0, Math.min(next, count - 1));
}

// Pointer position over an element as a 0-100 percentage of its height.
export function pctFromPointer(el, clientY) {
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  if (rect.height <= 0) return 0;
  return clampPct(((clientY - rect.top) / rect.height) * 100);
}
