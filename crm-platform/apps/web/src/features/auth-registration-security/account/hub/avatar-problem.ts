import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { ImageError, type ImageErrorReason } from '../../shared/image-downscale';

/** The reasons a photo change can fail that have their own sentence (WD-AUTH-026). */
export type AvatarProblem = ImageErrorReason | 'forbidden' | 'expired' | 'rejected';

/**
 * Which sentence explains a failed photo change, or null when the failure has
 * none (the caller then shows the generic error with its request id). The
 * server's real limit is 1 MB, so a 413 says that, while a file too big even to
 * open in the browser says 20 MB; 401 and 419 mean the sign-in is gone, 403 that
 * the account may not change its photo.
 */
export function avatarProblem(error: unknown): AvatarProblem | null {
  if (error instanceof ImageError) return error.reason;
  if (!(error instanceof ApiError)) return null;
  if (error.status === 413) return 'too-large';
  if (error.status === 401 || error.status === 419) return 'expired';
  if (error.status === 403) return 'forbidden';
  if (
    error.code === ERROR_CODES.AUTH_UPLOAD_REJECTED ||
    error.code === ERROR_CODES.VALIDATION_FAILED
  )
    return 'rejected';
  return null;
}
