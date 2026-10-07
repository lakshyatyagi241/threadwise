import type { WizardHistoryRow, WizardScheduleMode } from '@crm/contracts';

/** The three history pages of the Campaigns menu, one per way a broadcast is sent. */
export const HISTORY_PATH = '/campaigns/history';
export const SCHEDULED_PATH = '/campaigns/scheduled';
export const RECURRING_PATH = '/campaigns/recurring';

export const pathForMode = (mode: WizardScheduleMode): string =>
  mode === 'now' ? HISTORY_PATH : mode === 'scheduled' ? SCHEDULED_PATH : RECURRING_PATH;

/** Where a launch lands: the page of its kind, with the new row marked (`new` is the campaign's or the series' id). */
export const afterLaunchPath = (mode: WizardScheduleMode, id: string): string =>
  `${pathForMode(mode)}?new=${encodeURIComponent(id)}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The `new` parameter of a page address, only when it is an id. */
export const highlightOf = (raw: string | string[] | undefined): string | null =>
  typeof raw === 'string' && UUID.test(raw) ? raw : null;

/**
 * A row opens the screen that knows it: a run of a recurring series opens the series, a wizard broadcast its status page, a
 * classic campaign its own detail.
 */
export function rowHref(r: Pick<WizardHistoryRow, 'id' | 'source' | 'seriesId'>): string {
  if (r.source === 'classic') return `/campaigns/${r.id}`;
  return `/campaigns/wizard/broadcasts/${r.seriesId ?? r.id}`;
}

export const seriesHref = (id: string): string => `/campaigns/wizard/broadcasts/${id}`;

/** Only a wizard broadcast can be cancelled from here (the control endpoints belong to the wizard). */
export const canCancel = (r: Pick<WizardHistoryRow, 'source' | 'status'>): boolean =>
  r.source === 'wizard' && r.status === 'scheduled';

export const typeTone = (t: WizardScheduleMode): 'brand' | 'neutral' | 'warning' =>
  t === 'now' ? 'brand' : t === 'scheduled' ? 'warning' : 'neutral';
