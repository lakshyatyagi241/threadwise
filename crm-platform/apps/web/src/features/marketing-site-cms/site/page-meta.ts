import 'server-only';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CMS_REGISTRY, type CmsPage } from '@crm/contracts';
import { loadSiteContent } from '../public/load';
import { makeFc } from './content';

const stripTags = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Title and description of a marketing page (TW-CMS-016): the page name, and the hero's lead text as the description, so
 * an edit in the site editor reaches the search result too. Site-wide defaults, Open Graph and robots come from the
 * platform settings in the root layout.
 */
export async function pageMetadata(page: CmsPage): Promise<Metadata> {
  const [t, content] = await Promise.all([
    getTranslations('marketing-site-cms.site.pages'),
    loadSiteContent(),
  ]);
  const fc = makeFc(content.values);
  const hero = CMS_REGISTRY[page].sections[0]!;
  const leadKey = hero.fields.find((f) => f.key === 'subtitle' || f.key === 'intro')?.key;
  const description = leadKey ? stripTags(fc(`${page}.hero.${leadKey}`)).slice(0, 300) : undefined;
  return { title: t(page), description: description || undefined };
}
