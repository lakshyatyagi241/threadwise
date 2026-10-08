import { describe, expect, it } from 'vitest';
import { HtmlSanitizerService } from '../../../src/modules/auth/security/html-sanitizer.service';
import { UploadPolicyService } from '../../../src/modules/auth/security/upload-policy.service';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);
const upload = new UploadPolicyService();
const media = (name: string, buf: Buffer) =>
  upload.validate({ filename: name, buffer: buf, allow: ['media'], maxBytes: 1_000_000 });

function rejection(fn: () => unknown) {
  try {
    fn();
  } catch (err) {
    return err as {
      code: string;
      getStatus(): number;
      details: Array<{ path: string; message: string }>;
      message: string;
    };
  }
  throw new Error('expected a rejection');
}

describe('upload edge cases (TW-AUTH-043)', () => {
  it.each(['noextension', 'photo.', 'a.png.', '.png.', '   ', 'archive.tar.'])(
    'answers "%s" with the same "type not allowed" message as any other forbidden type',
    (name) => {
      const err = rejection(() =>
        upload.validate({ filename: name, buffer: PNG, allow: ['image'], maxBytes: 1024 }),
      );
      expect(err.code).toBe('AUTH_UPLOAD_REJECTED');
      expect(err.message).toBe('This file type is not allowed.');
      expect(err.details).toEqual([{ path: 'file', message: 'type_not_allowed' }]);
    },
  );

  it('tags each refusal with a stable reason, and the limit for an oversize file', () => {
    const big = rejection(() =>
      upload.validate({
        filename: 'a.png',
        buffer: Buffer.concat([PNG, Buffer.alloc(2048)]),
        allow: ['image'],
        maxBytes: 1024,
      }),
    );
    expect(big.details).toEqual([
      { path: 'file', message: 'too_large' },
      { path: 'limitBytes', message: '1024' },
    ]);
    expect(
      rejection(() =>
        upload.validate({
          filename: 'a.png',
          buffer: Buffer.alloc(0),
          allow: ['image'],
          maxBytes: 9,
        }),
      ).details[0]!.message,
    ).toBe('empty');
    expect(
      rejection(() =>
        upload.validate({
          filename: 'a.png',
          buffer: Buffer.from('<html>'),
          allow: ['image'],
          maxBytes: 99,
        }),
      ).details[0]!.message,
    ).toBe('content_not_allowed');
  });

  it('treats a trailing space or a double extension by the LAST extension, and still checks the bytes', () => {
    expect(() =>
      upload.validate({ filename: 'shell.php ', buffer: PNG, allow: ['image'], maxBytes: 1024 }),
    ).toThrow(/type is not allowed/);
    expect(
      upload.validate({ filename: 'evil.php.png', buffer: PNG, allow: ['image'], maxBytes: 1024 })
        .ext,
    ).toBe('png');
    expect(() =>
      upload.validate({ filename: 'evil.png.php', buffer: PNG, allow: ['image'], maxBytes: 1024 }),
    ).toThrow(/type is not allowed/);
  });

  const atom = (name: string) =>
    Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from(name, 'ascii'), Buffer.alloc(32)]);

  it.each(['ftyp', 'moov', 'wide', 'mdat', 'free', 'skip', 'pnot'])(
    'accepts a .mov that starts with the %s atom',
    (first) => {
      expect(media('clip.mov', atom(first)).mime).toBe('video/quicktime');
    },
  );

  it('still refuses a .mov that starts with something else, and an mp4 without ftyp', () => {
    expect(() => media('clip.mov', atom('junk'))).toThrow(/content/);
    expect(() => media('clip.mp4', atom('moov'))).toThrow(/content/);
    expect(media('clip.mp4', atom('ftyp')).mime).toBe('video/mp4');
  });
});

describe('html sanitiser (TW-AUTH-044)', () => {
  const s = new HtmlSanitizerService();

  it.each([
    ['<iframe src="https://x.test">fallback words</iframe>after', 'after'],
    ['<svg><text>svg words</text></svg>after', 'after'],
    ['<form action="/x"><label>name</label><input name="a">go</form>after', 'after'],
    ['<object data="x">object words</object><embed src="x">after', 'after'],
    ['<video><source src="x">video words</video><audio>audio words</audio>after', 'after'],
    ['<noscript><img src="x" onerror="1">no script words</noscript>after', 'after'],
    ['<template><p>template words</p></template>after', 'after'],
    ['<math><mtext>math words</mtext></math>after', 'after'],
    ['<applet>applet words</applet>after', 'after'],
    ['<style>p{color:red}</style><script>alert(1)</script>after', 'after'],
  ])('removes a blocked element together with its text: %s', (input, expected) => {
    expect(s.sanitize(input)).toBe(expected);
  });

  it('keeps the inner text of an ordinary unknown wrapper', () => {
    expect(s.sanitize('<font color="red">kept</font> and <blink>this</blink>')).toBe(
      'kept and this',
    );
  });

  it('allows the wider set of content tags storefront bodies carry', () => {
    const html =
      '<figure><figcaption>cap</figcaption></figure><small>s</small><del>d</del><ins>i</ins><mark>m</mark>' +
      '<dl><dt>t</dt><dd>d</dd></dl><section><article>a</article></section>' +
      '<table><caption>c</caption><tbody><tr><td>x</td></tr></tbody><tfoot><tr><td>f</td></tr></tfoot></table>';
    expect(s.sanitize(html)).toBe(html);
  });

  it('keeps dir and lang (right-to-left text needs them) but still drops class, id, style and handlers', () => {
    expect(
      s.sanitize('<p dir="rtl" lang="ar" class="c" id="i" style="x:y" onclick="z()">مرحبا</p>'),
    ).toBe('<p dir="rtl" lang="ar">مرحبا</p>');
  });
});
