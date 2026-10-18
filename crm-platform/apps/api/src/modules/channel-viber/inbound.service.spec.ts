import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { InboundService } from './inbound.service';

// The signature check has its own tests; here it only has to let the delivery through to the store.
vi.mock('./channel-rules', async (orig) => ({
  ...(await orig<typeof import('./channel-rules')>()),
  signatureMatches: () => true,
}));

/**
 * ASYNC-011/017: a webhook may answer 2xx only when the event is durably kept. A failed store used to be logged and answered with 200,
 * so the customer's message was lost. It is now deferred to the webhook retry queue and still answered 200 (the Reference's
 * behaviour); only when the deferral itself fails (nothing was kept) does it answer 503 so Viber redelivers.
 */
const AUTH = 'viber-auth-token';
const raw = Buffer.from(
  JSON.stringify({
    event: 'message',
    timestamp: 1_700_000_000_000,
    message_token: 5001,
    sender: { id: 'u1', name: 'Asha' },
    message: { type: 'text', text: 'hi' },
  }),
);
const signature = 'signed';

function build(
  recordInbound: () => Promise<unknown> = async () => ({ stored: true }),
  defer = vi.fn().mockResolvedValue(undefined),
) {
  const channel = { id: 7, active: true, authToken: 'enc' };
  const db = {
    primary: { execute: async () => ({ rows: [{ channel_org_id: 1, channel_row_id: 7 }] }) },
    txAs: async (_ctx: unknown, fn: (tx: unknown) => unknown) => fn({}),
  };
  const repo = { findById: async () => channel, touchInbound: async () => undefined };
  const inbox = {
    recordInbound,
    recordReceipt: async () => undefined,
    ensureThread: async () => undefined,
  };
  const handlers = new Map<string, (p: never) => Promise<void>>();
  const retry = {
    defer,
    register: (c: string, h: (p: never) => Promise<void>) => handlers.set(c, h),
  };
  const svc = new InboundService(
    db as never,
    repo as never,
    {} as never,
    { decrypt: () => AUTH } as never,
    { incr: async () => 1, expire: async () => 1 } as never,
    inbox as never,
    retry as never,
  );
  svc.onModuleInit();
  return { svc, defer, handlers };
}

describe('viber InboundService durability', () => {
  it('acknowledges a message that was stored', async () => {
    const { svc, defer } = build();
    await expect(svc.ingest('tok', raw, signature)).resolves.toEqual({ status: 0 });
    expect(defer).not.toHaveBeenCalled();
  });

  it('defers a message it failed to store and still answers 200', async () => {
    const { svc, defer } = build(vi.fn().mockRejectedValue(new Error('db down')));
    await expect(svc.ingest('tok', raw, signature)).resolves.toEqual({ status: 0 });
    expect(defer).toHaveBeenCalledTimes(1);
    expect(defer.mock.calls[0]![0]).toBe('viber');
    expect(defer.mock.calls[0]![1]).toMatchObject({
      orgId: 1,
      channelId: 7,
      event: { kind: 'message' },
    });
  });

  it('answers 503 when the deferral itself fails, because nothing was kept and Viber must redeliver', async () => {
    const { svc } = build(
      vi.fn().mockRejectedValue(new Error('db down')),
      vi.fn().mockRejectedValue(new Error('redis down')),
    );
    const err = await svc.ingest('tok', raw, signature).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('acknowledges a rule the data broke (an AppError) without deferring: a retry would fail the same way', async () => {
    const { svc, defer } = build(
      vi.fn().mockRejectedValue(new AppError(ERROR_CODES.VALIDATION_FAILED, 'bad shape')),
    );
    await expect(svc.ingest('tok', raw, signature)).resolves.toEqual({ status: 0 });
    expect(defer).not.toHaveBeenCalled();
  });

  it('registers a retry handler that stores the deferred event, and lets a failure surface for the queue to retry', async () => {
    const record = vi
      .fn()
      .mockResolvedValueOnce({ stored: true })
      .mockRejectedValueOnce(new Error('still down'));
    const { handlers } = build(record);
    const run = handlers.get('viber')!;
    const payload = {
      orgId: 1,
      channelId: 7,
      event: {
        kind: 'message',
        message: {
          user: { id: 'u1', name: null, avatar: null },
          token: '1',
          msgType: 'text',
          stickerId: null,
          body: { kind: 'text', text: 'hi' },
        },
      },
    };
    await expect(run(payload as never)).resolves.toBeUndefined();
    await expect(run(payload as never)).rejects.toThrow('still down');
  });
});
