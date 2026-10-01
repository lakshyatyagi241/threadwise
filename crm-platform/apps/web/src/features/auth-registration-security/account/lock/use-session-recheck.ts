'use client';

import type { SessionResponse } from '@crm/contracts';
import { useEffect, useRef } from 'react';
import { ApiError } from '@/lib/api/errors';
import { authApi } from '../api';

/**
 * Re-reads GET /auth/session whenever the tab regains focus. A lock screen uses
 * it to notice that the cause went away while the person was elsewhere (they
 * opened the verification link in their mail app, an administrator reactivated
 * the account) and to leave without a manual reload. The session route stays
 * open to gated and suspended accounts for exactly this.
 */
export function useSessionRecheck(onFresh: (session: SessionResponse) => void): void {
  const handler = useRef(onFresh);
  useEffect(() => {
    handler.current = onFresh;
  });

  useEffect(() => {
    let inFlight = false;
    const check = async () => {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        handler.current(await authApi.session());
      } catch (err) {
        // A revoked or expired session: the next page load sends them to sign in.
        if (err instanceof ApiError && err.status === 401) window.location.assign('/login');
      } finally {
        inFlight = false;
      }
    };
    const onWake = () => {
      void check();
    };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, []);
}
