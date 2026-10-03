import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { guidebookArticleSchema, guidebookBrowseResponseSchema } from '@crm/contracts';
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
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <Link href="/guidebook" className="text-sm underline">
        {t('back')}
      </Link>
      <div className="flex flex-col gap-6 md:flex-row">
        <GuidebookSidebar
          categories={list?.categories ?? []}
          total={list?.totalPublished ?? 0}
          active={article.category}
        />
        <article className="min-w-0 max-w-3xl flex-1 space-y-5">
          <header className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              <Link href={`/guidebook?category=${encodeURIComponent(article.category)}`}>
                {article.category}
              </Link>{' '}
              · {t('readMinutes', { count: article.readMinutes })} · {t('updated')}{' '}
              {fmt.relativeTime(new Date(article.updatedAt))}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">{article.title}</h1>
          </header>
          <div
            className="space-y-4 leading-relaxed [&_a]:underline [&_blockquote]:border-s-4 [&_blockquote]:border-border [&_blockquote]:ps-4 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:ps-6 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc [&_ul]:ps-6"
            dangerouslySetInnerHTML={{ __html: article.bodyHtml }}
          />
          <VoteButtons slug={article.slug} initial={article.myVote} />
          <p className="text-sm text-muted-foreground">
            {t('stuck')}{' '}
            <Link href="/support" className="underline">
              {t('openTicket')}
            </Link>
          </p>
          {article.related.length > 0 && (
            <section className="space-y-3 border-t border-border pt-4">
              <h2 className="text-lg font-semibold">{t('related')}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {article.related.map((a) => (
                  <Link
                    key={a.slug}
                    href={`/guidebook/${a.slug}`}
                    className="rounded-lg border border-border p-3 hover:bg-muted"
                  >
                    <span className="block text-xs text-muted-foreground">{a.category}</span>
                    <span className="font-medium">{a.title}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </article>
      </div>
    </div>
  );
}
