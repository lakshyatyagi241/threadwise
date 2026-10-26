import { legalPagePublicSchema, type LegalSlug } from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/**
 * One legal document (Terms, Privacy...) as the web's public pages show it: title, dates and numbered sections of sanitised HTML.
 * It is public, so no sign-in is needed and a person who is not signed in can read it too.
 */
export const fetchLegalPage = (slug: LegalSlug, signal?: AbortSignal) =>
  apiFetch(`/v2/public/cms/legal/${slug}`, {
    schema: legalPagePublicSchema,
    auth: false,
    signal,
  });
