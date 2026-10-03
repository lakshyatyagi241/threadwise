import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { cn } from '@crm/ui';

/** The category rail of the help centre: "All articles" and one row per category with its all-time count. */
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
          'flex items-center justify-between rounded-md px-3 py-2 text-sm',
          on ? 'bg-primary/10 font-semibold text-primary' : 'hover:bg-muted',
        )}
      >
        <span className="truncate">{label}</span>
        <span className="ms-2 text-xs text-muted-foreground">{count}</span>
      </Link>
    </li>
  );
  return (
    <nav aria-label={t('categories')} className="md:w-64 md:shrink-0">
      <ul className="space-y-0.5">
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
      <div className="mt-4 space-y-1 rounded-md border border-border p-3 text-sm">
        <p className="font-medium">{t('needHuman')}</p>
        <Link href="/support" className="text-primary underline">
          {t('contactSupport')}
        </Link>
      </div>
    </nav>
  );
}
