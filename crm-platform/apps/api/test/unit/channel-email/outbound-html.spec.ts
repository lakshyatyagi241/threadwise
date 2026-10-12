import { describe, expect, it } from 'vitest';
import {
  buildMime,
  fillSignatureVariables,
  mergeSignature,
  mimeAllowed,
  mimeList,
  outboundText,
  sanitizeOutboundHtml,
} from '../../../src/infra/providers/channel-email';
import { expectMimeCarries, outgoingWithFiles } from './driver-send-contract';

describe('TW-MAIL-027: outbound HTML is made safe', () => {
  it('keeps formatting, lists, quotes and links', () => {
    const out = sanitizeOutboundHtml(
      '<p>Hi <b>Ana</b> <i>x</i> <u>y</u></p><ul><li>one</li></ul><blockquote>q</blockquote><a href="https://acme.test/a">link</a>',
    );
    expect(out).toContain('<b>Ana</b>');
    expect(out).toContain('<ul><li>one</li></ul>');
    expect(out).toContain('<blockquote>q</blockquote>');
    expect(out).toContain('href="https://acme.test/a"');
  });

  it('removes scripts, event handlers, styles, forms, frames, images and javascript: links', () => {
    const out = sanitizeOutboundHtml(
      '<script>alert(1)</script><p onclick="x()" style="color:red">hi</p><img src="https://t.example/p.gif" onerror="x()"><iframe src="https://e"></iframe>' +
        '<form action="https://e"><input name="a"></form><a href="javascript:alert(1)">bad</a><svg><script>1</script></svg><style>p{}</style>',
    );
    expect(out).not.toMatch(
      /script|onclick|onerror|style|<img|iframe|<form|<input|javascript:|svg/i,
    );
    expect(out).toContain('hi');
    expect(out).toContain('bad');
  });

  it('derives a text part from the cleaned HTML', () => {
    expect(outboundText(sanitizeOutboundHtml('<p>Hello <b>Ana</b></p><p>Bye</p>'))).toBe(
      'Hello Ana\nBye',
    );
  });
});

describe('TW-MAIL-027: signature variables and the merge', () => {
  const vars = { name: 'Ana <Agent>', title: 'Support lead', phone: '+15550100' };

  it('fills name, title and phone, escaping them in HTML only', () => {
    expect(
      fillSignatureVariables('{{name}} | {{ Title }} | {{phone}} | {{other}}', vars, 'text'),
    ).toBe('Ana <Agent> | Support lead | +15550100 | {{other}}');
    expect(fillSignatureVariables('<b>{{name}}</b>', vars, 'html')).toBe(
      '<b>Ana &lt;Agent&gt;</b>',
    );
  });

  it('a missing value becomes empty', () => {
    expect(fillSignatureVariables('T:{{title}}.', { name: '', title: '', phone: '' }, 'text')).toBe(
      'T:.',
    );
  });

  it('appends the signature after the standard separator in both parts', () => {
    const m = mergeSignature(
      { text: 'Hello', html: '<p>Hello</p>' },
      { text: 'Ana\nSupport', html: '<b>Ana</b>' },
    );
    expect(m.text).toBe('Hello\n\n-- \nAna\nSupport');
    expect(m.html).toContain('<p>Hello</p>');
    expect(m.html).toContain('<div>--</div><div><b>Ana</b></div>');
  });

  it('gives a plain-text reply an HTML part when the signature has HTML, and leaves a reply alone without a signature', () => {
    const m = mergeSignature({ text: 'a < b', html: null }, { text: '', html: '<i>Ana</i>' });
    expect(m.html).toContain('a &lt; b');
    expect(m.html).toContain('<i>Ana</i>');
    expect(m.text).toContain('-- \nAna');
    expect(mergeSignature({ text: 'x', html: null }, null)).toEqual({ text: 'x', html: null });
    expect(mergeSignature({ text: 'x', html: null }, { text: ' ', html: '' })).toEqual({
      text: 'x',
      html: null,
    });
  });
});

describe('TW-MAIL-027: mime allow and deny lists', () => {
  it('an empty allow list allows anything; deny always wins; wildcards work', () => {
    expect(mimeAllowed('application/pdf', [], [])).toBe(true);
    expect(mimeAllowed('application/pdf', ['image/*'], [])).toBe(false);
    expect(mimeAllowed('image/png', ['image/*'], [])).toBe(true);
    expect(mimeAllowed('image/png', ['image/*'], ['image/png'])).toBe(false);
    expect(mimeAllowed('video/mp4', [], ['video/*'])).toBe(false);
    expect(mimeAllowed('Application/PDF; charset=x', ['application/pdf'], [])).toBe(true);
    expect(mimeList(' image/* , Application/PDF,')).toEqual(['image/*', 'application/pdf']);
  });
});

describe('TW-MAIL-027: the MIME of a reply carries html and file bytes (driver contract)', () => {
  it('buildMime puts the html part and every attachment, bytes intact, in the message', async () => {
    const mail = outgoingWithFiles();
    const raw = await buildMime({
      from: mail.from,
      to: mail.to,
      cc: mail.cc,
      bcc: mail.bcc,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      messageId: mail.messageId,
      inReplyTo: mail.inReplyTo,
      references: mail.references,
      attachments: mail.attachments.map((a) => ({ name: a.name, mime: a.mime, bytes: a.bytes! })),
    });
    expect(raw.toString('utf8')).toMatch(/multipart\/mixed/i);
    expectMimeCarries(raw, mail);
  });
});
