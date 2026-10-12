import { expect } from 'vitest';
import type { OutgoingMail } from '../../../src/infra/providers/channel-email';

/**
 * Shared check for every mail driver (TW-MAIL-027): whatever a driver sends over its own protocol (Gmail API, SMTP, Graph) must carry
 * the reply's `html` and the BYTES of `attachments`. A driver that builds RFC 5322 bytes (`buildMime`: Google, IMAP/SMTP) can feed them to
 * `expectMimeCarries`; a driver that posts JSON (Microsoft Graph) checks its request body against `outgoingWithFiles()` itself.
 */
export function outgoingWithFiles(over: Partial<OutgoingMail> = {}): OutgoingMail {
  return {
    messageId: 'tw.contract-1@acme.test',
    from: { name: 'Acme Support', address: 'support@acme.test' },
    to: ['ana@example.com'],
    cc: [],
    bcc: [],
    subject: 'Re: Invoice',
    text: 'Hello Ana\n\n-- \nAgent',
    html: '<div>Hello <b>Ana</b></div><div>-- </div><div>Agent</div>',
    inReplyTo: 'orig@example.com',
    references: ['orig@example.com'],
    threadKey: null,
    attachments: [
      {
        name: 'invoice.pdf',
        mime: 'application/pdf',
        bytes: Buffer.from('%PDF-1.4 contract bytes'),
        objectKey: 'chat/1/x.pdf',
      },
      {
        name: 'notes.txt',
        mime: 'text/plain',
        bytes: Buffer.from('plain notes'),
        objectKey: 'chat/1/y.txt',
      },
    ],
    headers: {},
    attempt: 1,
    ...over,
  };
}

const decodeQp = (s: string) =>
  s
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));

/** Asserts the raw message has the HTML part and each attachment with its exact bytes. */
export function expectMimeCarries(raw: Buffer | string, mail: OutgoingMail): void {
  const text = raw.toString('utf8');
  expect(text).toMatch(/Content-Type: text\/html/i);
  expect(decodeQp(text)).toContain(mail.html!.replace(/\s+$/, ''));
  for (const a of mail.attachments) {
    const at = text.indexOf(`filename=${JSON.stringify(a.name)}`);
    const alt = at >= 0 ? at : text.indexOf(`filename=${a.name}`);
    expect(alt, `attachment ${a.name} is in the message`).toBeGreaterThan(-1);
    const rest = text.slice(alt);
    const body = rest.split(/\r?\n\r?\n/)[1]!.split(/\r?\n--/)[0]!;
    expect(Buffer.from(body.replace(/\s+/g, ''), 'base64').equals(a.bytes!)).toBe(true);
  }
}
