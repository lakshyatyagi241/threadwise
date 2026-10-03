import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { guidebookBrowseResponseSchema } from '@crm/contracts';
import { GuidebookSidebar } from '@/features/marketing-site-cms/guidebook/sidebar';
import { userCms } from '@/features/marketing-site-cms/guidebook/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketing-site-cms.guidebook');
  return { title: t('title') };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const POPULAR = ['popular1', 'popular2', 'popular3', 'popular4'] as const;

/** The in-app help centre (WD-CMS-047): category rail, search, article cards. Content is the same for every workspace. */
export default async function GuidebookIndex({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const category = one(sp.category);
  const q = one(sp.q);
  const cursor = one(sp.cursor);
  const missing = one(sp.missing) === '1';
  const t = await getTranslations('marketing-site-cms.guidebook');
  const res = await userCms('/guidebook', guidebookBrowseResponseSchema, { category, q, cursor });
  const next = res?.page.hasMore ? res.page.nextCursor : null;
  const more = () => {
    const p = new URLSearchParams();
    if (category) p.set('category', category);
    if (q) p.set('q', q);
    p.set('cursor', next!);
    return `/guidebook?${p}`;
  };
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
          <p className="text-sm text-muted-foreground">{t('lead')}</p>
        </div>
        <Link href="/support" className="text-sm underline">
          {t('askSupport')}
        </Link>
      </header>
      {missing && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {t('notFound')}
        </p>
      )}
      <div className="flex flex-col gap-6 md:flex-row">
        <GuidebookSidebar
          categories={res?.categories ?? []}
          total={res?.totalPublished ?? 0}
          active={category}
        />
        <div className="min-w-0 flex-1 space-y-4">
          <form action="/guidebook" role="search" className="flex flex-wrap gap-2">
            <input
              name="q"
              defaultValue={q}
              placeholder={t('search')}
              aria-label={t('search')}
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm"
            />
            {category && <input type="hidden" name="category" value={category} />}
            <button type="submit" className="h-9 rounded-md border border-border px-3 text-sm">
              {t('searchButton')}
            </button>
          </form>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">{t('popular')}</span>
            {POPULAR.map((k) => (
              <Link
                key={k}
                href={`/guidebook?q=${encodeURIComponent(t(k))}`}
                className="rounded-full border border-border px-2.5 py-1 hover:bg-muted"
              >
                {t(k)}
              </Link>
            ))}
          </div>
          <h2 className="text-sm font-semibold">
            {category ?? t('allArticles')}{' '}
            <span className="font-normal text-muted-foreground">
              {t('count', { count: res?.data.length ?? 0 })}
            </span>
          </h2>
          {!res || res.data.length === 0 ? (
            <p className="text-muted-foreground">{t('none')}</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2" data-testid="guidebook-cards">
              {res.data.map((a) => (
                <Link
                  key={a.slug}
                  href={`/guidebook/${a.slug}`}
                  className="flex flex-col gap-2 rounded-lg border border-border p-4 hover:bg-muted"
                >
                  <span className="text-xs text-muted-foreground">
                    {a.category} · {t('readMinutes', { count: a.readMinutes })}
                  </span>
                  <span className="font-semibold">{a.title}</span>
                  {a.excerpt && <span className="text-sm text-muted-foreground">{a.excerpt}</span>}
                  <span className="mt-auto text-sm text-primary">{t('read')}</span>
                </Link>
              ))}
            </div>
          )}
          {next && (
            <Link href={more()} className="inline-block text-sm underline">
              {t('more')}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
