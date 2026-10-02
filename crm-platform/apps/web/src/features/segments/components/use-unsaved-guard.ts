'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { leavingTarget } from '../lib/guard';

/**
 * Keeps a form with unsaved changes from being lost by accident. While `dirty`:
 *  - closing or reloading the tab asks the browser's own question (`beforeunload`);
 *  - a click on any in-app link (the menu, a breadcrumb) is held and `pending` names where it was going;
 *  - the browser's Back button is held the same way (`pending === 'back'`).
 * The screen shows its own dialog while `pending` is set, then calls `leave()` or `stay()`.
 */
export function useUnsavedGuard(dirty: boolean) {
  const router = useRouter();
  const [pending, setPending] = useState<string | 'back' | null>(null);
  const dirtyRef = useRef(dirty);
  const released = useRef(false);
  /** One extra history entry (carrying Next's own state) lets Back land on this page instead of leaving it. */
  const guardEntry = useRef(false);

  useEffect(() => {
    dirtyRef.current = dirty;
    if (dirty && !guardEntry.current) {
      window.history.pushState(window.history.state, '', window.location.href);
      guardEntry.current = true;
    }
  }, [dirty]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current || released.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || released.current) return;
      const anchor = (e.target as Element | null)?.closest?.('a') ?? null;
      const target = leavingTarget(e, anchor, window.location);
      if (target === null) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(target);
    };
    const onPop = () => {
      if (released.current || !guardEntry.current) return;
      if (dirtyRef.current) {
        window.history.pushState(window.history.state, '', window.location.href);
        setPending('back');
      } else {
        // The changes were undone meanwhile: skip the extra entry and keep going back.
        guardEntry.current = false;
        window.history.back();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  const stay = useCallback(() => setPending(null), []);
  const leave = useCallback(() => {
    const target = pending;
    released.current = true;
    setPending(null);
    if (target === 'back') window.history.go(-2);
    else if (target) router.push(target);
  }, [pending, router]);

  /** Leaves for `href` now, or asks first when there are unsaved changes (the Cancel button). */
  const ask = useCallback(
    (href: string) => {
      if (dirtyRef.current && !released.current) setPending(href);
      else router.push(href);
    },
    [router],
  );

  /** Call right before navigating away after a successful save, so the guard does not hold it. */
  const release = useCallback(() => {
    released.current = true;
  }, []);

  return { pending, leave, stay, release, ask };
}
