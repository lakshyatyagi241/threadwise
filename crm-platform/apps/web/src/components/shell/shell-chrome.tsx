'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * Full-screen pages (the inbox, the flow builder) hide the shell's header, rail and bars (TW-ASHELL-012, Reference's `hideHeader`).
 * A page opts in by rendering `<HideShellChrome />`; the shell reads `useChromeHidden()`. A small counter rather than a flag,
 * so two such components mounting and unmounting in either order cannot leave the chrome stuck hidden.
 */
let hiders = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const chromeStore = {
  hide() {
    hiders += 1;
    emit();
  },
  show() {
    hiders = Math.max(0, hiders - 1);
    emit();
  },
  hidden: () => hiders > 0,
  reset() {
    hiders = 0;
    emit();
  },
};

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function useChromeHidden(): boolean {
  return useSyncExternalStore(subscribe, chromeStore.hidden, () => false);
}

export function HideShellChrome() {
  useEffect(() => {
    chromeStore.hide();
    return () => chromeStore.show();
  }, []);
  return null;
}
