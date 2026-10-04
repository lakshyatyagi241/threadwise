/** The tracking page's four-step progress bar (WD-STORE-017). */
export const TRACK_STEPS = ['placed', 'confirmed', 'paid', 'shipped'] as const;
export type TrackStep = (typeof TRACK_STEPS)[number];

/**
 * Index of the last reached step for an order status. WaDesk showed any status outside new/confirmed/paid/shipped (pending,
 * processing, completed) at the first step, so a completed order looked just placed; here every status has a position.
 */
const POSITION: Record<string, number> = {
  new: 0,
  pending: 0,
  confirmed: 1,
  paid: 2,
  processing: 2,
  shipped: 3,
  completed: 3,
};

export const isCancelled = (status: string): boolean => status.toLowerCase() === 'cancelled';

export function trackerIndex(status: string): number {
  return POSITION[status.toLowerCase()] ?? 0;
}

/** The pill shows the raw status word, capitalised. */
export const statusLabel = (status: string): string =>
  status.length === 0 ? status : status.charAt(0).toUpperCase() + status.slice(1);
