import { UNOFFICIAL_WHATSAPP_FEATURE_KEY } from '@crm/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  fetchEntitlements,
  fetchInboxCounts,
  fetchNewContacts,
  fetchSummary,
  fetchTaskCounts,
  fetchTeamPanel,
  fetchThroughput,
  fetchWalletSummary,
  fetchWidgets,
} from './api';
import type { DashWindow } from './ranges';

// The previous window stays on screen while a new one loads, so changing the dates never blanks the cards.
export const useSummary = (win: DashWindow) =>
  useQuery({
    queryKey: ['dash', 'summary', win.from, win.to],
    queryFn: ({ signal }) => fetchSummary(win, signal),
    placeholderData: keepPreviousData,
  });

export const useThroughput = (win: DashWindow) =>
  useQuery({
    queryKey: ['dash', 'throughput', win.from, win.to],
    queryFn: ({ signal }) => fetchThroughput(win, signal),
    placeholderData: keepPreviousData,
  });

export const useWidgets = (win: DashWindow) =>
  useQuery({
    queryKey: ['dash', 'widgets', win.from, win.to],
    queryFn: ({ signal }) => fetchWidgets(win, signal),
    placeholderData: keepPreviousData,
  });

/** The people panel of the Agent view. Only asked for while that view is open and the person may read analytics. */
export const useTeamPanel = (win: DashWindow, enabled: boolean) =>
  useQuery({
    queryKey: ['dash', 'team', win.from, win.to],
    queryFn: ({ signal }) => fetchTeamPanel(win, signal),
    enabled,
    placeholderData: keepPreviousData,
    // A plan without analytics answers 403 every time: say so at once instead of trying again.
    retry: false,
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

/** Contacts created in the window. No request for a person who may not read contacts. */
export const useNewContacts = (win: DashWindow, allowed: boolean) =>
  useQuery({
    queryKey: ['dash', 'new-contacts', win.from, win.to],
    queryFn: ({ signal }) => fetchNewContacts(win, signal),
    enabled: allowed,
    placeholderData: keepPreviousData,
  });

/** Open tasks. No request without the task permission; a plan without tasks answers with an error the card shows as a dash. */
export const useTaskCounts = (allowed: boolean) =>
  useQuery({
    queryKey: ['dash', 'task-counts'],
    queryFn: ({ signal }) => fetchTaskCounts(signal),
    enabled: allowed,
    staleTime: 30_000,
    retry: false,
  });

/** The live inbox counts. No request without the inbox permission. */
export const useInboxCounts = (allowed: boolean) =>
  useQuery({
    queryKey: ['dash', 'inbox-counts'],
    queryFn: ({ signal }) => fetchInboxCounts(signal),
    enabled: allowed,
    staleTime: 15_000,
  });
