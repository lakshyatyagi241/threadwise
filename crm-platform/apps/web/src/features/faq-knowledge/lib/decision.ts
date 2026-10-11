import type { FaqMatchDecision, FaqMatchOutcome, FaqMatchTier } from '@crm/contracts';

/** The six things a decision can come to, as the screens name them. */
export type Verdict = 'answer' | 'below' | 'ambiguous' | 'noFaqs' | 'providerError' | 'notSent';

export function verdictOf(outcome: FaqMatchOutcome): Verdict {
  switch (outcome) {
    case 'answered':
    case 'flow_started':
      return 'answer';
    case 'below_threshold':
      return 'below';
    case 'low_margin':
      return 'ambiguous';
    case 'no_faqs':
      return 'noFaqs';
    case 'provider_error':
      return 'providerError';
    case 'not_sent':
      return 'notSent';
  }
}

export const verdictTone = (v: Verdict): 'success' | 'warning' | 'danger' | 'neutral' =>
  v === 'answer'
    ? 'success'
    : v === 'providerError'
      ? 'danger'
      : v === 'noFaqs'
        ? 'neutral'
        : 'warning';

/** Unanswered customer messages are the three outcomes where no FAQ reached the bar. */
export const isUnansweredOutcome = (o: FaqMatchOutcome): boolean =>
  o === 'below_threshold' || o === 'low_margin' || o === 'no_faqs';

export const tierKey = (t: FaqMatchTier | null): 'exact' | 'semantic' | 'trigram' | 'none' =>
  t ?? 'none';

/** Whole percent of a 0..1 score, clamped. */
export const pct = (score: number): number => Math.round(Math.min(1, Math.max(0, score)) * 100);

/** Where the score fill and the threshold marker sit on a 0-100% track. */
export function scoreBar(score: number | null, threshold: number) {
  return {
    fillPct: score === null ? 0 : pct(score),
    markerPct: pct(threshold),
    reached: score !== null && score >= threshold,
  };
}

/** Lead over the runner-up, when both exist. */
export function marginOf(d: Pick<FaqMatchDecision, 'score' | 'secondScore'>): number | null {
  return d.score !== null && d.secondScore !== null ? d.score - d.secondScore : null;
}

/** The decision recorded for a single message and the playground's decision share these fields. */
export const decisionWouldAnswer = (d: Pick<FaqMatchDecision, 'outcome'>): boolean =>
  verdictOf(d.outcome) === 'answer';

/** Last ten playground runs, newest first, the same text moved to the top rather than listed twice. */
export function pushHistory<T extends { query: string }>(
  list: readonly T[],
  entry: T,
  max = 10,
): T[] {
  return [entry, ...list.filter((h) => h.query !== entry.query)].slice(0, max);
}
