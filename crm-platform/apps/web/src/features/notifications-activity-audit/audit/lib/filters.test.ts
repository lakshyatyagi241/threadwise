import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RANGE,
  EMPTY_FILTERS,
  isFiltered,
  parseFilters,
  toApiFilters,
  toSearch,
  windowOf,
} from './filters';
import { errorKey } from './errors';
import { fieldSummary, initials, showValue } from './format';
import { ApiError } from '@/lib/api/errors';

const parse = (qs: string) => parseFilters(new URLSearchParams(qs));
const NOW = new Date('2026-10-13T10:00:00.000Z');

describe('the URL', () => {
  it('has the defaults when empty and writes nothing for them', () => {
    expect(parse('')).toEqual(EMPTY_FILTERS);
    expect(toSearch(EMPTY_FILTERS)).toBe('');
    expect(isFiltered(EMPTY_FILTERS)).toBe(false);
  });
  it('round-trips every filter', () => {
    const qs =
      'range=custom&from=2026-09-01&to=2026-09-30&actor=3f0b9f0e-6c1c-4a39-9b7e-0d4d2b0c1a11&actorType=api_key&module=contacts&action=update&recordId=42&requestId=req-1&q=tag&actAs=1&entry=abc';
    const s = parse(qs);
    expect(s).toMatchObject({
      range: 'custom',
      from: '2026-09-01',
      to: '2026-09-30',
      actorType: 'api_key',
      module: 'contacts',
      recordId: '42',
      actAs: true,
      entry: 'abc',
    });
    expect(parse(toSearch(s))).toEqual(s);
    expect(isFiltered(s)).toBe(true);
  });
  it('ignores what a hand-edited URL gets wrong', () => {
    const s = parse('range=forever&from=yesterday&actor=not-a-uuid&actorType=wizard&recordId=12ab&actAs=yes');
    expect(s.range).toBe(DEFAULT_RANGE);
    expect(s.from).toBe('');
    expect(s.actorId).toBe('');
    expect(s.actorType).toBe('');
    expect(s.recordId).toBe('');
    expect(s.actAs).toBe(false);
  });
  it('dates alone mean a custom range', () => {
    expect(parse('from=2026-09-01').range).toBe('custom');
  });
  it('a preset drops stray dates', () => {
    expect(parse('range=30d&from=2026-09-01').from).toBe('');
  });
  it('trims and caps text', () => {
    expect(parse(`q=${'x'.repeat(500)}`).q).toHaveLength(100);
    expect(parse('q=%20%20hi%20').q).toBe('hi');
  });
});

describe('the time window', () => {
  it('a preset counts back from now', () => {
    expect(windowOf({ range: '24h', from: '', to: '' }, NOW)).toEqual({
      from: '2026-10-12T10:00:00.000Z',
    });
    expect(windowOf({ range: '7d', from: '', to: '' }, NOW).from).toBe('2026-10-06T10:00:00.000Z');
  });
  it('a custom range is whole local days, the end day included', () => {
    const w = windowOf({ range: 'custom', from: '2026-09-01', to: '2026-09-30' }, NOW);
    expect(new Date(w.from).getTime()).toBe(new Date(2026, 8, 1).getTime());
    expect(new Date(w.to!).getTime()).toBe(new Date(2026, 9, 1).getTime());
  });
  it('an open custom range starts 30 days back with no end', () => {
    const w = windowOf({ range: 'custom', from: '', to: '' }, NOW);
    expect(w.to).toBeUndefined();
    expect(w.from).toBe('2026-09-13T10:00:00.000Z');
  });
});

describe('the API filters', () => {
  it('carries only what is set, with the record number as a number', () => {
    const f = toApiFilters(
      { ...EMPTY_FILTERS, module: 'contacts', recordId: '42', actAs: true, q: 'tag' },
      NOW,
    );
    expect(f).toEqual({
      from: '2026-10-06T10:00:00.000Z',
      module: 'contacts',
      recordId: 42,
      actAs: true,
      q: 'tag',
    });
  });
  it('never sends the open entry', () => {
    expect(JSON.stringify(toApiFilters({ ...EMPTY_FILTERS, entry: 'abc' }, NOW))).not.toContain('abc');
  });
});

describe('format helpers', () => {
  it('initials', () => {
    expect(initials('Sara Ali')).toBe('SA');
    expect(initials('madonna')).toBe('M');
    expect(initials(null)).toBe('?');
    expect(initials('  ')).toBe('?');
  });
  it('field summary', () => {
    expect(fieldSummary(['a', 'b', 'c', 'd', 'e'])).toEqual({ shown: ['a', 'b', 'c'], more: 2 });
    expect(fieldSummary([])).toEqual({ shown: [], more: 0 });
  });
  it('values as text', () => {
    expect(showValue(null)).toBe('');
    expect(showValue(3)).toBe('3');
    expect(showValue({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe('error keys', () => {
  it('branch on the code and the status', () => {
    expect(errorKey(new Error('x'))).toBe('network');
    expect(errorKey(new ApiError(403, 'FORBIDDEN', 'no'))).toBe('forbidden');
    expect(errorKey(new ApiError(422, 'AUDIT_RANGE_INVALID', 'range'))).toBe('rangeInvalid');
    expect(errorKey(new ApiError(409, 'AUDIT_EXPORT_IN_PROGRESS', 'busy'))).toBe('exportInProgress');
    expect(errorKey(new ApiError(404, 'AUDIT_ENTRY_NOT_FOUND', 'gone'))).toBe('notFound');
    expect(errorKey(new ApiError(429, 'X', 'slow'))).toBe('rateLimited');
    expect(errorKey(new ApiError(500, 'X', 'boom'))).toBe('unexpected');
  });
});
