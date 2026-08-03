import { useState, useCallback } from "react";

// ── useSortable ───────────────────────────────────────────────────────────────
//
// Drag-to-reorder for a flat list, shared by core admin panels and exposed to
// extensions through window.NexusComponents so reorder UI behaves identically
// everywhere.
//
// Replaces four near-identical copies in AdminLayout plus one in
// AdminReactionsPanel, each of which tracked only a hovered *index* and tinted
// that row's background. That could not express which side of the row the item
// would land on, so dragging onto row 3 from above and from below looked the
// same and behaved the same — and one of those two was wrong.
//
// This tracks {index, after} and renders an insertion line at the exact
// boundary, so the drop position is never ambiguous.
//
// Uses HTML5 drag events deliberately. They work on touch — Chrome for Android
// and iOS Safari both start a drag from a long press on a draggable element —
// and they give free scroll-while-dragging behaviour that a pointer-event
// implementation has to rebuild by hand.
//
// Usage:
//
//   const sortable = useSortable(items, setItems);
//   items.map((item, i) => (
//     <div key={item.id} {...sortable.itemProps(i)} style={sortable.itemStyle(i, baseStyle)}>
//       ...
//     </div>
//   ));
//
export function useSortable(items, onChange) {
  const [dragging, setDragging] = useState(null);
  // { index, after } — after=true means "insert below this row".
  const [over, setOver] = useState(null);

  const reset = useCallback(() => { setDragging(null); setOver(null); }, []);

  const commit = useCallback(() => {
    if (dragging === null || !over) { reset(); return; }

    // Target position in the array as it stands *before* the move.
    let to = over.after ? over.index + 1 : over.index;

    // Removing the dragged item first shifts everything after it down one, so
    // a downward move overshoots by one without this. The old code had no
    // notion of a side at all and always inserted *at* the hovered index,
    // which is why dragging an item down landed it one place short.
    if (dragging < to) to -= 1;

    if (to !== dragging && to >= 0 && to <= items.length - 1) {
      const next = items.slice();
      const [moved] = next.splice(dragging, 1);
      next.splice(to, 0, moved);
      onChange(next);
    }
    reset();
  }, [dragging, over, items, onChange, reset]);

  const itemProps = useCallback((index) => ({
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = "move";
      // Firefox refuses to start a drag unless data is set.
      try { e.dataTransfer.setData("text/plain", String(index)); } catch (_) {}
      setDragging(index);
    },
    onDragOver: (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      // Which half of the row the pointer is in decides the side. Measuring on
      // every dragover rather than caching handles the list reflowing mid-drag.
      const r = e.currentTarget.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      setOver((prev) =>
        prev && prev.index === index && prev.after === after ? prev : { index, after }
      );
    },
    // No onDragLeave clearing the indicator: moving between adjacent rows fires
    // leave on the old row *after* enter on the new one, so clearing there made
    // the line flicker out on every boundary crossing. dragend and drop both
    // reset it, which is sufficient.
    onDrop: (e) => { e.preventDefault(); commit(); },
    onDragEnd: reset,
  }), [commit, reset]);

  // Merges the drag visuals into a caller-supplied style object.
  //
  // The insertion line is an inset box-shadow rather than a real element, so it
  // adds no node and — importantly — does not change layout. A border or an
  // inserted div would shift every row below it by 2px the moment the indicator
  // appeared, making the list twitch under the cursor.
  const itemStyle = useCallback((index, base = {}) => {
    const isDragging = dragging === index;
    const showBefore = over && over.index === index && !over.after;
    const showAfter  = over && over.index === index && over.after;

    let shadow = null;
    if (showBefore) shadow = "inset 0 2px 0 0 var(--ac)";
    else if (showAfter) shadow = "inset 0 -2px 0 0 var(--ac)";

    return {
      ...base,
      cursor: "grab",
      opacity: isDragging ? 0.4 : (base.opacity ?? 1),
      boxShadow: shadow || base.boxShadow,
      transition: "opacity .12s, box-shadow .12s",
    };
  }, [dragging, over]);

  return { itemProps, itemStyle, dragging, over, isDragging: dragging !== null };
}
