import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../../../common/errors/app-error';
import { UploadPolicyService } from '../../../../auth';
import { v1Error } from '../automation-errors';

/** `header_media` limit: 16384 KB (WD-API-037 rule 1). */
export const HEADER_MEDIA_MAX_BYTES = 16384 * 1024;

export interface UploadedHeader {
  originalname: string;
  buffer: Buffer;
}

/**
 * Runs the platform's shared upload guard (extension allow-list and block-list, content sniffing, never the client's name on disk) over the
 * inline `header_media` file and answers in WaDesk's terms: `unsupported_media_type` for a refused type or content, a validation error on
 * `header_media` for an empty or oversize file.
 */
export function guardHeaderMedia(
  policy: UploadPolicyService,
  file: UploadedHeader,
): { ext: string; mime: string; storedName: string } {
  try {
    return policy.validate({
      filename: file.originalname,
      buffer: file.buffer,
      allow: ['image', 'media', 'document'],
      maxBytes: HEADER_MEDIA_MAX_BYTES,
    });
  } catch (err) {
    if (err instanceof AppError && err.code === ERROR_CODES.AUTH_UPLOAD_REJECTED) {
      const reason = err.details?.[0]?.message;
      if (reason === 'too_large' || reason === 'empty')
        throw AppError.validation('The header media file is not valid.', [
          {
            path: 'header_media',
            message:
              reason === 'empty'
                ? 'The file is empty.'
                : 'The file may not be greater than 16384 kilobytes.',
          },
        ]);
      throw v1Error(
        'unsupported_media_type',
        reason === 'content_not_allowed'
          ? 'This file content is not allowed.'
          : 'This file type is not allowed.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    throw err;
  }
}
