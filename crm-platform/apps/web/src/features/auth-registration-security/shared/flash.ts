'use client';

import { useSyncExternalStore } from 'react';

/**
 * A one-line notice that must survive a navigation: "Switched to Acme" is shown
 * by the banner strip of the page you land on, not the one you left. Held in
 * module memory (a full page reload clears it, which is what you want).
 */
export type FlashTone = 'success' | 'info' | 'danger';
export interface Flash {
  id: number;
  message: string;
  tone: FlashTone;
}

/** A notice nobody saw (it was raised on a page with no banner strip) must not turn up minutes later. */
const EXPIRES_MS = 15_000;

let current: Flash | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function showFlash(message: string, tone: FlashTone = 'success'): void {
  const id = ++seq;
  current = { id, message, tone };
  emit();
  setTimeout(() => dismissFlash(id), EXPIRES_MS);
}

export function dismissFlash(id?: number): void {
  if (id !== undefined && current?.id !== id) return;
  current = null;
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useFlash(): Flash | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
