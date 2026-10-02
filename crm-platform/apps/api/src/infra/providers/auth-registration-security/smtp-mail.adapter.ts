import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../../../config/env.schema';
import { MailError, type MailMessage, type MailPort } from './mail.port';

const SEND_TIMEOUT_MS = 10_000;

/**
 * SMTP via nodemailer. Locally this is Mailpit (inbox UI on :58025).
 *
 * Errors are mapped to a small closed set so the caller can log something
 * useful without ever echoing SMTP credentials or server banners.
 */
@Injectable()
export class SmtpMailAdapter implements MailPort {
  private readonly logger = new Logger(SmtpMailAdapter.name);
  private readonly transport: Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    const host = config.get('SMTP_HOST', { infer: true });
    const user = config.get('SMTP_USER', { infer: true });
    const pass = config.get('SMTP_PASS', { infer: true });
    this.from = config.get('SMTP_FROM', { infer: true });

    this.transport = host
      ? createTransport({
          host,
          port: config.get('SMTP_PORT', { infer: true }),
          secure: config.get('SMTP_SECURE', { infer: true }),
          auth: user && pass ? { user, pass } : undefined,
          connectionTimeout: SEND_TIMEOUT_MS,
          greetingTimeout: SEND_TIMEOUT_MS,
          socketTimeout: SEND_TIMEOUT_MS,
        })
      : null;
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.transport || !this.from || this.from === 'hello@example.com') {
      throw new MailError('not_configured', 'mail transport or sender address is not configured');
    }
    try {
      await this.transport.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        replyTo: message.replyTo,
      });
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      const reason =
        code === 'EAUTH'
          ? 'auth_failed'
          : code === 'ECONNREFUSED'
            ? 'connection_refused'
            : code === 'ETIMEDOUT' || code === 'ESOCKET'
              ? 'timeout'
              : 'transport_error';
      this.logger.warn({ reason, code }, 'mail send failed');
      throw new MailError(reason, `mail send failed: ${reason}`);
    }
  }
}
