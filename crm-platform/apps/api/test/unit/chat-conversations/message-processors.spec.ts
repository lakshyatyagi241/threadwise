import { DelayedError, UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { ChannelError } from '../../../src/infra/providers/chat-conversations';
import {
  ChannelIngestProcessor,
  UNKNOWN_RECEIPT_GRACE_MS,
} from '../../../src/modules/chat-conversations/channel-ingest.processor';
import {
  MESSAGE_SEND_JOB,
  MESSAGE_SEND_JOB_OPTIONS,
  messageSendJobId,
} from '../../../src/modules/chat-conversations/message-dispatch.job';
import { MessageDispatchProcessor } from '../../../src/modules/chat-conversations/message-dispatch.processor';

const CH = '11111111-1111-4111-8111-111111111111';
const MSG = '22222222-2222-4222-8222-222222222222';

const inboundJob = (over: Record<string, unknown> = {}) => ({
  name: 'channel.ingest',
  id: 'j1',
  attemptsMade: 0,
  timestamp: Date.now(),
  opts: { attempts: 5 },
  data: {
    type: 'inbound',
    orgId: 7,
    channelUuid: CH,
    message: {
      providerMessageId: 'p1',
      peerKey: '919876543210',
      kind: 'text',
      body: 'hi',
      providerTimestamp: '2026-10-02T10:00:00.000Z',
    },
    ...over,
  },
});

const receiptJob = (over: Record<string, unknown> = {}) => ({
  name: 'channel.ingest',
  id: 'j2',
  attemptsMade: 0,
  timestamp: Date.now(),
  opts: { attempts: 5 },
  data: {
    type: 'receipt',
    orgId: 7,
    channelUuid: CH,
    receipt: { providerMessageId: 'p1', status: 'delivered', at: '2026-10-02T10:00:01.000Z' },
  },
  ...over,
});

function ingestProcessor(
  ingest = vi.fn(async () => ({ outcome: 'stored' })),
  apply = vi.fn(async () => 'applied'),
) {
  return {
    p: new ChannelIngestProcessor({ ingest } as never, { apply } as never),
    ingest,
    apply,
  };
}

describe('ChannelIngestProcessor (webhook-ingest)', () => {
  it('runs an inbound job as a system actor of the job workspace and reports the outcome', async () => {
    const { p, ingest } = ingestProcessor();
    await expect(p.process(inboundJob() as never)).resolves.toBe('stored');
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it('tells the pipeline when this is the last attempt, so a failed file download cannot lose the text', async () => {
    const { p, ingest } = ingestProcessor();
    await p.process(inboundJob({}) as never);
    expect((ingest.mock.calls as unknown as unknown[][])[0]![1]).toEqual({ finalAttempt: false });
    await p.process({ ...inboundJob(), attemptsMade: 4 } as never);
    expect((ingest.mock.calls as unknown as unknown[][])[1]![1]).toEqual({ finalAttempt: true });
  });

  it('a job that does not parse, or is not ours, is unrecoverable (retrying cannot fix it)', async () => {
    const { p } = ingestProcessor();
    await expect(
      p.process({ ...inboundJob(), name: 'something.else' } as never),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(
      p.process({ ...inboundJob(), data: { type: 'inbound', orgId: 'x' } } as never),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('a receipt that is applied, or recorded and ignored, completes', async () => {
    for (const outcome of ['applied', 'ignored', 'channel_missing']) {
      const { p } = ingestProcessor(
        undefined,
        vi.fn(async () => outcome),
      );
      await expect(p.process(receiptJob() as never)).resolves.toBe(outcome);
    }
  });

  it('a fresh receipt for a message that is not stored yet goes back through the queue (it may have beaten the send commit)', async () => {
    const { p } = ingestProcessor(
      undefined,
      vi.fn(async () => 'unknown'),
    );
    await expect(p.process(receiptJob() as never)).rejects.toThrow(/not stored yet/);
  });

  it('an old receipt for an unknown id is dropped, not retried forever', async () => {
    const { p } = ingestProcessor(
      undefined,
      vi.fn(async () => 'unknown'),
    );
    const old = receiptJob({ timestamp: Date.now() - UNKNOWN_RECEIPT_GRACE_MS - 1_000 });
    await expect(p.process(old as never)).resolves.toBe('unknown');
  });
});

describe('MessageDispatchProcessor (message-dispatch)', () => {
  const sendJob = (over: Record<string, unknown> = {}) => ({
    name: MESSAGE_SEND_JOB,
    id: `msg-${MSG}-1`,
    attemptsMade: 0,
    opts: { attempts: 8 },
    data: { orgId: 7, messageUuid: MSG, generation: 1 },
    moveToDelayed: vi.fn(async () => undefined),
    ...over,
  });

  const processor = (dispatch: ReturnType<typeof vi.fn>) =>
    new MessageDispatchProcessor({ dispatch } as never);

  it('dispatches the message of the job for its workspace, with the attempt number', async () => {
    const dispatch = vi.fn(async () => 'sent');
    await expect(
      processor(dispatch).process(sendJob({ attemptsMade: 2 }) as never, 't'),
    ).resolves.toBe('sent');
    expect(dispatch).toHaveBeenCalledWith(7, MSG, { attempt: 3, finalAttempt: false });
  });

  it('marks the last attempt, where a retryable error ends the message failed', async () => {
    const dispatch = vi.fn(async () => 'failed');
    await processor(dispatch).process(sendJob({ attemptsMade: 7 }) as never, 't');
    expect(dispatch).toHaveBeenCalledWith(7, MSG, { attempt: 8, finalAttempt: true });
  });

  it('a message another worker is sending is delayed, never retried (it must not use up the attempts a real failure needs)', async () => {
    const job = sendJob();
    const dispatch = vi.fn(async () => {
      throw new ChannelError('DISPATCH_IN_FLIGHT', 'busy', true);
    });
    await expect(processor(dispatch).process(job as never, 'tok')).rejects.toBeInstanceOf(
      DelayedError,
    );
    expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
  });

  it('a retryable provider error is rethrown so the queue backs off and tries again', async () => {
    const err = new ChannelError('SIM_FLAKY', 'flaky', true);
    const dispatch = vi.fn(async () => {
      throw err;
    });
    await expect(processor(dispatch).process(sendJob() as never, 't')).rejects.toBe(err);
  });

  it('a job that is not a send, or does not parse, is unrecoverable', async () => {
    const p = processor(vi.fn());
    await expect(p.process(sendJob({ name: 'other' }) as never, 't')).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    await expect(
      p.process(
        sendJob({ data: { orgId: 7, messageUuid: 'not-a-uuid', generation: 1 } }) as never,
        't',
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

describe('the send job', () => {
  it('has one job id per message and generation: a repeat is a no-op, a manual Retry is a new job', () => {
    expect(messageSendJobId(MSG, 1)).toBe(`msg-${MSG}-1`);
    expect(messageSendJobId(MSG, 2)).not.toBe(messageSendJobId(MSG, 1));
    expect(messageSendJobId(MSG, 1)).not.toContain(':');
  });

  it("retries long enough that a killed worker's send lock (60 s) has expired before the last attempt", () => {
    const { attempts, backoff } = MESSAGE_SEND_JOB_OPTIONS;
    // Exponential backoff: delay * 2^(n-1) before attempt n+1; the sum before the last attempt is delay * (2^(attempts-1) - 1).
    const waitedBeforeLastAttempt = backoff.delay * (2 ** (attempts - 1) - 1);
    expect(waitedBeforeLastAttempt).toBeGreaterThan(60_000);
  });
});
