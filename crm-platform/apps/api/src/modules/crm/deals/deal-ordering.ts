/**
 * Manual order inside a board column (TW-DEAL-007, D-07). Cards are ordered by `sort_order` ascending, then id descending, so
 * a column with all-equal `sort_order` is newest first, as in Reference. A drop between two cards takes the midpoint of their
 * `sort_order`; a drop on top takes one step below the smallest. When two neighbours are less than 2 apart there is no
 * midpoint, and the caller renumbers the column (rare: it takes about ten consecutive drops into the same gap).
 */
export const ORDER_STEP = 1024n;

/** Above every card of the column. */
export function onTop(minOrder: bigint | null): bigint {
  return minOrder === null ? 0n : minOrder - ORDER_STEP;
}

export type Between = { kind: 'value'; order: bigint } | { kind: 'rebalance' };

/**
 * Strictly between `above` (the card the drop lands under, or null for the top of the column) and `below` (the card it lands
 * over, or null for the bottom). `rebalance` when there is no integer strictly between them.
 */
export function between(above: bigint | null, below: bigint | null): Between {
  if (above === null && below === null) return { kind: 'value', order: 0n };
  if (above === null) return { kind: 'value', order: below! - ORDER_STEP };
  if (below === null) return { kind: 'value', order: above + ORDER_STEP };
  if (below - above < 2n) return { kind: 'rebalance' };
  return { kind: 'value', order: above + (below - above) / 2n };
}
