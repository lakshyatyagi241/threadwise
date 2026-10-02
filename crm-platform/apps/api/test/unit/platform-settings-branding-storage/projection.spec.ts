import { describe, expect, it } from 'vitest';
import { SET_GROUP_SCHEMAS } from '@crm/contracts';
import {
  ProjectionService,
  normalisePath,
  themeCss,
} from '../../../src/modules/platform-settings-branding-storage/projection.service';
import { isOpenDuringMaintenance } from '../../../src/modules/platform-settings-branding-storage/maintenance.guard';

const branding = (over: Record<string, unknown> = {}) => SET_GROUP_SCHEMAS.branding.parse(over);

describe('theme CSS (TW-SET-013, 014)', () => {
  it('emits nothing for an untouched palette, or for a token set to its shipped value', () => {
    expect(themeCss(branding())).toBe('');
    expect(themeCss(branding({ colors: { 'wa-deep': '#075e54' } }))).toBe('');
  });

  it('emits only the overridden tokens', () => {
    const css = themeCss(branding({ colors: { 'ink-900': '#000000' } }));
    expect(css).toBe(':root{--color-ink-900:#000000}');
  });

  it('derives teal, green, mint and bubble from an overridden primary, unless set explicitly', () => {
    const css = themeCss(branding({ colors: { 'wa-deep': '#7C3AED', 'wa-green': '#00FF00' } }));
    expect(css).toContain('--color-wa-deep:#7C3AED');
    expect(css).toContain('--color-wa-green:#00FF00');
    expect(css).toMatch(/--color-wa-teal:oklch\(from var\(--color-wa-deep\)/);
    expect(css).toMatch(/--color-wa-mint:color-mix/);
    expect(css).not.toMatch(/--color-wa-green:oklch/);
  });

  it('adds the size and opacity rules only when they differ from 100', () => {
    expect(themeCss(branding({ fontScale: 90 }))).toBe('html{font-size:90%}');
    expect(themeCss(branding({ uiOpacity: 80 }))).toBe('body{opacity:0.8}');
    expect(themeCss(branding({ fontScale: 100, uiOpacity: 100 }))).toBe('');
  });
});

describe('manifest and robots (TW-SET-028, 036)', () => {
  const make = (docs: Record<string, Record<string, unknown>>) =>
    new ProjectionService({
      values: async (g: keyof typeof SET_GROUP_SCHEMAS) =>
        SET_GROUP_SCHEMAS[g].parse(docs[g] ?? {}),
    } as never);

  it('has no manifest while the PWA switch is off', async () => {
    expect(await make({}).manifest()).toBeNull();
  });

  it('names the app from the brand when the PWA name is blank and normalises the start URL', async () => {
    const m = await make({
      general: { appName: 'Acme Chat Platform' },
      pwa: { enabled: true, startUrl: 'app', icon192: 'https://cdn.test/i.png' },
    }).manifest();
    expect(m).toMatchObject({
      name: 'Acme Chat Platform',
      short_name: 'Acme Chat Pl',
      start_url: '/app',
      scope: '/',
      icons: [{ src: 'https://cdn.test/i.png', sizes: '192x192' }],
    });
  });

  it('normalisePath', () => {
    expect(normalisePath('')).toBe('/');
    expect(normalisePath('//x')).toBe('/x');
    expect(normalisePath('https://a.test/x')).toBe('https://a.test/x');
  });

  it('robots.txt follows the robots directive and only names a sitemap when a base URL exists', async () => {
    expect(await make({ seo: { robots: 'noindex, nofollow' } }).robots()).toBe(
      'User-agent: *\nDisallow: /\n',
    );
    expect(await make({ general: { appUrl: 'https://acme.test/' } }).robots()).toContain(
      'Sitemap: https://acme.test/sitemap.xml',
    );
    expect(await make({}).robots()).toBe('User-agent: *\nAllow: /\n');
  });
});

describe('public site config (TW-SET-010, 023, 030, 033, 034)', () => {
  const make = (docs: Record<string, Record<string, unknown>>) =>
    new ProjectionService({
      values: async (g: keyof typeof SET_GROUP_SCHEMAS) =>
        SET_GROUP_SCHEMAS[g].parse(docs[g] ?? {}),
    } as never);

  it('a theme without its own logo falls back to the paper logo', async () => {
    const c = await make({
      branding: { logos: { paper: 'https://cdn.test/p.png', dark: '' } },
    }).siteConfig();
    expect(c.brand.logos.dark).toBe('https://cdn.test/p.png');
    expect(c.brand.logos.paper).toBe('https://cdn.test/p.png');
  });

  it('omits empty tracker ids and withholds custom code until the master switch is on', async () => {
    const off = await make({
      analytics: { googleGa4: 'G-123' },
      customCode: { css: 'body{}', js: 'alert(1)' },
    }).siteConfig();
    expect(off.analytics.googleGa4).toBe('G-123');
    expect(off.analytics.metaPixel).toBeUndefined();
    expect(off.customCode).toEqual({ css: '', js: '' });
    const on = await make({ customCode: { enabled: true, css: 'body{}', js: 'x()' } }).siteConfig();
    expect(on.customCode).toEqual({ css: 'body{}', js: 'x()' });
  });

  it('real-time shows enabled only with the flag, a key and a cluster', async () => {
    expect((await make({ realtime: { enabled: true } }).siteConfig()).realtime.enabled).toBe(false);
    expect(
      (await make({ realtime: { enabled: true, appKey: 'k' } }).siteConfig()).realtime.enabled,
    ).toBe(true);
  });

  it('the cookie banner legal link falls back to the privacy policy', async () => {
    const c = await make({ privacy: { policyUrl: 'https://a.test/privacy' } }).siteConfig();
    expect(c.cookieBanner.cookiesPolicyUrl).toBe('https://a.test/privacy');
  });
});

describe('maintenance open paths (TW-SET-008)', () => {
  it.each([
    '/health',
    '/v2/platform/settings/groups',
    '/v2/auth/login',
    '/v2/public/site-config',
    '/public/v1/leads',
  ])('%s stays open', (p) => expect(isOpenDuringMaintenance(p)).toBe(true));

  it.each(['/v2/contacts', '/v2/account/me', '/v2/plans', '/v2/platformish', '/v2/authx'])(
    '%s is blocked',
    (p) => expect(isOpenDuringMaintenance(p)).toBe(false),
  );
});
