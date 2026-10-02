import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS,
  FIRST_PAGE,
  MAX_X_LABELS,
  avatarIndex,
  compactNumber,
  currentCursor,
  defaultBucket,
  deltaView,
  effectiveBucket,
  formatMoney,
  initialsOf,
  labelIndexes,
  niceScale,
  pageNumber,
  parseFilters,
  plusMoney,
  popCursor,
  pushCursor,
  rangeDays,
  shownRange,
  toSearch,
  txLabel,
} from './format';

describe('default bucket (TW-CPN-035: 7d daily, up to 90 weekly, all monthly)', () => {
  it('is daily up to 14 days, weekly up to 90, monthly beyond', () => {
    expect(defaultBucket('7d')).toBe('daily');
    expect(defaultBucket('30d')).toBe('weekly');
    expect(defaultBucket('90d')).toBe('weekly');
    expect(defaultBucket('all')).toBe('monthly');
  });
  it('counts "all time" as 1825 days, as Reference did', () => {
    expect(rangeDays('all')).toBe(1825);
  });
  it('is only the fallback: a chosen tab wins, so Daily on 90 days stays daily', () => {
    expect(effectiveBucket({ range: '90d', bucket: 'daily', q: '' })).toBe('daily');
    expect(effectiveBucket({ range: '90d', bucket: null, q: '' })).toBe('weekly');
  });
});

describe('filters in the address', () => {
  it('keeps only what differs from the defaults', () => {
    expect(toSearch(EMPTY_FILTERS)).toBe('');
    expect(toSearch({ range: '7d', bucket: 'monthly', q: 'gmail' })).toBe(
      '?range=7d&bucket=monthly&q=gmail',
    );
  });
  it('reads them back and ignores unknown values', () => {
    expect(parseFilters(new URLSearchParams('range=all&bucket=weekly&q= x '))).toEqual({
      range: 'all',
      bucket: 'weekly',
      q: 'x',
    });
    expect(parseFilters(new URLSearchParams('range=2y&bucket=hourly'))).toEqual(EMPTY_FILTERS);
  });
});

describe('money from minor units (one convention on both screens)', () => {
  it('formats hundredths in the platform currency', () => {
    expect(formatMoney(250, 'USD', 'en')).toBe('$2.50');
    expect(formatMoney(0, 'USD', 'en')).toBe('$0.00');
    expect(plusMoney(250, 'USD', 'en')).toBe('+$2.50');
  });
  it('does not lose cents on large amounts', () => {
    expect(formatMoney(123456789, 'USD', 'en')).toBe('$1,234,567.89');
  });
  it('falls back to the code for a currency the browser does not know', () => {
    expect(formatMoney(250, 'ZZZZ', 'en')).toBe('ZZZZ 2.50');
  });
});

describe('delta colouring and sign', () => {
  it('signs a rise and colours it good', () => {
    expect(deltaView(12)).toEqual({ text: '+12%', tone: 'success' });
  });
  it('shows zero without a sign and still good', () => {
    expect(deltaView(0)).toEqual({ text: '0%', tone: 'success' });
  });
  it('keeps the minus of a fall and colours it bad', () => {
    expect(deltaView(-8)).toEqual({ text: '-8%', tone: 'danger' });
  });
});

describe('referee avatar', () => {
  it('takes the first letters of the first and last word', () => {
    expect(initialsOf('Aisha Khan')).toBe('AK');
    expect(initialsOf('  maria de la cruz ')).toBe('MC');
    expect(initialsOf('Prince')).toBe('P');
    expect(initialsOf('User #42')).toBe('U#');
    expect(initialsOf('')).toBe('?');
  });
  it('picks one of five gradients from the id, the same one every time', () => {
    const id = '0000000f-1111-4111-8111-111111111111';
    expect(avatarIndex(id)).toBe(15 % 5);
    expect(avatarIndex(id)).toBe(avatarIndex(id));
    const seen = new Set(
      Array.from({ length: 20 }, (_, i) => avatarIndex(`${i.toString(16).padStart(8, '0')}-0000`)),
    );
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('wallet tx label', () => {
  it('is tx- and the first 8 characters, or null when unpaid', () => {
    expect(txLabel('abcdef12-3456-4789-8abc-def012345678')).toBe('tx-abcdef12');
    expect(txLabel(null)).toBeNull();
  });
});

describe('Showing a-b of N', () => {
  it('counts from the page and the rows it holds', () => {
    expect(shownRange(1, 20, 20)).toEqual({ from: 1, to: 20 });
    expect(shownRange(3, 20, 5)).toEqual({ from: 41, to: 45 });
    expect(shownRange(1, 20, 0)).toEqual({ from: 0, to: 0 });
  });
});

describe('chart scale', () => {
  it('caps x labels at 10, keeping the first and last', () => {
    const idx = labelIndexes(90);
    expect(idx).toHaveLength(MAX_X_LABELS);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(89);
    expect(labelIndexes(7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(labelIndexes(0)).toEqual([]);
    expect(new Set(labelIndexes(11)).size).toBe(labelIndexes(11).length);
  });
  it('rounds the axis top up to a clean number with even ticks from zero', () => {
    expect(niceScale(37)).toEqual({ max: 40, ticks: [0, 10, 20, 30, 40] });
    expect(niceScale(0, 4, true)).toEqual({ max: 4, ticks: [0, 1, 2, 3, 4] });
    expect(niceScale(2, 4, true).ticks).toEqual([0, 1, 2, 3, 4]);
    const s = niceScale(1234);
    expect(s.max).toBeGreaterThanOrEqual(1234);
    expect(s.ticks[0]).toBe(0);
  });
  it('shortens big axis numbers', () => {
    expect(compactNumber(1200, 'en')).toBe('1.2K');
  });
});

describe('cursor stack (Prev/Next over a cursor API)', () => {
  it('starts on the first page with no cursor', () => {
    expect(currentCursor(FIRST_PAGE)).toBeUndefined();
    expect(pageNumber(FIRST_PAGE)).toBe(1);
  });
  it('pushes on Next and pops on Prev, never below the first page', () => {
    const p2 = pushCursor(FIRST_PAGE, 'c2');
    const p3 = pushCursor(p2, 'c3');
    expect(currentCursor(p3)).toBe('c3');
    expect(pageNumber(p3)).toBe(3);
    expect(currentCursor(popCursor(p3))).toBe('c2');
    expect(popCursor(popCursor(p3))).toEqual(FIRST_PAGE);
    expect(popCursor(FIRST_PAGE)).toEqual(FIRST_PAGE);
  });
});
