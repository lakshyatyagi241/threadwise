import type { ApiLibraryLogSource } from '@crm/contracts';
import type { LogFilters } from '../api/hooks';

/** What the filter bar holds. Dates are the `YYYY-MM-DD` of a date input; empty strings mean "no filter". */
export interface LogFilterForm {
  apiId: string;
  status: '' | 'success' | 'failed';
  statusCode: string;
  source: '' | ApiLibraryLogSource;
  from: string;
  to: string;
  search: string;
}

export const EMPTY_LOG_FILTERS: LogFilterForm = {
  apiId: '',
  status: '',
  statusCode: '',
  source: '',
  from: '',
  to: '',
  search: '',
};

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Start (or end) of a local day as the ISO instant the API filters on; null for anything that is not a date. */
export function dayBound(value: string, edge: 'start' | 'end'): string | null {
  const m = DAY.exec(value);
  if (!m) return null;
  const d =
    edge === 'start'
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0)
      : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The query the logs routes take. Empty fields are left out; a status code outside 100-599 is ignored. */
export function logQuery(f: LogFilterForm, fixedApiId?: string): LogFilters {
  const code = /^\d{3}$/.test(f.statusCode.trim()) ? Number(f.statusCode.trim()) : undefined;
  const search = f.search.trim();
  return {
    apiId: fixedApiId ?? (f.apiId !== '' ? f.apiId : undefined),
    status: f.status !== '' ? f.status : undefined,
    statusCode: code !== undefined && code >= 100 && code <= 599 ? code : undefined,
    source: f.source !== '' ? f.source : undefined,
    from: dayBound(f.from, 'start') ?? undefined,
    to: dayBound(f.to, 'end') ?? undefined,
    search: search !== '' ? search : undefined,
  };
}

export const hasLogFilters = (f: LogFilterForm): boolean =>
  (Object.keys(f) as Array<keyof LogFilterForm>).some((k) => f[k] !== '');
