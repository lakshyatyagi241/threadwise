import type { Metadata } from 'next';
import { getSiteConfig } from '@/features/platform-settings-branding-storage/site/site-config';

/** The brand as it appears in titles and share previews of the public site. */
export const SITE_NAME = 'Geta.ai';

/** Cut at a word boundary so a title or description never ends mid-word. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  // Prefer ending on a full sentence when one fits well inside the limit.
  const stop = cut.lastIndexOf('. ');
  if (stop > max * 0.55) return cut.slice(0, stop + 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 20)).replace(/[,:;.\-–—]+$/, '')}…`;
}

/**
 * The tags of one public page: a full title of its own (the site-wide template would otherwise append the saved brand
 * name), a description, a canonical address and the share-preview tags. Titles stay under 60 characters and descriptions
 * under 160, so search results do not truncate them.
 */
export async function pageMeta(opts: {
  path: string;
  title: string;
  description: string;
}): Promise<Metadata> {
  const site = await getSiteConfig();
  const base = (site?.brand.url ?? '').replace(/\/+$/, '');
  const title = opts.title.includes(SITE_NAME)
    ? clip(opts.title, 60)
    : `${clip(opts.title, 60 - SITE_NAME.length - 3)} | ${SITE_NAME}`;
  const description = clip(opts.description, 158);
  const url = base ? `${base}${opts.path}` : opts.path;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: SITE_NAME, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  };
}
