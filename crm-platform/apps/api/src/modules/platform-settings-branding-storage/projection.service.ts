import { Injectable } from '@nestjs/common';
import {
  BRAND_ASSET_PATH,
  THEME_COLOR_TOKENS,
  buildRobotsTxt,
  legalUrl,
  type PublicSiteConfig,
  type SetGroupValues,
} from '@crm/contracts';
import { BrandAssetsService } from './brand-assets.service';
import { SettingsService } from './settings.service';

/** The shipped value of every colour token; an override equal to it emits nothing (WD-SET-013 rule 2). */
export const THEME_DEFAULTS: Record<(typeof THEME_COLOR_TOKENS)[number], string> = {
  'wa-deep': '#075E54',
  'wa-teal': '#128C7E',
  'wa-green': '#25D366',
  'wa-mint': '#DCF8C6',
  'wa-bubble': '#E7FFDB',
  'paper-0': '#FBFAF6',
  'paper-50': '#F5F3EC',
  'paper-100': '#EFEBE0',
  'paper-200': '#E5DFD0',
  'ink-500': '#6B807C',
  'ink-700': '#1F4540',
  'ink-900': '#0B1F1C',
  'accent-coral': '#E87A5D',
  'accent-amber': '#E5A04E',
  'accent-plum': '#5B3D8A',
  'accent-sky': '#3E7AA1',
};

/**
 * CSS for the overridden tokens, or '' when nothing differs from the shipped palette. When the primary is
 * overridden, the shades that follow it (teal, green, mint, bubble) are derived from it unless set
 * explicitly. Metrics use a root font size and a body opacity (WaDesk used the non-standard `zoom`).
 */
export function themeCss(b: SetGroupValues<'branding'>): string {
  const colors = b.colors as Record<string, string>;
  const out: string[] = [];
  const set = (token: string, value: string) => out.push(`--color-${token}:${value}`);
  const overridden = (t: (typeof THEME_COLOR_TOKENS)[number]) =>
    colors[t] !== '' && colors[t]!.toLowerCase() !== THEME_DEFAULTS[t].toLowerCase();
  for (const t of THEME_COLOR_TOKENS) if (overridden(t)) set(t, colors[t]!);
  if (overridden('wa-deep')) {
    const p = 'var(--color-wa-deep)';
    if (!overridden('wa-teal')) set('wa-teal', `oklch(from ${p} calc(l + 0.08) c h)`);
    if (!overridden('wa-green')) set('wa-green', `oklch(from ${p} 0.72 c h)`);
    if (!overridden('wa-mint')) set('wa-mint', `color-mix(in srgb, ${p} 16%, white)`);
    if (!overridden('wa-bubble')) set('wa-bubble', `color-mix(in srgb, ${p} 10%, white)`);
  }
  const rules: string[] = [];
  if (out.length) rules.push(`:root{${out.join(';')}}`);
  if (b.fontScale !== 100) rules.push(`html{font-size:${b.fontScale}%}`);
  if (b.uiOpacity !== 100) rules.push(`body{opacity:${b.uiOpacity / 100}}`);
  return rules.join('');
}

const nonEmpty = (o: Record<string, string>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== ''));

/** Read model for visitors (WD-SET-011, 023, 027, 030, 033, 034, 036): no secrets, no operator data. */
@Injectable()
export class ProjectionService {
  constructor(
    private readonly settings: SettingsService,
    private readonly assets: BrandAssetsService,
  ) {}

  async siteConfig(): Promise<PublicSiteConfig> {
    const [g, b, site, seo, privacy, analytics, custom, pwa, ti] = await Promise.all([
      this.settings.values('general'),
      this.settings.values('branding'),
      this.settings.values('site'),
      this.settings.values('seo'),
      this.settings.values('privacy'),
      this.settings.values('analytics'),
      this.settings.values('customCode'),
      this.settings.values('pwa'),
      this.settings.values('tiPwa'),
    ]);
    const logos = b.logos as Record<string, string>;
    return {
      brand: {
        name: g.appName,
        url: g.appUrl,
        faviconUrl: b.faviconUrl,
        // A theme without its own logo falls back to the paper one (WD-SET-010 rule 5).
        logos: Object.fromEntries(
          Object.keys(logos).map((t) => [t, logos[t] || logos.paper || '']),
        ),
        fontFamily: g.fontFamily,
        platformFooter: g.platformFooter,
      },
      defaults: {
        timezone: g.defaultTimezone,
        language: g.defaultLanguage,
        currency: g.defaultCurrency,
        countryCode: g.defaultCountryCode,
        countryIso: g.defaultCountryIso,
      },
      maintenance: g.maintenanceMode,
      themeCss: themeCss(b),
      seo: {
        title: seo.metaTitle || g.appName,
        description: seo.metaDescription,
        keywords: seo.metaKeywords,
        robots: seo.robots,
        canonical: seo.canonical,
        author: seo.author || g.appName,
        ogTitle: seo.ogTitle || seo.metaTitle || g.appName,
        ogDescription: seo.ogDescription || seo.metaDescription,
        ogType: seo.ogType,
        ogUrl: seo.ogUrl || seo.canonical,
        ogImage: seo.ogImage,
        twitterCard: seo.twitterCard,
        twitterSite: seo.twitterSite,
        twitterCreator: seo.twitterCreator,
        googleVerification: seo.googleVerification,
        bingVerification: seo.bingVerification,
      },
      footer: {
        title: site.footerTitle,
        copyright: site.footerCopyright,
        description: site.footerDescription,
        social: nonEmpty({
          x: site.socialX,
          linkedin: site.socialLinkedin,
          instagram: site.socialInstagram,
          youtube: site.socialYoutube,
          facebook: site.socialFacebook,
          github: site.socialGithub,
        }),
      },
      cookieBanner: {
        enabled: privacy.cookieBannerEnabled,
        style: privacy.cookieBannerStyle,
        message: privacy.cookieMessage,
        policyUrl: privacy.policyUrl,
        termsUrl: privacy.termsUrl,
        cookiesPolicyUrl: privacy.cookiesPolicyUrl || privacy.policyUrl,
        respectDoNotTrack: privacy.respectDoNotTrack,
      },
      analytics: nonEmpty(analytics),
      // Custom code runs on the public site, so it is withheld unless the master switch is on.
      customCode: custom.enabled ? { css: custom.css, js: custom.js } : { css: '', js: '' },
      pwa: {
        enabled: pwa.enabled,
        themeColor: pwa.themeColor,
        shortName: pwa.shortName || g.appName.slice(0, 12),
        appleTouchIcon: pwa.icon192 || b.faviconUrl,
      },
      teamInboxPwa: { enabled: ti.enabled },
      legal: {
        terms: legalUrl('terms', privacy),
        privacy: legalUrl('privacy', privacy),
        cookies: legalUrl('cookies', privacy),
      },
    };
  }

