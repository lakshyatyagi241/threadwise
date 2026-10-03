import { describe, expect, it } from 'vitest';
import {
  parseStorefrontEnv,
  usableStorefrontHost,
} from '../../../src/config/domains/storefront-builder.env';
import {
  baseSlug,
  slugCandidate,
  slugify,
} from '../../../src/modules/storefront-builder/rules/slug';
import {
  buildWaUrl,
  pagesOrigin,
  publicUrl,
  trackPath,
  trackUrl,
} from '../../../src/modules/storefront-builder/rules/shop-url';
import {
  digitsOnly,
  hasValidPhone,
  storedPhone,
} from '../../../src/modules/storefront-builder/rules/phone';
import { randomToken } from '../../../src/modules/storefront-builder/rules/token';

describe('slugs (WD-STORE-003, 029)', () => {
  it('"Media City Threads" becomes media-city-threads', () => {
    expect(slugify('Media City Threads')).toBe('media-city-threads');
    expect(baseSlug('Media City Threads')).toBe('media-city-threads');
  });

  it('accents fold, punctuation drops, runs collapse and the ends are trimmed', () => {
    expect(slugify('  Café -- Crème & Co.!  ')).toBe('cafe-creme-co');
    expect(slugify('Acme_Traders @ Home')).toBe('acme-traders-at-home');
    expect(slugify('ÆØ ß')).toBe('aeo-ss');
  });

  it('a name with nothing usable falls back to "shop"; the workspace default does too', () => {
    expect(baseSlug('こんにちは')).toBe('shop');
    expect(baseSlug('')).toBe('shop');
  });

  it('a long name is cut to 64 and a suffixed candidate still fits 64 (WaDesk failed in the database)', () => {
    const long = baseSlug('word '.repeat(60));
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long.endsWith('-')).toBe(false);
    for (const n of [2, 3, 10, 123]) expect(slugCandidate(long, n).length).toBeLessThanOrEqual(64);
  });

  it('a taken slug gets -2, -3', () => {
    expect(slugCandidate('acme', 1)).toBe('acme');
    expect(slugCandidate('acme', 2)).toBe('acme-2');
    expect(slugCandidate('acme', 3)).toBe('acme-3');
  });
});

describe('phones and tokens', () => {
  it('the order keeps digits and a leading plus; comparisons use digits only', () => {
    expect(storedPhone('+91 (98123) 45-678')).toBe('+919812345678');
    expect(digitsOnly('+91 98123 45678')).toBe('919812345678');
  });

  it('a phone needs 7 digits', () => {
    expect(hasValidPhone('12-34')).toBe(false);
    expect(hasValidPhone('+1 555 12')).toBe(false);
    expect(hasValidPhone('+1 555 123')).toBe(true);
  });

  it('a tracking token is 40 alphanumeric characters and not repeated', () => {
    const a = randomToken(40);
    expect(a).toMatch(/^[A-Za-z0-9]{40}$/);
    expect(randomToken(40)).not.toBe(a);
  });
});

describe('public URL (WD-STORE-022)', () => {
  const env = (extra: Record<string, string> = {}) =>
    parseStorefrontEnv({
      APP_URL: 'https://api.example.com',
      WEB_APP_URL: 'https://app.example.com',
      ...extra,
    });
  const shop = { slug: 'acme', customDomain: null as string | null, customDomainVerified: false };

  it('a verified custom domain is https://<domain>', () => {
    expect(
      publicUrl({ ...shop, customDomain: 'shop.acme.com', customDomainVerified: true }, env()),
    ).toBe('https://shop.acme.com');
  });

  it('an unverified domain with STOREFRONT_HOST=shops.example.com gives the subdomain', () => {
    expect(
      publicUrl(
        { ...shop, customDomain: 'shop.acme.com' },
        env({ STOREFRONT_HOST: 'shops.example.com' }),
      ),
    ).toBe('https://acme.shops.example.com');
  });

  it('unset, localhost, an IP or the app host mean path mode on the web app', () => {
    for (const host of [
      undefined,
      'localhost',
      '192.168.1.10:3000',
      'app.example.com',
      'api.example.com',
    ]) {
      expect(publicUrl(shop, env(host ? { STOREFRONT_HOST: host } : {}))).toBe(
        'https://app.example.com/s/acme',
      );
    }
    expect(usableStorefrontHost('Shops.Example.com', 'app.example.com')).toBe('shops.example.com');
  });

  it('the tracking link keeps the shop host, and the path form works on it', () => {
    const e = env({ STOREFRONT_HOST: 'shops.example.com' });
    expect(trackPath('acme', 'tok')).toBe('/s/acme/order/tok');
    expect(trackUrl(shop, 'tok', e)).toBe('https://acme.shops.example.com/s/acme/order/tok');
    expect(trackUrl(shop, 'tok', env())).toBe('https://app.example.com/s/acme/order/tok');
    expect(
      pagesOrigin({ ...shop, customDomain: 'shop.acme.com', customDomainVerified: true }, env()),
    ).toBe('https://shop.acme.com');
  });

  it('the CNAME target defaults to the web host and can be set', () => {
    expect(env().cnameTarget).toBe('app.example.com');
    expect(env({ STOREFRONT_CNAME_TARGET: 'Edge.Example.com' }).cnameTarget).toBe(
      'edge.example.com',
    );
  });
});

describe('WhatsApp hand-off (WD-STORE-013 rule 12)', () => {
  const base = {
    shopName: 'Acme',
    orderNo: 42,
    totalMinor: 28000,
    currencyCode: 'INR',
    customerName: 'Asha',
    trackUrl: 'https://app.example.com/s/acme/order/tok',
  };

  it('builds wa.me with the confirmation text and the tracking link', () => {
    const url = buildWaUrl({ ...base, waNumber: '+91 98123 45678' })!;
    expect(url.startsWith('https://wa.me/919812345678?text=')).toBe(true);
    const text = decodeURIComponent(url.split('?text=')[1]!);
    expect(text).toBe(
      'Hi Acme! I just placed order #42 (₹ 280). My name is Asha.\nTrack: https://app.example.com/s/acme/order/tok',
    );
  });

  it('no sending number means no link; no name shows a dash', () => {
    expect(buildWaUrl({ ...base, waNumber: null })).toBeNull();
    expect(buildWaUrl({ ...base, waNumber: '' })).toBeNull();
    const text = decodeURIComponent(
      buildWaUrl({ ...base, waNumber: '9199', customerName: null })!.split('?text=')[1]!,
    );
    expect(text).toContain('My name is —.');
  });
});
