/**
 * The one-time display of the connection secret. `inboundSecret` is in the answer that creates or rotates it and nowhere else, so the
 * screen must show it, make the person confirm they saved it, and then forget it. The machine below is the whole rule:
 *
 *   none        no secret came with the answer (an app with no connection, or a push recipe whose secret the admin pasted)
 *   shown       the secret and the address are on screen; leaving needs the "I have saved it" confirmation
 *   dismissed   the person confirmed; the secret and the address are gone and can never be shown again
 *
 * `dismissed` is final: `reveal` ignores it, so no code path can bring the same secret back. A rotation starts a new machine.
 */

export interface RevealPayload {
  secret: string;
  /** The address a sender posts to. It carries the connection's public key, so it is wiped with the secret. */
  url: string | null;
  tokenHeader: string | null;
  signatureHeader: string | null;
  auth: 'token' | 'hmac' | 'either' | null;
}

export type RevealState =
  | { phase: 'none' }
  | { phase: 'shown'; payload: RevealPayload; saved: boolean }
  | { phase: 'dismissed' };

/** The state right after the install or rotate answer arrived. An empty or missing secret means there is nothing to reveal. */
export function startReveal(payload: RevealPayload | null | undefined): RevealState {
  if (!payload || payload.secret.length === 0) return { phase: 'none' };
  return { phase: 'shown', payload, saved: false };
}

/** Shows a secret only from `none`. From `shown` it keeps what is on screen, from `dismissed` it refuses: never re-enterable. */
export function reveal(state: RevealState, payload: RevealPayload): RevealState {
  if (state.phase !== 'none' || payload.secret.length === 0) return state;
  return { phase: 'shown', payload, saved: false };
}

/** The "I have saved it" checkbox. Only meaningful while shown. */
export function setSaved(state: RevealState, saved: boolean): RevealState {
  return state.phase === 'shown' ? { ...state, saved } : state;
}

/** Leaving the reveal. Refused (state unchanged) until the person confirmed; on success the payload is dropped. */
export function dismiss(state: RevealState): RevealState {
  if (state.phase !== 'shown') return state;
  return state.saved ? { phase: 'dismissed' } : state;
}

export const canDismiss = (state: RevealState): boolean => state.phase === 'shown' && state.saved;

/** True while the secret is on screen: the page should warn before it is left. */
export const isBlocking = (state: RevealState): boolean => state.phase === 'shown';

export function visiblePayload(state: RevealState): RevealPayload | null {
  return state.phase === 'shown' ? state.payload : null;
}
