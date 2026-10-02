import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { BlogCard } from '@crm/contracts';

/** One post in a list: image, category, title, excerpt, date and reading time. */
export async function BlogCardView({ post }: { post: BlogCard }) {
  const t = await getTranslations('marketing-site-cms.site');
  const fmt = await getFormatter();
  return (
    <article className="flex flex-col gap-2 rounded-md border border-border p-4">
      {post.featuredImage && (
        <img
          src={post.featuredImage}
          alt=""
          loading="lazy"
          className="aspect-video w-full rounded object-cover"
        />
      )}
      {post.category && (
        <Link
          href={`/blog?category=${post.category.slug}`}
          className="text-xs uppercase tracking-wide text-muted-foreground"
        >
          {post.category.name}
        </Link>
      )}
      <h2 className="text-lg font-semibold">
        <Link href={`/blog/${post.slug}`} className="hover:underline">
          {post.title}
        </Link>
      </h2>
      {post.excerpt && <p className="text-sm text-muted-foreground">{post.excerpt}</p>}
      <p className="mt-auto text-xs text-muted-foreground">
        {post.publishedAt && fmt.dateTime(new Date(post.publishedAt), { dateStyle: 'medium' })} ·{' '}
        {t('readMinutes', { count: post.readMinutes })}
      </p>
    </article>
  );
}
