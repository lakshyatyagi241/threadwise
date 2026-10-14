import { contactDealsResponseSchema } from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/** A contact's deals, open first then newest, at most 50, with the open and won totals. Needs `record.deals.read`. */
export const listContactDeals = (contactId: string, signal?: AbortSignal) =>
  apiFetch(`/v2/contacts/${encodeURIComponent(contactId)}/deals`, {
    schema: contactDealsResponseSchema,
    signal,
  });
