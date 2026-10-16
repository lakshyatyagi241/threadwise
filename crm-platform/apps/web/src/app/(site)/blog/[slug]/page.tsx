import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { blogPostPublicSchema } from '@crm/contracts';
import { BlogCardView } from '@/features/marketing-site-cms/public/blog-card';
import { cmsPublic } from '@/features/marketing-site-cms/public/api';
import { getSiteConfig } from '@/features/platform-settings-branding-storage/site/site-config';

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
    openGraph: post.seo.ogImage ? { type: 'article', images: [post.seo.ogImage] } : undefined,
  };
}

/** One public post (TW-CMS-012). The body is HTML the API sanitised on write. */
export default async function BlogPost({ params }: Props) {
  const post = await load((await params).slug);
  if (!post) notFound();
  const t = await getTranslations('marketing-site-cms.site');
  const fmt = await getFormatter();
  const site = await getSiteConfig();
  const brand = site?.brand.name ?? '';
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.seo.description,
    image: post.seo.ogImage ?? post.featuredImage ?? undefined,
    datePublished: post.publishedAt ?? undefined,
    dateModified: post.updatedAt,
    author: { '@type': 'Organization', name: post.authorName || brand },
    publisher: { '@type': 'Organization', name: brand },
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <article className="bg-paper-0">
        <div className="relative overflow-hidden">
          <div className="grid-bg pointer-events-none absolute inset-0 opacity-25" />
          <div className="blur-bub absolute -end-24 -top-28 h-[440px] w-[440px] rounded-full bg-wa-mint/40" />
          <header className="relative mx-auto max-w-[760px] px-4 pb-8 pt-20 sm:px-6">
            <nav className="mono mb-7 flex items-center gap-2 text-[11px] uppercase tracking-widest text-ink-500">
              <Link href="/" className="hover:text-wa-deep">
                {t('pages.home')}
              </Link>
              <span className="text-ink-400">/</span>
              <Link href="/blog" className="hover:text-wa-deep">
                {t('blog')}
              </Link>
              <span className="text-ink-400">/</span>
              <span className="max-w-[220px] truncate normal-case tracking-normal text-ink-700">
                {post.title}
              </span>
            </nav>
            {post.category && (
              <Link
                href={`/blog?category=${post.category.slug}`}
                className="hairline mono mb-5 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[11px] uppercase tracking-widest text-wa-deep hover:border-wa-deep"
              >
                {post.category.name}
              </Link>
            )}
            <h1 className="serif text-[40px] leading-[0.98] tracking-[-0.025em] text-ink-900 sm:text-[56px]">
              {post.title}
            </h1>
            {post.excerpt && (
              <p className="mt-5 text-[17px] leading-relaxed text-ink-700">{post.excerpt}</p>
            )}
            <div className="mono mt-7 flex flex-wrap items-center gap-3 text-[12px] text-ink-500">
              <span className="text-ink-700">{post.authorName || brand}</span>
              <span className="text-ink-400">·</span>
              <span>
                {post.publishedAt &&
                  fmt.dateTime(new Date(post.publishedAt), { dateStyle: 'medium' })}
              </span>
              <span className="text-ink-400">·</span>
              <span>{t('readMinutes', { count: post.readMinutes })}</span>
            </div>
          </header>
        </div>
        {post.featuredImage && (
          <div className="mx-auto max-w-[920px] px-4 sm:px-6">
            <img
              src={post.featuredImage}
              alt={post.title}
              className="w-full rounded-3xl border border-paper-200 object-cover"
            />
          </div>
        )}
        <div className="mx-auto max-w-[760px] px-4 py-12 sm:px-6">
          <div
            className="tw-article max-w-[720px]"
            dangerouslySetInnerHTML={{ __html: post.body }}
          />
          {post.tags.length > 0 && (
            <div className="hairline-t mt-12 flex flex-wrap gap-2 pt-7">
              {post.tags.map((tag) => (
                <span
                  key={tag}
                  className="hairline mono rounded-full bg-white px-3 py-1.5 text-[11.5px] text-ink-700"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </article>

      {post.related.length > 0 && (
        <section className="bg-white">
          <div className="hairline-t mx-auto max-w-[1360px] px-4 py-16 sm:px-6 lg:px-7">
            <div className="mb-8 flex items-end justify-between">
              <h2 className="serif text-[32px] leading-tight tracking-[-0.02em] sm:text-[44px]">
                {t('keepReadingA')} <em>{t('keepReadingB')}</em>
              </h2>
              <Link href="/blog" className="text-[13px] font-semibold text-wa-deep hover:underline">
                {t('allPosts')}
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {post.related.map((p) => (
                <BlogCardView key={p.slug} post={p} compact />
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="bg-paper-0">
        <div className="mx-auto max-w-[1360px] px-4 py-14 text-center sm:px-6 lg:px-7">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 rounded-full bg-wa-deep px-5 py-3 text-[13.5px] font-semibold text-paper-0 hover:bg-wa-teal"
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path d="M11 4l-4 4 4 4" />
            </svg>
            {t('backToAllPosts')}
          </Link>
        </div>
      </section>
    </>
  );
}
