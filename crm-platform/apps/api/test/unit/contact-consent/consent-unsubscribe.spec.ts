import { describe, expect, it } from 'vitest';
import {
  deriveUnsubscribeKeys,
  listUnsubscribeHeaders,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from '../../../src/modules/contact-consent/consent-unsubscribe.tokens';

const k1 = Buffer.alloc(32, 1).toString('base64');
const k2 = Buffer.alloc(32, 2).toString('base64');

describe('email unsubscribe token', () => {
  const keys = deriveUnsubscribeKeys([k1]);

  it('round-trips and carries only two numbers (no PII)', () => {
    const token = signUnsubscribeToken(keys, 12, 3456);
    expect(verifyUnsubscribeToken(keys, token)).toEqual({ orgId: 12, contactId: 3456 });
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token.split('.')[0]!, 'base64url').toString()).toBe('1.12.3456');
  });

  it('rejects an altered payload, an altered signature, garbage and another key', () => {
    const token = signUnsubscribeToken(keys, 12, 3456);
    const [p, s] = token.split('.');
    const forged = `${Buffer.from('1.12.9999').toString('base64url')}.${s}`;
    expect(verifyUnsubscribeToken(keys, forged)).toBeNull();
    expect(verifyUnsubscribeToken(keys, `${p}.${s!.slice(0, -2)}AA`)).toBeNull();
    expect(verifyUnsubscribeToken(keys, 'nonsense')).toBeNull();
    expect(verifyUnsubscribeToken(keys, `${p}.${s}.x`)).toBeNull();
    expect(verifyUnsubscribeToken(deriveUnsubscribeKeys([k2]), token)).toBeNull();
  });

  it('survives key rotation: the old key still verifies, the new one signs', () => {
    const old = signUnsubscribeToken(keys, 1, 2);
    const rotated = deriveUnsubscribeKeys([k2, k1]);
    expect(verifyUnsubscribeToken(rotated, old)).toEqual({ orgId: 1, contactId: 2 });
    expect(verifyUnsubscribeToken(keys, signUnsubscribeToken(rotated, 1, 2))).toBeNull();
  });

  it('writes the RFC 8058 headers', () => {
    expect(listUnsubscribeHeaders('https://x.test/u')).toEqual({
      'List-Unsubscribe': '<https://x.test/u>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });
});
