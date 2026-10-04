'use client';

import { useSyncExternalStore } from 'react';

/**
 * The shell's global flash (TW-ASHELL-007): Reference lets any controller redirect with success, error or warning and the
 * next page shows it as a toast. Here a screen calls `flash(...)` and then navigates; the host mounted in the shell shows it
 * on the page it lands on. Held in module memory, so a full reload drops it, and a notice nobody saw expires.
 */
export type FlashTone = 'success' | 'info' | 'warning' | 'danger';
export interface ShellFlash {
  id: number;
  tone: FlashTone;
  /** A message key under `admin-console-shell.flash` (never raw text from a URL or a server). */
  key: string;
  values?: Record<string, string | number>;
}

/** Longer than a page navigation, shorter than a stale surprise. */
export const FLASH_EXPIRES_MS = 15_000;

let current: ShellFlash | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function flash(
  key: string,
  tone: FlashTone = 'success',
  values?: Record<string, string | number>,
): number {
  const id = ++seq;
  current = { id, tone, key, values };
  emit();
  setTimeout(() => dismissFlash(id), FLASH_EXPIRES_MS);
  return id;
}

export function dismissFlash(id?: number): void {
  if (id !== undefined && current?.id !== id) return;
  current = null;
  emit();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export const getFlash = (): ShellFlash | null => current;

export const useShellFlash = (): ShellFlash | null =>
  useSyncExternalStore(subscribe, getFlash, () => null);

/** Test hook: forget everything. */
export function resetFlashForTests(): void {
  current = null;
  seq = 0;
  listeners.clear();
}
