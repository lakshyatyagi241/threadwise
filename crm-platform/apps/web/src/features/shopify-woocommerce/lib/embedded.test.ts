import { NextRequest, type NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import nextConfig from '../../../../next.config';
import { proxy } from '@/proxy';
import {
  SHOPIFY_FRAME_ANCESTORS,
  isShopifyEmbeddedRequest,
  isShopifyPath,
  shopifyFrameHeaders,
} from './embedded';

/** The Shopify embedded app's framing policy (TW-ECOM-038). */
const q = (s: string) => new URLSearchParams(s);
const SHOPIFY = 'host=YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvYWNtZQ&shop=acme.myshopify.com';
const get = (url: string) => proxy(new NextRequest(`http://localhost:3001${url}`)) as NextResponse;
const csp = (r: Response) => r.headers.get('content-security-policy');

describe('which requests are Shopify loading the app', () => {
  it('needs both host and a *.myshopify.com shop', () => {
    expect(isShopifyEmbeddedRequest(q(SHOPIFY))).toBe(true);
    expect(isShopifyEmbeddedRequest(q('shop=acme.myshopify.com'))).toBe(false);
    expect(isShopifyEmbeddedRequest(q('host=abc'))).toBe(false);
    expect(isShopifyEmbeddedRequest(q('host=abc&shop=evil.com'))).toBe(false);
    expect(isShopifyEmbeddedRequest(q('host=abc&shop=acme.myshopify.com.evil.com'))).toBe(false);
    expect(isShopifyEmbeddedRequest(q('host=a b&shop=acme.myshopify.com'))).toBe(false);
    expect(isShopifyEmbeddedRequest(q(''))).toBe(false);
  });

  it('knows only the /shopify pages', () => {
    for (const p of ['/shopify', '/shopify/', '/shopify/embedded'])
      expect(isShopifyPath(p), p).toBe(true);
    for (const p of [
      '/shopifyx',
      '/shopify/other',
      '/woocommerce',
      '/',
      '/login',
      '/shopify/embedded/x',
    ])
      expect(isShopifyPath(p), p).toBe(false);
  });
});

describe('frame headers of a /shopify page', () => {
  it('lets Shopify frame it only when the request is Shopify’s, and sends no X-Frame-Options then', () => {
    const h = shopifyFrameHeaders('/shopify', q(SHOPIFY));
    expect(h['Content-Security-Policy']).toBe(`frame-ancestors ${SHOPIFY_FRAME_ANCESTORS}`);
    expect(SHOPIFY_FRAME_ANCESTORS).toBe('https://admin.shopify.com https://*.myshopify.com');
    expect(h['X-Frame-Options']).toBeUndefined();
  });

  it('keeps the staff screen opened directly un-framable', () => {
    const h = shopifyFrameHeaders('/shopify', q('tab=orders'));
    expect(h['Content-Security-Policy']).toBe("frame-ancestors 'self'");
    expect(h['X-Frame-Options']).toBe('SAMEORIGIN');
  });
});

describe('proxy', () => {
  it('serves /shopify with host and shop as the embedded page, framable by Shopify only', () => {
    const res = get(`/shopify?${SHOPIFY}`);
    expect(res.headers.get('x-middleware-rewrite')).toContain(`/shopify/embedded?${SHOPIFY}`);
    expect(csp(res)).toBe(`frame-ancestors ${SHOPIFY_FRAME_ANCESTORS}`);
    expect(res.headers.get('x-frame-options')).toBeNull();
  });

  it('leaves /shopify opened without Shopify’s parameters on the app-wide policy and untouched', () => {
    for (const url of ['/shopify', '/shopify?tab=orders', '/shopify?shop=acme.myshopify.com']) {
      const res = get(url);
      expect(res.headers.get('x-middleware-rewrite'), url).toBeNull();
      expect(csp(res), url).toBe("frame-ancestors 'self'");
      expect(res.headers.get('x-frame-options'), url).toBe('SAMEORIGIN');
    }
  });

  it('does not touch any other route', () => {
    for (const url of [
      '/dashboard',
      `/woocommerce?${SHOPIFY}`,
      `/login?${SHOPIFY}`,
      `/shopifyx?${SHOPIFY}`,
    ]) {
      const res = get(url);
      expect(csp(res), url).toBeNull();
      expect(res.headers.get('x-middleware-rewrite'), url).toBeNull();
    }
  });
});

type Rule = { source: string; headers: Array<{ key: string; value: string }> };

describe('next.config', () => {
  it('keeps the blanket frame policy on every page but the /shopify ones, which proxy.ts decides', async () => {
    const rules = (await nextConfig.headers!()) as Rule[];
    const blanket = rules.find((r) => r.headers.some((h) => h.key === 'X-Frame-Options'))!;
    const re = new RegExp(`^${blanket.source}$`);
    for (const p of ['/login', '/dashboard', '/woocommerce', '/shopifyx', '/shopify/other'])
      expect(re.test(p), p).toBe(true);
    for (const p of ['/shopify', '/shopify/embedded']) expect(re.test(p), p).toBe(false);
    // No static rule may put a frame header on the /shopify pages: it would sit next to the one proxy.ts sets.
    for (const r of rules.filter((r) => r !== blanket && /shopify/.test(r.source)))
      expect(r.headers.map((h) => h.key)).not.toContain('X-Frame-Options');
  });
});
