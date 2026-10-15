import { describe, expect, it } from 'vitest';
import { parseGmailMessage } from '../../../src/infra/providers/channel-email';
import { b64, filePart, gmailMessage, h, htmlPart, textPart } from './fixtures';

const MAILBOX = 'support@acme.test';

describe('TW-MAIL-026: reading a Gmail message', () => {
  it('multipart/alternative: the text part, the html part and the headers', () => {
    const p = parseGmailMessage(
      gmailMessage({
        headers: [
          h('Cc', 'Bob <bob@example.com>'),
          h('In-Reply-To', '<prev@mail.example.com>'),
          h('References', '<root@mail.example.com> <prev@mail.example.com>'),
        ],
      }),
      MAILBOX,
    );
    expect(p).toMatchObject({
      providerMessageId: 'm1',
      threadId: 't1',
      subject: 'Order question',
      from: { name: 'Ana Customer', address: 'ana@example.com' },
      to: [{ name: null, address: 'support@acme.test' }],
      cc: [{ name: 'Bob', address: 'bob@example.com' }],
      messageId: 'abc123@mail.example.com',
      inReplyTo: 'prev@mail.example.com',
      references: ['root@mail.example.com', 'prev@mail.example.com'],
      text: 'Hello there',
      html: '<p>Hello <b>there</b></p>',
      automated: false,
      skip: null,
    });
    expect(p.sentAt.getTime()).toBe(1760000000000);
  });

  it('decodes an encoded subject and a non-UTF-8 text part', () => {
    const p = parseGmailMessage(
      gmailMessage({
        headers: [h('Subject', '=?UTF-8?B?w4RyZ2Vy?=')],
        parts: [
          {
            partId: '0',
            mimeType: 'text/plain',
            headers: [h('Content-Type', 'text/plain; charset=iso-8859-1')],
            body: { size: 4, data: b64(Buffer.from([0x63, 0x61, 0x66, 0xe9])) },
          },
        ],
        mimeType: 'text/plain',
      }),
      MAILBOX,
    );
    expect(p.subject).toBe('Ärger');
    expect(p.text).toBe('café');
    expect(p.html).toBeNull();
  });

  it('attachments: one with a Gmail attachment id, one small file with its bytes, inline images by Content-ID', () => {
    const p = parseGmailMessage(
      gmailMessage({
        mimeType: 'multipart/mixed',
        parts: [
          {
            partId: '0',
            mimeType: 'multipart/related',
            headers: [h('Content-Type', 'multipart/related')],
            parts: [
              htmlPart('<p>See <img src="cid:logo123"></p>', '0.0'),
              filePart('0.1', 'logo.png', 'image/png', {
                data: Buffer.from('PNGDATA'),
                contentId: 'logo123',
                disposition: 'inline',
              }),
            ],
          },
          filePart('1', 'invoice.pdf', 'application/pdf', { attachmentId: 'ATT-1', size: 200_000 }),
          filePart('2', 'note.txt', 'text/plain', { data: Buffer.from('a note') }),
        ],
      }),
      MAILBOX,
    );
    expect(p.html).toContain('cid:logo123');
    expect(p.text).toBe('');
    expect(
      p.attachments.map((a) => ({
        name: a.name,
        mime: a.mime,
        inline: a.inline,
        id: a.attachmentId,
        cid: a.contentId,
      })),
    ).toEqual([
      { name: 'logo.png', mime: 'image/png', inline: true, id: null, cid: 'logo123' },
      { name: 'invoice.pdf', mime: 'application/pdf', inline: false, id: 'ATT-1', cid: null },
      { name: 'note.txt', mime: 'text/plain', inline: false, id: null, cid: null },
    ]);
    expect(p.attachments[0]!.data?.toString()).toBe('PNGDATA');
    expect(p.attachments[1]!.size).toBe(200_000);
  });

  it('a text/plain attachment with a file name is a file, not the body', () => {
    const p = parseGmailMessage(
      gmailMessage({
        mimeType: 'multipart/mixed',
        parts: [
          textPart('the body'),
          filePart('1', 'log.txt', 'text/plain', { data: Buffer.from('LOG') }),
        ],
      }),
      MAILBOX,
    );
    expect(p.text).toBe('the body');
    expect(p.attachments).toHaveLength(1);
  });

  it('a mail with no Message-ID gets a stable synthetic one; no From is reported, not thrown', () => {
    const msg = gmailMessage();
    msg.payload!.headers = [h('Subject', 'x')];
    const a = parseGmailMessage(msg, MAILBOX);
    const b = parseGmailMessage(msg, MAILBOX);
    expect(a.messageId).toMatch(/^gmail-[0-9a-f]{24}@gmail\.invalid$/);
    expect(a.messageId).toBe(b.messageId);
    expect(a.from.address).toBe('unknown@invalid');
  });

  it('a mail with no payload at all is empty, not an error', () => {
    const p = parseGmailMessage({ id: 'x', threadId: 'y' }, MAILBOX);
    expect(p).toMatchObject({ text: '', html: null, attachments: [], skip: null });
  });
});

