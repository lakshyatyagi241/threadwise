import { useQuery } from '@tanstack/react-query';
import { getCompany } from './company-api';

export const contactCompanyKey = (id: string) => ['contacts', 'company', id] as const;

/** The company a contact belongs to. No request without an id or while `enabled` is false. */
export const useContactCompany = (id: string | null, enabled = true) =>
  useQuery({
    queryKey: contactCompanyKey(id ?? ''),
    queryFn: ({ signal }) => getCompany(id ?? '', signal),
    enabled: enabled && id !== null && id !== '',
  });
