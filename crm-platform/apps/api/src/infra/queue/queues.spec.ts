import { describe, expect, it } from 'vitest';
import { QUEUES, jobOptionsFor } from './queues';

/** Total time a BullMQ exponential backoff keeps a job alive: delay * (2^(attempts-1) - 1). */
const retryWindowSeconds = (queue: (typeof QUEUES)[keyof typeof QUEUES]): number => {
  const o = jobOptionsFor(queue);
  const attempts = o.attempts ?? 1;
  const b = o.backoff;
  const delay = typeof b === 'object' ? (b.delay ?? 0) : 0;
  return (delay * (2 ** (attempts - 1) - 1)) / 1000;
};

describe('job options of the inbound webhook queue', () => {
  it('rides out an outage of at least 30 minutes before a WhatsApp payload is given up on (ASYNC-032/036)', () => {
    // The default (5 attempts, 2 s) gave up after about 30 seconds: a short database or Redis blip lost inbound messages.
    expect(retryWindowSeconds(QUEUES.WABA_INGEST)).toBeGreaterThanOrEqual(30 * 60);
  });

  it('keeps the raw payload of a job that still failed, so it can be replayed (ASYNC-041)', () => {
    expect(jobOptionsFor(QUEUES.WABA_INGEST).removeOnFail).toBeTruthy();
  });

  it('still drops the personal payload once the job completed', () => {
    expect(jobOptionsFor(QUEUES.WABA_INGEST).removeOnComplete).toBe(true);
  });
});

describe('job options of the channel webhook retry queue', () => {
  it('keeps an inbound event for at least 30 minutes of retries, like the WhatsApp ingest queue', () => {
    expect(retryWindowSeconds(QUEUES.WEBHOOK_RETRY)).toBeGreaterThanOrEqual(30 * 60);
  });

  it('keeps failed events for replay and drops completed ones (they carry message text)', () => {
    expect(jobOptionsFor(QUEUES.WEBHOOK_RETRY).removeOnFail).toBeTruthy();
    expect(jobOptionsFor(QUEUES.WEBHOOK_RETRY).removeOnComplete).toBe(true);
  });
});
