import type { IgAvailableAccount } from '@crm/contracts';

/** Small pure rules of the Instagram hub (TW-IG-001, 002): what a row shows and what the connect button does. */

/** How long the connect button waits for "is the account already on the engine?" before it opens the sign-in popup instead. */
export const LOOKUP_MS = 4000;
/** The sign-in popup's window features (Reference's: 560 by 720). */
export const POPUP_FEATURES = 'popup,width=560,height=720';
/** What the engine's popup posts to its opener when an account has been connected. */
export const CONNECTED_EVENT = 'threadwise:instagram-connected';

/** `@handle` without a doubled @: the username, else the name. */
export const handleOf = (username: string | null, name: string | null): string =>
  `@${(username || name || '').replace(/^@+/, '')}`;

/** Two upper-case letters for the chip shown when the picture is missing or has expired. */
export const initialsOf = (name: string | null, username: string | null): string =>
  (name || username || '').replace(/^@+/, '').slice(0, 2).toUpperCase();

/** A mirror row shows as connected unless it was flagged otherwise. */
export const isConnected = (status: string): boolean => status === 'connected';

export type ConnectPlan =
  | { kind: 'link'; account: IgAvailableAccount }
  | { kind: 'pick'; accounts: IgAvailableAccount[] }
  | { kind: 'popup' };

/**
 * What "Connect Instagram" does. Exactly one account already on the engine is linked at once; several are offered in a picker;
 * none, or a lookup that failed or ran out of time (`null`), opens the sign-in popup, which is the right action for a fresh connect.
 */
export function planConnect(found: readonly IgAvailableAccount[] | null): ConnectPlan {
  if (found === null || found.length === 0) return { kind: 'popup' };
  if (found.length === 1) return { kind: 'link', account: found[0]! };
  return { kind: 'pick', accounts: [...found] };
}

/** The origin of the engine, from the address "Manage" opens; null when there is none or it does not parse. */
export function engineOrigin(manageUrl: string | null): string | null {
  if (!manageUrl) return null;
  try {
    return new URL(manageUrl).origin;
  } catch {
    return null;
  }
}

/**
 * The account id in a window message, when it is the engine telling us a new account is connected. A message from any other origin
 * is ignored (Reference took it from anyone), and so is one with no account id.
 */
export function connectedAccount(
  e: { origin: string; data: unknown },
  expectedOrigin: string | null,
): string | null {
  if (expectedOrigin === null || e.origin !== expectedOrigin) return null;
  const d = e.data;
  if (typeof d !== 'object' || d === null) return null;
  const m = d as { type?: unknown; account_id?: unknown };
  if (m.type !== CONNECTED_EVENT) return null;
  const id =
    typeof m.account_id === 'string' || typeof m.account_id === 'number'
      ? String(m.account_id)
      : '';
  return id === '' ? null : id;
}
