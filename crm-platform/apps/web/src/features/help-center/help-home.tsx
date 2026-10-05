import { useTranslations } from 'next-intl';
import { EmptyState } from '@crm/ui';
import { HelpSearch, type BrowseArea } from './help-search';
import { HELP_AREAS, type HelpIndexEntry } from './types';

const FEATURED = 4;

/**
 * `/help`: a hero with the search box, one card per area that has guides, the start-here guides, then every area's guides. With a
 * query the search replaces the browse view. Only plain data is passed to the search island; it renders every list itself.
 */
export function HelpHome({ entries }: { entries: readonly HelpIndexEntry[] }) {
  const t = useTranslations('help');
  const areas: BrowseArea[] = HELP_AREAS.map((area) => ({
    area,
    items: entries.filter((e) => e.area === area),
  })).filter((g) => g.items.length > 0);
  const start = entries.filter((e) => e.area === 'getting-started').slice(0, FEATURED);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-12 pb-12">
      <header className="space-y-4 pt-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t('title')}</h1>
        <p className="mx-auto max-w-xl text-base text-muted-foreground">{t('subtitle')}</p>
      </header>

      {entries.length === 0 ? (
        <EmptyState title={t('none.title')} message={t('none.message')} />
      ) : (
        <HelpSearch entries={entries} areas={areas} start={start} />
      )}
    </div>
  );
}
