import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { guidebookArticleSchema, guidebookBrowseResponseSchema } from '@crm/contracts';
import { GuidebookHeader } from '@/features/marketing-site-cms/guidebook/header';
import { userCms } from '@/features/marketing-site-cms/guidebook/server';
import { GuidebookSidebar } from '@/features/marketing-site-cms/guidebook/sidebar';
import { VoteButtons } from '@/features/marketing-site-cms/guidebook/vote';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('marketing-site-cms.guidebook');
  return { title: t('title') };
}

/** One help article (TW-CMS-048). A draft or unknown address sends the reader back to the list with a notice. */
export default async function GuidebookArticle({ params }: Props) {
  const { slug } = await params;
  if (!/^[a-z0-9-]+$/.test(slug)) notFound();
  const [article, list] = await Promise.all([
    userCms(`/guidebook/${slug}`, guidebookArticleSchema),
    userCms('/guidebook', guidebookBrowseResponseSchema, {}),
  ]);
  if (!article) redirect('/guidebook?missing=1');
  const t = await getTranslations('marketing-site-cms.guidebook');
  const fmt = await getFormatter();
  return (
    <>
      <GuidebookHeader
        backHref="/guidebook"
        crumbs={`${t('crumb')} / ${article.category}`}
        accent={article.title}
      />
      <main className="mx-auto max-w-none px-4 py-6 sm:px-6 lg:px-7">
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
          <GuidebookSidebar
            categories={list?.categories ?? []}
            total={list?.totalPublished ?? 0}
            active={article.category}
          />
          <article className="min-w-0 rounded-[14px] border border-border bg-background shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-4 py-5 sm:px-7">
              <Link
                href="/guidebook"
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary hover:underline"
              >
                <svg
                  viewBox="0 0 16 16"
                  className="size-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  aria-hidden
                >
                  <path d="M10 4l-4 4 4 4" />
                </svg>
                {t('back')}
              </Link>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="font-mono text-muted-foreground">
                  {t('readMinutes', { count: article.readMinutes })}
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">
                  {t('updated')} {fmt.relativeTime(new Date(article.updatedAt))}
                </span>
              </div>
            </div>
            <div className="px-4 py-6 sm:px-7">
              <div className="mb-3 flex items-center gap-2">
                <Link
                  href={`/guidebook?category=${encodeURIComponent(article.category)}`}
                  className="rounded-full bg-wa-mint px-2 py-0.5 font-mono text-[10.5px] text-wa-deep"
                >
                  {article.category}
                </Link>
              </div>
              <h2 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">
                {article.title}
              </h2>
              <div
                className="mt-5 max-w-[760px] space-y-4 text-[14px] leading-[1.7] text-foreground/80 [&_a]:text-primary [&_a]:underline [&_blockquote]:border-s-4 [&_blockquote]:border-border [&_blockquote]:ps-4 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:ps-6 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc [&_ul]:ps-6"
                dangerouslySetInnerHTML={{ __html: article.bodyHtml }}
              />
              <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
                <VoteButtons slug={article.slug} initial={article.myVote} />
                <Link
                  href="/support"
                  className="text-[12px] font-semibold text-primary hover:underline"
                >
                  {t('stuck')} {t('openTicket')}
                </Link>
              </div>
            </div>
            {article.related.length > 0 && (
              <div className="rounded-b-[14px] border-t border-border bg-muted/30 px-4 py-5 sm:px-7">
                <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {t('related')}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {article.related.slice(0, 4).map((a) => (
                    <Link
                      key={a.slug}
                      href={`/guidebook/${a.slug}`}
                      className="block rounded-[10px] border border-border bg-background p-4 transition hover:border-primary"
                    >
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="rounded-full bg-wa-mint px-2 py-0.5 font-mono text-[10.5px] text-wa-deep">
                          {a.category}
                        </span>
                        <span className="font-mono text-[10.5px] text-muted-foreground">
                          {t('readMinutes', { count: a.readMinutes })}
                        </span>
                      </div>
                      <div className="text-[15px] font-semibold leading-tight">{a.title}</div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </article>
        </div>
      </main>
    </>
  );
}
