import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { SetTestResult } from '@crm/contracts';
import {
  MAIL_PORT,
  MailError,
  type MailPort,
} from '../../infra/providers/auth-registration-security/mail.port';
import type {
  MailRuntime,
  MailRuntimeResolver,
} from '../../infra/providers/auth-registration-security/smtp-mail.adapter';
import { SettingsService } from './settings.service';

const FAILURES: Record<string, string> = {
  not_configured: 'no mail host or sender address is set',
  auth_failed: 'the server refused the username or password',
  connection_refused: 'the server refused the connection (check host and port)',
  timeout: 'the server did not answer in time',
  transport_error: 'the message could not be delivered',
};

/**
 * TW-SET-024 and 025. Saved mail settings override `.env` on every send: this service hands the SMTP adapter a
 * resolver, and the adapter asks it per message, so a saved change applies at once and in every process
 * (within the settings snapshot window), including queue workers (Reference's workers needed a restart).
 */
@Injectable()
export class MailRuntimeService implements OnModuleInit {
  private readonly logger = new Logger(MailRuntimeService.name);

  constructor(
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit(): void {
    const port = this.mail as MailPort & {
      setRuntimeResolver?: (r: MailRuntimeResolver | null) => void;
    };
    // Other adapters (tests, a future API-based provider) simply have no hook.
    port.setRuntimeResolver?.(() => this.resolve());
  }

  /** null = nothing saved yet, so `.env` rules. Only non-empty saved values override it. */
  async resolve(): Promise<MailRuntime | null> {
    if (!(await this.settings.isSaved('mail'))) return null;
    const v = await this.settings.values('mail');
    if (v.mailer === 'log' || v.mailer === 'array') return { mode: 'log' };
    // sendmail and the API mailers need their own adapters (and, for the API ones, key fields Reference never had).
    if (v.mailer !== 'smtp') return { mode: 'unsupported' };
    return {
      mode: 'smtp',
      host: v.host || undefined,
      port: v.port,
      secure: v.encryption === 'ssl',
      requireTls: v.encryption === 'starttls' || undefined,
      ignoreTls: v.encryption === '' || undefined,
      user: v.username || undefined,
      pass: (await this.settings.secret('mail', 'password')) ?? undefined,
      fromName: v.fromName || undefined,
      fromAddress: v.fromAddress || undefined,
    };
  }

  /** Sends one plain message with the SAVED settings (unsaved edits are ignored, as in Reference). */
  async test(to: string): Promise<SetTestResult> {
    const brand = (await this.settings.values('general')).appName;
    try {
      await this.mail.send({
        to,
        subject: 'Mail settings test',
        text: `This is a test email from ${brand} to confirm your mail settings are working. Sent at ${new Date().toISOString()}.`,
      });
      return { ok: true, message: `Test email sent to ${to}.` };
    } catch (err) {
      const reason = err instanceof MailError ? err.reason : 'transport_error';
      this.logger.warn({ reason }, 'mail test failed');
      return { ok: false, message: `Test email failed: ${FAILURES[reason] ?? reason}.` };
    }
  }
}
