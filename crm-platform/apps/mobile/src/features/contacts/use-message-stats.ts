import { useQuery } from '@tanstack/react-query';
import { getContactMessageStats } from './message-stats-api';

export const contactMessageStatsKey = (contactId: string) =>
  ['contacts', 'message-stats', contactId] as const;

/** The contact's WhatsApp summary. No request while `enabled` is false; a refusal is not retried. */
export const useContactMessageStats = (contactId: string, enabled = true) =>
  useQuery({
    queryKey: contactMessageStatsKey(contactId),
    queryFn: ({ signal }) => getContactMessageStats(contactId, signal),
    enabled: enabled && contactId !== '',
    retry: false,
    staleTime: 30_000,
  });
