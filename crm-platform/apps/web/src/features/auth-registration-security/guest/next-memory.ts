import { safeNextPath } from './next-path';
import { defaultStore, type KeyValueStore } from './otp-challenge';

/**
 * A return path (`?next=`) has to survive a trip through another site: the visitor leaves for Google or Facebook
 * and comes back to the callback page, whose address no longer carries it. It is kept in this tab's storage for
 * that round trip, re-checked on the way out, and used once.
 */
export const NEXT_KEY = 'crm.signin.next';

export function rememberNext(
  next: string | null | undefined,
  store: KeyValueStore = defaultStore(),
): void {
  const safe = safeNextPath(next);
  try {
    if (safe) store.setItem(NEXT_KEY, safe);
    else store.removeItem(NEXT_KEY);
  } catch {
    /* storage blocked: the visitor lands on the home router instead */
  }
}

/** The remembered path (checked again), removed so it cannot be used twice. Null when there is none. */
export function takeNext(store: KeyValueStore = defaultStore()): string | null {
  try {
    const value = store.getItem(NEXT_KEY);
    store.removeItem(NEXT_KEY);
    return safeNextPath(value);
  } catch {
    return null;
  }
}
