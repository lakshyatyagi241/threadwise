/**
 * Transactional mail for the auth flows (verify email, reset, alerts).
 *
 * The auth domain owns this port for now; when the platform mailer (F5) lands
 * its adapter replaces SmtpMailAdapter behind the same token.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Why a send failed, in terms an operator can act on. Never includes secrets. */
export type MailFailureReason =
  'not_configured' | 'auth_failed' | 'connection_refused' | 'timeout' | 'transport_error';

export class MailError extends Error {
  constructor(
    readonly reason: MailFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'MailError';
  }
}

export interface MailPort {
  send(message: MailMessage): Promise<void>;
}

export const MAIL_PORT = Symbol('MAIL_PORT');
