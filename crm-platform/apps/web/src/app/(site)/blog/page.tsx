import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { blogIndexResponseSchema } from '@crm/contracts';
import { BlogCardView } from '@/features/marketing-site-cms/public/blog-card';
import { cmsPublic } from '@/features/marketing-site-cms/public/api';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketing-site-cms.site');
  return { title: t('blogTitle'), description: t('blogLead') };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The public blog index (WD-CMS-011): search, category filter, featured post, keyset "older posts" link. */
export default async function BlogIndex({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const category = one(sp.category);
  const q = one(sp.q);
  const cursor = one(sp.cursor);
  const t = await getTranslations('marketing-site-cms.site');
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

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t('blogTitle')}</h1>
        <p className="text-muted-foreground">{t('blogLead')}</p>
      </header>
      <form action="/blog" role="search" className="flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm"
        />
        {category && <input type="hidden" name="category" value={category} />}
        <button type="submit" className="h-9 rounded-md border border-border px-3 text-sm">
          {t('searchButton')}
        </button>
      </form>
      {res && res.categories.length > 0 && (
        <nav className="flex flex-wrap gap-2 text-sm" aria-label={t('allCategories')}>
          <Link href="/blog" className={category ? 'underline' : 'font-semibold'}>
            {t('allCategories')}
          </Link>
          {res.categories.map((c) => (
            <Link
              key={c.slug}
              href={`/blog?category=${c.slug}`}
              className={category === c.slug ? 'font-semibold' : 'underline'}
            >
              {c.name}
            </Link>
          ))}
        </nav>
      )}
      {featured && (
        <section aria-label={t('featured')}>
          <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
            {t('featured')}
          </p>
          <BlogCardView post={featured} />
        </section>
      )}
      {!res || res.data.length === 0 ? (
        <p className="text-muted-foreground">{t('noPosts')}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {res.data.map((p) => (
            <BlogCardView key={p.slug} post={p} />
          ))}
        </div>
      )}
      {next && (
        <Link href={href(next)} className="inline-block text-sm underline">
          {t('olderPosts')}
        </Link>
      )}
    </div>
  );
}
