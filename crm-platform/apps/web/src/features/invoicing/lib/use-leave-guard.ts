'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

/**
 * Stops unsaved edits from being lost: the browser asks before the tab closes or reloads, and a click on an in-app link is held
 * until the person confirms (`target` is where they were going; `leave` goes there, `stay` drops the request).
 */
export function useLeaveGuard(dirty: boolean) {
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // The section menu and other same-page links keep the form open.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setTarget(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  const stay = useCallback(() => setTarget(null), []);
  const leave = useCallback(() => {
    const to = target;
    setTarget(null);
    if (to) router.push(to);
  }, [router, target]);

  return { target, stay, leave };
}
