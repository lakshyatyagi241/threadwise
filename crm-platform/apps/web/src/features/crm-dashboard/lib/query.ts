import { CRM_DASH_RANGES, type CrmDashRange } from '@crm/contracts';

/**
 * The CRM dashboard's state lives in the address, so a view can be shared and the back button works: `?range=30d&pipeline=<id>&owner=<id>`.
 * Unknown or malformed values fall back to the defaults instead of failing. Defaults are left out of the address.
 */
export interface DashFilters {
  range: CrmDashRange;
  /** `YYYY-MM-DD`, only with `range=custom`. */
  from: string;
  to: string;
  pipeline: string;
  owner: string;
  team: string;
}

export const DEFAULT_FILTERS: DashFilters = {
  range: 'month',
  from: '',
  to: '',
  pipeline: '',
  owner: '',
  team: '',
};

interface SearchLike {
  get(name: string): string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isRange = (v: string | null): v is CrmDashRange =>
  (CRM_DASH_RANGES as readonly (string | null)[]).includes(v);

export function parseFilters(search: SearchLike): DashFilters {
  const range = search.get('range');
  const id = (v: string | null) => (v && UUID.test(v) ? v : '');
  const date = (v: string | null) => (v && DATE.test(v) ? v : '');
  const custom = isRange(range) && range === 'custom';
  return {
    range: isRange(range) ? range : 'month',
    from: custom ? date(search.get('from')) : '',
    to: custom ? date(search.get('to')) : '',
    pipeline: id(search.get('pipeline')),
    owner: id(search.get('owner')),
    team: id(search.get('team')),
  };
}

export function filtersToSearch(f: DashFilters): string {
  const p = new URLSearchParams();
  if (f.range !== 'month') p.set('range', f.range);
  if (f.range === 'custom') {
    if (f.from) p.set('from', f.from);
    if (f.to) p.set('to', f.to);
  }
  if (f.pipeline) p.set('pipeline', f.pipeline);
  if (f.owner) p.set('owner', f.owner);
  if (f.team) p.set('team', f.team);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Anything beyond the period narrows the numbers (the period is not a filter, it is the window). */
export const hasNarrowing = (f: DashFilters): boolean => f.pipeline !== '' || f.owner !== '' || f.team !== '';

/** The query the API takes. `convertTo` is the currency the figures are shown in. */
export function apiQuery(f: DashFilters, convertTo: string): Record<string, string | undefined> {
  return {
    range: f.range,
    from: f.range === 'custom' ? f.from || undefined : undefined,
    to: f.range === 'custom' ? f.to || undefined : undefined,
    pipelineId: f.pipeline || undefined,
    ownerId: f.owner || undefined,
    teamId: f.team || undefined,
    convertTo,
  };
}

/** Drill-down addresses. The target screens already read these from their own address. */
export const links = {
  deals: (o: { pipeline?: string; stage?: string; status?: 'open' | 'won' | 'lost'; owner?: string } = {}): string => {
    const p = new URLSearchParams();
    if (o.pipeline) p.set('pipeline', o.pipeline);
    if (o.owner) p.set('owner', o.owner);
    if (o.status || o.stage) p.set('view', 'list');
    if (o.status) p.set('status', o.status);
    if (o.stage) p.set('stage', o.stage);
    const s = p.toString();
    return s ? `/deals?${s}` : '/deals';
  },
  tasks: (o: { tab?: 'overdue' | 'today' | 'all'; assignee?: string } = {}): string => {
    const p = new URLSearchParams();
    if (o.tab) p.set('tab', o.tab);
    if (o.assignee) p.set('assignee', o.assignee);
    const s = p.toString();
    return s ? `/tasks?${s}` : '/tasks';
  },
};
