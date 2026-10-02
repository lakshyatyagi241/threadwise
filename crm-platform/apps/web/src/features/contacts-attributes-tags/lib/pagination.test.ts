import { describe, expect, it } from 'vitest';
import { clampPage, pageWindow, rangeLabel, totalPages } from './pagination';

describe('totalPages', () => {
  it('rounds up and is never below one', () => {
    expect(totalPages(0, 10)).toBe(1);
    expect(totalPages(1, 10)).toBe(1);
    expect(totalPages(10, 10)).toBe(1);
    expect(totalPages(11, 10)).toBe(2);
    expect(totalPages(53, 10)).toBe(6);
  });
  it('survives nonsense', () => {
    expect(totalPages(Number.NaN, 10)).toBe(1);
    expect(totalPages(50, 0)).toBe(1);
    expect(totalPages(-5, 10)).toBe(1);
  });
});

describe('clampPage', () => {
  it('keeps a page inside 1..pages', () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(9, 5)).toBe(5);
    expect(clampPage(3.7, 5)).toBe(3);
    expect(clampPage(Number.NaN, 5)).toBe(1);
    expect(clampPage(2, 0)).toBe(1);
  });
});

describe('pageWindow', () => {
  it('lists every page when there are few', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('starts as 1 2 3 4 5 ... last', () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 4, 5, 'gap', 20]);
    expect(pageWindow(3, 20)).toEqual([1, 2, 3, 4, 5, 'gap', 20]);
  });
  it('slides a run of five around the current page with a gap on each side', () => {
    expect(pageWindow(10, 20)).toEqual([1, 'gap', 8, 9, 10, 11, 12, 'gap', 20]);
  });
  it('ends as first ... last five', () => {
    expect(pageWindow(20, 20)).toEqual([1, 'gap', 16, 17, 18, 19, 20]);
    expect(pageWindow(18, 20)).toEqual([1, 'gap', 16, 17, 18, 19, 20]);
  });
  it('shows a single skipped page instead of a gap', () => {
    expect(pageWindow(5, 20)).toEqual([1, 2, 3, 4, 5, 6, 7, 'gap', 20]);
    expect(pageWindow(6, 20)).toEqual([1, 'gap', 4, 5, 6, 7, 8, 'gap', 20]);
    expect(pageWindow(4, 20)).toEqual([1, 2, 3, 4, 5, 6, 'gap', 20]);
    expect(pageWindow(17, 20)).toEqual([1, 'gap', 15, 16, 17, 18, 19, 20]);
  });
  it('clamps a current page outside the range and honours another run size', () => {
    expect(pageWindow(99, 20)).toEqual([1, 'gap', 16, 17, 18, 19, 20]);
    expect(pageWindow(10, 30, 7)).toEqual([1, 'gap', 7, 8, 9, 10, 11, 12, 13, 'gap', 30]);
  });
});

describe('rangeLabel', () => {
  it('numbers the rows on the page', () => {
    expect(rangeLabel(1, 10, 10, 53)).toEqual({ from: 1, to: 10, total: 53 });
    expect(rangeLabel(6, 10, 3, 53)).toEqual({ from: 51, to: 53, total: 53 });
    expect(rangeLabel(1, 10, 0, 0)).toEqual({ from: 0, to: 0, total: 0 });
  });
});
