import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { blogPostPublicSchema } from '@crm/contracts';
import { PostCard, PostMeta } from '@/features/marketing-site-cms/geta/blog';
import { pageMeta } from '@/features/marketing-site-cms/geta/seo';
import { Cta, CtaBand, Section, Wrap } from '@/features/marketing-site-cms/geta/ui';
import { cmsPublic } from '@/features/marketing-site-cms/public/api';
import { getSiteConfig } from '@/features/platform-settings-branding-storage/site/site-config';

type Props = { params: Promise<{ slug: string }> };

const load = async (slug: string) =>
  cmsPublic(`/blog/${encodeURIComponent(slug)}`, blogPostPublicSchema);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await load(slug);
  if (!post) return {};
  const meta = await pageMeta({
    path: `/blog/${slug}`,
    title: post.seo.title,
    description: post.seo.description,
  });
  // What the author set in the editor wins over the defaults.
  return {
    ...meta,
    alternates: post.seo.canonicalUrl ? { canonical: post.seo.canonicalUrl } : meta.alternates,
    robots: post.seo.noindex ? { index: false, follow: false } : undefined,
    openGraph: {
      ...meta.openGraph,
      type: 'article',
      publishedTime: post.publishedAt ?? undefined,
      images: post.seo.ogImage ?? post.featuredImage ?? undefined,
    },
  };
}

/** One public post (TW-CMS-012). The body is HTML the API sanitised on write. */
export default async function BlogPost({ params }: Props) {
  const post = await load((await params).slug);
  if (!post) notFound();
  const t = await getTranslations('marketing-site-cms.site');
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
      <article>
        <header className="gx-hero gx-hero-plain">
          <Wrap>
            <div className="bl-head">
              <nav className="gx-crumb" aria-label="Breadcrumb">
                <Link href="/">{t('pages.home')}</Link> / <Link href="/blog">{t('blog')}</Link>
              </nav>
              {post.category && (
                <div className="bl-tags">
                  <Link href={`/blog?category=${post.category.slug}`} className="bl-cat">
                    {post.category.name}
                  </Link>
                </div>
              )}
              <h1 className="gx-h1">{post.title}</h1>
              {post.excerpt && <p className="gx-lead">{post.excerpt}</p>}
              <PostMeta post={{ ...post, authorName: post.authorName || brand }} />
            </div>
          </Wrap>
        </header>

        <Section label="Article">
          {post.featuredImage && (
            <div className="bl-hero-img">
              <img src={post.featuredImage} alt={post.title} decoding="async" />
            </div>
          )}
          <div
            className="gx-article"
            style={post.featuredImage ? { marginTop: 44 } : undefined}
            dangerouslySetInnerHTML={{ __html: post.body }}
          />
          {post.tags.length > 0 && (
            <div className="bl-article-tags">
              {post.tags.map((tag) => (
                <span key={tag}>#{tag}</span>
              ))}
            </div>
          )}
        </Section>
      </article>

      {post.related.length > 0 && (
        <Section soft label="Related articles">
          <div className="gx-sec-head">
            <h2 className="gx-h2">
              {t('keepReadingA')} {t('keepReadingB')}
            </h2>
          </div>
          <div className="bl-grid">
            {post.related.map((p) => (
              <PostCard key={p.slug} post={p} />
            ))}
          </div>
          <div className="bl-more-row">
            <Cta href="/blog" variant="ghost">
              {t('allPosts')}
            </Cta>
          </div>
        </Section>
      )}

      <CtaBand />
    </>
  );
}
