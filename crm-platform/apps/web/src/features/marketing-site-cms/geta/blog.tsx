import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { BlogCard } from '@crm/contracts';
import { Icon } from './icons';
import './blog.css';

/** Soft tints for a post that has no picture, picked from its category so a category looks the same everywhere. */
const HUES = ['#4338ca', '#0284c7', '#0f9488', '#d97706', '#7c3aed', '#db2777'];
const hueOf = (key: string) => {
  let n = 0;
  for (const ch of key) n = (n * 31 + ch.charCodeAt(0)) % 997;
  return HUES[n % HUES.length]!;
};

/** The picture of a post, or a soft tinted tile with the Geta mark's feel when it has none. */
export function PostCover({
  post,
  className = '',
}: {
  post: Pick<BlogCard, 'featuredImage' | 'title' | 'category' | 'slug'>;
  className?: string;
}) {
  const hue = hueOf(post.category?.slug ?? post.slug);
  return (
    <div
      className={`bl-cover ${className}`}
      style={post.featuredImage ? undefined : ({ ['--h' as string]: hue } as React.CSSProperties)}
    >
      {post.featuredImage ? (
        <img src={post.featuredImage} alt={post.title} loading="lazy" decoding="async" />
      ) : (
        <span className="bl-ph" aria-hidden>
          <Icon name="doc" />
        </span>
      )}
    </div>
  );
}

/** Date and reading time under a post title. */
export async function PostMeta({
  post,
}: {
  post: Pick<BlogCard, 'publishedAt' | 'readMinutes' | 'authorName'>;
}) {
  const t = await getTranslations('marketing-site-cms.site');
  const fmt = await getFormatter();
  return (
    <div className="bl-meta">
      {post.authorName && <span>{post.authorName}</span>}
      {post.publishedAt && (
        <time dateTime={post.publishedAt}>
          {fmt.dateTime(new Date(post.publishedAt), { dateStyle: 'medium' })}
        </time>
      )}
      <span>{t('readMinutes', { count: post.readMinutes })}</span>
    </div>
  );
}

/** One post in a list; `lead` makes it the wide card at the top of the blog. */
export async function PostCard({ post, lead = false }: { post: BlogCard; lead?: boolean }) {
  const t = await getTranslations('marketing-site-cms.site');
  const hue = hueOf(post.category?.slug ?? post.slug);
  return (
    <Link
      href={`/blog/${post.slug}`}
      className={`bl-card${lead ? ' bl-lead' : ''}`}
      style={{ ['--h' as string]: hue } as React.CSSProperties}
    >
      <PostCover post={post} />
      <div className="bl-body">
        <div className="bl-tags">
          {lead && <span className="bl-feat">{t('featured')}</span>}
          {post.category && <span className="bl-cat">{post.category.name}</span>}
        </div>
        <h3>{post.title}</h3>
        {post.excerpt && <p>{post.excerpt}</p>}
        <PostMeta post={post} />
        {lead && (
          <span className="bl-more">
            {t('readMore')}
            <Icon name="arrow" />
          </span>
        )}
      </div>
    </Link>
  );
}
