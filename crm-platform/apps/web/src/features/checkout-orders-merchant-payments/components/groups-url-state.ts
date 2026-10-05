'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One filter kept in the address (`?q=`), so a view can be shared and the back button works. With `debounce` the typed text is the
 * local value at once and the address follows after the person stops typing; without it the address is written immediately.
 * Every other query parameter (notably `?shop=`) is left as it is.
 */
export function useUrlParam(
  name: string,
  debounce = 0,
): { value: string; setValue: (next: string) => void; applied: string } {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const applied = search.get(name) ?? '';
  const [value, setLocal] = useState(applied);
  const pushed = useRef(applied);

  const write = useCallback(
    (next: string) => {
      const p = new URLSearchParams(search.toString());
      if (next) p.set(name, next);
      else p.delete(name);
      const qs = p.toString();
      pushed.current = next;
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [name, pathname, router, search],
  );

  // The address changed from outside (back button, a link): follow it.
  useEffect(() => {
    if (applied !== pushed.current) {
      pushed.current = applied;
      setLocal(applied);
    }
  }, [applied]);

  // Typed text reaches the address after a pause.
  useEffect(() => {
    if (debounce <= 0 || value === applied) return;
    const id = setTimeout(() => write(value), debounce);
    return () => clearTimeout(id);
  }, [value, applied, debounce, write]);

  const setValue = useCallback(
    (next: string) => {
      setLocal(next);
      if (debounce <= 0) write(next);
    },
    [debounce, write],
  );

  return { value, setValue, applied };
}
