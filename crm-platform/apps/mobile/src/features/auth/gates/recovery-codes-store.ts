import { useSyncExternalStore } from 'react';

/**
 * The recovery codes two-factor enrolment just made. The server shows them exactly once, and turning on two-factor ends the "required
 * enrolment" gate at once: if the screen listened to the session alone, a refresh of it (the person switching to their authenticator
 * app and back does exactly that) would take the codes away before they were saved. So they are held here, in memory only, until the
 * person says they saved them. They are never written to storage, never logged, and are dropped on sign-out.
 */
let codes: readonly string[] | null = null;
const listeners = new Set<() => void>();

const emit = () => {
  for (const l of [...listeners]) l();
};

export function setRecoveryCodes(next: readonly string[]): void {
  codes = next;
  emit();
}

export function clearRecoveryCodes(): void {
  if (codes === null) return;
  codes = null;
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The codes waiting to be saved, or null. */
export const useRecoveryCodes = (): readonly string[] | null =>
  useSyncExternalStore(
    subscribe,
    () => codes,
    () => null,
  );
