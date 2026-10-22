import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  appendOptOutLine,
  flbCleanVarName,
  wspDisplayName,
  isSafeLink,
  isSafeShortcutUrl,
  leadPayloadSchema,
  normaliseConsentText,
  toLocalPath,
  trimLikePhp,
  trimLikeThreadwise,
} from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { decodeCursor, isCursorTimestamp } from '../../../src/common/pagination/cursor';
import { HtmlSanitizerService } from '../../../src/modules/auth/security/html-sanitizer.service';
import {
  signRazorpayBody,
  verifyRazorpaySignature,
} from '../../../src/infra/providers/storefront-builder/razorpay-payloads';
import { findNul, ZodValidationPipe } from '../../../src/common/pipes/zod-validation.pipe';
import { sanitizeErrorText } from '../../../src/common/errors/sanitize-error';
import {
  htmlToText,
  sanitizeEmailHtml,
} from '../../../src/infra/providers/channel-email/html-sanitize';
import { verifyTwilioSignature } from '../../../src/infra/providers/channel-sms/twilio-signature';
import { verifyOAuthHmac } from '../../../src/modules/shopify-woocommerce/ecom-rules';
import { endpointProblem } from '../../../src/infra/providers/localization-translation/endpoint-guard';
import { mediaUrlProblem } from '../../../src/modules/broadcasts/template-guards';
import { resolveCountry } from '../../../src/modules/wallet-message-billing/phone-country';
import { safeRelativePath } from '../../../src/modules/auth/support/text';
import { storageKeyIsOwnedBy } from '../../../src/common/storage-key-owner';

/**
 * Regression tests for the defects the security fuzz suite found (QA sheet 3, item 38). Each input is the smallest one the shrinker
 * left; see docs/security/fuzz/Sheet3-38-security-fuzz-testing-REPORT.html for the finding behind each.
 */
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

