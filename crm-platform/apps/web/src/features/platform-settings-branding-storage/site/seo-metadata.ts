import type { Metadata, Viewport } from 'next';
import type { PublicSiteConfig } from '@crm/contracts';

/**
 * The site-wide tags (TW-SET-027, 036) as Next metadata. A blank value is "not set" and falls back or is left out (Reference
 * stored blanks as empty strings and then printed empty tags, a QUIRK the port does not copy). Always present: the site
 * name, `og:title`, `og:type`, `twitter:card` and `twitter:title`.
 */
const at = (h: string) =>
  h.trim() === '' ? undefined : h.trim().startsWith('@') ? h.trim() : `@${h.trim()}`;
const some = (s: string) => (s.trim() === '' ? undefined : s.trim());

export function siteMetadata(cfg: PublicSiteConfig): Metadata {
  const { seo, brand, pwa } = cfg;
  const title = some(seo.title) ?? brand.name;
  const ogTitle = some(seo.ogTitle) ?? title;
  const description = some(seo.description);
  const ogDescription = some(seo.ogDescription) ?? description;
  const image = some(seo.ogImage);
  const url = some(seo.ogUrl) ?? some(seo.canonical);
  const other: Record<string, string> = {};
  if (some(seo.bingVerification)) other['msvalidate.01'] = seo.bingVerification.trim();
  if (pwa.enabled) {
    // iOS home-screen tags next to the manifest (rule 3 of TW-SET-036).
    other['apple-mobile-web-app-capable'] = 'yes';
    other['apple-mobile-web-app-status-bar-style'] = 'black-translucent';
    other['apple-mobile-web-app-title'] = pwa.shortName;
  }
  const icon = some(brand.faviconUrl);
  const touch = some(pwa.appleTouchIcon);

  return {
    title: { default: title, template: `%s - ${brand.name}` },
    description,
    keywords: some(seo.keywords),
    authors: some(seo.author) ? [{ name: seo.author.trim() }] : undefined,
    robots: some(seo.robots),
    alternates: some(seo.canonical) ? { canonical: seo.canonical.trim() } : undefined,
    openGraph: {
      siteName: brand.name,
      title: ogTitle,
      description: ogDescription,
      type: (seo.ogType as 'website' | 'article') || 'website',
      url,
      images: image ? [{ url: image, width: 1200, height: 630 }] : undefined,
    },
    twitter: {
      card: (seo.twitterCard as 'summary_large_image') || 'summary_large_image',
      title: ogTitle,
      description: ogDescription,
      site: at(seo.twitterSite),
      creator: at(seo.twitterCreator),
      images: image ? [image] : undefined,
    },
    verification: some(seo.googleVerification)
      ? { google: seo.googleVerification.trim() }
      : undefined,
    icons: {
      icon: icon ? [{ url: icon }] : undefined,
      apple: pwa.enabled && touch ? [{ url: touch }] : undefined,
    },
    manifest: pwa.enabled ? '/manifest.webmanifest' : undefined,
    other: Object.keys(other).length ? other : undefined,
  };
}

/** The address-bar tint of an installed app: only while the PWA switch is on. */
export function siteViewport(cfg: PublicSiteConfig): Viewport {
  return cfg.pwa.enabled ? { themeColor: cfg.pwa.themeColor } : {};
}
