'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { gateRedirectFor } from './gate-errors';

/**
 * Pass a query's (or mutation's) error: when it is one of the four gate
 * refusals the page redirects to the screen that resolves the gate. Pages that
 * call the API from event handlers use `redirectOnGateError` in the catch block.
 */
export function useGateRedirect(error: unknown): void {
  const router = useRouter();
  const pathname = usePathname();
  const target = gateRedirectFor(error, pathname);
  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);
}
