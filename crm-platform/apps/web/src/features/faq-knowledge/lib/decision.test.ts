import { describe, expect, it } from 'vitest';
import { FAQ_MATCH_OUTCOMES } from '@crm/contracts';
import {
  marginOf,
  pct,
  pushHistory,
  scoreBar,
  verdictOf,
  verdictTone,
  isUnansweredOutcome,
} from './decision';

describe('decision helpers', () => {
  it('maps every outcome to a verdict', () => {
    for (const o of FAQ_MATCH_OUTCOMES) expect(verdictOf(o)).toBeTruthy();
    expect(verdictOf('answered')).toBe('answer');
    expect(verdictOf('flow_started')).toBe('answer');
    expect(verdictOf('low_margin')).toBe('ambiguous');
    expect(verdictTone('providerError')).toBe('danger');
    expect(verdictTone('answer')).toBe('success');
  });
  it('places the fill and the marker, and says whether the bar was reached', () => {
    expect(scoreBar(0.62, 0.45)).toEqual({ fillPct: 62, markerPct: 45, reached: true });
    expect(scoreBar(0.3, 0.45).reached).toBe(false);
    expect(scoreBar(null, 0.45)).toEqual({ fillPct: 0, markerPct: 45, reached: false });
    expect(pct(1.4)).toBe(100);
  });
  it('computes the lead only when both scores exist', () => {
    expect(marginOf({ score: 0.7, secondScore: 0.55 })).toBeCloseTo(0.15);
    expect(marginOf({ score: 0.7, secondScore: null })).toBeNull();
  });
  it('keeps the last ten runs, moving a repeated text to the top', () => {
    let h: Array<{ query: string }> = [];
    for (let i = 0; i < 12; i++) h = pushHistory(h, { query: `q${i}` });
    expect(h).toHaveLength(10);
    expect(h[0]!.query).toBe('q11');
    h = pushHistory(h, { query: 'q5' });
    expect(h.map((x) => x.query).filter((q) => q === 'q5')).toHaveLength(1);
    expect(h[0]!.query).toBe('q5');
  });
  it('knows the unanswered outcomes', () => {
    expect(isUnansweredOutcome('below_threshold')).toBe(true);
    expect(isUnansweredOutcome('answered')).toBe(false);
  });
});
