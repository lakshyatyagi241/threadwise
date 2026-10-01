import { describe, expect, it } from 'vitest';
import { UploadPolicyService } from '../../../src/modules/auth/security/upload-policy.service';
import { HtmlSanitizerService } from '../../../src/modules/auth/security/html-sanitizer.service';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);
const upload = new UploadPolicyService();
const check = (
  filename: string,
  buffer: Buffer,
  allow: Array<'image' | 'media' | 'document'> = ['image'],
) => upload.validate({ filename, buffer, allow, maxBytes: 1024 * 1024 });

describe('upload policy', () => {
  it('accepts an image whose bytes match its extension and stores it under a random name', () => {
    const r = check('Photo.PNG', PNG);
    expect(r.mime).toBe('image/png');
    expect(r.storedName).toMatch(/^\d+_[0-9a-f]{24}\.png$/);
    expect(r.storedName).not.toContain('Photo');
  });

  it.each(['evil.php', 'page.html', 'logo.svg', 'run.sh', 'x.exe', 'noextension'])(
    'refuses %s',
    (name) => {
      expect(() => check(name, PNG)).toThrow();
    },
  );

  it('refuses content that does not match the extension', () => {
    expect(() => check('logo.png', Buffer.from('<html><script>alert(1)</script></html>'))).toThrow(
      /content/,
    );
  });

  it('refuses markup disguised as text', () => {
    expect(() =>
      check('notes.txt', Buffer.from('<script>alert(1)</script>'), ['document']),
    ).toThrow();
    expect(check('notes.txt', Buffer.from('plain words'), ['document']).mime).toBe('text/plain');
  });

  it('respects the kinds an endpoint allows and the size cap', () => {
    expect(() => check('report.pdf', Buffer.from('%PDF-1.7 ...'))).toThrow();
    expect(check('report.pdf', Buffer.from('%PDF-1.7 ...'), ['document']).mime).toBe(
      'application/pdf',
    );
    expect(() =>
      upload.validate({
        filename: 'a.png',
        buffer: Buffer.concat([PNG, Buffer.alloc(2_000_000)]),
        allow: ['image'],
        maxBytes: 1_000_000,
      }),
    ).toThrow(/too large/);
    expect(() => check('a.png', Buffer.alloc(0))).toThrow();
  });
});

describe('html sanitiser', () => {
  const s = new HtmlSanitizerService();

  it('removes scripts and event handlers', () => {
    expect(s.sanitize('<p onclick="x()">Hi</p><script>alert(1)</script>')).toBe('<p>Hi</p>');
  });

  it('drops dangerous URL schemes but keeps safe links', () => {
    expect(s.sanitize('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(s.sanitize('<a href="https://example.test/a">x</a>')).toBe(
      '<a href="https://example.test/a">x</a>',
    );
    expect(s.sanitize('<img src="data:image/png;base64,AAAA">')).toBe('');
  });

  it('removes elements that are not on the allow-list', () => {
    expect(
      s.sanitize(
        '<iframe src="https://x.test"></iframe><object></object><svg onload="x()"></svg><p>ok</p>',
      ),
    ).toBe('<p>ok</p>');
    expect(s.sanitize('<p style="color:red">x</p>')).toBe('<p>x</p>');
  });

  it('hardens links that open a new tab', () => {
    expect(s.sanitize('<a href="https://e.test" target="_blank">x</a>')).toContain(
      'rel="noopener noreferrer nofollow"',
    );
  });

  it('returns an empty string for empty input', () => {
    expect(s.sanitize('')).toBe('');
    expect(s.sanitize(null)).toBe('');
  });
});