describe('TW-MAIL-021: what the sync skips', () => {
  const labelled = (labelIds: string[], from = 'Ana <ana@example.com>') =>
    parseGmailMessage(gmailMessage({ labelIds, headers: [h('From', from)] }), MAILBOX).skip;

  it('drafts, spam, trash and our own sent mail', () => {
    expect(labelled(['DRAFT'])).toBe('draft');
    expect(labelled(['SPAM', 'INBOX'])).toBe('spam');
    expect(labelled(['TRASH'])).toBe('trash');
    expect(labelled(['SENT'])).toBe('sent');
    expect(labelled(['INBOX', 'UNREAD'])).toBeNull();
  });

  it('a mail one sends to oneself (SENT and INBOX) is an inbound message', () => {
    expect(labelled(['SENT', 'INBOX'], 'Support <support@acme.test>')).toBeNull();
  });
});

describe('TW-MAIL-032: automated mail is marked, not dropped', () => {
  const automated = (headers: Array<[string, string]>, from?: string) =>
    parseGmailMessage(
      gmailMessage({
        headers: [...(from ? [h('From', from)] : []), ...headers.map(([n, v]) => h(n, v))],
      }),
      MAILBOX,
    ).automated;

  it('Auto-Submitted, Precedence bulk/list, List-Id, List-Unsubscribe, X-Auto-Response-Suppress', () => {
    expect(automated([['Auto-Submitted', 'auto-replied']])).toBe(true);
    expect(automated([['Auto-Submitted', 'no']])).toBe(false);
    expect(automated([['Precedence', 'bulk']])).toBe(true);
    expect(automated([['Precedence', 'list']])).toBe(true);
    expect(automated([['List-Id', '<news.example.com>']])).toBe(true);
    expect(automated([['List-Unsubscribe', '<mailto:u@x.com>']])).toBe(true);
    expect(automated([['X-Auto-Response-Suppress', 'All']])).toBe(true);
  });

  it('bounces and no-reply senders', () => {
    expect(automated([['Return-Path', '<>']])).toBe(true);
    expect(automated([], 'MAILER-DAEMON@googlemail.com')).toBe(true);
    expect(automated([], 'No Reply <noreply@shop.example>')).toBe(true);
    expect(automated([], 'donotreply@shop.example')).toBe(true);
    expect(automated([], 'Ana <ana@example.com>')).toBe(false);
  });

  it('a delivery status report (multipart/report)', () => {
    const msg = gmailMessage({
      mimeType: 'multipart/report',
      headers: [h('Content-Type', 'multipart/report; report-type=delivery-status')],
    });
    expect(parseGmailMessage(msg, MAILBOX).automated).toBe(true);
  });
});
