import { describe, expect, it } from 'vitest';
import { QUEUES, jobOptionsFor } from '../../infra/queue/queues';
import { FAILURE_POLICIES, parseReplayJobId, replayJobId } from './failure-policy';

const UUID = '3f0c2d1e-5b7a-4c1d-9e2f-1a2b3c4d5e6f';

describe('replay job ids', () => {
  it('round-trips the record and the replay number', () => {
    expect(parseReplayJobId(replayJobId(UUID, 2))).toEqual({ uuid: UUID, replay: 2 });
  });

  it.each([undefined, '', 'ingest-abc', `dlq-${UUID}`, `dlq-not-a-uuid-1`, `xdlq-${UUID}-1`])(
    '%s is not a replay id',
    (id) => {
      expect(parseReplayJobId(id)).toBeNull();
    },
  );
});

describe('the failure policy', () => {
  it('covers the queues whose job is the only copy of acknowledged work', () => {
    expect(FAILURE_POLICIES.map((p) => p.queue).sort()).toEqual(
      [
        QUEUES.WEBHOOK_INGEST,
        QUEUES.WABA_INGEST,
        QUEUES.WEBHOOK_RETRY,
        QUEUES.ECOM_WEBHOOK,
        QUEUES.TELEPHONY_INGEST,
      ].sort(),
    );
  });

  it('bounds every redrive: a finite count, a cooldown and an age', () => {
    for (const p of FAILURE_POLICIES) {
      expect(p.maxReplays).toBeGreaterThan(0);
      expect(p.maxReplays).toBeLessThanOrEqual(5);
      expect(p.cooldownMs).toBeGreaterThanOrEqual(30_000);
      expect(p.maxAgeMs).toBeGreaterThan(0);
    }
  });

  it('reads the workspace from the payload only when it names one', () => {
    const ingest = FAILURE_POLICIES.find((p) => p.queue === QUEUES.WEBHOOK_INGEST)!;
    expect(ingest.orgOf({ orgId: 7 })).toBe(7);
    expect(ingest.orgOf({ orgId: '7' })).toBeNull();
    expect(ingest.orgOf({ orgId: -1 })).toBeNull();
    expect(ingest.orgOf(null)).toBeNull();
    expect(
      FAILURE_POLICIES.find((p) => p.queue === QUEUES.WABA_INGEST)!.orgOf({ orgId: 7 }),
    ).toBeNull();
  });

  it('every queue whose options come from the queue module rides out a 30 minute outage (the work exists nowhere else)', () => {
    // ecom-webhook and telephony-ingest set their options at the producer; their own specs assert the same window.
    for (const p of FAILURE_POLICIES.filter(
      (x) => x.queue !== QUEUES.ECOM_WEBHOOK && x.queue !== QUEUES.TELEPHONY_INGEST,
    )) {
      expect(jobOptionsFor(p.queue).attempts, p.queue).toBeGreaterThanOrEqual(10);
    }
  });
});
