import type { PublicProductPage } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { footerParts, isDefaultFooter } from './footer';
import {
  isWaHandoff,
  orderQuestionUrl,
  productPath,
  productQuestionUrl,
  safeHttpUrl,
  shareLinks,
  waChatUrl,
} from './links';
import { LEGACY_FREE_THRESHOLD_MINOR, formatIn, formatMinor, totalDisplay } from './money';
import { isSameOrigin } from './same-origin';
import {
  homeMetadata,
  jsonLdString,
  limit,
  orderMetadata,
  productJsonLd,
  productMetadata,
} from './seo';
import { TRACK_STEPS, isCancelled, statusLabel, trackerIndex } from './tracker';

const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null });

describe('money', () => {
  it('formats like the shop did: symbol, space, no decimals when whole', () => {
    expect(formatMinor(49900, 'INR')).toBe('₹ 499');
    expect(formatMinor(49950, 'USD')).toBe('$ 499.50');
    expect(formatMinor(0, 'EUR')).toBe('€ 0');
    expect(formatMinor(1000, 'JPY')).toBe('JPY 10');
  });
});

describe('WaDesk money variants', () => {
  it('formatIn glues the symbol to two decimals (Range hint, free-shipping text)', () => {
    expect(formatIn(10900, 'INR')).toBe('₹109.00');
    expect(formatIn(123456789, 'USD')).toBe('$1,234,567.89');
    expect(formatIn(5000, 'JPY')).toBe('JPY 50.00');
    // QUIRK: the shipping copy always says 999.00, whatever the shop's free-above rule is
    expect(formatIn(LEGACY_FREE_THRESHOLD_MINOR, 'INR')).toBe('₹999.00');
  });

  it('totalDisplay is WaOrder::total_display: four symbols, other currencies by code, always two decimals', () => {
    expect(totalDisplay(47700, 'INR')).toBe('₹ 477.00');
    expect(totalDisplay(5000, 'GBP')).toBe('£ 50.00');
    expect(totalDisplay(5000, 'AED')).toBe('AED 50.00');
    expect(totalDisplay(123456, 'EUR')).toBe('€ 1,234.56');
  });
});

describe('links', () => {
  it('builds WhatsApp and share links', () => {
    expect(waChatUrl('+1 (555) 123-4567')).toBe('https://wa.me/15551234567');
    // PHP urlencode, as WaDesk's product link: spaces are `+`, `!` and brackets are escaped
    expect(productQuestionUrl('15551234567', 'Cap', 'https://s/p/cap')).toBe(
      'https://wa.me/15551234567?text=Hi%21+I+have+a+question+about%3A+Cap+%28https%3A%2F%2Fs%2Fp%2Fcap%29',
    );
    expect(orderQuestionUrl('1555', 12)).toBe(
      `https://wa.me/1555?text=${encodeURIComponent('Hi! About my order #12')}`,
    );
    const s = shareLinks('https://s/p/cap', 'Cap');
    expect(s.whatsapp).toContain('https://wa.me/?text=');
    expect(s.telegram).toContain('t.me/share/url?url=https%3A%2F%2Fs%2Fp%2Fcap');
    expect(s.mailto.startsWith('mailto:?subject=Cap')).toBe(true);
    expect(productPath('my shop', 'a/b')).toBe('/s/my%20shop/p/a%2Fb');
  });

  it('only follows http(s) and real WhatsApp hand-offs', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('https://pay.test/x')).toBe('https://pay.test/x');
    expect(isWaHandoff('https://wa.me/1555?text=x')).toBe(true);
    expect(isWaHandoff('https://evil.test/wa.me')).toBe(false);
    expect(isWaHandoff(null)).toBe(false);
  });
});

describe('tracker', () => {
  it('positions every status, fixing the completed-looks-placed quirk', () => {
    expect(TRACK_STEPS).toHaveLength(4);
    expect(trackerIndex('new')).toBe(0);
    expect(trackerIndex('confirmed')).toBe(1);
    expect(trackerIndex('paid')).toBe(2);
    expect(trackerIndex('shipped')).toBe(3);
    expect(trackerIndex('completed')).toBe(3);
    expect(trackerIndex('weird')).toBe(0);
    expect(isCancelled('Cancelled')).toBe(true);
    expect(statusLabel('confirmed')).toBe('Confirmed');
  });
});

