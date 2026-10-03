'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Filters kept in the address (Reference keeps them in the query string): a reload, a shared link and the back button all work.
 * A value equal to its default is left out of the URL, and changing any filter returns to page 1.
 */
export function useUrlState<T extends Record<string, string>>(defaults: T) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const values = useMemo(() => {
    const out: Record<string, string> = {};
    for (const key of Object.keys(defaults)) out[key] = sp.get(key) ?? defaults[key]!;
    return out as T;
    // defaults is a constant per screen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  const page = Math.max(1, Math.floor(Number(sp.get('page'))) || 1);

  const set = useCallback(
    (patch: Partial<T>, keepPage = false) => {
      const next = new URLSearchParams(sp.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === '' || value === defaults[key]) next.delete(key);
        else next.set(key, value);
      }
      if (!keepPage) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sp, router, pathname],
  );

  const setPage = useCallback(
    (p: number) => {
      const next = new URLSearchParams(sp.toString());
      if (p <= 1) next.delete('page');
      else next.set('page', String(p));
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [sp, router, pathname],
  );

  return { values, page, set, setPage };
}
