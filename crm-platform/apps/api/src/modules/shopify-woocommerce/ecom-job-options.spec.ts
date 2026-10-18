import { describe, expect, it } from 'vitest';
import { INBOUND_RETRY } from '../../infra/queue/queues';
import { ECOM_DELIVERY_JOB_OPTIONS } from './webhook.service';

describe('the store webhook job', () => {
  it('rides out an outage of about 40 minutes: the store has our 200 and its own redelivery is blocked for a day (DLQ audit DF-03)', () => {
    expect(ECOM_DELIVERY_JOB_OPTIONS.attempts).toBe(INBOUND_RETRY.attempts);
    expect(ECOM_DELIVERY_JOB_OPTIONS.backoff).toEqual(INBOUND_RETRY.backoff);
    const { delay, jitter } = ECOM_DELIVERY_JOB_OPTIONS.backoff;
    expect(
      (delay * (1 - jitter) * (2 ** (ECOM_DELIVERY_JOB_OPTIONS.attempts - 1) - 1)) / 1000,
    ).toBeGreaterThanOrEqual(30 * 60);
  });

  it('drops a completed delivery (it carries order data) and keeps failed ones for the failure record to find', () => {
    expect(ECOM_DELIVERY_JOB_OPTIONS.removeOnComplete).toBe(true);
    expect(ECOM_DELIVERY_JOB_OPTIONS.removeOnFail).toBeGreaterThan(0);
  });
});
