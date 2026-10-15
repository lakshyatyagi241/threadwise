'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { parseFormIds, rawFormIds, writeFormIds } from '../lib/summary-forms-store';
import { cleanFormIds, parseWindow, searchWithWindow } from '../lib/summary-model';

/** The window lives in the address (`?window=14`), so a link or a reload keeps it and the tab and other parameters are left alone. */
export function useSummaryWindow(): [number, (days: number) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const days = parseWindow(search.get('window'));
  const setDays = useCallback(
    (next: number) => {
      router.replace(`${pathname}?${searchWithWindow(search.toString(), next)}`, {
        scroll: false,
      });
    },
    [router, pathname, search],
  );
  return [days, setDays];
}

// The choice is kept in memory too, so it still applies on this screen when the browser blocks storage.
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
};

/**
 * The forms that count as an application, remembered per person. `ready` turns true once the stored choice is known (never on the
 * server), so the first request already carries it and the numbers never flash from "all forms" to the saved choice.
 */
export function useSummaryForms(): {
  formIds: string[];
  setFormIds: (ids: string[]) => void;
  ready: boolean;
} {
  const userId = useSession().user.id;
  const raw = useSyncExternalStore(
    subscribe,
    () => memory.get(userId) ?? rawFormIds(userId),
    () => null,
  );
  const formIds = useMemo(() => (raw === null ? [] : parseFormIds(raw)), [raw]);
  const setFormIds = useCallback(
    (ids: string[]) => {
      const clean = cleanFormIds(ids);
      memory.set(userId, clean.length ? JSON.stringify(clean) : '');
      writeFormIds(userId, clean);
      listeners.forEach((cb) => cb());
    },
    [userId],
  );
  return { formIds, setFormIds, ready: raw !== null };
}
