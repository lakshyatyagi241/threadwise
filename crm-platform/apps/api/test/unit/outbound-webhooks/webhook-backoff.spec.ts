import { describe, expect, it } from 'vitest';
import {
  DELIVERY_BACKOFF_MS,
  RetryAfterError,
  webhookBackoffStrategy,
} from '../../../src/modules/outbound-webhooks/webhook-job';

describe('customer webhook backoff (RF-06, RF-07)', () => {
  it('waits at least as long as the endpoint asked, and no more than an hour', () => {
    const err = new RetryAfterError('HTTP 429', 90_000);
    for (let i = 0; i < 500; i++) {
      const d = webhookBackoffStrategy(2, 'custom', err);
      expect(d).toBeGreaterThanOrEqual(90_000);
      expect(d).toBeLessThanOrEqual(112_500);
    }
    expect(webhookBackoffStrategy(1, 'custom', new RetryAfterError('x', 10 ** 9))).toBe(3_600_000);
  });

  it('without a hint it is the jittered 10 s doubling schedule', () => {
    for (let n = 1; n <= 6; n++) {
      const full = DELIVERY_BACKOFF_MS * 2 ** (n - 1);
      for (let i = 0; i < 200; i++) {
        const d = webhookBackoffStrategy(n, 'custom', new Error('HTTP 500'));
        expect(d).toBeGreaterThanOrEqual(full / 2);
        expect(d).toBeLessThanOrEqual(full);
      }
    }
  });
});
