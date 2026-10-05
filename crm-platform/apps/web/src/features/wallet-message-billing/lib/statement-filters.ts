import { statementTypeSchema, type StatementType } from '@crm/contracts';

export interface StatementFilters {
  type: StatementType;
  from: string;
  to: string;
  q: string;
}

export const EMPTY_FILTERS: StatementFilters = { type: 'all', from: '', to: '', q: '' };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

interface ParamReader {
  get(name: string): string | null;
}

/** The filters in the page address. Anything unreadable is ignored, as Reference ignored an invalid date. */
export function parseFilters(params: ParamReader): StatementFilters {
  const type = statementTypeSchema.safeParse(params.get('type'));
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  return {
    type: type.success ? type.data : 'all',
    from: DAY.test(from) ? from : '',
    to: DAY.test(to) ? to : '',
    q: (params.get('q') ?? '').trim().slice(0, 120),
  };
}

/** The query the statement and CSV endpoints take: only what is set. */
export function toApiQuery(f: StatementFilters): Record<string, string | undefined> {
  return {
    type: f.type === 'all' ? undefined : f.type,
    from: f.from || undefined,
    to: f.to || undefined,
    q: f.q.trim() || undefined,
  };
}

/** The address query string for the page ("?type=spend&from=..."), empty when nothing is filtered. */
export function toSearch(f: StatementFilters): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(toApiQuery(f))) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const hasFilters = (f: StatementFilters): boolean => toSearch(f) !== '';

/** A range that ends before it starts matches nothing: the form says so instead of sending it. */
export const rangeInverted = (f: StatementFilters): boolean =>
  Boolean(f.from && f.to && f.from > f.to);
