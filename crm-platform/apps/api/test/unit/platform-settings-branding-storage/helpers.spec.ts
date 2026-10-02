import { describe, expect, it } from 'vitest';
import {
  appendFooterToBody,
  brandEmail,
  brandName,
  brandToken,
  buildRobotsTxt,
  buildSitemapXml,
  convertCurrency,
  defaultLocale,
  directionFor,
  formatMoney,
  isLocaleAvailable,
  legalUrl,
  resolveBrandingFooter,
  resolveTimezone,
  safeTimezone,
  webhookHeaderNames,
  type LocaleRow,
} from '@crm/contracts';

describe('brand identity (TW-SET-011)', () => {
  it('the webhook signature header is built from the brand name', () => {
    expect(webhookHeaderNames('Acme Corp').signature).toBe('X-AcmeCorp-Signature');
    expect(webhookHeaderNames('Acme Corp').event).toBe('X-AcmeCorp-Event');
    expect(webhookHeaderNames('!!!').hookId).toBe('X-CRM-Hook-Id');
  });

  it('a blank app name gives the product default, a name is trimmed', () => {
    expect(brandName('')).toBe('CRM Platform');
    expect(brandName(null)).toBe('CRM Platform');
    expect(brandName('  Acme ')).toBe('Acme');
  });

  it('brandToken keeps letters, upper-cases, cuts, and falls back to SENDER', () => {
    expect(brandToken('Acme Corp 24')).toBe('ACMECO');
    expect(brandToken('Acme Corp', 4)).toBe('ACME');
    expect(brandToken('1234')).toBe('SENDER');
  });

  it('brandEmail: own mailbox, then support, then prefix@domain without www or app', () => {
    expect(
      brandEmail('privacy', { roleEmails: { privacy: 'p@x.com' }, supportEmail: 's@x.com' }),
    ).toBe('p@x.com');
    expect(brandEmail('privacy', { supportEmail: 'help@x.com' })).toBe('help@x.com');
    expect(brandEmail('billing', { requestHost: 'www.acme.io' })).toBe('billing@acme.io');
    expect(brandEmail('billing', { appUrl: 'https://app.acme.io:3000/x' })).toBe('billing@acme.io');
    expect(brandEmail('billing', {})).toBe('billing@example.com');
    // the site domain wins over the request host
    expect(brandEmail('billing', { siteDomain: 'site.io', requestHost: 'other.io' })).toBe(
      'billing@site.io',
    );
  });
});

describe('platform message footer (TW-SET-012)', () => {
  it('a plan without remove_branding gets the platform footer', () => {
    expect(
      resolveBrandingFooter({ platformFooter: 'Sent via Acme', workspaceFooter: 'Mine' }),
    ).toBe('Sent via Acme');
  });

  it('a plan with remove_branding uses its own footer and never falls back to the platform one', () => {
    const base = { platformFooter: 'Sent via Acme', hasRemoveBranding: true };
    expect(resolveBrandingFooter({ ...base, workspaceFooter: null })).toBeNull();
    expect(resolveBrandingFooter({ ...base, workspaceFooter: '   ' })).toBeNull();
    expect(resolveBrandingFooter({ ...base, workspaceFooter: 'Team X' })).toBe('Team X');
  });

  it('is cut to 60 characters and blank means none', () => {
    expect(resolveBrandingFooter({ platformFooter: 'x'.repeat(80) })).toHaveLength(60);
    expect(resolveBrandingFooter({ platformFooter: '  ' })).toBeNull();
  });

  it('appends an italic footer after a blank line, once', () => {
    const once = appendFooterToBody('Hello', 'Sent via Acme');
    expect(once).toBe('Hello\n\n_Sent via Acme_');
    expect(appendFooterToBody(once, 'Sent via Acme')).toBe(once);
    expect(appendFooterToBody('Hello', null)).toBe('Hello');
  });
});

describe('timezone (TW-SET-046)', () => {
  it('maps a legacy alias to its canonical zone and falls back for an unknown one', () => {
    expect(safeTimezone('Asia/Calcutta')).toBe('Asia/Kolkata');
    expect(safeTimezone('Europe/Kiev')).toBe('Europe/Kyiv');
    expect(safeTimezone('Mars/Olympus', 'UTC')).toBe('UTC');
    expect(safeTimezone('')).toBe('');
    expect(safeTimezone('Asia/Kolkata')).toBe('Asia/Kolkata');
  });

  it('takes the first valid zone of the chain, skipping invalid ones', () => {
    expect(resolveTimezone(['Nope/Zone', null, 'Asia/Calcutta', 'Europe/Paris'])).toBe(
      'Asia/Kolkata',
    );
    expect(resolveTimezone([undefined, '', 'America/New_York'])).toBe('America/New_York');
    expect(resolveTimezone([null, 'bad'])).toBe('UTC');
  });
});

