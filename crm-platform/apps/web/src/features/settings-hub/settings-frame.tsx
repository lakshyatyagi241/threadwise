'use client';

import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@crm/ui';
import { defaultSection, toSettingsSections } from '@/features/_registry/settings-resolve';
import { isSettingsSection } from '@/features/_registry/settings-types';
import { SearchResults } from './search-results';
import { useSettingsPageTiles } from './settings-context';
import { searchTiles } from './settings-search';
import { SettingsSearchBox } from './settings-search-box';
import { useSearchableTiles } from './use-tile-copy';

/** How long typing pauses before the tiles are filtered. */
const DEBOUNCE_MS = 150;

/**
 * The frame every Settings page sits in (`app/(app)/(settings)/settings/layout.tsx`): the title and the list of sections on
 * the start side (a scrolling strip on a phone), the search box and the page's own content on the other. The section list and
 * the search stay put while the person moves between sections; typing replaces the section with the matching tiles.
 */
export function SettingsFrame({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const tiles = useSettingsPageTiles();
  const sections = useMemo(() => toSettingsSections(tiles), [tiles]);
  const entries = useSearchableTiles(tiles);
  const segment = useSelectedLayoutSegment();
  const activeSection = isSettingsSection(segment) ? segment : defaultSection(sections);

  const [query, setQuery] = useState('');
  const [settled, setSettled] = useState('');
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(query.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [query]);
  const clear = () => {
    setQuery('');
    setSettled('');
  };

  const hits = useMemo(() => searchTiles(entries, settled), [entries, settled]);
  const searching = settled.length > 0 && query.trim().length > 0;
  const resultsRef = useRef<HTMLDivElement>(null);
  const activeLink = useRef<HTMLAnchorElement>(null);
  // On a phone the sections are a scrolling strip: keep the open one in view (a deep link may land past the edge).
  useEffect(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) return;
    activeLink.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [activeSection]);

  return (
    <div className="w-full">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">{t('settings.title')}</h1>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-8">
        <nav aria-label={t('settings.sectionsLabel')} className="min-w-0 lg:w-72 lg:shrink-0">
          <ul className="thin-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:-mx-6 md:px-6 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
            {sections.map(({ section }) => {
              const active = !searching && section === activeSection;
              return (
                <li key={section} className="shrink-0 lg:shrink">
                  <Link
                    ref={section === activeSection ? activeLink : undefined}
                    href={`/settings/${section}`}
                    onClick={clear}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'block rounded-xl border px-4 py-2.5 outline-none transition focus-visible:ring-2 focus-visible:ring-primary lg:py-3.5',
                      active
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-background hover:border-primary/40 hover:bg-muted/50',
                    )}
                  >
                    <span className="block whitespace-nowrap text-sm font-semibold lg:whitespace-normal">
                      {t(`settings.sections.${section}.title`)}
                    </span>
                    <span
                      className={cn(
                        'mt-0.5 hidden text-xs leading-snug lg:block',
                        active ? 'text-foreground/80' : 'text-muted-foreground',
                      )}
                    >
                      {t(`settings.sections.${section}.description`)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0 flex-1 space-y-6">
          <SettingsSearchBox value={query} onChange={setQuery} resultsRef={resultsRef} />
          <div ref={resultsRef}>
            {searching ? <SearchResults hits={hits} query={settled} onClear={clear} /> : children}
          </div>
          <p role="status" className="sr-only">
            {searching ? t('settings.results.status', { count: hits.length }) : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
