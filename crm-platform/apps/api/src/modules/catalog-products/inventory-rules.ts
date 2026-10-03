/**
 * The arithmetic of the stock ledger (WD-CAT-025). `stock_qty` null means unlimited stock: it is never decremented and a hold
 * has no ceiling (but is still ledgered).
 */

/** How long a customer has to confirm before the hold is given back. */
export const DEFAULT_HOLD_TTL_SECONDS = 1800;
/** A hold never lasts less than this, whatever TTL was asked for. */
export const MIN_HOLD_TTL_SECONDS = 60;
export const REF_MAX = 128;

export interface Stock {
  stockQty: number | null;
  reservedQty: number;
}

export const holdTtl = (requested: number): number => Math.max(MIN_HOLD_TTL_SECONDS, requested);

export const clampRef = (ref: string): string => Array.from(ref).slice(0, REF_MAX).join('');

/** Whether `qty` can be put on hold now: always for unlimited stock, otherwise only up to what is not already held. */
export function canHold(s: Stock, qty: number): boolean {
  if (qty <= 0) return false;
  if (s.stockQty === null) return true;
  return Math.max(0, s.stockQty - (s.reservedQty || 0)) >= qty;
}

export const afterHold = (s: Stock, qty: number): Stock => ({
  stockQty: s.stockQty,
  reservedQty: (s.reservedQty || 0) + qty,
});

/** Confirm: the real stock goes down by the held quantity (never below 0) and the hold leaves the books. */
export const afterCommit = (s: Stock, qty: number): Stock => ({
  stockQty: s.stockQty === null ? null : Math.max(0, s.stockQty - qty),
  reservedQty: Math.max(0, (s.reservedQty || 0) - qty),
});

/** Cancel or expire: only the hold is given back. */
export const afterRelease = (s: Stock, qty: number): Stock => ({
  stockQty: s.stockQty,
  reservedQty: Math.max(0, (s.reservedQty || 0) - qty),
});
