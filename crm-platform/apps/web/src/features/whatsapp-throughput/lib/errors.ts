import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** Message key under `whatsapp-throughput.errors` for an API failure. Branches on the problem+json code, never on its text. */
export function watErrorKey(err: unknown): string {
  if (!(err instanceof ApiError)) return 'unexpected';
  switch (err.code) {
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return 'conflict';
    case ERROR_CODES.WABA_PROVIDER_UNAVAILABLE:
      return 'metaUnavailable';
    case ERROR_CODES.NOT_FOUND:
      return 'notFound';
    default:
      return err.status === 403 ? 'forbidden' : err.status === 400 ? 'invalid' : 'unexpected';
  }
}

export const isConflict = (err: unknown) => watErrorKey(err) === 'conflict';
