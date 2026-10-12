import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';

/** Why a mailbox cannot be used right now. `needs_reauth` is the one an admin fixes from the hub (Reconnect). */
export type MailboxUnavailableReason =
  'none' | 'disconnected' | 'needs_reauth' | 'not_configured' | 'feature_off';

export class MailboxUnavailableError extends Error {
  constructor(readonly reason: MailboxUnavailableReason) {
    super(`The mailbox is not usable (${reason})`);
    this.name = 'MailboxUnavailableError';
  }
}

export const mailboxUnavailable = (
  message = 'This mailbox is disconnected or needs reconnecting.',
) => new AppError(ERROR_CODES.MAIL_MAILBOX_UNAVAILABLE, message, HttpStatus.CONFLICT);

export const notConfigured = () =>
  new AppError(
    ERROR_CODES.MAIL_NOT_CONFIGURED,
    'Gmail is not set up for this platform. Ask your platform administrator to add the Google OAuth client.',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

export const mailboxLimit = (limit: number) =>
  new AppError(
    ERROR_CODES.MAIL_MAILBOX_LIMIT,
    `Your plan allows ${limit} connected mailbox${limit === 1 ? '' : 'es'}. Disconnect one or upgrade your plan to add another.`,
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
