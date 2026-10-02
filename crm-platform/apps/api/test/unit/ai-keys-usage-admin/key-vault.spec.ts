import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { KeyVault } from '../../../src/modules/ai-keys-usage-admin/key-vault';

const crypto = (fill: number) =>
  new CryptoService({
    get: () => Buffer.alloc(32, fill).toString('base64'),
  } as unknown as ConfigService<never, true>);

describe('provider keys at rest (TW-AIADM-006)', () => {
  it('stores no plaintext and reads the key back', () => {
    const vault = new KeyVault(crypto(7));
    const { cipher, last4 } = vault.seal('sk-live-0123456789abcd');
    expect(cipher).not.toContain('sk-live');
    expect(last4).toBe('abcd');
    expect(vault.read(cipher, 'openai')).toEqual({
      state: 'readable',
      key: 'sk-live-0123456789abcd',
    });
  });

  it('treats null and an empty string as no key (the empty string a migration may leave)', () => {
    const vault = new KeyVault(crypto(7));
    expect(vault.read(null, 'x')).toEqual({ state: 'none' });
    expect(vault.read('', 'x')).toEqual({ state: 'none' });
  });

  it('reads a value sealed under another encryption key as unreadable, without throwing', () => {
    const cipher = new KeyVault(crypto(7)).seal('sk-live-0123456789abcd').cipher;
    expect(new KeyVault(crypto(9)).read(cipher, 'openai')).toEqual({ state: 'unreadable' });
    expect(new KeyVault(crypto(7)).read('not-a-ciphertext', 'openai')).toEqual({
      state: 'unreadable',
    });
  });
});
