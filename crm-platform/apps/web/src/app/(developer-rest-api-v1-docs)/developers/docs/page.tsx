import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { getSiteConfig } from '@/features/platform-settings-branding-storage/site/site-config';
import { DocsPage } from '@/features/developer-rest-api-v1/docs/components/docs-page';
import { loadDocs, publicApiOrigin } from '@/features/developer-rest-api-v1/docs/lib/load-spec';
import { brandFromTitle } from '@/features/developer-rest-api-v1/docs/lib/spec-model';
import { baseUrlOf } from '@/features/developer-rest-api-v1/lib/keys-model';

/** The brand: the site settings' name, else the one in the OpenAPI title, else none (the page then reads "API"). */
async function brandOf(title: string): Promise<string> {
  return (await getSiteConfig())?.brand.name || brandFromTitle(title) || 'API';
}

/** Public page (TW-API-149): no login, and kept out of search results as Reference's `noindex` meta does. */
export async function generateMetadata(): Promise<Metadata> {
  const [t, data] = await Promise.all([getTranslations('developer-rest-api-v1-docs'), loadDocs()]);
  const brand = await brandOf(data.status === 'unavailable' ? '' : data.reference.title);
  return {
    title: { absolute: t('metaTitle', { brand }) },
    description: t('metaDescription', { brand }),
    robots: { index: false, follow: false },
  };
}

export default async function DeveloperDocsPage() {
  const data = await loadDocs();
  const origin = publicApiOrigin();
  const brand = await brandOf(data.status === 'unavailable' ? '' : data.reference.title);
  return (
    <DocsPage
      data={data}
      brand={brand}
      baseUrl={baseUrlOf(origin)}
      specUrl={`${origin.replace(/\/+$/, '')}/docs/api.json`}
    />
  );
}
