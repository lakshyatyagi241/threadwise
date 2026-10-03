import { useCan } from '@/features/auth-registration-security/shared/session-context';

/** The two capability keys of the lead pipeline (docs/api/leads.md). Absent from the session = denied. */
export const LEADS_READ = 'leads.sources.read';
export const LEADS_MANAGE = 'leads.sources.manage';

export interface LeadsCan {
  read: boolean;
  /** Create, change, delete, rotate the token, preview a mapping, send a test lead, retry, open a stored payload. */
  manage: boolean;
}

export function useLeadsCan(): LeadsCan {
  const read = useCan(LEADS_READ);
  const manage = useCan(LEADS_MANAGE);
  return { read, manage };
}
