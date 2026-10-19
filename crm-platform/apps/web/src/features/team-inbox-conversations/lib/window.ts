import type { ServiceWindow } from '@crm/contracts';

/** open: more than three hours left; soon: under three; closed: only a template may be sent; none: the channel has no window rule. */
export type WindowState = 'none' | 'open' | 'soon' | 'closed';

export interface WindowView {
  state: WindowState;
  /** Milliseconds until it closes, only while a countdown makes sense (open or soon). */
  msLeft: number | null;
  expiresAt: string | null;
}

/** Reference turns the badge amber under three hours. */
export const WINDOW_SOON_MS = 3 * 3_600_000;

/**
 * The 24 hour rule as the header, the list chip and the composer show it. The server answers `open` as of the moment it
 * read the thread, and that answer wins: a simulator forced open (or closed) stays that way. Only one thing is worked out
 * here: a window the server called open that has run out since it was fetched (`fetchedAt`), so a thread left open on a
 * screen closes by itself without waiting for the next refetch.
 */
export function computeWindow(
  window: ServiceWindow | null,
  windowHours: number | null,
  nowMs: number,
  fetchedAtMs: number,
): WindowView {
  if (!window || windowHours === null) return { state: 'none', msLeft: null, expiresAt: null };
  const expiresAt = window.expiresAt;
  if (!window.open) return { state: 'closed', msLeft: null, expiresAt };
  if (!expiresAt) return { state: 'none', msLeft: null, expiresAt: null };

  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return { state: 'none', msLeft: null, expiresAt: null };
  // Open while already past its time when it was fetched means the server forced it open.
  if (at <= nowMs && at > fetchedAtMs) return { state: 'closed', msLeft: null, expiresAt };
  if (at <= nowMs) return { state: 'open', msLeft: null, expiresAt };
  const msLeft = at - nowMs;
  return { state: msLeft < WINDOW_SOON_MS ? 'soon' : 'open', msLeft, expiresAt };
}

/** `3h 20m`, or `45m` under an hour. */
export function formatWindowLeft(ms: number): { hours: number; minutes: number } {
  const total = Math.max(0, Math.floor(ms / 60_000));
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/**
 * The row chip of the list: a window is only worth a chip when it matters (closing soon, or closed). Returns null for none/open.
 * `hasRule` says the row's channel has a window rule: then a customer who never wrote (no expiry) is closed, exactly as the header
 * says, so the list and the header never disagree. A channel without a rule (or one not known yet) never gets a chip.
 */
export function rowWindowChip(
  expiresAt: string | null,
  nowMs: number,
  hasRule = false,
): { state: 'soon' | 'closed'; msLeft: number | null } | null {
  if (!expiresAt) return hasRule ? { state: 'closed', msLeft: null } : null;
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return null;
  if (at <= nowMs) return { state: 'closed', msLeft: null };
  const msLeft = at - nowMs;
  return msLeft < WINDOW_SOON_MS ? { state: 'soon', msLeft } : null;
}
