import { describe, expect, it } from 'vitest';
import { EMPTY_LOG_FILTERS, dayBound, hasLogFilters, logQuery } from './log-filters';

describe('log filters', () => {
  it('sends nothing for an empty form', () => {
    expect(logQuery(EMPTY_LOG_FILTERS)).toEqual({
      apiId: undefined,
      status: undefined,
      statusCode: undefined,
      source: undefined,
      from: undefined,
      to: undefined,
      search: undefined,
    });
    expect(hasLogFilters(EMPTY_LOG_FILTERS)).toBe(false);
  });

  it('maps the filled fields, trimming the search and parsing the code', () => {
    const q = logQuery({
      apiId: 'a1',
      status: 'failed',
      statusCode: '404',
      source: 'flow',
      from: '2026-03-01',
      to: '2026-03-02',
      search: '  orders ',
    });
    expect(q).toMatchObject({
      apiId: 'a1',
      status: 'failed',
      statusCode: 404,
      source: 'flow',
      search: 'orders',
    });
    expect(new Date(q.from!).getTime()).toBeLessThan(new Date(q.to!).getTime());
  });

  it('a fixed API wins over the filter, and a bad code is ignored', () => {
    expect(logQuery({ ...EMPTY_LOG_FILTERS, apiId: 'x' }, 'fixed').apiId).toBe('fixed');
    expect(logQuery({ ...EMPTY_LOG_FILTERS, statusCode: '99' }).statusCode).toBeUndefined();
    expect(logQuery({ ...EMPTY_LOG_FILTERS, statusCode: '600' }).statusCode).toBeUndefined();
    expect(logQuery({ ...EMPTY_LOG_FILTERS, statusCode: '20' }).statusCode).toBeUndefined();
  });

  it('turns a day into the start or the end of that local day', () => {
    const s = new Date(dayBound('2026-03-05', 'start')!);
    const e = new Date(dayBound('2026-03-05', 'end')!);
    expect(s.getHours()).toBe(0);
    expect(e.getHours()).toBe(23);
    expect(e.getDate()).toBe(5);
    expect(dayBound('', 'start')).toBeNull();
    expect(dayBound('garbage', 'end')).toBeNull();
  });
});
