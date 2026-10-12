import { describe, expect, it } from 'vitest';
import { EMAIL_HTML_MAX } from '@crm/contracts';
import { htmlToText, sanitizeEmailHtml } from '../../../src/infra/providers/channel-email';

const opts = { blockRemoteImages: true, inputMaxChars: 1_000_000 };
const clean = (html: string, o = opts) => sanitizeEmailHtml(html, o).html;

describe('TW-MAIL-026: the HTML body is made safe', () => {
  it('removes scripts, styles, frames, forms, event handlers and javascript links', () => {
    const out = clean(
      '<p onclick="x()" style="color:red">Hi</p><script>alert(1)</script><style>p{}</style><iframe src="//e.com"></iframe>' +
        '<form action="/x"><input name="a"></form><a href="javascript:alert(1)">bad</a><object data="x"></object>',
    );
    expect(out).toBe('<p>Hi</p><a target="_blank" rel="noopener noreferrer nofollow">bad</a>');
    expect(out).not.toMatch(/script|onclick|javascript|iframe|form|style/i);
  });

  it('links open in a new window with no referrer; mailto and tel survive', () => {
    expect(clean('<a href="https://example.com/x" title="t">go</a>')).toBe(
      '<a href="https://example.com/x" title="t" target="_blank" rel="noopener noreferrer nofollow">go</a>',
    );
    expect(clean('<a href="mailto:a@b.com">m</a><a href="tel:+1555">t</a>')).toContain(
      'href="mailto:a@b.com"',
    );
  });

  it('remote images are not loaded: the address moves to data-remote-src', () => {
    const out = clean('<img src="https://tracker.example/p.gif" alt="logo" width="1">');
    expect(out).toBe(
      '<img alt="logo" width="1" data-remote-src="https://tracker.example/p.gif" />',
    );
    expect(out).not.toContain(' src=');
    expect(clean('<img src="//cdn.example/x.png">')).not.toContain(' src=');
  });

  it('with blocking off the remote image keeps its src', () => {
    expect(
      clean('<img src="https://a.example/x.png">', { ...opts, blockRemoteImages: false }),
    ).toContain('src="https://a.example/x.png"');
  });

  it('cid images point at the attachment id; an unmapped cid and a data: image are dropped', () => {
    const map = new Map([['logo@x', 'ATT-9']]);
    expect(clean('<img src="cid:logo@x">', { ...opts, cidToAttachmentId: map })).toBe(
      '<img src="cid:ATT-9" />',
    );
    expect(clean('<img src="cid:other">', { ...opts, cidToAttachmentId: map })).toBe('');
    expect(clean('<img src="data:image/png;base64,AAAA">')).toBe('');
  });

  it('a body over the cap is cut and stays well formed and under the cap', () => {
    const big = `<div>${'<p><b>word</b> and some more text </p>'.repeat(5000)}</div>`;
    const r = sanitizeEmailHtml(big, opts);
    expect(r.truncated).toBe(true);
    expect(r.html.length).toBeLessThanOrEqual(EMAIL_HTML_MAX);
    expect(r.html.endsWith('</div>')).toBe(true);
    expect((r.html.match(/<p>/g) ?? []).length).toBe((r.html.match(/<\/p>/g) ?? []).length);
  });

  it('an enormous input is cut before it is parsed', () => {
    const r = sanitizeEmailHtml('<p>x</p>'.repeat(50_000), { ...opts, inputMaxChars: 1_000 });
    expect(r.truncated).toBe(true);
    expect(r.html.length).toBeLessThan(1_100);
  });

  it('htmlToText keeps line breaks and decodes entities', () => {
    expect(
      htmlToText('<p>Hello &amp; welcome</p><p>Line<br>two</p><ul><li>a</li><li>b</li></ul>'),
    ).toBe('Hello & welcome\nLine\ntwo\n- a\n- b');
    expect(htmlToText('<script>x()</script>Only text')).toBe('Only text');
  });
});
