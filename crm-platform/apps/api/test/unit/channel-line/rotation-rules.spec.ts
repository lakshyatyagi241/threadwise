import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MAX_TOKEN_SECONDS,
  buildAssertionJwt,
  rotatedTokenIsFresh,
  rotationConfigured,
} from '../../../src/modules/channel-line/rotation-rules';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const decode = (part: string) =>
  JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));

describe('buildAssertionJwt', () => {
  it('signs an RS256 assertion that names the channel, the key and the token life', () => {
    const jwt = buildAssertionJwt({
      channelId: '1234567890',
      kid: 'key-1',
      privateKeyPem: privateKey,
      tokenSeconds: 3600,
      nowSeconds: 1_700_000_000,
    });
    const [h, c, s] = jwt.split('.');
    expect(decode(h!)).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'key-1' });
    expect(decode(c!)).toEqual({
      iss: '1234567890',
      sub: '1234567890',
      aud: 'https://api.line.me/',
      exp: 1_700_000_000 + 1800,
      token_exp: 3600,
    });
    const verifier = createVerify('RSA-SHA256').update(`${h}.${c}`);
    const signature = Buffer.from(s!.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    expect(verifier.verify(createPublicKey(publicKey), signature)).toBe(true);
  });

  it('keeps the token life between a minute and thirty days', () => {
    const life = (tokenSeconds?: number) =>
      decode(
        buildAssertionJwt({
          channelId: '1',
          kid: 'k',
          privateKeyPem: privateKey,
          ...(tokenSeconds === undefined ? {} : { tokenSeconds }),
        }).split('.')[1]!,
      ).token_exp;
    expect(life()).toBe(MAX_TOKEN_SECONDS);
    expect(life(5)).toBe(60);
    expect(life(99_999_999)).toBe(MAX_TOKEN_SECONDS);
  });

  it('answers nothing when the key cannot sign', () => {
    expect(buildAssertionJwt({ channelId: '1', kid: 'k', privateKeyPem: 'not a key' })).toBe('');
  });
});

describe('rotatedTokenIsFresh', () => {
  const now = new Date('2026-10-14T10:00:00Z');
  const in_ = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

  it('is fresh only while more than a day is left', () => {
    expect(rotatedTokenIsFresh('t', in_(48), now)).toBe(true);
    expect(rotatedTokenIsFresh('t', in_(23), now)).toBe(false);
    expect(rotatedTokenIsFresh('t', in_(-1), now)).toBe(false);
  });

  it('needs a token and an expiry', () => {
    expect(rotatedTokenIsFresh(null, in_(48), now)).toBe(false);
    expect(rotatedTokenIsFresh('t', null, now)).toBe(false);
  });
});

describe('rotationConfigured', () => {
  it('needs both the key id and the key', () => {
    expect(rotationConfigured('kid', 'pem')).toBe(true);
    expect(rotationConfigured('kid', ' ')).toBe(false);
    expect(rotationConfigured(null, 'pem')).toBe(false);
  });
});
