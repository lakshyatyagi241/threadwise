import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../common/errors/app-error';
import { lineSignature } from './channel-rules';
import { InboundService } from './inbound.service';

/**
 * ASYNC-017/050: a webhook may only answer 2xx once every event of the delivery is durably stored. A failed store used to be logged
 * and answered with 200, so LINE never redelivered and the message was lost. The inbox write is idempotent per webhook event id, so a
 * redelivery of the whole batch is safe.
 */
const SECRET = 'line-secret';
const event = (n: number) => ({
  type: 'message',
  mode: 'active',
  timestamp: 1_700_000_000_000 + n,
  source: { type: 'user', userId: `U${n}` },
  webhookEventId: `WE${n}`,
  replyToken: `rt${n}`,
  message: { type: 'text', id: `m${n}`, text: 'hi' },
});
const body = (...events: object[]) => Buffer.from(JSON.stringify({ destination: 'Ubot', events }));
const sig = (b: Buffer) => lineSignature(b, SECRET);

function build(recordInbound: (...a: unknown[]) => Promise<unknown>) {
  const channel = { id: 4, active: true, channelSecret: 'enc' };
  const db = {
    primary: { execute: async () => ({ rows: [{ channel_org_id: 1, channel_row_id: 4 }] }) },
    txAs: async (_c: unknown, fn: (tx: unknown) => unknown) =>
      fn({ execute: async () => ({ rows: [{ x: 1 }] }) }),
  };
  return new InboundService(
    db as never,
    { findById: async () => channel, touchInbound: async () => undefined } as never,
    { decrypt: () => SECRET } as never,
    {} as never,
    { incr: async () => 1, expire: async () => 1 } as never,
    {} as never,
    { recordInbound } as never,
    { handoffToFlow: async () => false, automate: async () => undefined } as never,
  );
}

const stored = { stored: true, newThread: false, conversationId: 1 };

describe('line InboundService durability', () => {
  it('acknowledges a delivery whose events were all stored', async () => {
    const b = body(event(1), event(2));
    const r = await build(async () => stored).ingest('tok', b, sig(b));
    expect(r).toMatchObject({ kind: 'ack' });
  });

  it('still tries every event of the batch, then does NOT acknowledge if one failed to store', async () => {
    const recordInbound = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(stored);
    const b = body(event(1), event(2));
    const err = await build(recordInbound)
      .ingest('tok', b, sig(b))
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(recordInbound).toHaveBeenCalledTimes(2);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });
});
