import { UNOFFICIAL_WHATSAPP_FEATURE_KEY } from '@crm/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  fetchEntitlements,
  fetchSummary,
  fetchThroughput,
  fetchWalletSummary,
  fetchWidgets,
} from './api';
import type { Range } from './ranges';

// The previous window stays on screen while a new one loads, so switching 7d -> 30d never blanks the cards.
export const useSummary = (range: Range) =>
  useQuery({
    queryKey: ['dash', 'summary', range],
    queryFn: ({ signal }) => fetchSummary(range, signal),
    placeholderData: keepPreviousData,
  });

export const useThroughput = (range: Range) =>
  useQuery({
    queryKey: ['dash', 'throughput', range],
    queryFn: ({ signal }) => fetchThroughput(range, signal),
    placeholderData: keepPreviousData,
  });

export const useWidgets = (range: Range) =>
  useQuery({
    queryKey: ['dash', 'widgets', range],
    queryFn: ({ signal }) => fetchWidgets(range, signal),
    placeholderData: keepPreviousData,
  });

/** The wallet balance. No request at all for a person without the permission (`enabled: false`). */
export const useWalletSummary = (allowed: boolean) =>
  useQuery({
    queryKey: ['dash', 'wallet'],
    queryFn: ({ signal }) => fetchWalletSummary(signal),
    enabled: allowed,
    staleTime: 60_000,
  });

/**
 * Whether the platform has the personal-number WhatsApp engine switched on. False while loading and when the call fails, so
 * nothing for that engine flashes up before the answer is known (same rule as the web).
 */
export function useUnofficialWhatsapp(): boolean {
  const entitlements = useQuery({
    queryKey: ['billing', 'entitlements'],
    queryFn: ({ signal }) => fetchEntitlements(signal),
    staleTime: 60_000,
  });
  return entitlements.data?.features.includes(UNOFFICIAL_WHATSAPP_FEATURE_KEY) ?? false;
}
