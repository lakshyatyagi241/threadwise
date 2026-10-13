import { registrationConfigResponseSchema } from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/**
 * The public settings of the platform; the Menu reads only the legal links from them (the same call the sign-up screen makes, so
 * the two share one cache entry).
 */
export const fetchLegalLinks = (signal?: AbortSignal) =>
  apiFetch('/v2/auth/registration-config', {
    schema: registrationConfigResponseSchema,
    auth: false,
    signal,
  });
