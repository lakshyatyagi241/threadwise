'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { MAX_TABS } from './console-layout';
import { activeStatusBadge, formatCount, type ConsoleGroup, type ConsoleLeaf } from './console-nav';
import type { ConsoleCounts } from './console-counts';

const tabClass = (active: boolean) =>
  cn(
    'inline-flex min-h-9 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-1.5 text-sm font-medium transition',
    'focus-visible:ring-2 focus-visible:ring-primary',
    active
      ? 'border-primary text-foreground'
      : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
  );

/**
 * The tab bar of a hub (docs/specs/admin-menu-hubs.md). Every tab is a link to the page's own address, so bookmarks, permissions
 * and each page's own code are untouched; the shell draws this above whatever page is open. The first `MAX_TABS` pages sit in
 * the bar, the rest (module pages added at run time) under "More". A Settings-style `index` hub has no bar: its pages show a back
 * link to the hub's landing page, which lists them all.
 */
export function HubTabs({
  hub,
  activeId,
  counts,
}: {
  hub: ConsoleGroup;
  activeId: string | null;
  counts: ConsoleCounts;
}) {
  const t = useTranslations();
  const tc = useTranslations('admin-console-shell.shell');
  const label = t(hub.labelKey);

  if (hub.kind === 'index') {
    const landing = hub.children[0];
    if (!landing || landing.id === activeId) return null;
    return (
      <nav aria-label={label} className="mb-4 text-sm">
        <Link
          href={landing.href}
          data-testid="hub-back"
          className="inline-flex items-center gap-1 rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span aria-hidden="true" className="rtl:-scale-x-100">
            ←
          </span>
          {tc('backToHub', { hub: label })}
        </Link>
      </nav>
    );
  }

  if (hub.children.length < 2) return null;
  const inBar = hub.children.slice(0, MAX_TABS);
  const more = hub.children.slice(MAX_TABS);
  const moreActive = more.some((leaf) => leaf.id === activeId);

  const tab = (leaf: ConsoleLeaf) => {
    const active = leaf.id === activeId;
    const count = formatCount(leaf.badgeKey ? counts[leaf.badgeKey] : null);
    const status = activeStatusBadge(leaf, counts);
    return (
      <Link
        key={leaf.id}
        href={leaf.href}
        data-testid={`tab-${leaf.id}`}
        aria-current={active ? 'page' : undefined}
        className={tabClass(active)}
      >
        <span>{leaf.label ?? t(leaf.labelKey)}</span>
        {count && (
          <span
            data-testid={`count-${leaf.id}`}
            className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground"
          >
            {count}
          </span>
        )}
        {status && (
          <span
            data-testid={`status-${leaf.id}`}
            className="rounded-full bg-warning/25 px-1.5 text-[0.6875rem] font-medium leading-4"
          >
            {t(status)}
          </span>
        )}
      </Link>
    );
  };

  return (
    <nav
      aria-label={label}
      data-testid="hub-tabs"
      className="-mx-4 mb-4 flex items-end gap-1 overflow-x-auto border-b border-border px-4 md:-mx-6 md:px-6"
    >
      {inBar.map(tab)}
      {more.length > 0 && (
        <details className="group relative">
          <summary
            className={cn(
              tabClass(moreActive),
              'cursor-pointer list-none [&::-webkit-details-marker]:hidden',
            )}
          >
            {tc('moreTabs')}
            <span aria-hidden="true" className="text-xs">
              ▾
            </span>
          </summary>
          <div className="absolute end-0 top-full z-10 mt-1 flex min-w-48 flex-col rounded-md border border-border bg-background p-1 shadow-lg">
            {more.map((leaf) => (
              <Link
                key={leaf.id}
                href={leaf.href}
                aria-current={leaf.id === activeId ? 'page' : undefined}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
                  leaf.id === activeId && 'bg-muted font-medium',
                )}
              >
                {leaf.label ?? t(leaf.labelKey)}
              </Link>
            ))}
          </div>
        </details>
      )}
    </nav>
  );
}
