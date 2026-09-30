import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../../src/common/crypto/crypto.service';

const KEY = Buffer.alloc(32, 7).toString('base64');

function makeService(key = KEY): CryptoService {
  return new CryptoService({ get: () => key } as unknown as ConfigService<never, true>);
}

describe('CryptoService', () => {
  it('round-trips a secret', () => {
    const crypto = makeService();
    const secret = 'EAAG...meta-access-token';
    expect(crypto.decrypt(crypto.encrypt(secret))).toBe(secret);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const crypto = makeService();
    // Deterministic ciphertext would leak that two channels share a token.
    expect(crypto.encrypt('same')).not.toBe(crypto.encrypt('same'));
  });

  it('refuses a tampered ciphertext instead of returning garbage', () => {
    const crypto = makeService();
    const encoded = crypto.encrypt('sensitive');
    const parts = encoded.split(':');
    const flipped = Buffer.from(parts[3]!, 'base64');
    flipped[0] ^= 0xff;
    parts[3] = flipped.toString('base64');

    expect(() => crypto.decrypt(parts.join(':'))).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => makeService(Buffer.alloc(16).toString('base64'))).toThrow(/must be 32 bytes/);
  });
});
