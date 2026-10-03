import { describe, expect, it } from 'vitest';
import { SESSIONS_PER_PAGE, durationLabel, pageRange } from './session-page';

describe('pageRange', () => {
  it('numbers the rows on the first page', () => {
    expect(pageRange(0, 10, 23, 10)).toEqual({ from: 1, to: 10, page: 1, pages: 3 });
    expect(SESSIONS_PER_PAGE).toBe(10);
  });

  it('numbers a middle and the last, shorter page', () => {
    expect(pageRange(1, 10, 23, 10)).toEqual({ from: 11, to: 20, page: 2, pages: 3 });
    expect(pageRange(2, 3, 23, 10)).toEqual({ from: 21, to: 23, page: 3, pages: 3 });
  });

  it('an empty list is one empty page', () => {
    expect(pageRange(0, 0, 0, 10)).toEqual({ from: 0, to: 0, page: 1, pages: 1 });
  });

  it('exactly one page needs no paging', () => {
    expect(pageRange(0, 10, 10, 10).pages).toBe(1);
  });
});

describe('durationLabel', () => {
  it('uses the largest unit it divides into evenly', () => {
    expect(durationLabel(7 * 86_400, 'en')).toBe('7 days');
    expect(durationLabel(30 * 86_400, 'en')).toBe('30 days');
    expect(durationLabel(3_600, 'en')).toBe('1 hour');
    expect(durationLabel(90 * 60, 'en')).toBe('90 minutes');
    expect(durationLabel(86_400, 'en')).toBe('1 day');
  });

  it('writes the unit in the reader’s language', () => {
    expect(durationLabel(7 * 86_400, 'ar')).not.toMatch(/days/);
    expect(durationLabel(7 * 86_400, 'ar')).toMatch(/[؀-ۿ]/);
  });
});
