import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  legacyValue,
  tokenColumns,
  tokenHash,
  tokenOf,
} from '../../../src/common/crypto/secret-columns';

const crypto = new CryptoService({
  get: (n: string) =>
    n === 'CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS' ? '' : randomBytes(32).toString('base64'),
} as unknown as ConfigService<never, true>);

describe('hashed and sealed tokens (encryption audit E2, E3, E8)', () => {
  afterEach(() => {
    delete process.env.SECRETS_LEGACY_PLAINTEXT_MIRROR;
  });

  it('stores a hash for lookup and a sealed copy to show again; the plaintext mirror follows the flag', () => {
    const c = tokenColumns(crypto, 'tok-123');
    expect(c.hash).toBe(tokenHash('tok-123'));
    expect(c.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(crypto.decrypt(c.enc)).toBe('tok-123');
    expect(c.plain).toBe('tok-123'); // default: the previous release still reads the plaintext column
    process.env.SECRETS_LEGACY_PLAINTEXT_MIRROR = 'off';
    expect(tokenColumns(crypto, 'tok-123').plain).toBeNull();
    expect(legacyValue('x')).toBeNull();
  });

  it('reads the sealed copy first and falls back to the legacy column', () => {
    const enc = crypto.encrypt('from-enc');
    expect(tokenOf(crypto, { enc, plain: 'legacy' })).toBe('from-enc');
    expect(tokenOf(crypto, { enc: null, plain: 'legacy' })).toBe('legacy');
    expect(() => tokenOf(crypto, { enc: null, plain: null })).toThrow();
  });
});

describe('every writer of a webhook routing token stores the hash and the sealed copy', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '../../../src/modules', p), 'utf8');
  it.each([
    ['channel-telegram/bots.repository.ts', 'channel-telegram/bots.service.ts'],
    ['channel-line/channels.repository.ts', 'channel-line/channels.service.ts'],
    ['channel-viber/channels.repository.ts', 'channel-viber/channels.service.ts'],
    ['channel-wechat/channels.repository.ts', 'channel-wechat/channels.service.ts'],
  ])('%s', (repo, service) => {
    expect(src(repo)).toMatch(/INSERT INTO [a-z_]+ \([^)]*webhook_token_hash, webhook_token_enc/s);
    expect(src(service)).toContain('webhookToken: tokenColumns(this.crypto, randomToken())');
    expect(src(service)).toContain('tokenOf(this.crypto, { enc: row.webhookTokenEnc');
  });
});

describe('the bearer-link writers store the hash (E8)', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '../../../src/modules', p), 'utf8');
  it('platform orders: the return token is hashed on insert, a manual order has none, and the return route matches the hash', () => {
    expect(src('platform-payment-gateways/orders.repository.ts')).toContain('return_token_hash');
    expect(src('platform-payment-gateways/orders.repository.ts')).toContain(
      'o.return_token_hash = ${tokenHash(token)}',
    );
    expect(src('platform-payment-gateways/admin-billing.repository.ts')).toMatch(
      /created_at, return_token\)/,
    );
  });
  it('storefront orders: the tracking token is hashed and sealed on insert, and read back from the sealed copy', () => {
    const gw = src('storefront-builder/_shims/sql-orders-gateway.ts');
    expect(gw).toContain('tokenColumns(this.crypto, o.recoveryToken)');
    expect(gw).toContain('recovery_token_hash = ${tokenHash(token)}');
    expect(src('storefront-builder/admin/store-orders.service.ts')).toContain(
      'order.recoveryTokenEnc',
    );
  });
});

describe('the store webhook secret is hashed and sealed (E2)', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '../../../src/modules', p), 'utf8');
  it('both services write hash + sealed copy and read the secret back from the sealed copy', () => {
    expect(src('shopify-woocommerce/shopify.service.ts')).toContain(
      'tokenColumns(this.crypto, secret)',
    );
    expect(src('shopify-woocommerce/woocommerce.service.ts')).toContain(
      'tokenColumns(this.crypto, secret)',
    );
    expect(src('shopify-woocommerce/woocommerce.service.ts')).toContain('webhookSecretEnc');
    expect(src('shopify-woocommerce/webhook.service.ts')).toContain('store.webhookSecretEnc');
    expect(src('shopify-woocommerce/stores.repository.ts')).toContain('webhook_secret_hash');
  });
});