  /** MIME type of an icon: the stored file's own for an upload, else guessed from the extension (default PNG). */
  private async iconType(url: string): Promise<string> {
    const asset = url.split('?')[0]!;
    if (BRAND_ASSET_PATH.test(url)) {
      const stored = await this.assets.read(asset.split('/').pop()!);
      if (stored) return stored.mime;
    }
    const ext = /\.([a-z0-9]+)$/i.exec(asset)?.[1]?.toLowerCase();
    return (
      {
        webp: 'image/webp',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        svg: 'image/svg+xml',
        ico: 'image/x-icon',
      }[ext ?? ''] ?? 'image/png'
    );
  }

  /** The web app manifest, or null when installable-app support is off (WD-SET-036). */
  async manifest(): Promise<Record<string, unknown> | null> {
    const [pwa, g] = await Promise.all([
      this.settings.values('pwa'),
      this.settings.values('general'),
    ]);
    if (!pwa.enabled) return null;
    const name = pwa.appName || g.appName;
    const icons = [];
    if (pwa.icon192) {
      icons.push({ src: pwa.icon192, sizes: '192x192', type: await this.iconType(pwa.icon192) });
    }
    if (pwa.icon512) {
      icons.push({ src: pwa.icon512, sizes: '512x512', type: await this.iconType(pwa.icon512) });
    }
    return {
      name,
      short_name: pwa.shortName || name.slice(0, 12),
      description: pwa.description,
      start_url: normalisePath(pwa.startUrl),
      scope: normalisePath(pwa.scope),
      display: pwa.display,
      orientation: pwa.orientation,
      theme_color: pwa.themeColor,
      background_color: pwa.backgroundColor,
      icons,
    };
  }

  /**
   * The Team Inbox app's manifest (WD-SET-038 rule 1), or null while it is off. Icons fall back to the app-wide ones and
   * then to the favicon (size `any`); colours come from the app-wide settings.
   */
  async teamInboxManifest(): Promise<Record<string, unknown> | null> {
    const [ti, pwa, g, b] = await Promise.all([
      this.settings.values('tiPwa'),
      this.settings.values('pwa'),
      this.settings.values('general'),
      this.settings.values('branding'),
    ]);
    if (!ti.enabled) return null;
    const i192 = ti.icon192 || pwa.icon192;
    const i512 = ti.icon512 || pwa.icon512;
    const icons: Array<Record<string, string>> = [];
    if (i192) icons.push({ src: i192, sizes: '192x192', type: await this.iconType(i192) });
    if (i512) icons.push({ src: i512, sizes: '512x512', type: await this.iconType(i512) });
    if (icons.length === 0 && b.faviconUrl) {
      icons.push({ src: b.faviconUrl, sizes: 'any', type: await this.iconType(b.faviconUrl) });
    }
    return {
      name: ti.name || `${g.appName} Inbox`,
      short_name: (ti.shortName || 'Inbox').slice(0, 12),
      description: 'Your shared team inbox - chat with customers on the go.',
      start_url: '/team-inbox',
      scope: '/team-inbox',
      display: 'standalone',
      orientation: 'portrait',
      theme_color: pwa.themeColor,
      background_color: pwa.backgroundColor,
      icons,
    };
  }

  /** robots.txt (WD-SET-028): see `buildRobotsTxt` for the one place it differs from WaDesk. */
  async robots(): Promise<string> {
    const [seo, g] = await Promise.all([
      this.settings.values('seo'),
      this.settings.values('general'),
    ]);
    return buildRobotsTxt({ baseUrl: g.appUrl, robotsDirective: seo.robots });
  }
}

/** A start URL or scope always begins with one slash (WD-SET-035 normalisation). */
export function normalisePath(p: string): string {
  const t = p.trim();
  if (t === '') return '/';
  if (/^https?:\/\//i.test(t)) return t;
  return '/' + t.replace(/^\/+/, '');
}
