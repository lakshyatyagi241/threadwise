import { describe, expect, it } from 'vitest';
import {
  generateRawKey,
  hashRawKey,
  keyPrefixOf,
  looksLikeRawKey,
  randomKeyBody,
  rawKeyMatches,
} from '../../../src/modules/developer-rest-api-v1/keys/api-key-secret';

describe('api key secret (WD-API-001, 005)', () => {
  it('makes wsk_ plus 40 alphanumeric characters, as WaDesk does', () => {
    const key = generateRawKey();
    expect(key).toMatch(/^wsk_[A-Za-z0-9]{40}$/);
    expect(looksLikeRawKey(key)).toBe(true);
  });

  it('never repeats and uses every part of the alphabet', () => {
    const seen = new Set<string>();
    const chars = new Set<string>();
    for (let i = 0; i < 400; i += 1) {
      const body = randomKeyBody();
      seen.add(body);
      for (const c of body) chars.add(c);
    }
    expect(seen.size).toBe(400);
    expect(chars.size).toBeGreaterThan(55);
  });

  it('takes the first 12 characters as the prefix', () => {
    const key = generateRawKey();
    expect(keyPrefixOf(key)).toBe(key.slice(0, 12));
    expect(keyPrefixOf(key)).toHaveLength(12);
  });

  it('matches only the key it was made from, in constant time form', () => {
    const key = generateRawKey();
    const stored = hashRawKey(key);
    expect(stored).toMatch(/^sha256\$[0-9a-f]{64}$/);
    expect(rawKeyMatches(key, stored)).toBe(true);
    expect(rawKeyMatches(generateRawKey(), stored)).toBe(false);
    expect(rawKeyMatches(key + 'x', stored)).toBe(false);
  });

  it('never matches a stored value that is not a sha256 hash (a partner key keeps an argon2 hash)', () => {
    const key = generateRawKey();
    expect(rawKeyMatches(key, '$argon2id$v=19$m=19456,t=2,p=1$abc$def')).toBe(false);
    expect(rawKeyMatches(key, '')).toBe(false);
  });

  it('refuses a token that cannot be one of ours before any lookup', () => {
    for (const bad of [
      '',
      'wsk_',
      'wsk_short',
      'sk_' + 'a'.repeat(41),
      'wsk_' + 'a'.repeat(39),
      'wsk_' + 'a'.repeat(41),
      'wsk_' + '!'.repeat(40),
    ]) {
      expect(looksLikeRawKey(bad), bad).toBe(false);
    }
  });
});
