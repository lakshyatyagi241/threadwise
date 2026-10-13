import {
  MESSAGE_HISTORY_DIRECTIONS,
  MESSAGE_HISTORY_RANGES,
  MESSAGE_HISTORY_SOURCES,
  MESSAGE_HISTORY_STATUSES,
  MESSAGE_HISTORY_TYPES,
  messageHistoryIdSchema,
  type MessageHistoryDirection,
  type MessageHistoryRange,
  type MessageHistorySource,
  type MessageHistoryStatus,
  type MessageHistoryType,
} from '@crm/contracts';

/**
 * The filters of Message History live in the address, one state for the table, the cards and the charts (Reference had a form and a
 * second, half-wired AJAX state that dropped the range on the next click). This file reads and writes that address and builds the
 * API query from it; nothing here touches the DOM.
 */

export const DEFAULT_RANGE: MessageHistoryRange = '30d';
export type Bucket = 'hourly' | 'daily' | 'weekly';
export const BUCKETS: readonly Bucket[] = ['daily', 'hourly', 'weekly'];

export interface HistoryState {
  range: MessageHistoryRange;
  /** UTC days, both or none: a custom window that wins over `range`. */
  from: string;
  to: string;
  dir: MessageHistoryDirection;
  type: '' | MessageHistoryType;
  source: MessageHistorySource[];
  status: '' | MessageHistoryStatus;
  channelId: string;
  templateId: string;
  campaignId: string;
  broadcastId: string;
  scheduledId: string;
  q: string;
  bucket: Bucket;
  /** The row open in the drawer. */
  open: string;
}

export const EMPTY_STATE: HistoryState = {
  range: DEFAULT_RANGE,
  from: '',
  to: '',
  dir: 'all',
  type: '',
  source: [],
  status: '',
  channelId: '',
  templateId: '',
  campaignId: '',
  broadcastId: '',
  scheduledId: '',
  q: '',
  bucket: 'daily',
  open: '',
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const oneOf = <T extends string>(list: readonly T[], v: string | null): T | undefined =>
  list.find((x) => x === v);

/** The state an address means. Anything unknown or malformed falls back to the default, so a stale link still opens. */
export function parseState(sp: URLSearchParams): HistoryState {
  const from = sp.get('from');
  const to = sp.get('to');
  const custom = from !== null && to !== null && DAY.test(from) && DAY.test(to);
  const source = (sp.get('source') ?? '')
    .split(',')
    .map((s) => oneOf(MESSAGE_HISTORY_SOURCES, s))
    .filter((s): s is MessageHistorySource => s !== undefined);
  const id = (k: string): string => {
    const v = sp.get(k);
    return v !== null && UUID.test(v) ? v : '';
  };
  const open = sp.get('open');
  return {
    range: oneOf(MESSAGE_HISTORY_RANGES, sp.get('range')) ?? DEFAULT_RANGE,
    from: custom ? from : '',
    to: custom ? to : '',
    dir: oneOf(MESSAGE_HISTORY_DIRECTIONS, sp.get('dir')) ?? 'all',
    type: oneOf(MESSAGE_HISTORY_TYPES, sp.get('type')) ?? '',
    source: [...new Set(source)],
    status: oneOf(MESSAGE_HISTORY_STATUSES, sp.get('status')) ?? '',
    channelId: id('channelId'),
    templateId: id('templateId'),
    campaignId: id('campaignId'),
    broadcastId: id('broadcastId'),
    scheduledId: id('scheduledId'),
    q: (sp.get('q') ?? '').trim().slice(0, 100),
    bucket: oneOf(BUCKETS, sp.get('bucket')) ?? 'daily',
    open: open !== null && messageHistoryIdSchema.safeParse(open).success ? open : '',
  };
}

/** The address of a state: only what differs from the default, so the plain page has a plain address. */
export function stateToSearch(s: HistoryState): string {
  const p = new URLSearchParams();
  if (s.from && s.to) {
    p.set('from', s.from);
    p.set('to', s.to);
  } else if (s.range !== DEFAULT_RANGE) p.set('range', s.range);
  if (s.dir !== 'all') p.set('dir', s.dir);
  if (s.type) p.set('type', s.type);
  if (s.source.length > 0) p.set('source', s.source.join(','));
  if (s.status) p.set('status', s.status);
  for (const k of [
    'channelId',
    'templateId',
    'campaignId',
    'broadcastId',
    'scheduledId',
  ] as const) {
    if (s[k]) p.set(k, s[k]);
  }
  if (s.q) p.set('q', s.q);
  if (s.bucket !== 'daily') p.set('bucket', s.bucket);
  if (s.open) p.set('open', s.open);
  const out = p.toString();
  return out ? `?${out}` : '';
}

type Query = Record<string, string | number | boolean | undefined>;

const windowOf = (s: HistoryState): Query =>
  s.from && s.to ? { from: s.from, to: s.to } : { range: s.range };

const scopingOf = (s: HistoryState): Query => ({
  channelId: s.channelId || undefined,
  templateId: s.templateId || undefined,
  campaignId: s.campaignId || undefined,
  broadcastId: s.broadcastId || undefined,
  scheduledId: s.scheduledId || undefined,
});

const narrowOf = (s: HistoryState): Query => ({
  dir: s.dir === 'all' ? undefined : s.dir,
  type: s.type || undefined,
  source: s.source.length > 0 ? s.source.join(',') : undefined,
  status: s.status || undefined,
  q: s.q || undefined,
});

/** The table and the export: every filter. */
export const feedQuery = (s: HistoryState): Query => ({
  ...windowOf(s),
  ...scopingOf(s),
  ...narrowOf(s),
});

/** The cards: the window and the scoping filters only (the tab counts and the headline numbers do not move with the narrowing ones). */
export const summaryQuery = (s: HistoryState): Query => ({ ...windowOf(s), ...scopingOf(s) });

/** The charts follow every filter, as Reference's did. */
export const insightsQuery = (s: HistoryState, tz: string): Query => ({
  ...feedQuery(s),
  bucket: s.bucket,
  tz,
});

/** The body of an export request: the filters without the paging and the chart bucket. */
export function exportBody(s: HistoryState): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(feedQuery(s))) {
    if (v === undefined) continue;
    body[k] = k === 'source' ? String(v).split(',') : v;
  }
  return body;
}

/** Filters that come from a link (a campaign's, a broadcast's, a template's page) and have no picker on the screen: shown as chips. */
export const SCOPE_KEYS = ['templateId', 'campaignId', 'broadcastId', 'scheduledId'] as const;
export type ScopeKey = (typeof SCOPE_KEYS)[number];

/** Is anything narrowing the feed? Decides between the empty state "nothing yet" and "nothing matches". */
export const isNarrowed = (s: HistoryState): boolean =>
  s.dir !== 'all' ||
  s.type !== '' ||
  s.source.length > 0 ||
  s.status !== '' ||
  s.q !== '' ||
  s.channelId !== '' ||
  SCOPE_KEYS.some((k) => s[k] !== '');

/** Days of the state's window, for the "last N days" wording of an empty period; null for a custom window. */
export const rangeDays = (s: HistoryState): number | null =>
  s.from && s.to ? null : { '24h': 1, '7d': 7, '30d': 30, '90d': 90 }[s.range];
