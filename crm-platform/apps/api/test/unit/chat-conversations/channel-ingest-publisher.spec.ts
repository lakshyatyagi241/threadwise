import { describe, expect, it, vi } from 'vitest';
import {
  CHANNEL_INGEST_JOB,
  channelIngestJobSchema,
} from '../../../src/infra/providers/chat-conversations';
import { ChannelIngestPublisher } from '../../../src/modules/chat-conversations/channel-ingest.publisher';

const CH = '33333333-3333-4333-8333-333333333333';
const message = {
  providerMessageId: 'wamid.ABC',
  peerKey: '919876543210',
  kind: 'text' as const,
  body: 'hi',
  providerTimestamp: new Date('2026-10-10T12:00:00Z'),
};

function build() {
  const add = vi.fn(async (..._args: unknown[]) => undefined);
  return { add, publisher: new ChannelIngestPublisher({ add } as never) };
}

describe('ChannelIngestPublisher', () => {
  it('queues an inbound message as a JSON-safe job that the ingest schema accepts', async () => {
    const { add, publisher } = build();
    const jobId = await publisher.enqueueInbound(7, CH, message);
    const [name, data, opts] = add.mock.calls[0] as unknown as [string, unknown, { jobId: string }];
    expect(name).toBe(CHANNEL_INGEST_JOB);
    expect(opts.jobId).toBe(jobId);
    expect(channelIngestJobSchema.parse(JSON.parse(JSON.stringify(data)))).toMatchObject({
      type: 'inbound',
      orgId: 7,
      channelUuid: CH,
      message: { providerMessageId: 'wamid.ABC', providerTimestamp: '2026-10-10T12:00:00.000Z' },
    });
  });

  it('job ids never contain a colon (BullMQ reserves it), and a redelivery of one message shares the id', async () => {
    const { publisher } = build();
    const a = await publisher.enqueueInbound(7, CH, message);
    const b = await publisher.enqueueInbound(7, CH, message);
    expect(a).toBe(b);
    expect(a).not.toContain(':');
  });

  it('a numbered copy gets its own id so the same message can go through the pipeline again (the simulator /dup)', async () => {
    const { publisher } = build();
    const ids = await Promise.all(
      [0, 1, 2].map((c) => publisher.enqueueInbound(7, CH, message, c)),
    );
    expect(new Set(ids).size).toBe(3);
  });

  it('queues a receipt with its delay; a unique one never collapses into an earlier receipt', async () => {
    const { add, publisher } = build();
    const receipt = {
      providerMessageId: 'p1',
      status: 'read' as const,
      at: new Date('2026-10-10T12:00:03Z'),
    };
    const same1 = await publisher.enqueueReceipt(7, CH, receipt, { delayMs: 3000 });
    const same2 = await publisher.enqueueReceipt(7, CH, receipt);
    const u1 = await publisher.enqueueReceipt(7, CH, receipt, { unique: true });
    const u2 = await publisher.enqueueReceipt(7, CH, receipt, { unique: true });
    expect(same1).toBe(same2);
    expect(u1).not.toBe(u2);
    const opts = add.mock.calls[0]![2] as unknown as { delay: number };
    expect(opts.delay).toBe(3000);
    const job = channelIngestJobSchema.parse(JSON.parse(JSON.stringify(add.mock.calls[0]![1])));
    expect(job).toMatchObject({
      type: 'receipt',
      receipt: { status: 'read', at: '2026-10-10T12:00:03.000Z' },
    });
  });
});
