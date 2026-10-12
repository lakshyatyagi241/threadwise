import { describe, expect, it } from 'vitest';
import {
  detectBounce,
  isLoopRisk,
  normaliseGmailMessage,
  parseGmailMessage,
  type GmailPart,
  type NormalisedMail,
} from '../../../src/infra/providers/channel-email';
import { b64, gmailMessage, h, textPart } from './fixtures';

const MAILBOX = 'support@acme.test';
const ORIGINAL_ID = 'tw.reply-1@acme.test';

const normalise = (msg: ReturnType<typeof gmailMessage>): NormalisedMail =>
  normaliseGmailMessage(msg, parseGmailMessage(msg, MAILBOX), async () => Buffer.alloc(0));

const dsnPart = (text: string): GmailPart => ({
  partId: '1',
  mimeType: 'message/delivery-status',
  filename: '',
  headers: [h('Content-Type', 'message/delivery-status')],
  body: { size: text.length, data: b64(text) },
});
const headersPart = (text: string): GmailPart => ({
  partId: '2',
  mimeType: 'text/rfc822-headers',
  filename: '',
  headers: [h('Content-Type', 'text/rfc822-headers')],
  body: { size: text.length, data: b64(text) },
});

const report = (parts: GmailPart[], extra: Array<[string, string]> = []) =>
  gmailMessage({
    mimeType: 'multipart/report',
    headers: [
      h('From', 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>'),
      h('Subject', 'Delivery Status Notification (Failure)'),
      h('Content-Type', 'multipart/report; report-type=delivery-status; boundary="b"'),
      h('Auto-Submitted', 'auto-replied'),
      ...extra.map(([n, v]) => h(n, v)),
    ],
    parts,
  });

describe('TW-MAIL-032: bounce and delivery-status detection', () => {
  it('Gmail DSN, hard: recipient, 5.1.1 status, reason, and the original Message-ID from the returned headers', () => {
    const mail = normalise(
      report([
        textPart(
          "Your message wasn't delivered to nobody@example.org because the address couldn't be found.",
        ),
        dsnPart(
          [
            'Reporting-MTA: dns; googlemail.com',
            '',
            'Final-Recipient: rfc822; nobody@example.org',
            'Action: failed',
            'Status: 5.1.1',
            'Diagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does not exist.',
          ].join('\n'),
        ),
        headersPart(`Message-ID: <${ORIGINAL_ID}>\nSubject: Re: Order\nTo: nobody@example.org`),
      ]),
    );
    expect(mail.report?.deliveryStatus).toContain('Final-Recipient');
    const b = detectBounce(mail)!;
    expect(b).toMatchObject({
      kind: 'hard',
      failedRecipient: 'nobody@example.org',
      status: '5.1.1',
    });
    expect(b.reason).toContain('does not exist');
    expect(b.originalMessageIds[0]).toBe(ORIGINAL_ID);
  });

  it('Postfix DSN, soft: a 4.2.2 mailbox full is soft and keeps the SMTP reason', () => {
    const b = detectBounce(
      normalise(
        report(
          [
            textPart('<bob@example.net>: host mx.example.net said: 452 4.2.2 Mailbox full'),
            dsnPart(
              'Reporting-MTA: dns; mail.acme.test\n\nFinal-Recipient: rfc822; bob@example.net\nAction: delayed\nStatus: 4.2.2\nDiagnostic-Code: smtp; 452 4.2.2 Mailbox full',
            ),
            headersPart(`Message-ID: <${ORIGINAL_ID}>`),
          ],
          [['From', 'MAILER-DAEMON@mail.acme.test (Mail Delivery System)']],
        ),
      ),
    )!;
    expect(b).toMatchObject({ kind: 'soft', failedRecipient: 'bob@example.net', status: '4.2.2' });
    expect(b.reason).toContain('Mailbox full');
  });

  it('Postfix, hard without a delivery-status part: read from the readable text', () => {
    const msg = gmailMessage({
      headers: [
        h('From', 'MAILER-DAEMON@mail.acme.test (Mail Delivery System)'),
        h('Subject', 'Undelivered Mail Returned to Sender'),
        h('Content-Type', 'multipart/report; report-type=delivery-status; boundary="b"'),
        h('In-Reply-To', `<${ORIGINAL_ID}>`),
      ],
      mimeType: 'multipart/report',
      parts: [
        textPart(
          '<carol@example.com>: host mx.example.com[1.2.3.4] said: 550 5.1.1 <carol@example.com>: Recipient address rejected: User unknown (in reply to RCPT TO command)',
        ),
      ],
    });
    const b = detectBounce(normalise(msg))!;
    expect(b).toMatchObject({ kind: 'hard', failedRecipient: 'carol@example.com' });
    expect(b.originalMessageIds).toContain(ORIGINAL_ID);
  });

  it('Exchange / Outlook NDR (no machine part): "Undeliverable", the diagnostic and the quoted Message-ID', () => {
    const msg = gmailMessage({
      headers: [
        h('From', 'Microsoft Outlook <postmaster@contoso.onmicrosoft.com>'),
        h('Subject', 'Undeliverable: Re: Order question'),
        h('X-MS-Exchange-Message-Is-Ndr', ''),
      ],
      parts: [
        textPart(
          [
            'Delivery has failed to these recipients or groups:',
            '',
            'dave@contoso.com',
            "Your message to dave@contoso.com couldn't be delivered.",
            'Diagnostic information for administrators:',
            "Remote Server returned '550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup'",
            `Message-ID: <${ORIGINAL_ID}>`,
          ].join('\n'),
        ),
      ],
    });
    const b = detectBounce(normalise(msg))!;
    expect(b).toMatchObject({
      kind: 'hard',
      failedRecipient: 'dave@contoso.com',
      status: '5.1.10',
    });
    expect(b.originalMessageIds[0]).toBe(ORIGINAL_ID);
  });

  it('Exchange soft NDR: a 4.4.7 timeout is soft', () => {
    const msg = gmailMessage({
      headers: [
        h('From', 'postmaster@contoso.com'),
        h('Subject', 'Delivery Status Notification (Delay)'),
      ],
      parts: [
        textPart(
          "Your message to erin@contoso.com couldn't be delivered yet. Remote Server returned '450 4.4.7 Message delayed'",
        ),
      ],
    });
    expect(detectBounce(normalise(msg))).toMatchObject({
      kind: 'soft',
      failedRecipient: 'erin@contoso.com',
    });
  });

  it('X-Failed-Recipients alone names the recipient', () => {
    const msg = gmailMessage({
      headers: [
        h('From', 'mailer-daemon@example.com'),
        h('Subject', 'Mail delivery failed: returning message to sender'),
        h('X-Failed-Recipients', 'frank@example.com'),
      ],
      parts: [
        textPart(
          'This message was created automatically by mail delivery software. 550 5.1.1 unknown user',
        ),
      ],
    });
    expect(detectBounce(normalise(msg))).toMatchObject({
      kind: 'hard',
      failedRecipient: 'frank@example.com',
    });
  });

  it('is NOT a bounce: an out-of-office from a person, a newsletter, a no-reply notice, a normal mail', () => {
    const ooo = gmailMessage({
      headers: [h('Auto-Submitted', 'auto-replied'), h('Subject', 'Out of office')],
      parts: [textPart('I am away until Monday. The message was not delivered to my phone.')],
    });
    expect(detectBounce(normalise(ooo))).toBeNull();
    const news = gmailMessage({
      headers: [h('List-Unsubscribe', '<mailto:u@x.com>'), h('From', 'news@shop.example')],
    });
    expect(detectBounce(normalise(news))).toBeNull();
    expect(detectBounce(normalise(gmailMessage()))).toBeNull();
  });
});

describe('TW-MAIL-032: loop protection', () => {
  const mail = (headers: Record<string, string>, from = 'ana@example.com') =>
    ({ rawHeaders: headers, automated: false, from: { name: null, address: from } }) as const;
  it('never answers Auto-Submitted, bulk mail, suppress markers, lists, null return paths or daemons', () => {
    expect(isLoopRisk(mail({ 'auto-submitted': 'auto-replied' }))).toBe(true);
    expect(isLoopRisk(mail({ 'auto-submitted': 'no' }))).toBe(false);
    expect(isLoopRisk(mail({ precedence: 'bulk' }))).toBe(true);
    expect(isLoopRisk(mail({ precedence: 'junk' }))).toBe(true);
    expect(isLoopRisk(mail({ 'x-auto-response-suppress': 'All' }))).toBe(true);
    expect(isLoopRisk(mail({ 'list-unsubscribe': '<mailto:x@y>' }))).toBe(true);
    expect(isLoopRisk(mail({ 'return-path': '<>' }))).toBe(true);
    expect(isLoopRisk(mail({}, 'mailer-daemon@x.com'))).toBe(true);
    expect(isLoopRisk(mail({}))).toBe(false);
  });
});
