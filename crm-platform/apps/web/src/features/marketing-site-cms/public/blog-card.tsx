import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { BlogCard } from '@crm/contracts';

/** The picture of a post, or Reference's brand gradient when it has none. */
export function PostImage({
  src,
  alt,
  className = 'aspect-[16/10] overflow-hidden',
  zoom = 'group-hover:scale-[1.04]',
}: {
  src: string | null;
  alt: string;
  className?: string;
  zoom?: string;
}) {
  return (
    <div className={className}>
      {src ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className={`h-full w-full object-cover transition duration-500 ${zoom}`}
        />
      ) : (
        <div className="h-full min-h-[inherit] w-full bg-gradient-to-br from-wa-deep via-wa-teal to-wa-green" />
      )}
    </div>
  );
}

/** One post in a list: image, category, title, excerpt, date and reading time (Reference's blog card). */
export async function BlogCardView({
  post,
  compact = false,
}: {
  post: BlogCard;
  compact?: boolean;
}) {
  const t = await getTranslations('marketing-site-cms.site');
  const fmt = await getFormatter();
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="reveal group hairline flex flex-col overflow-hidden rounded-3xl bg-paper-50 transition hover:border-wa-deep"
    >
      <PostImage src={post.featuredImage} alt={post.title} />
      <div className="flex flex-1 flex-col p-6">
        {post.category && (
          <div className="mono mb-2 text-[10px] uppercase tracking-widest text-ink-500">
            {post.category.name}
          </div>
        )}
        <h3
          className={`serif leading-tight transition group-hover:text-wa-deep ${compact ? 'text-[22px]' : 'text-[24px] tracking-[-0.01em]'}`}
        >
          {post.title}
        </h3>
        {!compact && post.excerpt && (
          <p className="mt-3 line-clamp-3 text-[13px] leading-relaxed text-ink-700">
            {post.excerpt}
          </p>
        )}
        <div className="mono mt-auto flex items-center gap-2.5 pt-5 text-[11px] text-ink-500">
          <span>
            {post.publishedAt && fmt.dateTime(new Date(post.publishedAt), { dateStyle: 'medium' })}
          </span>
          <span className="text-ink-400">·</span>
          <span>{t('readMinutes', { count: post.readMinutes })}</span>
        </div>
      </div>
    </Link>
  );
}
