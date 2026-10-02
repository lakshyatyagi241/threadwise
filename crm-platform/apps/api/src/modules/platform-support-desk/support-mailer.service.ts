import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import {
  MAIL_PORT,
  type MailPort,
} from '../../infra/providers/auth-registration-security/mail.port';

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export interface TicketReplyMail {
  to: string;
  customerName: string;
  ticketNumber: string;
  ticketUuid: string;
  subject: string;
  status: string;
  body: string;
}

/**
 * The operator's reply, emailed to the address typed on the ticket form (TW-SUPP-010). Sending never throws: the
 * reply is already stored, so a mail failure is reported back as 'failed' (and kept on the message) instead of
 * pretending it went out, which is what Reference's success banner did.
 *
 * Reference's footer promised "reply to this email to add to your ticket" and an auto-close; neither exists there or here,
 * so this copy does not promise them.
 */
@Injectable()
export class SupportMailer {
  private readonly logger = new Logger(SupportMailer.name);
  private readonly brand: string;
  private readonly webUrl: string;

  constructor(
    @Inject(MAIL_PORT) private readonly port: MailPort,
    config: ConfigService<Env, true>,
  ) {
    this.brand = config.get('APP_NAME', { infer: true });
    this.webUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/$/, '');
  }

  ticketUrl(ticketUuid: string): string {
    return `${this.webUrl}/support/${ticketUuid}`;
  }

  async sendReply(m: TicketReplyMail): Promise<'sent' | 'failed'> {
    const url = this.ticketUrl(m.ticketUuid);
    const subject = `Re: ${m.subject || 'Your support ticket'}`;
    const hello = m.customerName.trim() ? `Hi ${m.customerName.trim()},` : 'Hi there,';
    const text = [
      hello,
      '',
      `Our support team replied to your ticket "${m.subject}":`,
      '',
      m.body,
      '',
      `View the ticket and answer: ${url}`,
      '',
      `Ticket #${m.ticketNumber} (${m.status.replace('_', ' ')}) - sent by ${this.brand}`,
    ].join('\n');
    const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f172a">
<div style="max-width:560px;margin:24px auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px">
<p style="font-weight:700;margin:0 0 4px">${esc(this.brand)} support</p>
<p style="color:#64748b;font-size:13px;margin:0 0 16px;font-family:monospace">Re: ticket #${esc(m.ticketNumber)} &middot; ${esc(m.status.replace('_', ' '))}</p>
<p>${esc(hello)}</p>
<p>Our support team replied to your ticket &ldquo;${esc(m.subject)}&rdquo;:</p>
<blockquote style="margin:0 0 16px;padding:12px 16px;background:#f8fafc;border-left:3px solid #0f766e;white-space:pre-wrap">${esc(m.body)}</blockquote>
<p><a href="${esc(url)}" style="background:#0f766e;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">View ticket &amp; reply</a></p>
</div></body></html>`;
    try {
      await this.port.send({ to: m.to, subject, text, html });
      return 'sent';
    } catch (err) {
      this.logger.warn(
        `support reply email failed for ticket ${m.ticketNumber}: ${(err as Error).message}`,
      );
      return 'failed';
    }
  }
}
