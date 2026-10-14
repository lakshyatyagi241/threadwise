import { companyResponseSchema } from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/** One company (a contact's "account"), with its rollup. Needs `record.companies.read`. */
export const getCompany = (id: string, signal?: AbortSignal) =>
  apiFetch(`/v2/companies/${encodeURIComponent(id)}`, { schema: companyResponseSchema, signal });
