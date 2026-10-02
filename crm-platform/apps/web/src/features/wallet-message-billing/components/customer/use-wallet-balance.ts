'use client';

import { useLocale } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, customerApi } from '../../api';
import { formatMinor } from '../../lib/money';

/** How often the balance is read again; there is no push channel for it yet. */
export const BALANCE_REFRESH_MS = 60_000;

/**
 * The workspace's wallet balance for any screen that shows it. It reads `/wallet/summary` (the same query the wallet page
 * uses, so they share one cache entry) and refreshes on window focus and every minute. A member without
 * `wallet.balance.read` makes no request and gets `allowed: false`.
 */
export function useWalletBalance() {
  const allowed = useCan('wallet.balance.read');
  const locale = useLocale();
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
