import { buildSitemapXml, sitemapResponseSchema } from '@crm/contracts';

/**
 * Builds sitemap.xml from the public CMS listing and the saved site address, and hands it to the browser as a file named
 * `sitemap.xml` (TW-SET-028). The same builder serves the public `/sitemap.xml`, so the download is what crawlers see.
 */
export async function downloadSitemap(baseUrl: string): Promise<void> {
  const res = await fetch('/api/v2/public/cms/sitemap', {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`sitemap ${res.status}`);
  const data = sitemapResponseSchema.parse(await res.json());
  const xml = buildSitemapXml({
    baseUrl: baseUrl || window.location.origin,
    posts: data.posts,
    categories: data.categories,
    legal: data.legal,
  });
  const href = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
  const a = document.createElement('a');
  a.href = href;
  a.download = 'sitemap.xml';
  a.click();
  URL.revokeObjectURL(href);
}
