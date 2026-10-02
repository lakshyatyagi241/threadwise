import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import type { SecurityTab } from './policy-draft';

/** Where the allowlist is edited: the Security Center, API and webhooks tab. */
export const ALLOWLIST_TAB: SecurityTab = 'api';

/** The API refused the call because the caller's address is not on the operator IP allowlist (TW-AUTH-038). */
export function isIpBlocked(error: unknown): error is ApiError {
  return (
    error instanceof ApiError && error.status === 403 && error.code === ERROR_CODES.AUTH_IP_BLOCKED
  );
}

/**
 * The address the API refused, as it reports it in the `ip` field error. Null when the API could not read
 * the caller's address (the field is then empty) or the error carries none.
 */
export function blockedAddress(error: ApiError): string | null {
  const raw = error.fieldErrors.find((e) => e.path === 'ip')?.message.trim();
  return raw ? raw : null;
}

/** A tiny external store: the refusal is noticed deep inside a fetch, the shell has to react to it. */
export interface IpBlockStore {
  get(): { ip: string | null } | null;
  report(ip: string | null): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

export function createIpBlockStore(): IpBlockStore {
  let current: { ip: string | null } | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    get: () => current,
    report(ip) {
      // Same address again: keep the object so subscribers do not re-render for nothing.
      if (current && current.ip === ip) return;
      current = { ip };
      emit();
    },
    clear() {
      if (current === null) return;
      current = null;
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** Shared by operatorFetch (which reports) and the shell (which shows the blocked view). */
export const ipBlockStore = createIpBlockStore();
