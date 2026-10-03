'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api/errors';
import { redirectOnTrialExpired } from '@/features/plans-subscriptions-trials/lib/trial-redirect';

/** A feature call answered 402 PLAN_TRIAL_EXPIRED (WD-PLAN-015): send the person to the plan picker. */
const onTrialExpired = (error: unknown) =>
  redirectOnTrialExpired(error, window.location.pathname, (to) => window.location.assign(to));

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: onTrialExpired }),
        mutationCache: new MutationCache({ onError: onTrialExpired }),
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
