import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  collectSealed,
  looksSealed,
  mapSealed,
} from '../../../src/modules/platform-infrastructure';

const key = (fill: number) => Buffer.alloc(32, fill).toString('base64');
const crypto = (current: number, previous?: number) =>
  new CryptoService({
    get: (k: string) =>
      k === 'CREDENTIALS_ENCRYPTION_KEY'
        ? key(current)
        : k === 'CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS' && previous
          ? key(previous)
          : undefined,
  } as unknown as ConfigService<never, true>);

describe('looksSealed', () => {
  it('recognises what CryptoService writes, with and without the key id', () => {
    const blob = crypto(1).encrypt('hello');
    expect(looksSealed(blob)).toBe(true);
    const legacy = blob.split(':').slice(0, 4).join(':'); // written before key ids existed
    expect(looksSealed(legacy)).toBe(true);
  });

  it('recognises an empty secret too (empty ciphertext segment)', () => {
    expect(looksSealed(crypto(1).encrypt(''))).toBe(true);
  });

  it.each([
    'v1:beta',
    'v1:a:b',
    'hello world',
    '',
    'v2:aaaa:bbbb:cccc',
    'v1:aaaa:bbbb:cccc:ZZZZZZZZ',
    ' v1:aaaa:bbbb:cccc',
    'v1:aaaa:bbbb:cccc ',
    'prefix v1:aaaa:bbbb:cccc',
  ])('does not take %j for one', (text) => {
    expect(looksSealed(text)).toBe(false);
  });

  it.each([null, undefined, 42, {}, []])('does not take %j for one', (v) => {
    expect(looksSealed(v)).toBe(false);
  });
});

describe('mapSealed / collectSealed', () => {
  const a = crypto(1).encrypt('a');
  const b = crypto(1).encrypt('b');

  it('finds blobs at any depth, in arrays and objects, and nowhere else', () => {
    const doc = { token: a, nested: { list: ['x', b, { deep: a }] }, n: 1, s: 'v1:beta', k: null };
    expect(collectSealed(doc).sort()).toEqual([a, a, b].sort());
  });

  it('replaces only the blobs and returns a new value', () => {
    const doc = { token: a, keep: 'plain', list: [b, 3, true] };
    const out = mapSealed(doc, () => 'NEW') as typeof doc;
    expect(out).toEqual({ token: 'NEW', keep: 'plain', list: ['NEW', 3, true] });
    expect(doc.token).toBe(a); // input untouched
  });

  it('leaves object keys alone even when a key looks like a blob', () => {
    expect(mapSealed({ [a]: 1 }, () => 'NEW')).toEqual({ [a]: 1 });
  });

  it('handles a bare string, null and an empty document', () => {
    expect(mapSealed(a, () => 'NEW')).toBe('NEW');
    expect(mapSealed(null, () => 'NEW')).toBeNull();
    expect(mapSealed({}, () => 'NEW')).toEqual({});
    expect(collectSealed([])).toEqual([]);
  });
});