describe('currency (TW-SET-044)', () => {
  const inr = { code: 'INR', symbol: '₹', precision: 2, rate: '83.5' };
  it('formats with the symbol, fixed separators and the currency precision', () => {
    expect(formatMoney('1499.5', inr)).toBe('₹1,499.50');
    expect(formatMoney(1234567.891, { ...inr, precision: 0 })).toBe('₹1,234,568');
    expect(formatMoney('12', { ...inr, symbol: '' })).toBe('INR 12.00');
  });

  it('without a currency row the amount is a plain two-decimal number', () => {
    expect(formatMoney('1499.5', null)).toBe('1,499.50');
    expect(formatMoney('abc', null)).toBe('0.00');
  });

  it('converts through the USD rates, to two decimals; a bad source rate leaves the amount', () => {
    expect(convertCurrency('10', '1', '83.5')).toBe('835.00');
    expect(convertCurrency('835', '83.5', '1')).toBe('10.00');
    expect(convertCurrency('10', '0', '83.5')).toBe('10.00');
  });
});

describe('locale registry helpers (TW-SET-045)', () => {
  const registry: LocaleRow[] = [
    { code: 'en', name: 'English', nativeName: 'English', direction: 'ltr' },
    { code: 'ar', name: 'Arabic', nativeName: 'العربية', direction: 'rtl' },
  ];
  it('reads direction from the registry, ltr when unknown', () => {
    expect(directionFor('ar', registry)).toBe('rtl');
    expect(directionFor('xx', registry)).toBe('ltr');
    expect(isLocaleAvailable('ar', registry)).toBe(true);
    expect(isLocaleAvailable('fr', registry)).toBe(false);
  });
  it('the default locale is never empty', () => {
    expect(defaultLocale('')).toBe('en');
    expect(defaultLocale(undefined)).toBe('en');
    expect(defaultLocale(' fr ')).toBe('fr');
  });
});

describe('sitemap and robots (TW-SET-028)', () => {
  const xml = buildSitemapXml({
    baseUrl: 'https://acme.test/',
    posts: [
      { slug: 'a', lastModified: '2026-01-02T00:00:00.000Z', featured: true },
      { slug: 'b&c', lastModified: '2026-01-01T00:00:00.000Z' },
    ],
    categories: [{ slug: 'news' }],
    legal: [{ slug: 'privacy' }],
  });
  it('lists static pages, categories and posts with their priorities, XML-escaped', () => {
    expect(xml).toContain('<loc>https://acme.test/</loc>');
    expect(xml).toContain('<loc>https://acme.test/blog?category=news</loc>');
    expect(xml).toMatch(
      /<loc>https:\/\/acme.test\/blog\/a<\/loc>\s*<lastmod>2026-01-02[^<]*<\/lastmod>\s*<changefreq>weekly<\/changefreq>\s*<priority>0.8<\/priority>/,
    );
    expect(xml).toMatch(/blog\/b%26c<\/loc>[\s\S]*?<priority>0.7<\/priority>/);
    expect(xml.startsWith('<?xml')).toBe(true);
  });
  it('robots.txt has the five lines, or disallows all under a global noindex', () => {
    expect(
      buildRobotsTxt({ baseUrl: 'https://acme.test/', robotsDirective: 'index, follow' }),
    ).toBe(
      'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\nSitemap: https://acme.test/sitemap.xml\n',
    );
    expect(buildRobotsTxt({ baseUrl: '', robotsDirective: 'index, follow' })).not.toContain(
      'Sitemap',
    );
    expect(
      buildRobotsTxt({ baseUrl: 'https://a.test', robotsDirective: 'noindex, nofollow' }),
    ).toBe('User-agent: *\nDisallow: /\n');
  });
});

describe('legal links (TW-SET-030 rule 5)', () => {
  it('uses the saved URL, else the built-in page', () => {
    const saved = { termsUrl: ' https://x.test/t ', policyUrl: '', cookiesPolicyUrl: '' };
    expect(legalUrl('terms', saved)).toBe('https://x.test/t');
    expect(legalUrl('privacy', saved)).toBe('/legal/privacy');
    expect(legalUrl('cookies', saved)).toBe('/legal/cookies');
  });
});
