import type { BridgeAccount } from '../../infra/providers/channel-instagram/instagram-bridge.port';

/** Pure rules of the linked-account hub (WD-IG-001 to 006): no database, no engine, so each one can be tested alone. */

/** The @handle without its leading @: the username, else the name (WaDesk's `handle()`). */
export const handleOf = (username: string | null, name: string | null): string =>
  (username || name || '').replace(/^@+/, '');

/** A mirror row counts as connected unless it was flagged disconnected (a null status counts as connected). */
export const isLive = (status: string | null): boolean => status !== 'disconnected';

/** Where "Manage" opens the account on the engine; nothing when the engine is not connected. */
export const manageUrl = (engineUrl: string, connected: boolean): string | null =>
  connected && engineUrl !== '' ? `${engineUrl.replace(/\/+$/, '')}/instagram` : null;

/** Where the engine's sign-in popup sends a window that has no opener: the hub, which links the returned account. */
export const returnUrl = (webAppUrl: string): string =>
  `${webAppUrl.replace(/\/+$/, '')}/instagram`;

/** The accounts the picker offers: the ones the engine lists, minus those already linked, each shaped for the dialog. */
export function availableAccounts(
  found: readonly BridgeAccount[],
  linkedIds: ReadonlySet<string>,
): Array<{ id: string; username: string; name: string; avatar: string; connected: boolean }> {
  return found
    .filter((a) => a.id !== '' && !linkedIds.has(a.id))
    .map((a) => ({
      id: a.id,
      username: a.username,
      name: a.name,
      avatar: a.avatar,
      // The picker shows an account as connected only when the engine says so.
      connected: a.connected === true,
    }));
}

export interface Profile {
  username: string;
  name: string;
  avatar: string;
  status: 'connected' | 'disconnected';
}

/**
 * The profile a mirror row is saved with, for an account the engine listed to this person or workspace. What the picker already
 * knew wins; the engine's answer fills the rest (the name falls back to the username). The status comes from the engine's
 * `connected` flag and reads as connected when the engine did not say. (WaDesk also saved an account the engine did not list
 * whenever a username came with the request, so any engine account id could be linked; the port links only a listed account.)
 */
export function resolveProfile(
  given: { username?: string; name?: string; avatar?: string },
  found: BridgeAccount,
): Profile {
  return {
    username: given.username ?? found.username,
    name: given.name ?? (found.name || found.username),
    avatar: given.avatar ?? found.avatar,
    status: (found.connected ?? true) ? 'connected' : 'disconnected',
  };
}

/** The first account of the lists, in order, whose id is `id`. */
export const findAccount = (
  lists: ReadonlyArray<readonly BridgeAccount[]>,
  id: string,
): BridgeAccount | undefined => {
  for (const list of lists) {
    const hit = list.find((a) => a.id === id);
    if (hit) return hit;
  }
  return undefined;
};
