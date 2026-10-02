/** Where a dragged card lands inside a column, from the pointer position. Pure. */
export interface CardRect {
  id: string;
  top: number;
  bottom: number;
}

/**
 * Index among the column's *other* cards: the number of cards whose vertical midpoint lies above the pointer.
 * The dragged card is left out so dropping in its own column does not count it twice.
 */
export function dropIndex(
  pointerY: number,
  cards: readonly CardRect[],
  draggedId: string | null,
): number {
  let n = 0;
  for (const c of cards) {
    if (c.id === draggedId) continue;
    if (pointerY > (c.top + c.bottom) / 2) n++;
  }
  return n;
}
