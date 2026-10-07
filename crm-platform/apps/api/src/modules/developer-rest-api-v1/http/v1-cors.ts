import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/** The customer API and its spec: key-authenticated (or public), never cookie-authenticated. */
export function isCustomerApiPath(url: string | undefined): boolean {
  const path = (url ?? '').split('?')[0] ?? '';
  return path === '/api/v1' || path.startsWith('/api/v1/') || path === '/docs/api.json';
}

/**
 * Any website may call the customer API from a browser (WaDesk's `api` group answers every origin), because a caller there holds its own
 * bearer key and the answer to a call never depends on a cookie. That is why `credentials` is off here: the staff API's policy (a list of
 * origins WITH credentials, WD-INFRA-014) must not be widened to every origin, and this one never needs credentials.
 */
export const CUSTOMER_API_CORS: CorsOptions = {
  origin: '*',
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  exposedHeaders: [
    'x-request-id',
    'retry-after',
    'allow',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
  ],
  maxAge: 600,
};
