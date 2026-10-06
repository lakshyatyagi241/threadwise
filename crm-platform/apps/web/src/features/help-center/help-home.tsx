import { useTranslations } from 'next-intl';
import { EmptyState } from '@crm/ui';
import { HelpFrame, HelpHeader, HelpRail } from './help-frame';
import { HelpSearch } from './help-search';
import { HELP_AREAS, type HelpArea, type HelpIndexEntry } from './types';

/** The guides offered as quick links under the search box, when this person can see them. */
export const POPULAR_GUIDES = [
  'connect-first-whatsapp-number',
  'template-rejected-fix',
  'message-stuck-or-not-sent',
  'import-contacts-csv',
  'how-message-billing-works',
] as const;

const isArea = (v: string | undefined): v is HelpArea => HELP_AREAS.some((a) => a === v);

/**
 * `/help`: the header, the category rail (one row per area that has guides, with its count), the search card with the popular
 * guides, then the guides as cards. `area` is the rail's choice (`?area=`); an unknown or empty area shows every guide.
 */
export function HelpHome({ entries, area }: { entries: readonly HelpIndexEntry[]; area?: string }) {
  const t = useTranslations('help');
  const rail = HELP_AREAS.map((a) => ({
    area: a,
    count: entries.filter((e) => e.area === a).length,
  })).filter((r) => r.count > 0);
  const active = isArea(area) && rail.some((r) => r.area === area) ? area : undefined;
  const popular = POPULAR_GUIDES.flatMap((id) => entries.filter((e) => e.id === id));

  return (
    <>
      <HelpHeader
        backHref="/dashboard"
        crumbs={t('crumb')}
        accent={t('heading')}
        rest={t('headingRest')}
      />
      <HelpFrame rail={<HelpRail areas={rail} total={entries.length} active={active} />}>
        {entries.length === 0 ? (
          <EmptyState title={t('none.title')} message={t('none.message')} />
        ) : (
          <HelpSearch entries={entries} active={active} popular={popular} />
        )}
      </HelpFrame>
    </>
  );
}
