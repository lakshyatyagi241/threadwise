import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCOPES,
  SHOPIFY_WEBHOOK_TOPICS,
  STATE_TTL_MS,
  WOO_WEBHOOK_TOPICS,
  authorizeUrl,
  isValidShop,
  isValidWooUrl,
  newWebhookSecret,
  normalizeShop,
  normalizeWooUrl,
  phpUrlencode,
  readState,
  verifyOAuthHmac,
  webhookIdsOf,
  webhookUrl,
} from '../../../src/modules/shopify-woocommerce/ecom-rules';

describe('the Shopify store domain (TW-ECOM-005)', () => {
  it('a bare handle gets the Shopify domain, and a pasted address is cut to its host', () => {
    expect(normalizeShop('my-store')).toBe('my-store.myshopify.com');
    expect(normalizeShop('  My-Store  ')).toBe('my-store.myshopify.com');
    expect(normalizeShop('HTTPS://My-Store.myshopify.com/admin/products')).toBe(
      'my-store.myshopify.com',
    );
    expect(normalizeShop('http://my-store.myshopify.com/')).toBe('my-store.myshopify.com');
    expect(normalizeShop('')).toBe('');
  });

  it('only <handle>.myshopify.com is a store', () => {
    expect(isValidShop('my-store')).toBe(true);
    expect(isValidShop('my-store.myshopify.com')).toBe(true);
    expect(isValidShop('a1.myshopify.com')).toBe(true);
    expect(isValidShop('-bad.myshopify.com')).toBe(false);
    expect(isValidShop('shop.example.com')).toBe(false);
    expect(isValidShop('evil.com/.myshopify.com')).toBe(false);
    expect(isValidShop('my_store.myshopify.com')).toBe(false);
    expect(isValidShop('')).toBe(false);
    expect(isValidShop('127.0.0.1')).toBe(false);
    expect(isValidShop('shop.myshopify.com.evil.com')).toBe(false);
  });
});

describe('the OAuth round trip (TW-ECOM-005, 006)', () => {
  it('encodes like PHP urlencode: a space is +, the tilde and the other marks are escaped', () => {
    expect(phpUrlencode('a b')).toBe('a+b');
    expect(phpUrlencode('x=y&z')).toBe('x%3Dy%26z');
    expect(phpUrlencode("it's (1)*~")).toBe('it%27s+%281%29%2A%7E');
    expect(phpUrlencode('a-b_c.d')).toBe('a-b_c.d');
  });

  const secret = 'shpss_secret';
  const sign = (msg: string) => createHmac('sha256', secret).update(msg).digest('hex');
  const query = {
    code: 'abc123',
    host: 'YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvdGVzdA==',
    shop: 'my-store.myshopify.com',
    state: 'st-1',
    timestamp: '1700000000',
  };
  const message =
    'code=abc123&host=YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvdGVzdA%3D%3D&shop=my-store.myshopify.com&state=st-1&timestamp=1700000000';

  it('accepts the signature over the sorted parameters, ignoring the signature fields themselves', () => {
    expect(verifyOAuthHmac({ ...query, hmac: sign(message) }, secret)).toBe(true);
    expect(verifyOAuthHmac({ ...query, signature: 'old', hmac: sign(message) }, secret)).toBe(true);
    // The order the parameters arrive in does not matter.
    const shuffled = {
      timestamp: query.timestamp,
      state: query.state,
      shop: query.shop,
      host: query.host,
      code: query.code,
    };
    expect(verifyOAuthHmac({ ...shuffled, hmac: sign(message) }, secret)).toBe(true);
  });

  it('refuses a wrong, missing or altered signature, a changed parameter and an empty secret', () => {
    const good = sign(message);
    expect(verifyOAuthHmac({ ...query, hmac: 'f'.repeat(64) }, secret)).toBe(false);
    expect(verifyOAuthHmac({ ...query, hmac: good.slice(0, 63) }, secret)).toBe(false);
    expect(verifyOAuthHmac(query, secret)).toBe(false);
    expect(verifyOAuthHmac({ ...query, shop: 'other.myshopify.com', hmac: good }, secret)).toBe(
      false,
    );
    expect(verifyOAuthHmac({ ...query, hmac: good }, 'wrong')).toBe(false);
    expect(verifyOAuthHmac({ ...query, hmac: good }, '')).toBe(false);
  });

  it('the approval address is on the store’s own host with the app, scopes, redirect and state', () => {
    const u = new URL(
      authorizeUrl({
        shop: 'my-store.myshopify.com',
        clientId: 'cid',
        scopes: DEFAULT_SCOPES,
        redirectUri: 'https://app.example.com/v2/shopify/oauth/callback',
        state: 'sealed state',
      }),
    );
    expect(u.origin).toBe('https://my-store.myshopify.com');
    expect(u.pathname).toBe('/admin/oauth/authorize');
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('scope')).toBe(DEFAULT_SCOPES);
    expect(u.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/v2/shopify/oauth/callback',
    );
    expect(u.searchParams.get('state')).toBe('sealed state');
  });

  const NOW = 1_800_000_000_000;
  const state = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      orgId: 7,
      userId: 3,
      shop: 'my-store.myshopify.com',
      at: NOW - 1000,
      nonce: 'n',
      ...over,
    });

  it('a state is good when it parses, is fresh and is not from the future', () => {
    expect(readState(state(), NOW)).toEqual({
      orgId: 7,
      userId: 3,
      shop: 'my-store.myshopify.com',
      at: NOW - 1000,
      nonce: 'n',
    });
    expect(readState(state({ userId: null }), NOW)?.userId).toBeNull();
    expect(readState(state({ at: NOW - STATE_TTL_MS - 1 }), NOW)).toBeNull();
    expect(readState(state({ at: NOW + 120_000 }), NOW)).toBeNull();
    expect(readState(state({ shop: undefined }), NOW)).toBeNull();
    expect(readState(state({ orgId: '7' }), NOW)).toBeNull();
    expect(readState(state({ userId: 'x' }), NOW)).toBeNull();
    expect(readState('not json', NOW)).toBeNull();
    expect(readState('null', NOW)).toBeNull();
  });
});

