import { V1_BULK_ERROR_CODES } from '@crm/contracts';
import { asErrorCode } from '../../http/v1-error';

/** `V1_BULK_ERROR_CODES` typed for `AppError`: these are Reference's plain refusal codes, kept out of the platform-wide registry. */
export const V1_BULK_CODE = Object.fromEntries(
  Object.entries(V1_BULK_ERROR_CODES).map(([k, v]) => [k, asErrorCode(v)]),
) as { [K in keyof typeof V1_BULK_ERROR_CODES]: ReturnType<typeof asErrorCode> };
