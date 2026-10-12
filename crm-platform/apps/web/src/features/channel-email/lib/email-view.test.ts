import { describe, expect, it } from 'vitest';
import {
  buildSrcDoc,
  formatAddress,
  formatAddresses,
  hasRemoteImages,
  listedAttachments,
  neutralise,
} from './email-view';

describe('addresses', () => {
  it('shows Name <address>, or the bare address', () => {
    expect(formatAddress({ name: 'Asha Rao', address: 'asha@x.io' })).toBe('Asha Rao <asha@x.io>');
    expect(formatAddress({ name: null, address: 'asha@x.io' })).toBe('asha@x.io');
    expect(formatAddress({ name: 'asha@x.io', address: 'asha@x.io' })).toBe('asha@x.io');
    expect(
      formatAddresses([
        { name: 'A', address: 'a@x.io' },
        { name: null, address: 'b@x.io' },
      ]),
    ).toBe('A <a@x.io>, b@x.io');
  });
});

describe('attachments', () => {
  const file = (o: Partial<{ id: string; inline: boolean }>) => ({
    id: 'a',
    name: 'f.pdf',
    mime: 'application/pdf',
    size: 1,
    inline: false,
    tooLarge: false,
    ...o,
  });
  it('lists files but not the pictures shown inside the body', () => {
    expect(
      listedAttachments([file({ id: '1' }), file({ id: '2', inline: true })]).map((a) => a.id),
    ).toEqual(['1']);
  });
});

describe('remote images', () => {
  it('detects pictures that would be fetched from the internet', () => {
    expect(hasRemoteImages('<p><img src="https://t.example/p.gif"></p>')).toBe(true);
    expect(hasRemoteImages("<img alt='x' src='//cdn.example/p.png'>")).toBe(true);
    expect(
      hasRemoteImages('<div style="background-image:url(https://x.example/a.png)">x</div>'),
    ).toBe(true);
    expect(hasRemoteImages('<table background="http://x.example/a.png"></table>')).toBe(true);
  });

  it('does not flag text, links or pictures inside the message', () => {
    expect(hasRemoteImages('<p>Hello <a href="https://x.example">link</a></p>')).toBe(false);
    expect(hasRemoteImages('<img src="data:image/png;base64,AAAA">')).toBe(false);
    expect(hasRemoteImages('<img src="cid:logo">')).toBe(false);
  });
});

describe('the document the frame shows', () => {
  const evil =
    '<p onclick="steal()">Hi</p><script>alert(1)</script><iframe src="https://evil.example"></iframe>' +
    '<meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example/">' +
    '<a href="javascript:alert(1)">x</a><form action="https://evil.example"><input name="p"></form>' +
    '<object data="x"></object><embed src="x">';

  it('removes scripts, frames, forms, redirects, re-basing and handlers', () => {
    const out = neutralise(evil);
    expect(out).not.toMatch(
      /<script|<iframe|<form|<object|<embed|<meta|<base|onclick|javascript:/i,
    );
    expect(out).toContain('<p');
    expect(out).toContain('Hi');
  });

  it('blocks remote pictures through the policy until asked, and allows them after', () => {
    const blocked = buildSrcDoc('<img src="https://t.example/p.gif">', false);
    expect(blocked).toContain("img-src data: 'self';");
    expect(blocked).not.toMatch(/img-src[^;]*https:/);
    expect(blocked).toContain("default-src 'none'");
    expect(buildSrcDoc('<img src="https://t.example/p.gif">', true)).toMatch(
      /img-src data: 'self' https:/,
    );
  });

  it('never allows script in the policy, in either state', () => {
    for (const allow of [false, true]) {
      const doc = buildSrcDoc(evil, allow);
      expect(doc).not.toMatch(/script-src/);
      expect(doc).not.toMatch(/<script/i);
      expect(doc).toContain('name="referrer" content="no-referrer"');
      expect(doc).toContain('<base target="_blank">');
    }
  });

  it('keeps the message text', () => {
    expect(buildSrcDoc('<p>Order #4 shipped</p>', false)).toContain('<p>Order #4 shipped</p>');
  });
});

describe('inline pictures', () => {
  it('points cid: sources at the attachment route and lets the frame load them from its own origin', () => {
    const doc = buildSrcDoc('<img src="cid:abc_-1">', false, '/api/v2/email/attachments/c/m');
    expect(doc).toContain('src="/api/v2/email/attachments/c/m/abc_-1"');
    expect(doc).toContain("img-src data: 'self'");
    expect(doc).not.toContain('https:');
  });
});