describe('F-01 a schema that throws is a 422, not a 500', () => {
  const pipe = new ZodValidationPipe(z.object({ limit: z.coerce.number().optional() }));
  it('coerce on an object with a non-function toString (what `?limit[toString]=1` parses to)', () => {
    const err = (() => {
      try {
        pipe.transform({ limit: { toString: [] } });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).getStatus()).toBe(422);
  });
  it('a refine that stringifies a body nested 20 000 deep', () => {
    let v: unknown = 1;
    for (let i = 0; i < 20_000; i += 1) v = { k: v };
    expect(() => new ZodValidationPipe(leadPayloadSchema).transform(v)).toThrow(AppError);
  });
});

describe('F-02 a NUL in an object key, or deeper than 32 levels, is refused', () => {
  it('finds it in a key', () => expect(findNul({ 'a\u0000b': 1 })).toBe('a\u0000b'));
  it('finds it 40 levels down', () => {
    let v: unknown = 'x\u0000';
    for (let i = 0; i < 40; i += 1) v = { n: v };
    expect(findNul(v)).toMatch(/^n(\.n)*$/);
  });
  it('does not overflow the stack on a very deep clean value', () => {
    let v: unknown = 'x';
    for (let i = 0; i < 50_000; i += 1) v = [v];
    expect(findNul(v)).toBeNull();
  });
});

describe('F-03 sanitizeErrorText is not quadratic', () => {
  it('32 KB of one character is read in well under a second', () => {
    const t0 = Date.now();
    sanitizeErrorText('a'.repeat(32_000));
    sanitizeErrorText('1'.repeat(32_000));
    expect(Date.now() - t0).toBeLessThan(500);
  });
  it('still redacts a secret in the first line', () => {
    expect(sanitizeErrorText('failed: password=Zq1234567890abcd')).not.toContain(
      'Zq1234567890abcd',
    );
  });
  it('does not throw for a value too deep to print', () => {
    let v: unknown = [];
    for (let i = 0; i < 50_000; i += 1) v = [v];
    expect(typeof sanitizeErrorText(v)).toBe('string');
  });
});

describe('F-04 a pagination cursor Postgres cannot read is a 400, not a 500', () => {
  it.each([
    '12|1',
    '2026|7',
    'Jan 1 2020|1',
    '2020-01-01|1',
    '2026-01-01T00:00:00.000Z|99999999999999999999',
    '2026-01-01T00:00:00.000Z|1e3',
  ])('refuses %s', (raw) => expect(() => decodeCursor(b64(raw))).toThrow(AppError));
  it('still reads the cursor the API writes', () => {
    expect(decodeCursor(b64('2026-01-01T00:00:00.123456Z|42'))).toMatchObject({
      id: 42,
      createdAtIso: '2026-01-01T00:00:00.123456Z',
    });
    expect(decodeCursor(b64('2026-01-01T00:00:00.000Z|42')).id).toBe(42);
  });
});

describe('F-05 a webhook verifier answers no, it does not throw', () => {
  it('Twilio: a field that is an object', () => {
    expect(verifyTwilioSignature('token', 'https://x.test/h', { a: { toString: '' } }, 'sig')).toBe(
      false,
    );
  });
  it('Shopify: hmac as an object, and a lone surrogate in a value', () => {
    expect(verifyOAuthHmac({ hmac: {} as unknown as string }, 'secret')).toBe(false);
    expect(verifyOAuthHmac({ hmac: 'ab', shop: '\ud800' }, 'secret')).toBe(false);
  });
});

describe('F-06 the translation endpoint guard sees the metadata host with a trailing dot', () => {
  it.each(['http://metadata.google.internal./', 'http://169.254.169.254./latest/meta-data/'])(
    'refuses %s',
    (u) => expect(endpointProblem(u)).not.toBeNull(),
  );
  it('still allows the documented localhost default', () =>
    expect(endpointProblem('http://localhost:5000')).toBeNull());
});

describe('F-07 the broadcast media URL check uses the shared address rule', () => {
  it.each([
    'https://[100::]/a.png',
    'https://[::ffff:ac7:0]/a.png',
    'https://[fec0::7:a9fe:0:0]/a.png',
    'https://100.68.192.99/a.png',
    'https://[64:ff9b::f464:1f]/a.png',
  ])('refuses %s', (u) => expect(mediaUrlProblem(u)).not.toBeNull());
  it('accepts a public address and a public name', () => {
    expect(mediaUrlProblem('https://93.184.216.34/a.png')).toBeNull();
    expect(mediaUrlProblem('https://cdn.example.com/a.png')).toBeNull();
  });
});

describe('F-08 a country cell named like an Object property is not a country', () => {
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])('%s', (v) =>
    expect(resolveCountry(v)).toBeNull(),
  );
  it('still resolves an alias', () => expect(resolveCountry('uk')).toBe('GB'));
});

describe('F-09 an email of 20 000 unclosed tags is cut, not sanitised for 20 seconds', () => {
  it('stays fast and flags the cut', () => {
    const t0 = Date.now();
    const out = sanitizeEmailHtml('<div>'.repeat(200_000), {
      blockRemoteImages: true,
      inputMaxChars: 1_000_000,
    });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(out.truncated).toBe(true);
  });
});

describe('F-10 links that a browser sends off the site', () => {
  it.each(['/\\evil.com', '/\\http://127.0.0.1/'])('isSafeLink refuses %s', (v) =>
    expect(isSafeLink(v)).toBe(false),
  );
  it.each(['/\n/evil.com', '/\t/evil.com', '/\n\\evil.com'])('isSafeShortcutUrl refuses %j', (v) =>
    expect(isSafeShortcutUrl(v)).toBe(false),
  );
  it('safeRelativePath refuses a tab or line break between the slashes', () => {
    expect(safeRelativePath('/\t/evil.com')).toBeNull();
    expect(safeRelativePath('/\n/evil.com')).toBeNull();
    expect(safeRelativePath('/inbox?x=1')).toBe('/inbox?x=1');
  });
});

describe('F-11 a storage key with a control character is not owned', () => {
  it('NUL', () => expect(storageKeyIsOwnedBy(20, 'a/20/\u0000')).toBe(false));
  it('a normal key is', () => expect(storageKeyIsOwnedBy(20, 'chat/20/x.png')).toBe(true));
  it('the org is read from the same form of the key that is checked and acted on', () => {
    // One canonical pass gives " /STOIA/19/x" (what the storage layer acts on); a second would have read org 19 from it.
    expect(storageKeyIsOwnedBy(19, '/ /STOIA/19/%2E%2E/8/X')).toBe(false);
  });
});

