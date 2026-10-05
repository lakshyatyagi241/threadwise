'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { MarketAppKind, MarketCategory } from '@crm/contracts';
import { cn } from '@crm/ui';
import { fetchShelves, mktKeys } from '../api';
import { categoryItems, type BrowseFilters } from '../lib/browse';
import { mktRoutes } from '../lib/routes';
import { AppCard } from './app-card';
import { ErrorPanel, LINK_BUTTON, LoadingBlock } from './ui';

/**
 * The category list of a tab: a vertical list on wide screens, a row of chips that scrolls sideways on narrow ones. Each entry is a
 * link (the selected category lives in the address), "All" first with the sum of the counts.
 */
export function CategoryList({
  kind,
  categories,
  filters,
}: {
  kind: MarketAppKind;
  categories: readonly MarketCategory[];
  filters: BrowseFilters;
}) {
  const t = useTranslations('marketplace.browse');
  const items = categoryItems(kind, categories, filters);
  return (
    <nav aria-label={t('categoriesLabel')}>
      <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
        {items.map((c) => (
          <li key={c.slug ?? '__all'} className="shrink-0">
            <Link
              href={c.href}
              aria-current={c.selected ? 'page' : undefined}
              className={cn(
                'flex items-center justify-between gap-3 rounded-full border px-3 py-1.5 text-sm transition lg:rounded-md lg:border-transparent',
                c.selected
                  ? 'border-primary bg-primary/10 font-medium text-foreground lg:border-transparent lg:bg-muted'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span>{c.name ?? t('all')}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{c.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The compact "Request an integration" box under the grid and in empty states. The search text travels along to prefill the form. */
export function RequestBox({ kind, name }: { kind: MarketAppKind; name?: string }) {
  const t = useTranslations('marketplace.requestBox');
  const href = (() => {
    const p = new URLSearchParams();
    if (name?.trim()) p.set('name', name.trim().slice(0, 80));
    if (kind === 'mini_app') p.set('kind', kind);
    const s = p.toString();
    return `${mktRoutes.requests}${s ? `?${s}` : ''}`;
  })();
  return (
    <aside
      aria-labelledby="mkt-request-box"
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-border bg-muted/40 p-4"
    >
      <div className="min-w-0">
        <h2 id="mkt-request-box" className="text-sm font-semibold">
          {t(`title.${kind}`)}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('message')}</p>
      </div>
      <Link href={href} className={LINK_BUTTON}>
        {t(`action.${kind}`)}
      </Link>
    </aside>
  );
}

/** Featured, Popular and New: a row of cards each, shown only while nothing narrows the list. */
export function Shelves({ kind }: { kind: MarketAppKind }) {
  const t = useTranslations('marketplace.browse');
  const q = useQuery({
    queryKey: mktKeys.shelves(kind),
    queryFn: ({ signal }) => fetchShelves(kind, signal),
    staleTime: 30_000,
  });
  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />;
  const shelves = [
    { id: 'featured', apps: q.data.featured },
    { id: 'popular', apps: q.data.popular },
    { id: 'new', apps: q.data.new },
  ].filter((s) => s.apps.length > 0);
  if (shelves.length === 0) return null;
  return (
    <div className="space-y-6">
      {shelves.map((s) => (
        <section key={s.id} aria-labelledby={`mkt-shelf-${s.id}`} className="space-y-2">
          <h2 id={`mkt-shelf-${s.id}`} className="text-base font-semibold">
            {t(`shelves.${s.id}`)}
          </h2>
          <div className="thin-scrollbar -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
            {s.apps.map((card) => (
              <AppCard key={card.id} card={card} className="w-72 shrink-0 snap-start" />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
