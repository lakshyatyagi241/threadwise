'use client';

import { useEffect } from 'react';
import { useLocale } from 'next-intl';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  REALTIME_EVENT,
  realtimeEventSchemas,
  type RealtimeEventPayload,
  type WalletSummary,
} from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useRealtimeClient, type RealtimeClient } from '@/lib/realtime';
import { KEYS, customerApi } from '../../api';
import { formatMinor } from '../../lib/money';

/** Fallback poll. The balance arrives by `wallet.updated`; this only covers a socket that is down or a missed event. */
export const BALANCE_REFRESH_MS = 300_000;

/**
 * The balance the push carries, written into the cached summary at once. Everything derived from the balance (low-balance flag,
 * about-how-many-messages) is recomputed from the figures already cached, with the same rules the summary endpoint uses; the rest
 * of the summary (30-day totals) is refetched right after.
 */
export function applyWalletUpdate(
  qc: QueryClient,
  payload: RealtimeEventPayload<'wallet.updated'>,
) {
  qc.setQueryData<WalletSummary>(KEYS.summary, (old) =>
    old
      ? {
          ...old,
          balanceMinor: payload.balanceMinor,
          lowBalance:
            old.lowBalanceThresholdMinor > 0 &&
            payload.balanceMinor <= old.lowBalanceThresholdMinor,
          approxMessages:
            old.approxMessages !== null && old.flatPriceMinor > 0
              ? Math.floor(payload.balanceMinor / old.flatPriceMinor)
              : old.approxMessages,
        }
      : old,
  );
  void qc.invalidateQueries({ queryKey: KEYS.summary });
}

/**
 * Keeps the cached summary current from the realtime client: every `wallet.updated` event updates the balance and refetches, and
 * so does anything that may have made the screen stale (a reconnect, a sequence gap, the tab coming back) on the workspace room.
 * Returns the unsubscribe.
 */
export function subscribeWalletUpdates(client: RealtimeClient, qc: QueryClient): () => void {
  const offEvent = client.subscribe(REALTIME_EVENT.walletUpdated, (event) => {
    const parsed = realtimeEventSchemas[REALTIME_EVENT.walletUpdated].safeParse(event.payload);
    if (parsed.success) applyWalletUpdate(qc, parsed.data);
    else void qc.invalidateQueries({ queryKey: KEYS.summary });
  });
  const offResync = client.onResync((request) => {
    if (request.room === 'org') void qc.invalidateQueries({ queryKey: KEYS.summary });
  });
  return () => {
    offEvent();
    offResync();
  };
}

/**
 * The workspace's wallet balance for any screen that shows it. It reads `/wallet/summary` (the same query the wallet page
 * uses, so they share one cache entry), follows `wallet.updated` pushes on the workspace room, and polls slowly as a fallback.
 * A member without `wallet.balance.read` makes no request and gets `allowed: false`.
 */
export function useWalletBalance() {
  const allowed = useCan('wallet.balance.read');
  const locale = useLocale();
  const qc = useQueryClient();
  const realtime = useRealtimeClient();
  useEffect(() => {
    if (!allowed || !realtime) return;
    return subscribeWalletUpdates(realtime, qc);
  }, [allowed, realtime, qc]);
  const query = useQuery({
    queryKey: KEYS.summary,
    queryFn: ({ signal }) => customerApi.summary(signal),
    enabled: allowed,
    refetchInterval: BALANCE_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
  const summary = query.data;
  return {
    allowed,
    summary,
    /** The balance as money in the wallet's currency, or null until it is known. */
    label: summary ? formatMinor(summary.balanceMinor, summary.currency, locale) : null,
    lowBalance: summary?.lowBalance ?? false,
    isPending: allowed && query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
