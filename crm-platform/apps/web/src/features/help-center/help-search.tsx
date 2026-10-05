'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { NavIcon } from '@/components/shell/nav-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, cn } from '@crm/ui';
import { matchHelp } from './search';
import type { HelpArea, HelpIndexEntry } from './types';

/** The icon that stands for each guide area (the same icons the menu groups use). */
export const AREA_ICON: Readonly<Record<HelpArea, string>> = {
  overview: 'dashboard',
  inbox: 'inbox',
  audience: 'contacts',
  sales: 'crm',
  campaigns: 'campaign',
  automation: 'flow',
  store: 'store',
  apps: 'apps',
  settings: 'gear',
  account: 'help',
  'getting-started': 'book',
};

function Result({ entry, showArea }: { entry: HelpIndexEntry; showArea?: boolean }) {
  const t = useTranslations('help');
  return (
    <li>
      <Link
        href={`/help/${entry.id}`}
        className="group flex items-start gap-3 rounded-xl border border-border bg-background px-4 py-3.5 outline-none transition hover:border-primary/40 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground group-hover:text-primary">
            {entry.title}
          </span>
          <span className="mt-0.5 block text-sm leading-6 text-muted-foreground">
            {entry.summary}
          </span>
          {showArea && (
            <span className="mt-1.5 block text-xs font-medium text-muted-foreground">
              {t(`areas.${entry.area}`)}
            </span>
          )}
        </span>
        <span aria-hidden="true" className="mt-1 text-muted-foreground group-hover:text-primary">
          →
        </span>
      </Link>
    </li>
  );
}

/**
 * The help center's search island. The search box is the hero; with no query the page shows `idle` (the area cards and the guides
 * grouped by area, rendered on the server), and with a query it shows one ranked list. Cmd/Ctrl+K focuses the box from anywhere on
 * the page, as the shortcut hint in the box says.
 */
export interface BrowseArea {
  area: HelpArea;
  items: HelpIndexEntry[];
}

export function HelpSearch({
  entries,
  areas,
  start,
}: {
  entries: readonly HelpIndexEntry[];
  /** The areas that have guides, in menu order, as plain data (no JSX crosses the server/client boundary). */
  areas: readonly BrowseArea[];
  /** The guides for "Start here". */
  start: readonly HelpIndexEntry[];
}) {
  const t = useTranslations('help');
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => matchHelp(entries, query), [entries, query]);
  const searching = query.trim() !== '';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="space-y-8">
      <div className="relative mx-auto max-w-2xl">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <circle cx="9" cy="9" r="6" />
          <path d="m14 14 4 4" />
        </svg>
        <input
          ref={input}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
          className="h-14 w-full rounded-2xl border border-border bg-background ps-12 pe-24 text-base shadow-sm outline-none transition placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary"
        />
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute end-4 top-1/2 hidden -translate-y-1/2 rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground sm:inline-block"
        >
          ⌘K
        </kbd>
      </div>

      <p role="status" aria-live="polite" className="text-center text-sm text-muted-foreground">
        {searching ? t('resultsStatus', { count: results.length }) : ''}
      </p>

      {searching ? (
        results.length === 0 ? (
          <EmptyState title={t('noResults.title')} message={t('noResults.message')} />
        ) : (
          <ul className="mx-auto grid max-w-3xl gap-3">
            {results.map((entry) => (
              <Result key={entry.id} entry={entry} showArea />
            ))}
          </ul>
        )
      ) : (
        <BrowseView areas={areas} start={start} />
      )}
    </div>
  );
}

/** The browse view: area cards that jump to their sections, the start-here guides, then every area's guides. */
function BrowseView({
  areas,
  start,
}: {
  areas: readonly BrowseArea[];
  start: readonly HelpIndexEntry[];
}) {
  const t = useTranslations('help');
  return (
    <div className="space-y-12">
      <nav aria-label={t('browseLabel')}>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {areas.map(({ area, items }) => (
            <li key={area}>
              <a
                href={`#area-${area}`}
                className="flex h-full items-start gap-4 rounded-2xl border border-border bg-background p-5 outline-none transition hover:border-primary/40 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <NavIcon name={AREA_ICON[area]} className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold text-foreground">{t(`areas.${area}`)}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">
                    {t('guideCount', { count: items.length })}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {start.length > 0 && (
        <section aria-labelledby="help-start" className="space-y-3">
          <h2 id="help-start" className="text-sm font-semibold text-foreground">
            {t('startHere')}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {start.map((entry) => (
              <Result key={entry.id} entry={entry} />
            ))}
          </ul>
        </section>
      )}

      {areas.map(({ area, items }) => (
        <AreaList key={area} area={area} entries={items} />
      ))}
    </div>
  );
}

/** One area of the help center: its heading and its guides as a grid. */
export function AreaList({
  area,
  entries,
  className,
}: {
  area: HelpArea;
  entries: readonly HelpIndexEntry[];
  className?: string;
}) {
  const t = useTranslations('help');
  return (
    <section
      id={`area-${area}`}
      aria-labelledby={`help-area-${area}`}
      className={cn('scroll-mt-24 space-y-3', className)}
    >
      <h2 id={`help-area-${area}`} className="text-sm font-semibold text-foreground">
        {t(`areas.${area}`)}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {entries.map((entry) => (
          <Result key={entry.id} entry={entry} />
        ))}
      </ul>
    </section>
  );
}
