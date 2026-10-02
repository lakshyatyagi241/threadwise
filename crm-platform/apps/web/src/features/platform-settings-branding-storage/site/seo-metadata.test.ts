import { describe, expect, it } from 'vitest';
import type { PublicSiteConfig } from '@crm/contracts';
import { fontAssets } from './fonts';
import { siteMetadata, siteViewport } from './seo-metadata';

const base = (
  over: Partial<PublicSiteConfig> = {},
  seo: Record<string, string> = {},
): PublicSiteConfig =>
  ({
    brand: { name: 'Acme', url: '', faviconUrl: '', logos: {}, fontFamily: '', platformFooter: '' },
    seo: {
      title: 'Acme',
      description: '',
      keywords: '',
      robots: 'index, follow',
      canonical: '',
      author: 'Acme',
      ogTitle: 'Acme',
      ogDescription: '',
      ogType: 'website',
      ogUrl: '',
      ogImage: '',
      twitterCard: 'summary_large_image',
      twitterSite: '',
      twitterCreator: '',
      googleVerification: '',
      bingVerification: '',
      ...seo,
    },
    pwa: { enabled: false, themeColor: '#075E54', shortName: 'Acme', appleTouchIcon: '' },
    ...over,
  }) as PublicSiteConfig;

describe('SEO meta emission (WD-SET-027)', () => {
  it('an OG image brings width 1200, height 630 and the twitter image', () => {
    const m = siteMetadata(base({}, { ogImage: 'https://cdn.test/og.png' }));
    expect(m.openGraph?.images).toEqual([
      { url: 'https://cdn.test/og.png', width: 1200, height: 630 },
    ]);
    expect(m.twitter?.images).toEqual(['https://cdn.test/og.png']);
  });

  it('twitter site and creator get an @ once', () => {
    const m = siteMetadata(base({}, { twitterSite: 'brand', twitterCreator: '@me' }));
    expect(m.twitter).toMatchObject({ site: '@brand', creator: '@me' });
  });

  it('the robots default is the saved one; verification tags appear only when set', () => {
    expect(siteMetadata(base({}, { robots: 'noindex, nofollow' })).robots).toBe(
      'noindex, nofollow',
    );
    const none = siteMetadata(base());
    expect(none.verification).toBeUndefined();
    expect(none.other).toBeUndefined();
    const set = siteMetadata(
      base({}, { googleVerification: 'g-code', bingVerification: 'b-code' }),
    );
    expect(set.verification).toEqual({ google: 'g-code' });
    expect(set.other).toMatchObject({ 'msvalidate.01': 'b-code' });
  });

  it('blank values are unset, not empty tags: a blank OG title falls back to the meta title', () => {
    const m = siteMetadata(
      base({}, { title: 'Meta Title', ogTitle: '', ogDescription: '', description: 'Desc' }),
    );
    expect(m.openGraph).toMatchObject({ title: 'Meta Title', description: 'Desc' });
    expect(m.twitter).toMatchObject({ title: 'Meta Title', card: 'summary_large_image' });
    expect(m.description).toBe('Desc');
    expect(m.alternates).toBeUndefined();
    expect(m.keywords).toBeUndefined();
  });

  it('site name, og:type and the card are always present; the title carries the brand template', () => {
    const m = siteMetadata(base());
    expect(m.openGraph).toMatchObject({ siteName: 'Acme', type: 'website' });
    expect(m.title).toEqual({ default: 'Acme', template: '%s - Acme' });
  });

  it('a canonical URL is emitted only when saved', () => {
    expect(siteMetadata(base({}, { canonical: 'https://acme.test/' })).alternates).toEqual({
      canonical: 'https://acme.test/',
    });
  });
});

describe('PWA head tags (WD-SET-036)', () => {
  it('no manifest link, no iOS tags and no theme colour while the switch is off', () => {
    const m = siteMetadata(base());
    expect(m.manifest).toBeUndefined();
    expect(m.other).toBeUndefined();
    expect(siteViewport(base())).toEqual({});
  });

  it('on: manifest link, theme colour, iOS home-screen tags and the touch icon', () => {
    const cfg = base({
      pwa: {
        enabled: true,
        themeColor: '#123456',
        shortName: 'AC',
        appleTouchIcon: '/api/v2/public/brand/pwa-192?v=abcd1234',
      },
    });
    const m = siteMetadata(cfg);
    expect(m.manifest).toBe('/manifest.webmanifest');
    expect(m.other).toMatchObject({
      'apple-mobile-web-app-capable': 'yes',
      'apple-mobile-web-app-status-bar-style': 'black-translucent',
      'apple-mobile-web-app-title': 'AC',
    });
    expect(m.icons).toMatchObject({ apple: [{ url: '/api/v2/public/brand/pwa-192?v=abcd1234' }] });
    expect(siteViewport(cfg)).toEqual({ themeColor: '#123456' });
  });
});

describe('UI font (WD-SET-006 rule 2)', () => {
  it('Inter gives the stylesheet and the --font-sans override; blank or unknown gives nothing', () => {
    const f = fontAssets('inter')!;
    expect(f.href).toContain('fonts.googleapis.com/css2?family=Inter');
    expect(f.css).toContain('--font-sans');
    expect(fontAssets('')).toBeNull();
    expect(fontAssets('comic-sans')).toBeNull();
  });
});
