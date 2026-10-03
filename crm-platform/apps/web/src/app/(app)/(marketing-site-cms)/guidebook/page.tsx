import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { guidebookBrowseResponseSchema } from '@crm/contracts';
import { GuidebookHeader } from '@/features/marketing-site-cms/guidebook/header';
import { GuidebookSidebar } from '@/features/marketing-site-cms/guidebook/sidebar';
import { userCms } from '@/features/marketing-site-cms/guidebook/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketing-site-cms.guidebook');
  return { title: t('title') };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const POPULAR = ['popular1', 'popular2', 'popular3', 'popular4'] as const;

/** The in-app help centre (TW-CMS-047): category rail, search, article cards. Content is the same for every workspace. */
export default async function GuidebookIndex({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const category = one(sp.category);
  const q = one(sp.q);
  const cursor = one(sp.cursor);
  const missing = one(sp.missing) === '1';
  const t = await getTranslations('marketing-site-cms.guidebook');
  // Reference lists every article on one page; the help centre is small, so one request carries the lot
  const res = await userCms('/guidebook', guidebookBrowseResponseSchema, {
    category,
    q,
    cursor,
    limit: '100',
  });
  const next = res?.page.hasMore ? res.page.nextCursor : null;
  const more = () => {
    const p = new URLSearchParams();
    if (category) p.set('category', category);
    if (q) p.set('q', q);
    p.set('cursor', next!);
    return `/guidebook?${p}`;
  };
  return (
    <>
      <GuidebookHeader
        backHref="/dashboard"
        crumbs={t('crumb')}
        accent={t('heading')}
        rest={t('headingRest')}
      />
      <main className="mx-auto max-w-none px-4 py-6 sm:px-6 lg:px-7">
        {missing && (
          <p role="alert" className="mb-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {t('notFound')}
          </p>
        )}
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
          <GuidebookSidebar
            categories={res?.categories ?? []}
            total={res?.totalPublished ?? 0}
            active={category}
          />
          <div className="min-w-0">
            <div className="mb-5 rounded-[14px] border border-border bg-background p-3 shadow-sm">
              <form action="/guidebook" role="search" className="relative">
                {category && <input type="hidden" name="category" value={category} />}
                <svg
                  viewBox="0 0 16 16"
                  className="absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  aria-hidden
                >
                  <circle cx="7" cy="7" r="5" />
                  <path d="m11 11 3 3" />
                </svg>
                <input
                  name="q"
                  type="search"
                  defaultValue={q}
                  placeholder={t('search')}
                  aria-label={t('search')}
                  className="w-full rounded-lg border border-border bg-background py-3 pe-3 ps-10 text-[13.5px] focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
                />
              </form>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="me-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {t('popular')}
                </span>
                {POPULAR.map((k) => (
                  <Link
                    key={k}
                    href={`/guidebook?q=${encodeURIComponent(t(k))}`}
                    className="rounded-full border border-border px-2.5 py-1 hover:border-primary"
                  >
                    {t(k)}
                  </Link>
                ))}
              </div>
            </div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[20px] font-semibold leading-tight">
                {category ?? t('allArticles')}
              </h2>
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {t('count', { count: res?.data.length ?? 0 })}
              </span>
            </div>
            {!res || res.data.length === 0 ? (
              <div className="rounded-[14px] border border-dashed border-border bg-muted/30 py-12 text-center">
                <div className="text-[18px] font-semibold">{t('noneTitle')}</div>
                <div className="mt-1 text-[12px] text-muted-foreground">{t('none')}</div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="guidebook-cards">
                {res.data.map((a) => (
                  <Link
                    key={a.slug}
                    href={`/guidebook/${a.slug}`}
                    className="group block rounded-[14px] border border-border bg-background p-5 shadow-sm transition hover:border-primary hover:shadow-md"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className="rounded-full bg-wa-mint px-2 py-0.5 font-mono text-[10.5px] text-wa-deep">
                        {a.category}
                      </span>
                      <span className="font-mono text-[10.5px] text-muted-foreground">
                        {t('readMinutes', { count: a.readMinutes })}
                      </span>
                    </div>
                    <h3 className="mb-1.5 text-[18px] font-semibold leading-tight">{a.title}</h3>
                    {a.excerpt && (
                      <p className="text-[12.5px] leading-snug text-muted-foreground">
                        {a.excerpt}
                      </p>
                    )}
                    <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-primary group-hover:underline">
                      {t('read')}
                      <svg
                        viewBox="0 0 16 16"
                        className="size-3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        aria-hidden
                      >
                        <path d="M6 3l5 5-5 5" />
                      </svg>
                    </span>
                  </Link>
                ))}
              </div>
            )}
            {next && (
              <Link href={more()} className="mt-4 inline-block text-sm underline">
                {t('more')}
              </Link>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
