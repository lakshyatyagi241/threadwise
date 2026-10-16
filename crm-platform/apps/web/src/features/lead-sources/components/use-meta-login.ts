'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { startMetaLogin } from '../meta-api';
import { safeLoginUrl } from '../lib/meta-view';

/**
 * "Connect a Facebook Page", "Grant lead access" and "Reconnect" are one round trip: the API hands back the Facebook login address
 * (asking for the lead permissions) and the browser is sent there. The login comes back to `/lead-sources?tab=ads&fb=...`. While the
 * browser is leaving, `pending` stays true so a second click cannot start a second login.
 */
export function useMetaLogin() {
  const [leaving, setLeaving] = useState(false);
  const start = useMutation({
    mutationFn: startMetaLogin,
    onSuccess: ({ url }) => {
      const target = safeLoginUrl(url);
      if (!target) throw new Error('unsafe login address');
      setLeaving(true);
      window.location.assign(target);
    },
  });
  return {
    run: () => start.mutate(),
    pending: start.isPending || leaving,
    error: start.error,
    reset: start.reset,
  };
}

export type MetaLogin = ReturnType<typeof useMetaLogin>;
