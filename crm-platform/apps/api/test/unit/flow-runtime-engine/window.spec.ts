import { describe, expect, it } from 'vitest';
import {
  likePattern,
  windowOf,
} from '../../../src/modules/flow-runtime-engine/flow-runtime.window';

const now = new Date('2026-10-03T15:30:00Z');

describe('windowOf', () => {
  it('is open both ways with no days and no dates', () => {
    expect(windowOf({}, now)).toEqual({ from: null, to: null });
    expect(windowOf({ days: 0 }, now)).toEqual({ from: null, to: null });
  });
  it('counts today as the first of the days', () => {
    expect(windowOf({ days: 7 }, now)).toEqual({ from: '2026-09-27T00:00:00.000Z', to: null });
    expect(windowOf({ days: 1 }, now).from).toBe('2026-10-03T00:00:00.000Z');
  });
  it('lets explicit dates win over days and covers the whole last day', () => {
    expect(windowOf({ days: 7, dateFrom: '2026-09-01', dateTo: '2026-09-30' }, now)).toEqual({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-30T23:59:59.999Z',
    });
  });
  it('narrows with one date alone', () => {
    expect(windowOf({ dateTo: '2026-09-30' }, now)).toEqual({
      from: null,
      to: '2026-09-30T23:59:59.999Z',
    });
  });
});

describe('likePattern', () => {
  it('escapes the wildcards so a search for 50% finds 50%', () => {
    expect(likePattern('50%_x')).toBe('%50\\%\\_x%');
  });
});