describe('F-12 the cursor of a module with its own format uses the strict timestamp check', () => {
  it.each(['12', '2026', 'Jan 1 2020'])('isCursorTimestamp refuses %s', (v) =>
    expect(isCursorTimestamp(v)).toBe(false),
  );
  it('accepts what the SQL writes', () =>
    expect(isCursorTimestamp('2026-01-01T00:00:00.123456Z')).toBe(true));
});

describe('F-13 the Razorpay verifier compares bytes, not characters', () => {
  it('a 64-character header of multi-byte characters is refused, not a RangeError', () => {
    expect(verifyRazorpaySignature('{}', '１'.repeat(64), 'secret')).toBe(false);
  });
  it('the genuine signature still verifies', () => {
    expect(verifyRazorpaySignature('{}', signRazorpayBody('{}', 'secret'), 'secret')).toBe(true);
  });
});

describe('F-14 toLocalPath does not return a path a browser reads as another host', () => {
  it.each(['/\n//m/com', '/\t\\\\server\\share\\x', '/\n\n/bin/sh'])('%j', (v) => {
    const p = toLocalPath(v);
    expect(
      p === null || new URL(p, 'https://app.example.com').origin === 'https://app.example.com',
    ).toBe(true);
  });
});

describe('F-15 trimming the edges of a long run of spaces is linear, not quadratic', () => {
  const spaces = ' '.repeat(300_000);
  it('trimLikeThreadwise (product text fields)', () => {
    const t0 = Date.now();
    expect(trimLikeThreadwise(`${spaces}x`)).toBe('x');
    expect(trimLikeThreadwise(`x${spaces}`)).toBe('x');
    expect(trimLikeThreadwise(`${spaces}x${spaces}y${spaces}`)).toBe(`x${spaces}y`);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it('flbCleanVarName, appendOptOutLine and wspDisplayName (the same regex shape)', () => {
    const t0 = Date.now();
    expect(flbCleanVarName(`{{${spaces}x`)).toBe('x');
    expect(flbCleanVarName(`x${spaces}}}y`)).toBe(`x${spaces}}}y`);
    expect(flbCleanVarName(' {{ name }} ')).toBe('name');
    expect(flbCleanVarName('@name')).toBe('name');
    expect(appendOptOutLine(`hi${spaces}x`, 'STOP').endsWith('\n\nSTOP')).toBe(true);
    expect(wspDisplayName(50).parse('​  Ana ﻿')).toBe('Ana');
    expect(wspDisplayName(400_000).parse(`${spaces}x`)).toBe('x');
    expect(Date.now() - t0).toBeLessThan(1500);
  });
  it('trimLikePhp (the tags box)', () => {
    const t0 = Date.now();
    expect(trimLikePhp(`${'\t'.repeat(300_000)}x`)).toBe('x');
    expect(trimLikePhp(` \t\0\x0Bvip, \n`)).toBe('vip,');
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it('normaliseConsentText (the text of an inbound message)', () => {
    const t0 = Date.now();
    expect(normaliseConsentText(`${spaces}STOP${'-'.repeat(300_000)}`)).toBe('stop');
    expect(normaliseConsentText(`${spaces}x`)).toBe('x');
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it('still trims what the regex trimmed, astral format characters included', () => {
    expect(trimLikeThreadwise('​  Tee‍  ')).toBe('Tee');
    expect(trimLikeThreadwise('\u{E0001}x\u{E0001}')).toBe('x');
    expect(trimLikeThreadwise('\u{1F600}x')).toBe('\u{1F600}x');
    expect(normaliseConsentText('  Stop!!  ')).toBe('stop');
  });
});

describe('F-17 htmlToText is linear on a long run of tabs', () => {
  it('300 000 tabs then text', () => {
    const t0 = Date.now();
    expect(htmlToText(`${'\t'.repeat(300_000)}x`)).toBe('x');
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it('still drops the blanks at the end of a line and collapses blank lines', () => {
    expect(htmlToText('<p>a \t </p><p>b</p><br><br><br><br>c')).toBe('a\nb\n\nc');
  });
});

describe('F-09b the rich-text sanitiser is cut at the same tag limit', () => {
  it('200 KB of < stays fast', () => {
    const t0 = Date.now();
    new HtmlSanitizerService().sanitize('<p>' + '<'.repeat(200_000));
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
