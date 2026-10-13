import type { InfiniteData } from '@tanstack/react-query';
import type { FaqLogItem, FaqLogResponse } from '@crm/contracts';
import { isUnansweredOutcome, isVetoed } from './decision';

export type LogView = 'all' | 'answered' | 'unanswered' | 'errors';
export const LOG_VIEWS: readonly LogView[] = ['all', 'answered', 'unanswered', 'errors'];

/** Optimistic dismiss/learn: the row leaves every loaded page at once; the caller keeps the old data to roll back to. */
export function withoutLog(
  data: InfiniteData<FaqLogResponse> | undefined,
  id: string,
): InfiniteData<FaqLogResponse> | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((p) => ({ ...p, data: p.data.filter((row) => row.id !== id) })),
  };
}

export type WhyKey =
  | 'belowThreshold'
  | 'vetoed'
  | 'lowMargin'
  | 'noFaqs'
  | 'providerError'
  | 'notSent'
  | 'answered'
  | 'flowStarted';

/** Why a message was (not) answered, in the message-file vocabulary. */
export function whyKey(
  row: Pick<FaqLogItem, 'outcome'> & Partial<Pick<FaqLogItem, 'verify'>>,
): WhyKey {
  if (row.outcome === 'below_threshold' && isVetoed(row)) return 'vetoed';
  switch (row.outcome) {
    case 'below_threshold':
      return 'belowThreshold';
    case 'low_margin':
      return 'lowMargin';
    case 'no_faqs':
      return 'noFaqs';
    case 'provider_error':
      return 'providerError';
    case 'not_sent':
      return 'notSent';
    case 'flow_started':
      return 'flowStarted';
    default:
      return 'answered';
  }
}

export const canLearn = (row: Pick<FaqLogItem, 'query' | 'outcome'>): boolean =>
  row.query !== null && isUnansweredOutcome(row.outcome);

/** Bar heights as a share of the tallest day, so a quiet week is not stretched to full height. */
export function dailyScale(daily: ReadonlyArray<{ answered: number; unanswered: number }>) {
  const max = Math.max(1, ...daily.map((d) => d.answered + d.unanswered));
  return daily.map((d) => ({
    answeredPct: (d.answered / max) * 100,
    unansweredPct: (d.unanswered / max) * 100,
  }));
}

export function histogramMax(h: ReadonlyArray<{ answered: number; unanswered: number }>): number {
  return Math.max(1, ...h.map((b) => b.answered + b.unanswered));
}

/** The bucket (0..9) a threshold falls in, and how far across it, as a percent of the whole 0-1 axis. */
export const thresholdPosition = (threshold: number): number =>
  Math.min(100, Math.max(0, threshold * 100));
