'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, cn } from '@crm/ui';
import { matchHelp } from './search';
import type { HelpArea, HelpIndexEntry } from './types';

const CHEVRON = (
  <svg
    viewBox="0 0 16 16"
    className="size-3 rtl:-scale-x-100"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    aria-hidden
  >
    <path d="M6 3l5 5-5 5" />
  </svg>
);

/** One guide as a card: its area, how long it takes to read, its title and summary. */
function GuideCard({ entry }: { entry: HelpIndexEntry }) {
  const t = useTranslations('help');
  return (
    <li>
      <Link
        href={`/help/${entry.id}`}
        className="group block h-full rounded-[14px] border border-border bg-background p-5 shadow-sm outline-none transition hover:border-primary hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="mb-2 flex items-center gap-2">
          <span className="rounded-full bg-wa-mint px-2 py-0.5 font-mono text-[10.5px] text-wa-deep">
            {t(`areas.${entry.area}`)}
          </span>
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {t('readMinutes', { count: entry.readMinutes })}
          </span>
        </span>
        <span className="mb-1.5 block text-[18px] font-semibold leading-tight">{entry.title}</span>
        <span className="block text-[12.5px] leading-snug text-muted-foreground">
          {entry.summary}
        </span>
        <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-primary group-hover:underline">
          {t('read')}
          {CHEVRON}
        </span>
      </Link>
    </li>
  );
}

function CardGrid({ entries }: { entries: readonly HelpIndexEntry[] }) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="help-cards">
      {entries.map((entry) => (
        <GuideCard key={entry.id} entry={entry} />
      ))}
    </ul>
  );
}

/**
 * The list side of the help center: the search card (box with the Cmd/Ctrl+K hint and the popular guides), the heading with how
 * many guides are shown, then the guides as cards. Without a query the cards are the chosen area's, or every area's one after the
 * other (Getting started first); with a query one ranked list replaces them, limited to the chosen area. Only plain data crosses in from the server.
 */
export function HelpSearch({
  entries,
  active,
  popular,
}: {
  /** The guides this person may see, all areas. */
  entries: readonly HelpIndexEntry[];
  /** The area chosen in the rail, if any. */
  active?: HelpArea;
  /** The guides offered as quick links under the search box. */
  popular: readonly HelpIndexEntry[];
}) {
  const t = useTranslations('help');
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const scope = useMemo(
    () => (active ? entries.filter((e) => e.area === active) : [...entries]),
    [entries, active],
  );
  const results = useMemo(() => matchHelp(scope, query), [scope, query]);
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

  const shown = searching ? results : scope;
  const heading = searching ? t('searchResults') : active ? t(`areas.${active}`) : t('allGuides');
  const byArea = useMemo(() => {
    const groups = new Map<HelpArea, HelpIndexEntry[]>();
    for (const e of scope) groups.set(e.area, [...(groups.get(e.area) ?? []), e]);
    // Getting started leads the whole-list view: it is where a new person begins.
    return [...groups].sort(
      ([a], [b]) => Number(b === 'getting-started') - Number(a === 'getting-started'),
    );
  }, [scope]);

  return (
    <div>
      <div className="mb-5 rounded-[14px] border border-border bg-background p-3 shadow-sm">
        <div className="relative">
          <svg
            viewBox="0 0 16 16"
            className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden
          >
            <circle cx="7" cy="7" r="5" />
            <path d="m11 11 3 3" />
          </svg>
          <input
            ref={input}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('searchLabel')}
            placeholder={t('searchPlaceholder')}
            className="w-full rounded-lg border border-border bg-background py-3 pe-16 ps-10 text-[13.5px] outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10"
          />
          <kbd
            aria-hidden="true"
            className="pointer-events-none absolute end-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground sm:inline-block"
          >
            ⌘K
          </kbd>
        </div>
        {popular.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="me-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {t('popular')}
            </span>
            {popular.map((entry) => (
              <Link
                key={entry.id}
                href={`/help/${entry.id}`}
                className="rounded-full border border-border px-2.5 py-1 outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-primary"
              >
                {entry.title}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[20px] font-semibold leading-tight">{heading}</h2>
        <span
          role="status"
          aria-live="polite"
          className="font-mono text-[10.5px] text-muted-foreground"
        >
          {t('resultsStatus', { count: shown.length })}
        </span>
      </div>

      {searching ? (
        results.length === 0 ? (
          <EmptyState title={t('noResults.title')} message={t('noResults.message')} />
        ) : (
          <CardGrid entries={results} />
        )
      ) : active ? (
        <CardGrid entries={scope} />
      ) : (
        <div className="space-y-10">
          {byArea.map(([area, items]) => (
            <section
              key={area}
              id={`area-${area}`}
              aria-labelledby={`help-area-${area}`}
              className={cn('scroll-mt-24 space-y-3')}
            >
              <h3
                id={`help-area-${area}`}
                className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
              >
                {t(`areas.${area}`)}
              </h3>
              <CardGrid entries={items} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
