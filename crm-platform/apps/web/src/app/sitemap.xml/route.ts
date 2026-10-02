import { buildSitemapXml, sitemapResponseSchema } from '@crm/contracts';
import { apiBase } from '@/lib/auth/server';
import { getSiteConfig } from '@/features/platform-settings-branding-storage/site/site-config';

/**
 * sitemap.xml (WD-SET-028): the static pages, the blog categories and the live, indexable blog posts, listed under the
 * saved site address (the request's own origin when none is saved). Public, cacheable, never behind sign-in.
 */
export async function GET(req: Request) {
  const site = await getSiteConfig();
  const base = site?.brand.url || new URL(req.url).origin;
  let data = { posts: [], categories: [], legal: [] } as ReturnType<
    typeof sitemapResponseSchema.parse
  >;
  try {
    const res = await fetch(`${apiBase()}/v2/public/cms/sitemap`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) data = sitemapResponseSchema.parse(await res.json());
  } catch {
    /* the static pages are still worth listing */
  }
  return new Response(buildSitemapXml({ baseUrl: base, ...data }), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
