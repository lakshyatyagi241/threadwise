import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { lineSignature } from './channel-rules';
import { InboundService } from './inbound.service';

/**
 * ASYNC-011/017: a webhook may answer 2xx only when every event of the delivery is durably kept. A failed store used to be logged and
 * answered with 200, so the message was lost. Each failed event is now deferred to the webhook retry queue and the delivery is still
 * answered 200 (the Reference's behaviour); only when a deferral itself fails (nothing was kept) does it answer 503 so LINE redelivers.
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
const stored = { stored: true, newThread: false, conversationId: 1 };

function build(
  recordInbound: (...a: unknown[]) => Promise<unknown>,
  defer = vi.fn().mockResolvedValue(undefined),
) {
  const channel = { id: 4, active: true, channelSecret: 'enc' };
  const db = {
    primary: { execute: async () => ({ rows: [{ channel_org_id: 1, channel_row_id: 4 }] }) },
    txAs: async (_c: unknown, fn: (tx: unknown) => unknown) =>
      fn({ execute: async () => ({ rows: [{ x: 1 }] }) }),
  };
  const handlers = new Map<string, (p: never) => Promise<void>>();
  const retry = {
    defer,
    register: (c: string, h: (p: never) => Promise<void>) => handlers.set(c, h),
  };
  const svc = new InboundService(
    db as never,
    { findById: async () => channel, touchInbound: async () => undefined } as never,
    { decrypt: () => SECRET } as never,
    {} as never,
    { incr: async () => 1, expire: async () => 1 } as never,
    {} as never,
    { recordInbound } as never,
    { handoffToFlow: async () => false, automate: async () => undefined } as never,
    retry as never,
  );
  svc.onModuleInit();
  return { svc, defer, handlers };
}

describe('line InboundService durability', () => {
  it('acknowledges a delivery whose events were all stored', async () => {
    const b = body(event(1), event(2));
    const { svc, defer } = build(async () => stored);
    expect(await svc.ingest('tok', b, sig(b))).toMatchObject({ kind: 'ack' });
    expect(defer).not.toHaveBeenCalled();
  });

  it('defers only the event it failed to store, tries the others, and still answers 200', async () => {
    const recordInbound = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(stored);
    const b = body(event(1), event(2));
    const { svc, defer } = build(recordInbound);
    expect(await svc.ingest('tok', b, sig(b))).toMatchObject({ kind: 'ack' });
    expect(recordInbound).toHaveBeenCalledTimes(2);
    expect(defer).toHaveBeenCalledTimes(1);
    expect(defer.mock.calls[0]![0]).toBe('line');
    expect(defer.mock.calls[0]![1]).toMatchObject({
      orgId: 1,
      channelId: 4,
      event: { webhookEventId: 'WE1' },
    });
  });

  it('answers 503 when a deferral itself fails, because nothing was kept and LINE must redeliver', async () => {
    const b = body(event(1));
    const { svc } = build(
      vi.fn().mockRejectedValue(new Error('db down')),
      vi.fn().mockRejectedValue(new Error('redis down')),
    );
    const err = await svc.ingest('tok', b, sig(b)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('acknowledges a rule the data broke (an AppError) without deferring: a retry would fail the same way', async () => {
    const b = body(event(1));
    const { svc, defer } = build(
      vi.fn().mockRejectedValue(new AppError(ERROR_CODES.VALIDATION_FAILED, 'bad shape')),
    );
    expect(await svc.ingest('tok', b, sig(b))).toMatchObject({ kind: 'ack' });
    expect(defer).not.toHaveBeenCalled();
  });

  it('registers a retry handler that stores the deferred event, and lets a failure surface for the queue to retry', async () => {
    const record = vi
      .fn()
      .mockResolvedValueOnce(stored)
      .mockRejectedValueOnce(new Error('still down'));
    const { handlers } = build(record);
    const run = handlers.get('line')!;
    const payload = { orgId: 1, channelId: 4, event: event(1) };
    await expect(run(payload as never)).resolves.toBeUndefined();
    await expect(run(payload as never)).rejects.toThrow('still down');
  });
});
