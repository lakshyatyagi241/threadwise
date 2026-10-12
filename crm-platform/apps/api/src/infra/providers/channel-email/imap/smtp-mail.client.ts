import { Injectable } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { channelEmailEnv } from '../../../../config/domains/channel-email.env';
import type { MailServerLogin } from '../mail-types';
import { resolveSafeTarget } from './host-guard';

/** Opens SMTP submissions (TW-MAIL-031) with the same TLS, certificate and SSRF rules as the IMAP side. */
@Injectable()
export class SmtpMailClient {
  private async transport(login: MailServerLogin): Promise<Transporter> {
    const env = channelEmailEnv();
    const target = await resolveSafeTarget(login.host, env.MAIL_IMAP_ALLOW_PRIVATE_HOSTS);
    return createTransport({
      host: target.connectHost,
      port: login.port,
      secure: login.security === 'ssl',
      requireTLS: login.security === 'starttls',
      ignoreTLS: login.security === 'none',
      tls: {
        rejectUnauthorized: true,
        ...(target.servername ? { servername: target.servername } : {}),
      },
      auth: { user: login.username, pass: login.password },
      connectionTimeout: env.MAIL_IMAP_TIMEOUT_MS,
      greetingTimeout: env.MAIL_IMAP_TIMEOUT_MS,
      socketTimeout: Math.max(env.MAIL_IMAP_TIMEOUT_MS * 3, 60_000),
      logger: false,
    });
  }

  /** Connects and authenticates, sends nothing. */
  async verify(login: MailServerLogin): Promise<void> {
    const t = await this.transport(login);
    try {
      await t.verify();
    } finally {
      t.close();
    }
  }

  /** Submits a complete RFC 5322 message to these recipients (Bcc ones included: they are in the envelope only). */
  async send(
    login: MailServerLogin,
    envelope: { from: string; to: string[] },
    raw: Buffer,
  ): Promise<void> {
    const t = await this.transport(login);
    try {
      await t.sendMail({ envelope, raw });
    } finally {
      t.close();
    }
  }
}
