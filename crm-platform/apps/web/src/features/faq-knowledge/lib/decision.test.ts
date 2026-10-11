import { describe, expect, it } from 'vitest';
import { FAQ_MATCH_OUTCOMES, FAQ_VERIFY_VERDICTS, type FaqVerifyInfo } from '@crm/contracts';
import {
  marginOf,
  pct,
  pushHistory,
  scoreBar,
  verdictOf,
  verdictTone,
  isUnansweredOutcome,
  isVetoed,
  originKey,
  verdictWithCheck,
  verifyKind,
  verifyTone,
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

describe('second check helpers', () => {
  const info = (verdict: FaqVerifyInfo['verdict']): FaqVerifyInfo => ({
    verdict,
    model: 'openai/gpt-4o-mini',
    reason: null,
  });
  it('names every verdict once, in the words of the chip', () => {
    expect(FAQ_VERIFY_VERDICTS.map((v) => verifyKind(info(v)))).toEqual([
      'confirmed',
      'vetoed',
      'failed',
      'skipped',
    ]);
  });
  it('colours a veto as a warning, a failed check as a problem and a skipped one as neutral', () => {
    expect(verifyTone('confirmed')).toBe('success');
    expect(verifyTone('vetoed')).toBe('warning');
    expect(verifyTone('failed')).toBe('danger');
    expect(verifyTone('skipped')).toBe('neutral');
  });
  it('turns "below threshold" into "withheld" only when the check said no', () => {
    expect(verdictWithCheck({ outcome: 'below_threshold', verify: info('rejected') })).toBe(
      'vetoed',
    );
    expect(verdictWithCheck({ outcome: 'below_threshold', verify: info('error') })).toBe('below');
    expect(verdictWithCheck({ outcome: 'below_threshold', verify: null })).toBe('below');
    expect(verdictWithCheck({ outcome: 'below_threshold' })).toBe('below');
    // A check that agreed or failed leaves the answer as it was.
    expect(verdictWithCheck({ outcome: 'answered', verify: info('confirmed') })).toBe('answer');
    expect(verdictWithCheck({ outcome: 'answered', verify: info('error') })).toBe('answer');
    expect(verdictTone('vetoed')).toBe('warning');
    expect(isVetoed({ verify: info('rejected') })).toBe(true);
    expect(isVetoed({ verify: null })).toBe(false);
  });
  it('knows which log origins are not a customer message', () => {
    expect(originKey('inbound')).toBeNull();
    expect(originKey('test')).toBe('testRun');
    expect(originKey('flow')).toBe('flowRun');
  });
});
