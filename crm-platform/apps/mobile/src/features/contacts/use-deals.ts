import { useQuery } from '@tanstack/react-query';
import { listContactDeals } from './deals-api';

export const contactDealsKey = (contactId: string) => ['contacts', 'deals', contactId] as const;

/** The contact's deals. No request while `enabled` is false (the person may not read deals). */
export const useContactDeals = (contactId: string, enabled = true) =>
  useQuery({
    queryKey: contactDealsKey(contactId),
    queryFn: ({ signal }) => listContactDeals(contactId, signal),
    enabled: enabled && contactId !== '',
  });
