import { randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { looksSealed } from '../../../src/modules/platform-infrastructure/crypto-rotation/envelope';

/**
 * Encryption audit E4: a sealed value can be bound to the row it belongs to (associated data), so a blob copied to another row or
 * column no longer opens. The new format is only WRITTEN when CREDENTIALS_AAD_WRITE=on (default off), because a release that predates
 * it cannot parse it; every release from this one on reads both.
 */
const key = randomBytes(32).toString('base64');
const make = (k = key, previous = '', flag?: string) =>
  new CryptoService({
    get: (n: string) =>
      n === 'CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS'
        ? previous
        : n === 'CREDENTIALS_AAD_WRITE'
          ? flag
          : k,
  } as unknown as ConfigService<never, true>);
const ctxA = 'push_subscriptions.auth:1:7';
const ctxB = 'push_subscriptions.auth:2:7';

describe('bound blobs (E4)', () => {
  it('writes the old v1 format unless the flag is on, so a release that predates v2 can still read it', () => {
    const c = make();
    const blob = c.encrypt('secret', ctxA);
    expect(blob.startsWith('v1:')).toBe(true);
    expect(c.decrypt(blob, ctxA)).toBe('secret');
    expect(c.decrypt(blob)).toBe('secret'); // v1 has no binding, and the context is ignored
    expect(c.isBound(blob)).toBe(false);
  });

  it('with the flag on, binds the value to its context: it opens there and nowhere else', () => {
    const c = make(key, '', 'on');
    const blob = c.encrypt('secret', ctxA);
    expect(blob.startsWith('v2:')).toBe(true);
    expect(c.isBound(blob)).toBe(true);
    expect(c.decrypt(blob, ctxA)).toBe('secret');
    expect(() => c.decrypt(blob, ctxB)).toThrow(/different context/);
    expect(() => c.decrypt(blob)).toThrow(/context/);
    expect(blob).not.toContain('secret');
  });

  it('a value written without a context stays v1 even with the flag on', () => {
    const c = make(key, '', 'on');
    expect(c.encrypt('secret').startsWith('v1:')).toBe(true);
  });

  it('rewriting the context segment of a bound blob does not make it open elsewhere', () => {
    const c = make(key, '', 'on');
    const [v, iv, tag, data, kid] = c.encrypt('secret', ctxA).split(':');
    const forged = [v, iv, tag, data, kid, c.encrypt('x', ctxB).split(':')[5]].join(':');
    expect(() => c.decrypt(forged, ctxB)).toThrow();
  });

  it('a bound blob survives key rotation without anyone knowing its context', () => {
    const old = make(key, '', 'on');
    const blob = old.encrypt('secret', ctxA);
    const newKey = randomBytes(32).toString('base64');
    const rotated = make(newKey, key, 'on');
    expect(rotated.isCurrent(blob)).toBe(false);
    const moved = rotated.reencrypt(blob);
    expect(rotated.isCurrent(moved)).toBe(true);
    expect(moved.startsWith('v2:')).toBe(true);
    expect(rotated.decrypt(moved, ctxA)).toBe('secret');
    expect(() => rotated.decrypt(moved, ctxB)).toThrow();
  });

  it('the key-rotation scan recognises bound blobs, so they cannot be missed', () => {
    const blob = make(key, '', 'on').encrypt('secret', ctxA);
    expect(looksSealed(blob)).toBe(true);
    expect(looksSealed(make().encrypt('secret'))).toBe(true);
    expect(looksSealed('v2:beta')).toBe(false);
  });

  it('empty values and tampering behave as for v1', () => {
    const c = make(key, '', 'on');
    expect(c.decrypt(c.encrypt('', ctxA), ctxA)).toBe('');
    const [v, iv, tag, data, kid, ctx] = c.encrypt('secret', ctxA).split(':');
    const flipped = Buffer.from(data!, 'base64');
    flipped[0] = flipped[0]! ^ 1;
    expect(() =>
      c.decrypt([v, iv, tag, flipped.toString('base64'), kid, ctx].join(':'), ctxA),
    ).toThrow();
  });
});
