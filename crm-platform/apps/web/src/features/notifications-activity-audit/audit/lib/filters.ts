import { AUDIT_ACTOR_KINDS, type AuditActorKind, type AuditLogFilters } from '@crm/contracts';

/**
 * The Audit log's filters as the page keeps them: in the URL (so a filtered view can be shared and survives a reload), parsed
 * defensively (a hand-edited URL never breaks the page), and turned into the API's query. Pure: tested without a browser.
 */

export const RANGE_PRESETS = ['24h', '7d', '30d', '90d', 'custom'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export const DEFAULT_RANGE: RangePreset = '7d';

const HOURS: Record<Exclude<RangePreset, 'custom'>, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
  '90d': 24 * 90,
};

export interface AuditFilterState {
  range: RangePreset;
  /** `YYYY-MM-DD`, the person's local day; only for `custom`. */
  from: string;
  to: string;
  actorId: string;
  actorType: AuditActorKind | '';
  module: string;
  action: string;
  recordId: string;
  requestId: string;
  q: string;
  actAs: boolean;
  /** The entry open in the side panel. */
  entry: string;
}

export const EMPTY_FILTERS: AuditFilterState = {
  range: DEFAULT_RANGE,
  from: '',
  to: '',
  actorId: '',
  actorType: '',
  module: '',
  action: '',
  recordId: '',
  requestId: '',
  q: '',
  actAs: false,
  entry: '',
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (v: string | null, max: number): string => (v ?? '').trim().slice(0, max);

export function parseFilters(params: URLSearchParams): AuditFilterState {
  const rangeRaw = params.get('range');
  const from = DAY.test(params.get('from') ?? '') ? params.get('from')! : '';
  const to = DAY.test(params.get('to') ?? '') ? params.get('to')! : '';
  const range: RangePreset = (RANGE_PRESETS as readonly string[]).includes(rangeRaw ?? '')
    ? (rangeRaw as RangePreset)
    : from || to
      ? 'custom'
      : DEFAULT_RANGE;
  const actorType = params.get('actorType') ?? '';
  const recordId = /^\d{1,15}$/.test(params.get('recordId') ?? '') ? params.get('recordId')! : '';
  return {
    range,
    from: range === 'custom' ? from : '',
    to: range === 'custom' ? to : '',
    actorId: UUID.test(params.get('actor') ?? '') ? params.get('actor')! : '',
    actorType: (AUDIT_ACTOR_KINDS as readonly string[]).includes(actorType)
      ? (actorType as AuditActorKind)
      : '',
    module: clean(params.get('module'), 120),
    action: clean(params.get('action'), 120),
    recordId,
    requestId: clean(params.get('requestId'), 200),
    q: clean(params.get('q'), 100),
    actAs: params.get('actAs') === '1',
    entry: clean(params.get('entry'), 200),
  };
}

/** The URL's query string for a state: only what differs from the defaults. */
export function toSearch(s: AuditFilterState): string {
  const p = new URLSearchParams();
  if (s.range !== DEFAULT_RANGE) p.set('range', s.range);
  if (s.range === 'custom') {
    if (s.from) p.set('from', s.from);
    if (s.to) p.set('to', s.to);
  }
  if (s.actorId) p.set('actor', s.actorId);
  if (s.actorType) p.set('actorType', s.actorType);
  if (s.module) p.set('module', s.module);
  if (s.action) p.set('action', s.action);
  if (s.recordId) p.set('recordId', s.recordId);
  if (s.requestId) p.set('requestId', s.requestId);
  if (s.q) p.set('q', s.q);
  if (s.actAs) p.set('actAs', '1');
  if (s.entry) p.set('entry', s.entry);
  return p.toString();
}

/** True when anything but the default window is set (the empty state then says "no match" and offers Reset). */
export function isFiltered(s: AuditFilterState): boolean {
  return (
    s.range !== DEFAULT_RANGE ||
    !!(s.actorId || s.actorType || s.module || s.action || s.recordId || s.requestId || s.q) ||
    s.actAs
  );
}

/** The local start of a `YYYY-MM-DD` day, as the person's own midnight. */
function localDayStart(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 0, 0, 0, 0);
}

/** The time window of a state: a preset counts back from `now`; a custom range is whole local days (the end day included). */
export function windowOf(
  s: Pick<AuditFilterState, 'range' | 'from' | 'to'>,
  now: Date,
): { from: string; to?: string } {
  if (s.range !== 'custom') {
    return { from: new Date(now.getTime() - HOURS[s.range] * 3_600_000).toISOString() };
  }
  const start = s.from ? localDayStart(s.from) : new Date(now.getTime() - HOURS['30d'] * 3_600_000);
  const out: { from: string; to?: string } = { from: start.toISOString() };
  if (s.to) {
    const end = localDayStart(s.to);
    end.setDate(end.getDate() + 1);
    out.to = end.toISOString();
  }
  return out;
}

/** The API's filters for a state (no cursor, no limit). */
export function toApiFilters(s: AuditFilterState, now: Date): AuditLogFilters {
  const f: AuditLogFilters = { ...windowOf(s, now) };
  if (s.actorId) f.actorId = s.actorId;
  if (s.actorType) f.actorType = s.actorType;
  if (s.module) f.module = s.module;
  if (s.action) f.action = s.action;
  if (s.recordId) f.recordId = Number(s.recordId);
  if (s.requestId) f.requestId = s.requestId;
  if (s.q) f.q = s.q;
  if (s.actAs) f.actAs = true;
  return f;
}
