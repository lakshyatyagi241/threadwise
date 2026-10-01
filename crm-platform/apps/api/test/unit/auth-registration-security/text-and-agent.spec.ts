import { describe, expect, it } from 'vitest';
import { ttlToSeconds } from '../../../src/modules/auth/token.service';
import { redact } from '../../../src/modules/auth/security/auth-audit.service';
import {
  isValidTimezone,
  maskEmail,
  maskPhone,
  safeRelativePath,
  slugify,
  suggestWorkspaceName,
} from '../../../src/modules/auth/support/text';
import {
  describeAgent,
  fingerprint,
  parseUserAgent,
} from '../../../src/modules/auth/support/user-agent';
import {
  randomNumericCode,
  safeEqual,
  sha256Hex,
} from '../../../src/modules/auth/support/crypto-utils';

const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const EDGE_WIN = `${CHROME_WIN} Edg/120.0.0.0`;
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';

describe('user agent', () => {
  it('tells Edge from Chrome and Chrome from Safari', () => {
    expect(parseUserAgent(CHROME_WIN).browser).toBe('chrome');
    expect(parseUserAgent(EDGE_WIN).browser).toBe('edge');
    expect(parseUserAgent(SAFARI_IPHONE).browser).toBe('safari');
    expect(parseUserAgent(FIREFOX_LINUX).browser).toBe('firefox');
  });

  it('describes the device for the sessions list', () => {
    expect(describeAgent(CHROME_WIN)).toEqual({ label: 'Chrome on Windows', kind: 'desktop' });
    expect(describeAgent(SAFARI_IPHONE)).toEqual({ label: 'Safari on iPhone', kind: 'mobile' });
    expect(describeAgent(null).kind).toBe('unknown');
  });

  it('fingerprints browser and OS only (version changes are not a new device)', () => {
    expect(fingerprint(CHROME_WIN)).toBe(fingerprint(CHROME_WIN.replace('120', '121')));
    expect(fingerprint(CHROME_WIN)).not.toBe(fingerprint(SAFARI_IPHONE));
  });
});

describe('text helpers', () => {
  it('slugifies names to short ascii slugs with a safe fallback', () => {
    expect(slugify('Acme Corp!')).toBe('acme-corp');
    expect(slugify('  Çafé Délice  ')).toBe('cafe-delice');
    expect(slugify('!!')).toBe('workspace');
    expect(slugify('x'.repeat(80)).length).toBeLessThanOrEqual(32);
  });

  it('masks phone numbers and emails', () => {
    expect(maskPhone('+919876543221')).toBe('+91 •••• ••21');
    expect(maskEmail('priya@acme.test')).toBe('p•••@acme.test');
  });

  it('suggests a workspace name from an email', () => {
    expect(suggestWorkspaceName('priya.sharma@acme.test')).toBe("Priya Sharma's workspace");
    expect(suggestWorkspaceName('1234@acme.test')).toBe("My's workspace");
  });

  it('validates IANA time zones', () => {
    expect(isValidTimezone('Asia/Kolkata')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });

  it('only allows relative, same-site return paths', () => {
    expect(safeRelativePath('/dashboard?x=1')).toBe('/dashboard?x=1');
    for (const bad of [
      '//evil.test',
      '/\\evil.test',
      'https://evil.test',
      'javascript:alert(1)',
      '',
      null,
      undefined,
    ]) {
      expect(safeRelativePath(bad as string | null)).toBeNull();
    }
  });
});

describe('crypto helpers', () => {
  it('compares strings in constant time and tolerates different lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('hashes deterministically', () => {
    expect(sha256Hex('a')).toBe('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
  });

  it('generates zero-padded numeric codes of the requested length', () => {
    for (let i = 0; i < 200; i++) expect(randomNumericCode(6)).toMatch(/^\d{6}$/);
    expect(randomNumericCode(4)).toHaveLength(4);
  });
});

describe('token ttl', () => {
  it('parses env style TTLs to seconds', () => {
    expect(ttlToSeconds('15m')).toBe(900);
    expect(ttlToSeconds('30d')).toBe(2_592_000);
    expect(ttlToSeconds('2h')).toBe(7200);
    expect(ttlToSeconds('90')).toBe(90);
    expect(() => ttlToSeconds('soon')).toThrow();
  });
});

describe('audit redaction', () => {
  it('replaces secret-looking keys at any depth and leaves the rest alone', () => {
    expect(
      redact({
        email: 'a@b.test',
        password: 'x',
        nested: { clientSecret: 'y', token: 'z', keep: 1 },
        list: [{ apiKey: 'k', name: 'n' }],
      }),
    ).toEqual({
      email: 'a@b.test',
      password: '[REDACTED]',
      nested: { clientSecret: '[REDACTED]', token: '[REDACTED]', keep: 1 },
      list: [{ apiKey: '[REDACTED]', name: 'n' }],
    });
  });
});
