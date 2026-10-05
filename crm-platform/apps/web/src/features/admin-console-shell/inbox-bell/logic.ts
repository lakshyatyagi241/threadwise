/** The floating new-message pill (TW-ASHELL-028): polling, dismissal and sound rules, kept apart from the component so they can be tested. */
export const BASE_POLL_MS = 15_000;
export const MAX_POLL_MS = 300_000;

/** 15 seconds while it works; doubled after a 429 or any failure, up to 5 minutes; back to 15 on success. */
export function nextDelay(current: number, outcome: 'ok' | 'throttled' | 'failed'): number {
  if (outcome === 'ok') return BASE_POLL_MS;
  return Math.min(Math.max(current, BASE_POLL_MS) * 2, MAX_POLL_MS);
}

/** "99+" above 99, as every bell in the shell. */
export const countLabel = (n: number): string => (n > 99 ? '99+' : String(n));

export interface Dismissal {
  /** Newest `lastMessageAt` (epoch ms) when the person dismissed. */
  mark: number;
  total: number;
}

/** The newest message time among the listed conversations (0 for none). */
export function latestMark(items: ReadonlyArray<{ lastMessageAt: string | null }>): number {
  return items.reduce((m, i) => Math.max(m, i.lastMessageAt ? Date.parse(i.lastMessageAt) : 0), 0);
}

/**
 * Dismissing hides the pill until a newer message arrives or the total grows; at zero there is nothing to show and the
 * dismissal is forgotten (`clear`).
 */
export function visibility(
  total: number,
  mark: number,
  dismissed: Dismissal | null,
): { show: boolean; clear: boolean } {
  if (total <= 0) return { show: false, clear: true };
  if (!dismissed) return { show: true, clear: false };
  const newer = mark > dismissed.mark || total > dismissed.total;
  return { show: newer, clear: newer };
}

/** Beep and flash the tab title only when the total rises after the first poll. */
export const shouldAlert = (previous: number | null, total: number): boolean =>
  previous !== null && total > previous;

export const parseDismissal = (raw: string | null): Dismissal | null => {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Dismissal>;
    return typeof v.mark === 'number' && typeof v.total === 'number'
      ? { mark: v.mark, total: v.total }
      : null;
  } catch {
    return null;
  }
};

export interface Pos {
  x: number;
  y: number;
}

/** Keeps the pill inside the viewport after a drag or a resize. */
export function clampPos(p: Pos, vw: number, vh: number, w = 220, h = 44): Pos {
  return {
    x: Math.min(Math.max(p.x, 8), Math.max(8, vw - w - 8)),
    y: Math.min(Math.max(p.y, 8), Math.max(8, vh - h - 8)),
  };
}

/** The pages that must not show the widget: the inbox itself already shows every new message. */
export const hidesBell = (pathname: string): boolean =>
  pathname === '/inbox' || pathname.startsWith('/inbox/');

export const BELL_POS_KEY = 'ibx-bell-pos';
export const BELL_DISMISS_KEY = 'ibx-bell-dismissed';
