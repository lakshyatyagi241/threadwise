import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../../../config/env.schema';
import { MailError, type MailMessage, type MailPort } from './mail.port';

const SEND_TIMEOUT_MS = 10_000;

/**
 * What the platform-settings domain (WD-SET-024) lets an operator override at runtime. Every field is
 * optional: only a non-empty value replaces the `.env` one, so a blank setting leaves `.env` in charge.
 * `mode` 'log' records the message instead of sending it (a dev mailer); 'unsupported' is a mailer whose
 * adapter does not exist yet, which must fail loudly rather than send through the wrong place.
 */
export interface MailRuntime {
  mode: 'smtp' | 'log' | 'unsupported';
  host?: string;
  port?: number;
  secure?: boolean;
  requireTls?: boolean;
  ignoreTls?: boolean;
  user?: string;
  pass?: string;
  fromName?: string;
  fromAddress?: string;
}
export type MailRuntimeResolver = () => Promise<MailRuntime | null>;

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
  private resolver: MailRuntimeResolver | null = null;
  private runtimeTransport: { key: string; transport: Transporter } | null = null;
  private readonly env: {
    host: string | undefined;
    port: number;
    secure: boolean;
    user: string | undefined;
    pass: string | undefined;
  };

  constructor(config: ConfigService<Env, true>) {
    const host = config.get('SMTP_HOST', { infer: true });
    const user = config.get('SMTP_USER', { infer: true });
    const pass = config.get('SMTP_PASS', { infer: true });
    this.from = config.get('SMTP_FROM', { infer: true });
    this.env = {
      host,
      port: config.get('SMTP_PORT', { infer: true }),
      secure: config.get('SMTP_SECURE', { infer: true }),
      user,
      pass,
    };

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

  /** Registered once by the platform-settings module; consulted on every send so a saved change applies at once. */
  setRuntimeResolver(resolver: MailRuntimeResolver | null): void {
    this.resolver = resolver;
  }

  private async effective(): Promise<{ transport: Transporter | null; from: string } | 'log'> {
    const rt = this.resolver ? await this.resolver().catch(() => null) : null;
    if (!rt) return { transport: this.transport, from: this.from };
    if (rt.mode === 'log') return 'log';
    if (rt.mode === 'unsupported') return { transport: null, from: this.from };
    const host = rt.host || this.env.host;
    const from = rt.fromAddress
      ? rt.fromName
        ? `"${rt.fromName.replace(/["\r\n]/g, '')}" <${rt.fromAddress}>`
        : rt.fromAddress
      : this.from;
    if (!host) return { transport: null, from };
    const user = rt.user || this.env.user;
    const pass = rt.pass || this.env.pass;
    const opts = {
      host,
      port: rt.port ?? this.env.port,
      secure: rt.secure ?? this.env.secure,
      requireTLS: rt.requireTls,
      ignoreTLS: rt.ignoreTls,
      auth: user && pass ? { user, pass } : undefined,
      connectionTimeout: SEND_TIMEOUT_MS,
      greetingTimeout: SEND_TIMEOUT_MS,
      socketTimeout: SEND_TIMEOUT_MS,
    };
    const key = JSON.stringify(opts);
    if (this.runtimeTransport?.key !== key) {
      this.runtimeTransport = { key, transport: createTransport(opts) };
    }
    return { transport: this.runtimeTransport.transport, from };
  }

  async send(message: MailMessage): Promise<void> {
    const eff = await this.effective();
    if (eff === 'log') {
      this.logger.log({ to: message.to, subject: message.subject }, 'mail (log mailer, not sent)');
      return;
    }
    const { transport, from } = eff;
    if (!transport || !from || from === 'hello@example.com') {
      throw new MailError('not_configured', 'mail transport or sender address is not configured');
    }
    try {
      await transport.sendMail({
        from,
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
