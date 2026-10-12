import type { InfiniteData } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { FaqLogResponse } from '@crm/contracts';
import {
  canLearn,
  dailyScale,
  histogramMax,
  thresholdPosition,
  whyKey,
  withoutLog,
} from './log-model';

const row = (id: string) => ({ id }) as never;
const data: InfiniteData<FaqLogResponse> = {
  pageParams: [undefined, 'c'],
  pages: [
    { data: [row('1'), row('2')], page: { nextCursor: 'c', hasMore: true, limit: 2 } },
    { data: [row('3')], page: { nextCursor: null, hasMore: false, limit: 2 } },
  ],
};

describe('unanswered optimistic removal', () => {
  it('removes the row from whichever page holds it and leaves the original untouched (for rollback)', () => {
    const next = withoutLog(data, '3')!;
    expect(next.pages.map((p) => p.data.length)).toEqual([2, 0]);
    expect(data.pages[1]!.data).toHaveLength(1);
    expect(withoutLog(undefined, '1')).toBeUndefined();
  });
});

describe('log helpers', () => {
  it('explains each outcome', () => {
    expect(whyKey({ outcome: 'below_threshold' })).toBe('belowThreshold');
    expect(whyKey({ outcome: 'low_margin' })).toBe('lowMargin');
    expect(whyKey({ outcome: 'no_faqs' })).toBe('noFaqs');
    expect(whyKey({ outcome: 'answered' })).toBe('answered');
  });
  it('only a kept, unanswered message can be learned', () => {
    expect(canLearn({ query: 'hi', outcome: 'below_threshold' })).toBe(true);
    expect(canLearn({ query: null, outcome: 'below_threshold' })).toBe(false);
    expect(canLearn({ query: 'hi', outcome: 'answered' })).toBe(false);
  });
  it('scales charts to their tallest value', () => {
    expect(
      dailyScale([
        { answered: 5, unanswered: 5 },
        { answered: 1, unanswered: 0 },
      ]).map((d) => d.answeredPct),
    ).toEqual([50, 10]);
    expect(histogramMax([])).toBe(1);
    expect(thresholdPosition(1.4)).toBe(100);
  });
});

describe('whyKey and the second check', () => {
  const verify = (verdict: 'confirmed' | 'rejected' | 'error' | 'skipped') => ({
    verdict,
    model: 'm',
    reason: null,
  });
  it('explains a veto in its own words, not as "below the bar"', () => {
    expect(whyKey({ outcome: 'below_threshold', verify: verify('rejected') })).toBe('vetoed');
    expect(whyKey({ outcome: 'below_threshold', verify: verify('skipped') })).toBe(
      'belowThreshold',
    );
    expect(whyKey({ outcome: 'below_threshold' })).toBe('belowThreshold');
    expect(whyKey({ outcome: 'answered', verify: verify('error') })).toBe('answered');
  });
});
