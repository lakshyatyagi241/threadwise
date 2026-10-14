import { pqlResultSchema, type PqlResult } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

/** Plain English contact search: the rules to pass as the list's `rules` filter. */
export function askPql(query: string): Promise<PqlResult> {
  return apiFetch('/contacts/pql', { method: 'POST', body: { query }, schema: pqlResultSchema });
}
