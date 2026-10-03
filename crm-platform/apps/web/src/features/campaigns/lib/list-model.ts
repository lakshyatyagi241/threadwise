import {
  CAMPAIGN_RANGES,
  CAMPAIGN_TYPE_FILTERS,
  type Campaign,
  type CampaignRange,
  type CampaignStatus,
  type CampaignTypeFilter,
} from '@crm/contracts';

/** What the campaigns list decides without the network (WD-CAMP-001, 016, 017). Pure. */

/** The status views of the left rail, in WaDesk's order. */
export const STATUS_VIEWS = [
  'all',
  'recently_created',
  'recently_updated',
  'scheduled',
  'running',
  'completed',
  'failed',
] as const;
export type StatusView = (typeof STATUS_VIEWS)[number];

export interface ListState {
  status: StatusView;
  type: CampaignTypeFilter;
  range: CampaignRange;
  q: string;
  page: number;
}

export const DEFAULT_STATE: ListState = {
  status: 'all',
  type: 'all',
  range: 'all',
  q: '',
  page: 1,
};

const oneOf = <T extends string>(list: readonly T[], v: string | null, fallback: T): T =>
  v !== null && (list as readonly string[]).includes(v) ? (v as T) : fallback;

/** The address is the single source of truth for the filters: a bad value falls back to its default. */
export function parseState(p: URLSearchParams): ListState {
  const page = Number(p.get('page'));
  return {
    status: oneOf(STATUS_VIEWS, p.get('status'), 'all'),
    type: oneOf(CAMPAIGN_TYPE_FILTERS, p.get('type'), 'all'),
    range: oneOf(CAMPAIGN_RANGES, p.get('range'), 'all'),
    q: (p.get('q') ?? '').trim(),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** Only what differs from the default goes into the address. */
export function stateToSearch(s: ListState): string {
  const p = new URLSearchParams();
  if (s.status !== 'all') p.set('status', s.status);
  if (s.type !== 'all') p.set('type', s.type);
  if (s.range !== 'all') p.set('range', s.range);
  if (s.q !== '') p.set('q', s.q);
  if (s.page > 1) p.set('page', String(s.page));
  const text = p.toString();
  return text === '' ? '' : `?${text}`;
}

export const stateToQuery = (s: ListState) => ({
  status: s.status,
  type: s.type,
  range: s.range,
  q: s.q,
  page: s.page,
});

/** What each status lets an operator do (the card's buttons). */
export const can = {
  cancel: (s: CampaignStatus) => s === 'running' || s === 'scheduled',
  resume: (s: CampaignStatus) => s === 'paused' || s === 'failed' || s === 'cancelled',
  edit: (s: CampaignStatus) => s === 'draft' || s === 'scheduled' || s === 'paused',
  resend: (s: CampaignStatus) => s === 'completed' || s === 'failed' || s === 'cancelled',
};

export const TYPE_LABEL: Record<
  Campaign['type'],
  'template' | 'flow' | 'text' | 'media' | 'button' | 'custom'
> = {
  template: 'template',
  flow: 'flow',
  text: 'text',
  media: 'media',
  button: 'button',
  custom: 'custom',
};

/** Delivery rate of the card: delivered of sent, one decimal. */
export const deliveryRate = (c: Campaign['counts']): number =>
  c.sent > 0 ? Math.round((c.delivered / c.sent) * 1000) / 10 : 0;

/** Pages of 12 for `total` rows. */
export const pageCount = (total: number, perPage: number): number =>
  Math.max(1, Math.ceil(total / perPage));
