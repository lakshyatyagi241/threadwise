import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { cn } from '@crm/ui';

/** The category rail of the help centre (Reference's `_sidebar`): "All articles" and one row per category with its all-time count. */
export async function GuidebookSidebar({
  categories,
  total,
  active,
}: {
  categories: Array<{ name: string; count: number }>;
  total: number;
  active?: string;
}) {
  const t = await getTranslations('marketing-site-cms.guidebook');
  const row = (href: string, label: string, count: number, on: boolean) => (
    <li key={href}>
      <Link
        href={href}
        aria-current={on ? 'page' : undefined}
        className={cn(
          'flex w-full items-center justify-between px-4 py-2.5 text-left transition',
          on ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/60',
        )}
      >
        <span className={cn('truncate text-[13px]', on ? 'font-semibold' : 'font-medium')}>
          {label}
        </span>
        <span
          className={cn(
            'ms-2 font-mono text-[10.5px]',
            on ? 'rounded-full bg-primary-foreground/15 px-2 py-0.5' : 'text-muted-foreground',
          )}
        >
          {count}
        </span>
      </Link>
    </li>
  );
  return (
    <aside
      aria-label={t('categories')}
      className="overflow-hidden rounded-[14px] border border-border bg-background shadow-sm xl:sticky xl:top-5"
    >
      <div className="border-b border-border px-4 py-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {t('categories')}
        </div>
      </div>
      <ul className="divide-y divide-border">
        {row('/guidebook', t('allArticles'), total, !active)}
        {categories.map((c) =>
          row(
            `/guidebook?category=${encodeURIComponent(c.name)}`,
            c.name,
            c.count,
            active === c.name,
          ),
        )}
      </ul>
      <div className="border-t border-border bg-muted/40 p-4">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {t('needHuman')}
        </div>
        <Link
          href="/support"
          className="inline-flex items-center gap-2 rounded-full bg-primary px-3.5 py-2 text-[12px] font-semibold text-primary-foreground hover:opacity-90"
        >
          <svg
            viewBox="0 0 16 16"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden
          >
            <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h5A2.5 2.5 0 0 1 13 5.5v3A2.5 2.5 0 0 1 10.5 11H8l-3.5 2v-2A2.5 2.5 0 0 1 3 8.5v-3Z" />
          </svg>
          {t('contactSupport')}
        </Link>
      </div>
    </aside>
  );
}
