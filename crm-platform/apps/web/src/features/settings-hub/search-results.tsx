'use client';

import { useTranslations } from 'next-intl';
import { Button, EmptyState } from '@crm/ui';
import { Highlight } from './highlight';
import type { SearchHit } from './settings-search';
import { TileCard } from './tile-card';

/** The tiles that match the search, from every section, each with the section it lives in. */
export function SearchResults({
  hits,
  query,
  onClear,
}: {
  hits: readonly SearchHit[];
  query: string;
  onClear: () => void;
}) {
  const t = useTranslations('settings');
  if (hits.length === 0) {
    return (
      <EmptyState
        title={t('noResults.title', { query })}
        message={t('noResults.message')}
        actions={
          <Button type="button" variant="secondary" onClick={onClear}>
            {t('clearSearch')}
          </Button>
        }
      />
    );
  }
  return (
    <section aria-labelledby="settings-results-title" className="space-y-4">
      <h2 id="settings-results-title" className="text-xl font-semibold tracking-tight">
        {t('results.title', { count: hits.length, query })}
      </h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {hits.map(({ entry, ranges }) => (
          <li key={entry.tile.id} className="min-w-0">
            <TileCard
              tile={entry.tile}
              resultRef
              label={<Highlight text={entry.label} ranges={ranges} />}
              description={entry.description || undefined}
              footer={t('inSection', { section: entry.sectionTitle })}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
