import { describe, expect, it } from 'vitest';
import {
  OUTBOX_BACKOFF_CAP_SECONDS,
  OUTBOX_MAX_ATTEMPTS,
  outboxRetryDecision,
} from './outbox-retry-policy';

/** ASYNC-032/033/036/040: bounded retries, long enough to ride out an outage, jittered so a recovery is not a stampede. */
describe('outboxRetryDecision', () => {
  it('keeps retrying an event through an outage of at least two hours before dead-lettering', () => {
    let total = 0;
    for (let attempts = 1; attempts < OUTBOX_MAX_ATTEMPTS; attempts += 1) {
      const d = outboxRetryDecision(attempts, () => 0);
      expect(d.dead).toBe(false);
      total += d.backoffSeconds;
    }
    // Lower bound of the jitter band, so the real window is never shorter than this.
    expect(total).toBeGreaterThanOrEqual(2 * 60 * 60);
  });

  it('dead-letters at exactly OUTBOX_MAX_ATTEMPTS', () => {
    expect(outboxRetryDecision(OUTBOX_MAX_ATTEMPTS - 1, () => 0.5).dead).toBe(false);
    expect(outboxRetryDecision(OUTBOX_MAX_ATTEMPTS, () => 0.5).dead).toBe(true);
  });

  it('caps the delay at the configured ceiling even at the top of the jitter band', () => {
    const d = outboxRetryDecision(OUTBOX_MAX_ATTEMPTS - 1, () => 0.999999);
    expect(d.backoffSeconds).toBeLessThanOrEqual(OUTBOX_BACKOFF_CAP_SECONDS);
  });

  it('spreads retries of the same attempt over a band instead of one instant', () => {
    const low = outboxRetryDecision(10, () => 0).backoffSeconds;
    const high = outboxRetryDecision(10, () => 0.999999).backoffSeconds;
    expect(high).toBeGreaterThan(low);
  });

  it('grows with the attempt number until the cap', () => {
    const early = outboxRetryDecision(2, () => 0.5).backoffSeconds;
    const later = outboxRetryDecision(6, () => 0.5).backoffSeconds;
    expect(later).toBeGreaterThan(early);
  });
});