describe('the WooCommerce store address (TW-ECOM-025)', () => {
  it('becomes an origin, with https when no scheme was typed', () => {
    expect(normalizeWooUrl('example.com')).toBe('https://example.com');
    expect(normalizeWooUrl('https://example.com/wp-json')).toBe('https://example.com');
    expect(normalizeWooUrl('HTTP://Example.com:8080/x?y=1')).toBe('http://example.com:8080');
    expect(normalizeWooUrl('  shop.example.com/store  ')).toBe('https://shop.example.com');
  });

  it('is empty, and so not valid, when there is no host', () => {
    expect(normalizeWooUrl('')).toBe('');
    expect(normalizeWooUrl('https://')).toBe('');
    expect(normalizeWooUrl('http://:80')).toBe('');
    expect(isValidWooUrl('example.com')).toBe(true);
    expect(isValidWooUrl('')).toBe(false);
  });
});

describe('webhooks (TW-ECOM-007, 026)', () => {
  it('registers the Shopify and WooCommerce topics Reference does', () => {
    expect(SHOPIFY_WEBHOOK_TOPICS).toHaveLength(12);
    expect(SHOPIFY_WEBHOOK_TOPICS).toContain('app/uninstalled');
    expect(SHOPIFY_WEBHOOK_TOPICS).toContain('checkouts/create');
    expect(WOO_WEBHOOK_TOPICS).toEqual([
      'order.created',
      'order.updated',
      'order.deleted',
      'customer.created',
      'customer.updated',
      'product.created',
      'product.updated',
    ]);
  });

  it('a delivery address carries the secret, and a secret is 40 URL-safe characters that never repeat', () => {
    expect(webhookUrl('https://app.example.com/', 'shopify', 'S3CR3T')).toBe(
      'https://app.example.com/v2/shopify/webhook/S3CR3T',
    );
    expect(webhookUrl('https://app.example.com', 'woocommerce', 'x')).toBe(
      'https://app.example.com/v2/woocommerce/webhook/x',
    );
    const a = newWebhookSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{40}$/);
    expect(newWebhookSecret()).not.toBe(a);
  });

  it('reads the registered ids from the metadata and drops anything else', () => {
    expect(
      webhookIdsOf({ webhook_ids: { 'orders/create': '11', 'orders/paid': 22, junk: '' } }),
    ).toEqual({
      'orders/create': '11',
    });
    expect(webhookIdsOf(null)).toEqual({});
    expect(webhookIdsOf({})).toEqual({});
    expect(webhookIdsOf({ webhook_ids: 'x' })).toEqual({});
  });
});
