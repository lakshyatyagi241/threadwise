import { describe, expect, it } from 'vitest';
import { INBOUND_RETRY } from '../../../infra/queue/queues';
import { TELEPHONY_JOB_OPTIONS } from './telephony-webhook.service';

describe('the telephony callback job', () => {
  it('rides out an outage of about 40 minutes: the callback is acked before anything is stored (DLQ audit DF-04)', () => {
    expect(TELEPHONY_JOB_OPTIONS.attempts).toBe(INBOUND_RETRY.attempts);
    const { delay, jitter } = TELEPHONY_JOB_OPTIONS.backoff;
    expect(
      (delay * (1 - jitter) * (2 ** (TELEPHONY_JOB_OPTIONS.attempts - 1) - 1)) / 1000,
    ).toBeGreaterThanOrEqual(30 * 60);
  });
});
