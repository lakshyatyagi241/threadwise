import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { MailPort } from '../../../src/infra/providers/auth-registration-security/mail.port';
import { SupportMailer } from '../../../src/modules/platform-support-desk/support-mailer.service';

const config = {
  get: (k: string) => (k === 'APP_NAME' ? 'Acme' : 'https://app.example.test/'),
} as unknown as ConfigService<never, true>;

const mail = {
  to: 'c@example.test',
  customerName: 'Cora',
  ticketNumber: 'TKT-ABC123',
  ticketUuid: '11111111-1111-4111-8111-111111111111',
  subject: 'Cannot <send>',
  status: 'in_progress',
  body: 'Try <b>again</b>',
};

describe('SupportMailer (TW-SUPP-010)', () => {
  it('sends Re: subject with the reply, the ticket number and a link under the app URL, HTML-escaped', async () => {
    const sent: Array<{ to: string; subject: string; text: string; html?: string }> = [];
    const port: MailPort = { send: async (m) => void sent.push(m) };
    expect(await new SupportMailer(port, config).sendReply(mail)).toBe('sent');
    const m = sent[0]!;
    expect(m.subject).toBe('Re: Cannot <send>');
    expect(m.text).toContain('Try <b>again</b>');
    expect(m.text).toContain(
      'https://app.example.test/support/11111111-1111-4111-8111-111111111111',
    );
    expect(m.html).toContain('Try &lt;b&gt;again&lt;/b&gt;');
    expect(m.html).not.toContain('<b>again</b>');
  });

  it('reports failure instead of throwing when the transport fails', async () => {
    const port: MailPort = {
      send: async () => {
        throw new Error('smtp down');
      },
    };
    expect(await new SupportMailer(port, config).sendReply(mail)).toBe('failed');
  });
});
