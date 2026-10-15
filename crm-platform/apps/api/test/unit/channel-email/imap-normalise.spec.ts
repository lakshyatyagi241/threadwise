import { describe, expect, it } from 'vitest';
import {
  attachmentBytes,
  imapProviderMessageId,
  INLINE_ATTACHMENT_BYTES,
  normaliseImapMessage,
} from '../../../src/infra/providers/channel-email/imap/imap-normalise';
import { skipByFlags } from '../../../src/modules/channel-email/drivers/imap-mail.driver';

const mime = (headers: string[], body: string) => Buffer.from([...headers, '', body].join('\r\n'));
const base = (source: Buffer, over: Record<string, unknown> = {}) => ({
  source,
  flags: ['seen'],
  folder: 'INBOX',
  internalDate: null,
  size: source.length,
  fallbackMessageId: 'fallback@imap.invalid',
  known: undefined,
  refetch: async () => Buffer.alloc(0),
  ...over,
});

describe('normaliseImapMessage', () => {
  it('reads addresses, ids and the plain body; a first mail is its own thread root', async () => {
    const m = await normaliseImapMessage(
      base(
        mime(
          [
            'From: "Ana C" <Ana@Example.com>',
            'To: support@acme.test, Bob <bob@acme.test>',
            'Subject: Hello',
            'Message-ID: <one@example.com>',
            'Date: Mon, 12 Oct 2026 10:00:00 +0000',
            'Content-Type: text/plain; charset=utf-8',
          ],
          'Hi there',
        ),
      ),
    );
    expect(m.from).toEqual({ name: 'Ana C', address: 'ana@example.com' });
    expect(m.to.map((a) => a.address)).toEqual(['support@acme.test', 'bob@acme.test']);
    expect(m.messageId).toBe('one@example.com');
    expect(m.text).toBe('Hi there');
    expect(m.html).toBeNull();
    expect(m.providerMessageId).toBe(imapProviderMessageId('one@example.com'));
    expect(m.threadKey).toMatch(/^m:[0-9a-f]{40}$/);
    expect(m.sentAt.toISOString()).toBe('2026-10-12T10:00:00.000Z');
  });

  it('a reply and its parent get the same thread key, with or without References', async () => {
    const parent = await normaliseImapMessage(
      base(mime(['From: a@x.com', 'Message-ID: <root@x.com>', 'Subject: s'], 'q')),
    );
    const viaRefs = await normaliseImapMessage(
      base(
        mime(
          [
            'From: b@x.com',
            'Message-ID: <r1@x.com>',
            'In-Reply-To: <root@x.com>',
            'References: <root@x.com>',
            'Subject: Re: s',
          ],
          'a',
        ),
      ),
    );
    const viaParentOnly = await normaliseImapMessage(
      base(
        mime(
          [
            'From: b@x.com',
            'Message-ID: <r2@x.com>',
            'In-Reply-To: <root@x.com>',
            'Subject: Re: s',
          ],
          'a',
        ),
      ),
    );
    expect(viaRefs.threadKey).toBe(parent.threadKey);
    expect(viaParentOnly.threadKey).toBe(parent.threadKey);
    expect(viaRefs.references).toEqual(['root@x.com']);
  });

  it('a stored ancestor decides the thread when the reply names it only by its parent', async () => {
    const m = await normaliseImapMessage(
      base(
        mime(
          [
            'From: b@x.com',
            'Message-ID: <r3@x.com>',
            'In-Reply-To: <ours@acme.test>',
            'Subject: Re',
          ],
          'a',
        ),
        {
          known: new Map([['ours@acme.test', 'm:stored']]),
        },
      ),
    );
    expect(m.threadKey).toBe('m:stored');
  });

  it('does not merge two unrelated mails with the same subject', async () => {
    const a = await normaliseImapMessage(
      base(mime(['From: a@x.com', 'Message-ID: <a@x.com>', 'Subject: Same'], '1')),
    );
    const b = await normaliseImapMessage(
      base(mime(['From: b@x.com', 'Message-ID: <b@x.com>', 'Subject: Same'], '2')),
    );
    expect(a.threadKey).not.toBe(b.threadKey);
  });

  it('uses the fallback id for a mail without a Message-ID', async () => {
    const m = await normaliseImapMessage(base(mime(['From: a@x.com', 'Subject: none'], 'x')));
    expect(m.messageId).toBe('fallback@imap.invalid');
  });

  it('marks auto-replies, bulk mail and bounces as automated and keeps the classifying headers', async () => {
    const auto = await normaliseImapMessage(
      base(mime(['From: a@x.com', 'Message-ID: <q@x.com>', 'Auto-Submitted: auto-replied'], 'ooo')),
    );
    expect(auto.automated).toBe(true);
    expect(auto.rawHeaders['auto-submitted']).toBe('auto-replied');
    const list = await normaliseImapMessage(
      base(
        mime(['From: a@x.com', 'Message-ID: <l@x.com>', 'List-Unsubscribe: <mailto:u@x.com>'], 'n'),
      ),
    );
    expect(list.automated).toBe(true);
    const human = await normaliseImapMessage(
      base(mime(['From: a@x.com', 'Message-ID: <h@x.com>'], 'hi')),
    );
    expect(human.automated).toBe(false);
  });

  it('carries small attachments, hands big ones over lazily, and finds them again by part id', async () => {
    const big = Buffer.alloc(INLINE_ATTACHMENT_BYTES + 10, 7);
    const source = Buffer.from(
      [
        'From: a@x.com',
        'Message-ID: <att@x.com>',
        'Subject: files',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="b"',
        '',
        '--b',
        'Content-Type: text/plain',
        '',
        'see files',
        '--b',
        'Content-Type: application/pdf; name="small.pdf"',
        'Content-Disposition: attachment; filename="small.pdf"',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from('small-bytes').toString('base64'),
        '--b',
        'Content-Type: application/octet-stream; name="big.bin"',
        'Content-Disposition: attachment; filename="big.bin"',
        'Content-Transfer-Encoding: base64',
        '',
        big.toString('base64'),
        '--b--',
        '',
      ].join('\r\n'),
    );
    const m = await normaliseImapMessage(
      base(source, { refetch: (partId: string) => attachmentBytes(source, partId) }),
    );
    expect(m.attachments.map((a) => a.name)).toEqual(['small.pdf', 'big.bin']);
    expect(m.attachments[0]!.data?.toString()).toBe('small-bytes');
    expect(m.attachments[0]!.fetch).toBeNull();
    expect(m.attachments[1]!.data).toBeNull();
    const bytes = await m.attachments[1]!.fetch!();
    expect(bytes.equals(big)).toBe(true);
  });

  it('keeps raw html for the ingest to sanitise and an inline image as inline', async () => {
    const source = Buffer.from(
      [
        'From: a@x.com',
        'Message-ID: <html@x.com>',
        'MIME-Version: 1.0',
        'Content-Type: multipart/related; boundary="r"',
        '',
        '--r',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<p>hi <img src="cid:pic1"></p><script>x()</script>',
        '--r',
        'Content-Type: image/png; name="p.png"',
        'Content-ID: <pic1>',
        'Content-Disposition: inline; filename="p.png"',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from('png').toString('base64'),
        '--r--',
        '',
      ].join('\r\n'),
    );
    const m = await normaliseImapMessage(base(source));
    expect(m.html).toContain('<script>');
    expect(m.text).toBe('');
    expect(m.attachments[0]).toMatchObject({ contentId: 'pic1', inline: true });
  });
});

describe('skipByFlags', () => {
  it('skips drafts, deleted and junk but not ordinary mail', () => {
    expect(skipByFlags(['draft'])).toBe('draft');
    expect(skipByFlags(['seen', 'deleted'])).toBe('trash');
    expect(skipByFlags(['$junk'])).toBe('spam');
    expect(skipByFlags(['seen', 'answered', '$notjunk'])).toBeNull();
  });
});
