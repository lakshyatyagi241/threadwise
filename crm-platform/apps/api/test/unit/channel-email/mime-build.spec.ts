import { describe, expect, it } from 'vitest';
import { buildMime, textToHtml } from '../../../src/infra/providers/channel-email';

const unfold = (raw: string) => raw.replace(/\r?\n[ \t]+/g, ' ');
const header = (raw: string, name: string) =>
  new RegExp(`^${name}: (.*)$`, 'im').exec(unfold(raw.split(/\r?\n\r?\n/)[0]!))?.[1];

const base = {
  from: { name: 'Acme Support', address: 'support@acme.test' },
  to: ['ana@example.com'],
  cc: [],
  bcc: [],
  subject: 'Re: Order question',
  text: 'Thanks, shipped today.',
  messageId: 'tw.ref-1@acme.test',
  inReplyTo: 'abc123@mail.example.com',
  references: ['root@mail.example.com', 'abc123@mail.example.com'],
};

describe('TW-MAIL-022: the reply is an RFC 5322 message', () => {
  it('carries the threading headers, subject, from and a multipart/alternative body', async () => {
    const raw = (await buildMime(base)).toString('utf8');
    expect(header(raw, 'Subject')).toBe('Re: Order question');
    expect(header(raw, 'From')).toBe('Acme Support <support@acme.test>');
    expect(header(raw, 'To')).toBe('ana@example.com');
    expect(header(raw, 'Message-ID')).toBe('<tw.ref-1@acme.test>');
    expect(header(raw, 'In-Reply-To')).toBe('<abc123@mail.example.com>');
    expect(header(raw, 'References')).toBe('<root@mail.example.com> <abc123@mail.example.com>');
    expect(header(raw, 'Content-Type')).toMatch(/^multipart\/alternative/);
    expect(raw).toMatch(/Content-Type: text\/plain/i);
    expect(raw).toMatch(/Content-Type: text\/html/i);
    expect(raw).toContain('Thanks, shipped today.');
  });

  it('adds In-Reply-To to References when the chain lacks it, and omits both for a new thread', async () => {
    const a = (await buildMime({ ...base, references: ['root@x'] })).toString('utf8');
    expect(header(a, 'References')).toBe('<root@x> <abc123@mail.example.com>');
    const b = (await buildMime({ ...base, inReplyTo: null, references: [] })).toString('utf8');
    expect(header(b, 'In-Reply-To')).toBeUndefined();
    expect(header(b, 'References')).toBeUndefined();
  });

  it('cc and bcc are in the message (Gmail reads Bcc to address those recipients and removes it)', async () => {
    const raw = (
      await buildMime({ ...base, cc: ['cc1@x.com', 'cc2@x.com'], bcc: ['hidden@x.com'] })
    ).toString('utf8');
    expect(header(raw, 'Cc')).toBe('cc1@x.com, cc2@x.com');
    expect(header(raw, 'Bcc')).toBe('hidden@x.com');
  });

  it('a non-ASCII subject and body are encoded, a line break in a header value cannot inject a header', async () => {
    const raw = (
      await buildMime({
        ...base,
        subject: 'Re: Ärger\r\nBcc: evil@x.com',
        from: { name: 'Zoë\r\nX-Evil: 1', address: 'support@acme.test' },
        text: 'Grüße ✓',
      })
    ).toString('utf8');
    expect(raw).not.toMatch(/^X-Evil:/im);
    expect(header(raw, 'Bcc')).toBeUndefined();
    expect(header(raw, 'Subject')).toMatch(/=\?UTF-8\?/);
    expect(raw).toMatch(/Content-Transfer-Encoding: quoted-printable/i);
  });

  it('the html twin is the escaped text with line breaks', () => {
    expect(textToHtml('a <b> & "c"\nline2')).toBe(
      '<div dir="auto">a &lt;b&gt; &amp; &quot;c&quot;<br>\nline2</div>',
    );
  });
});
