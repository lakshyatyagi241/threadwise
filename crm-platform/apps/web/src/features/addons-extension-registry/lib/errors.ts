import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

export type AddonErrorKey =
  | 'generic'
  | 'forbidden'
  | 'notFound'
  | 'conflict'
  | 'packInUse'
  | 'invalidPackage'
  | 'tooLarge'
  | 'coreTooOld'
  | 'engineConflict';

/** Which sentence a failed call gets. Branches on the stable `code` and status, never on the API's wording. */
export function addonErrorKey(error: unknown): AddonErrorKey {
  if (!(error instanceof ApiError)) return 'generic';
  switch (error.code) {
    case ERROR_CODES.ADD_PACK_IN_USE:
      return 'packInUse';
    case ERROR_CODES.ADD_PACKAGE_INVALID:
      return 'invalidPackage';
    case ERROR_CODES.ADD_PACKAGE_TOO_LARGE:
      return 'tooLarge';
    case ERROR_CODES.ADD_CORE_TOO_OLD:
      return 'coreTooOld';
    case ERROR_CODES.ADD_ENGINE_CONFLICT:
      return 'engineConflict';
  }
  if (error.isRowVersionConflict) return 'conflict';
  if (error.status === 403) return 'forbidden';
  if (error.status === 404) return 'notFound';
  return 'generic';
}
