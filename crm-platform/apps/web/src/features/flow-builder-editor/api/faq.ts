import { z } from 'zod';
import type { FaqEntryListResponse } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

/**
 * What the "Answer from FAQ" node asks of the FAQ API: one entry and the list stats, whose `categories` are the values the node's
 * "Only these FAQs" picker offers. The FAQ responses are typed as interfaces in the contracts, so the boundary check is the shape
 * the picker reads.
 */
const summary = z.custom<FaqEntryListResponse>((v) => {
  if (typeof v !== 'object' || v === null) return false;
  const stats = (v as { stats?: unknown }).stats;
  if (typeof stats !== 'object' || stats === null) return false;
  const s = stats as { categories?: unknown; total?: unknown };
  return Array.isArray(s.categories) && typeof s.total === 'number';
}, 'Unexpected response');

export const faqForFlowApi = {
  summary: (signal?: AbortSignal) =>
    apiFetch('/faq/entries', { query: { limit: 1 }, schema: summary, signal }),
};