describe('footer', () => {
  it('tells the default copyright line from the merchant text', () => {
    const shop = { name: 'Acme & Co', footerText: '© 2026 Acme &amp; Co' };
    expect(isDefaultFooter(shop)).toBe(true);
    expect(footerParts(shop).custom).toBeNull();
    expect(footerParts(shop).bottom).toBe('© 2026 Acme &amp; Co');
    const own = { name: 'Acme', footerText: 'Made with <em>love</em>' };
    expect(footerParts(own).custom).toBe('Made with <em>love</em>');
    expect(footerParts({ name: 'A', footerText: '' })).toEqual({ custom: null, bottom: null });
  });
});

describe('same-origin guard', () => {
  it('accepts the shop’s own origin and refuses others', () => {
    expect(isSameOrigin(headers({ origin: 'https://shop.acme.com', host: 'shop.acme.com' }))).toBe(
      true,
    );
    expect(isSameOrigin(headers({ origin: 'https://evil.test', host: 'shop.acme.com' }))).toBe(
      false,
    );
    expect(isSameOrigin(headers({ 'sec-fetch-site': 'cross-site', host: 'x' }))).toBe(false);
    expect(isSameOrigin(headers({ 'sec-fetch-site': 'same-origin', host: 'x' }))).toBe(true);
    expect(isSameOrigin(headers({ origin: 'null', host: 'x' }))).toBe(false);
    expect(isSameOrigin(headers({ host: 'x' }))).toBe(true);
  });
});

describe('seo', () => {
  const page = {
    shop: { currencyCode: 'INR' },
    product: {
      name: 'Cap',
      imageUrl: 'https://i/x.png',
      description: '<b>Nice</b> cap',
      sku: null,
      brand: null,
      priceMinor: 49950,
      currencyCode: 'USD',
      stockQty: 0,
    },
    ratingCount: 2,
    ratingAvg: 4.5,
  } as unknown as PublicProductPage;

  it('builds Product JSON-LD with null keys removed', () => {
    const ld = productJsonLd(page, 'https://s/p/cap');
    expect(ld).toMatchObject({
      '@type': 'Product',
      name: 'Cap',
      image: ['https://i/x.png'],
      description: 'Nice cap',
      offers: {
        price: '499.50',
        priceCurrency: 'USD',
        availability: 'https://schema.org/OutOfStock',
        url: 'https://s/p/cap',
      },
      aggregateRating: { ratingValue: 4.5, reviewCount: 2 },
    });
    expect(ld).not.toHaveProperty('sku');
    expect(ld).not.toHaveProperty('brand');
    const none = productJsonLd(
      { ...page, ratingCount: 0, ratingAvg: null } as PublicProductPage,
      'u',
    );
    expect(none).not.toHaveProperty('aggregateRating');
  });

  it('cannot be broken out of its script tag', () => {
    expect(jsonLdString({ a: '</script><script>x' })).not.toContain('</script>');
  });

  it('limits text with a marker', () => {
    expect(limit('abcdef', 3)).toBe('abc...');
    expect(limit('abc', 3)).toBe('abc');
  });
});

describe('shop head tags do not inherit the staff app', () => {
  const shop = {
    name: 'Aurora Goods',
    heroText: '',
    logoUrl: null,
  } as unknown as Parameters<typeof homeMetadata>[0];

  it('uses absolute titles and resets robots', () => {
    const home = homeMetadata(shop, 'https://x/s/a');
    expect(home.title).toEqual({ absolute: 'Aurora Goods' });
    expect(home.robots).toBeNull();
    const product = productMetadata(
      shop,
      { name: 'Mug', description: 'Nice', imageUrl: null } as never,
      'https://x/s/a/p/mug',
    );
    expect(product.title).toEqual({ absolute: 'Mug · Aurora Goods' });
    expect(product.robots).toBeNull();
  });

  it('the tracking page is noindex and carries no social tags', () => {
    const m = orderMetadata(shop, 9100);
    expect(m.title).toEqual({ absolute: 'Order #9100 · Aurora Goods' });
    expect(m.robots).toEqual({ index: false });
    expect(m.openGraph).toBeNull();
    expect(m.twitter).toBeNull();
  });
});
