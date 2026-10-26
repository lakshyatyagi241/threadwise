import type { LegalSlug } from '@crm/contracts';
import { useQuery } from '@tanstack/react-query';
import { fetchLegalPage } from './legal-api';

const TEN_MINUTES = 10 * 60_000;

/** One legal document, kept for ten minutes (they change rarely); a failed read is tried once more. */
export function useLegalPage(slug: LegalSlug | null) {
  return useQuery({
    queryKey: ['legal', slug],
    queryFn: ({ signal }) => fetchLegalPage(slug!, signal),
    enabled: slug !== null,
    staleTime: TEN_MINUTES,
    retry: 1,
  });
}
