import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { blogPostPublicSchema } from '@crm/contracts';
import { BlogCardView } from '@/features/marketing-site-cms/public/blog-card';
import { cmsPublic } from '@/features/marketing-site-cms/public/api';

type Props = { params: Promise<{ slug: string }> };

const load = async (slug: string) =>
  cmsPublic(`/blog/${encodeURIComponent(slug)}`, blogPostPublicSchema);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await load((await params).slug);
  if (!post) return {};
  return {
    title: post.seo.title,
    description: post.seo.description,
    alternates: post.seo.canonicalUrl ? { canonical: post.seo.canonicalUrl } : undefined,
    robots: post.seo.noindex ? { index: false, follow: false } : undefined,
    openGraph: post.seo.ogImage ? { images: [post.seo.ogImage] } : undefined,
  };
}

/** One public post (WD-CMS-012). The body is HTML the API sanitised on write. */
export default async function BlogPost({ params }: Props) {
  const post = await load((await params).slug);
  if (!post) notFound();
  const t = await getTranslations('marketing-site-cms.site');
  const fmt = await getFormatter();
  return (
    <div className="cms-wrap cms-page">
      <article className="mx-auto max-w-3xl space-y-6">
        <Link href="/blog" className="text-sm underline">
          {t('backToBlog')}
        </Link>
        <header className="space-y-2">
          {post.category && (
            <Link
              href={`/blog?category=${post.category.slug}`}
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              {post.category.name}
            </Link>
          )}
          <h1 className="text-3xl font-semibold tracking-tight">{post.title}</h1>
          <p className="text-sm text-muted-foreground">
            {post.authorName && `${post.authorName} · `}
            {post.publishedAt &&
              fmt.dateTime(new Date(post.publishedAt), { dateStyle: 'long' })} ·{' '}
            {t('readMinutes', { count: post.readMinutes })}
          </p>
        </header>
        {post.featuredImage && (
          <img src={post.featuredImage} alt="" className="w-full rounded-md" />
        )}
        <div
          className="space-y-4 leading-relaxed [&_a]:underline [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:ps-6 [&_ul]:list-disc [&_ul]:ps-6"
          dangerouslySetInnerHTML={{ __html: post.body }}
        />
        {post.related.length > 0 && (
          <section className="space-y-3 border-t border-border pt-6">
            <h2 className="text-lg font-semibold">{t('relatedPosts')}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {post.related.map((p) => (
                <BlogCardView key={p.slug} post={p} />
              ))}
            </div>
          </section>
        )}
      </article>
    </div>
  );
}
