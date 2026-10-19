import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { blogIndexResponseSchema } from '@crm/contracts';
import { BlogCardView, PostImage } from '@/features/marketing-site-cms/public/blog-card';
import { cmsPublic } from '@/features/marketing-site-cms/public/api';
import { getSiteConfig } from '@/features/platform-settings-branding-storage/site/site-config';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketing-site-cms.site');
  return { title: t('blogTitle'), description: t('blogLead') };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The public blog index (TW-CMS-011): hero, featured post, category filter, post grid, keyset "older posts" link. */
export default async function BlogIndex({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const category = one(sp.category);
  const q = one(sp.q);
  const cursor = one(sp.cursor);
  const t = await getTranslations('marketing-site-cms.site');
  const fmt = await getFormatter();
  const site = await getSiteConfig();
  const res = await cmsPublic('/blog', blogIndexResponseSchema, { category, q, cursor });
  const featured = res?.featured && !cursor && !category && !q ? res.featured : null;
  const next = res?.page.hasMore && res.page.nextCursor ? res.page.nextCursor : null;
  const href = (c: string) => {
    const p = new URLSearchParams();
    if (category) p.set('category', category);
    if (q) p.set('q', q);
    p.set('cursor', c);
    return `/blog?${p.toString()}`;
  };
  const pill = (on: boolean) =>
    `mono rounded-full px-4 py-1.5 text-[12px] transition ${on ? 'bg-wa-deep text-paper-0' : 'hairline bg-white text-ink-700 hover:border-wa-deep hover:text-wa-deep'}`;

  return (
    <>
      <section className="relative overflow-hidden bg-paper-0">
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-30" />
        <div className="blur-bub absolute -end-32 -top-32 h-[520px] w-[520px] rounded-full bg-wa-mint/50" />
        <div className="blur-bub absolute -bottom-40 -start-32 h-[460px] w-[460px] rounded-full bg-accent-amber/15" />
        <div className="relative mx-auto max-w-[1360px] px-4 pb-12 pt-24 sm:px-6 lg:px-7">
          <div className="hairline mono inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[11px] uppercase tracking-widest text-ink-700">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-wa-green" />
            <span>{t('blogEyebrow', { brand: site?.brand.name ?? '' })}</span>
          </div>
          <h1 className="serif reveal mt-6 text-[44px] leading-[0.94] tracking-[-0.025em] sm:text-[72px] lg:text-[96px]">
            {t('blogHeadlineA')} <em>{t('blogHeadlineB')}</em>.
          </h1>
          <p className="reveal mt-5 max-w-2xl text-[15.5px] leading-relaxed text-ink-700">
            {t('blogLead')}
          </p>
        </div>
      </section>

      {featured && (
        <section className="bg-white">
          <div className="mx-auto max-w-[1360px] px-4 pb-4 sm:px-6 lg:px-7">
            <Link
              href={`/blog/${featured.slug}`}
              className="reveal group hairline grid grid-cols-1 items-center gap-8 overflow-hidden rounded-3xl bg-paper-50 transition hover:border-wa-deep lg:grid-cols-2"
            >
              <PostImage
                src={featured.featuredImage}
                alt={featured.title}
                className="aspect-[16/10] min-h-[280px] overflow-hidden lg:aspect-auto lg:h-full"
                zoom="group-hover:scale-[1.03]"
              />
              <div className="p-7 lg:p-10">
                <div className="mono mb-4 flex items-center gap-3 text-[11px] uppercase tracking-widest text-ink-500">
                  <span className="hairline rounded-full bg-white px-2.5 py-1 text-wa-deep">
                    {t('featured')}
                  </span>
                  {featured.category && <span>{featured.category.name}</span>}
                </div>
                <h2 className="serif text-[32px] leading-[1.0] tracking-[-0.02em] transition group-hover:text-wa-deep sm:text-[44px]">
                  {featured.title}
                </h2>
                {featured.excerpt && (
                  <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-700">
                    {featured.excerpt}
                  </p>
                )}
                <div className="mono mt-6 flex items-center gap-3 text-[11.5px] text-ink-500">
                  <span>
                    {featured.publishedAt &&
                      fmt.dateTime(new Date(featured.publishedAt), { dateStyle: 'medium' })}
                  </span>
                  <span className="text-ink-400">·</span>
                  <span>{t('readMinutes', { count: featured.readMinutes })}</span>
                </div>
                <span className="mt-6 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-wa-deep">
                  {t('readMore')}
                  <svg
                    viewBox="0 0 16 16"
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                  >
                    <path d="M5 4l4 4-4 4" />
                  </svg>
                </span>
              </div>
            </Link>
          </div>
        </section>
      )}

      <section className="bg-white">
        <div className="mx-auto max-w-[1360px] px-4 py-12 sm:px-6 lg:px-7">
          {res && res.categories.length > 0 && (
            <nav className="mb-10 flex flex-wrap gap-2" aria-label={t('allCategories')}>
              <Link href="/blog" className={pill(!category)}>
                {t('all')}
              </Link>
              {res.categories.map((c) => (
                <Link
                  key={c.slug}
                  href={`/blog?category=${c.slug}`}
                  className={pill(category === c.slug)}
                >
                  {c.name}
                </Link>
              ))}
            </nav>
          )}
          {res && res.data.length > 0 ? (
            <>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {res.data.map((p) => (
                  <BlogCardView key={p.slug} post={p} />
                ))}
              </div>
              {next && (
                <div className="mt-12">
                  <Link href={href(next)} className={pill(false)}>
                    {t('olderPosts')} →
                  </Link>
                </div>
              )}
            </>
          ) : (
            <div className="hairline rounded-3xl bg-paper-50 px-6 py-20 text-center">
              <div className="serif text-[28px] text-ink-900">{t('nothingYet')}</div>
              <p className="mt-2 text-[14px] text-ink-600">{t('nothingYetBody')}</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
