import type { CallParty } from './call-monitor';

/**
 * A call placed from the app that nothing is watching (iOS, or Android without the phone-state permission): the app cannot hear it
 * end, so it remembers it and, when the person comes back to the app, offers to log it. Held in memory only: if the phone closes
 * the app in the meantime the offer is lost, which is the safe way to fail (nothing is logged that the person did not see).
 */
interface Pending {
  party: CallParty;
  placedAt: number;
  /** True once the app has gone to the background, that is, the phone's call screen is on top. */
  left: boolean;
}

let pending: Pending | null = null;

export function rememberCall(party: CallParty, now = Date.now()): void {
  pending = { party, placedAt: now, left: false };
}

export function forgetCall(): void {
  pending = null;
}

/** The app went to the background: from now on a return to the foreground is the call ending. */
export function markAppLeft(): void {
  if (pending) pending.left = true;
}

export interface ReturnedCall {
  party: CallParty;
  startedAt: number;
  durationSec: number;
}

/** The app came back to the foreground: the remembered call, once, if the person really left for it. */
export function takeReturnedCall(now = Date.now()): ReturnedCall | null {
  if (!pending?.left) return null;
  const { party, placedAt } = pending;
  pending = null;
  return {
    party,
    startedAt: placedAt,
    durationSec: Math.max(0, Math.round((now - placedAt) / 1000)),
  };
}
