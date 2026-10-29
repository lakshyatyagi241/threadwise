import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { blogIndexResponseSchema } from '@crm/contracts';
import { PostCard } from '@/features/marketing-site-cms/geta/blog';
import { pageMeta } from '@/features/marketing-site-cms/geta/seo';
import { Cta, CtaBand, Section, Wrap } from '@/features/marketing-site-cms/geta/ui';
import { cmsPublic } from '@/features/marketing-site-cms/public/api';
import { getSiteConfig } from '@/features/platform-settings-branding-storage/site/site-config';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const t = await getTranslations('marketing-site-cms.site');
  const sp = await searchParams;
  const meta = await pageMeta({
    path: '/blog',
    title: `${t('blogTitle')}: guides and ideas for talking to customers`,
    description: t('blogLead'),
  });
  // A filtered or paged list is the same blog; only the plain list is worth indexing.
  const filtered = !!(one(sp.category) || one(sp.q) || one(sp.cursor));
  return filtered ? { ...meta, robots: { index: false, follow: true } } : meta;
}

/** The public blog index (TW-CMS-011): header with search, the featured post, category filter, post grid, keyset "older posts" link. */
export default async function BlogIndex({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const category = one(sp.category);
  const q = one(sp.q);
  const cursor = one(sp.cursor);
  const t = await getTranslations('marketing-site-cms.site');
  const site = await getSiteConfig();
  const res = await cmsPublic('/blog', blogIndexResponseSchema, { category, q, cursor });
  const featured = res?.featured && !cursor && !category && !q ? res.featured : null;
  const posts = res?.data.filter((p) => p.slug !== featured?.slug) ?? [];
  const next = res?.page.hasMore && res.page.nextCursor ? res.page.nextCursor : null;
  const href = (c: string) => {
    const p = new URLSearchParams();
    if (category) p.set('category', category);
    if (q) p.set('q', q);
    p.set('cursor', c);
    return `/blog?${p.toString()}`;
  };

  return (
    <>
      <header className="gx-hero gx-hero-plain">
        <Wrap>
          <div className="gx-hero-grid">
            <div>
              <div className="gx-eyebrow">
                {t('blogEyebrow', { brand: site?.brand.name ?? '' })}
              </div>
              <h1 className="gx-h1">
                {t('blogHeadlineA')} {t('blogHeadlineB')}.
              </h1>
              <p className="gx-lead">{t('blogLead')}</p>
              <form className="bl-search" action="/blog" role="search">
                {category && <input type="hidden" name="category" value={category} />}
                <input
                  type="search"
                  name="q"
                  defaultValue={q ?? ''}
                  placeholder="Search articles"
                  aria-label="Search articles"
                />
                <button type="submit">Search</button>
              </form>
            </div>
          </div>
        </Wrap>
      </header>

      <Section label="Articles">
        {featured && <PostCard post={featured} lead />}
        {res && res.categories.length > 0 && (
          <nav className="bl-pills" aria-label={t('allCategories')}>
            <Link href="/blog" className={`bl-pill${!category ? ' on' : ''}`}>
              {t('all')}
            </Link>
            {res.categories.map((c) => (
              <Link
                key={c.slug}
                href={`/blog?category=${c.slug}`}
                className={`bl-pill${category === c.slug ? ' on' : ''}`}
              >
                {c.name}
              </Link>
            ))}
          </nav>
        )}
        {posts.length > 0 ? (
          <>
            <div className="bl-grid">
              {posts.map((p) => (
                <PostCard key={p.slug} post={p} />
              ))}
            </div>
            {next && (
              <div className="bl-more-row">
                <Cta href={href(next)} variant="ghost" arrow>
                  {t('olderPosts')}
                </Cta>
              </div>
            )}
          </>
        ) : (
          !featured && (
            <div className="bl-empty">
              <b>{t('nothingYet')}</b>
              <p>{t('nothingYetBody')}</p>
            </div>
          )
        )}
      </Section>

      <CtaBand />
    </>
  );
}
