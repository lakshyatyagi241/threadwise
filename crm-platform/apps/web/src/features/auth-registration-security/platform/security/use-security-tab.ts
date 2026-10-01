'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { SecurityTab } from '../lib/policy-draft';
import { TAB_STORAGE_KEY, resolveInitialTab } from '../lib/tab-state';

function readStored(): string | null {
  try {
    return window.sessionStorage.getItem(TAB_STORAGE_KEY);
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener('hashchange', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('hashchange', onChange);
  };
}

const snapshot = (): SecurityTab => resolveInitialTab(window.location.hash, readStored());

/**
 * The active Security Center tab lives in the URL hash (so a link opens the right panel) and in
 * sessionStorage (so a reload in the same browser tab returns to it). It is read from the browser,
 * not copied into component state, so the two never disagree.
 */
export function useSecurityTab(): { tab: SecurityTab; setTab: (t: SecurityTab) => void } {
  const tab = useSyncExternalStore(subscribe, snapshot, () => 'summary' as SecurityTab);

  const setTab = useCallback((next: SecurityTab) => {
    window.history.replaceState(null, '', `#${next}`);
    try {
      window.sessionStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      /* private mode: the hash still works */
    }
    listeners.forEach((l) => l());
  }, []);

  return { tab, setTab };
}
