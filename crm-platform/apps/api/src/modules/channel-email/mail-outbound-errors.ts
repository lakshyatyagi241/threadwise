import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';

const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;

export const attachmentTooLarge = (limitBytes: number, what: 'file' | 'total' = 'file') =>
  new AppError(
    ERROR_CODES.MAIL_ATTACHMENT_TOO_LARGE,
    what === 'file'
      ? `A file can be at most ${mb(limitBytes)}.`
      : `The files of one reply can be at most ${mb(limitBytes)} together.`,
    HttpStatus.PAYLOAD_TOO_LARGE,
  );

export const tooManyAttachments = (max: number) =>
  new AppError(
    ERROR_CODES.MAIL_TOO_MANY_ATTACHMENTS,
    `A reply can carry at most ${max} files.`,
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

export const attachmentNotFound = () =>
  new AppError(
    ERROR_CODES.MAIL_ATTACHMENT_NOT_FOUND,
    'An attached file is no longer available. Attach it again.',
    HttpStatus.NOT_FOUND,
  );

export const signatureNotFound = () =>
  new AppError(ERROR_CODES.MAIL_SIGNATURE_NOT_FOUND, 'Signature not found', HttpStatus.NOT_FOUND);
