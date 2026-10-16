import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import { MailError, type MailMessage, type MailPort } from './mail.port';

const SEND_TIMEOUT_MS = 10_000;
const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email), called directly via `fetch` —
 * no `resend` SDK dependency, matching the house style of the other HTTP-based provider adapters in this
 * codebase (see `WabaHttp`).
 *
 * Purely env-driven: unlike `SmtpMailAdapter` this adapter has no `setRuntimeResolver` equivalent. The
 * runtime-override mechanism (WD-SET-024) is an admin-settings feature scoped to SMTP only for now; a saved
 * Settings change does not affect this adapter until that feature is extended to cover it.
 */
@Injectable()
export class ResendMailAdapter implements MailPort {
  private readonly logger = new Logger(ResendMailAdapter.name);
  private readonly apiKey: string | undefined;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    this.apiKey = config.get('RESEND_API_KEY', { infer: true });
    this.from = config.get('SMTP_FROM', { infer: true });
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.apiKey || !this.from || this.from === 'hello@example.com') {
      throw new MailError('not_configured', 'mail transport or sender address is not configured');
    }

    let res: Response;
    try {
      res = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          reply_to: message.replyTo,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      const reason = timedOut ? 'timeout' : 'connection_refused';
      this.logger.warn({ reason }, 'mail send failed');
      throw new MailError(reason, `mail send failed: ${reason}`);
    }

    if (!res.ok) {
      const reason = res.status === 401 || res.status === 403 ? 'auth_failed' : 'transport_error';
      this.logger.warn({ reason, status: res.status }, 'mail send failed');
      throw new MailError(reason, `mail send failed: ${reason}`);
    }
  }
}
