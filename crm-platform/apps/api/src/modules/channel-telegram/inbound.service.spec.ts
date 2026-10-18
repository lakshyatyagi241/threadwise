import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { InboundService } from './inbound.service';

/**
 * ASYNC-011/017: a webhook may answer 2xx only when the update is durably kept. A failed store used to be logged and answered with 200,
 * so the message was lost. It is now deferred to the webhook retry queue and still answered 200 (the Reference's behaviour); only when
 * the deferral itself fails (nothing was kept) does it answer 503 so Telegram redelivers.
 */
const update = {
  update_id: 1,
  message: { message_id: 10, chat: { id: 5, type: 'private' }, from: { id: 5 }, text: 'hi' },
};
const stored = {
  stored: true,
  newContact: false,
  contactId: 1,
  conversationId: 1,
  newThread: false,
};

function build(
  recordInbound: () => Promise<unknown>,
  defer = vi.fn().mockResolvedValue(undefined),
) {
  const bot = { id: 3, active: true, secretToken: null, botToken: 'enc' };
  const db = {
    primary: { execute: async () => ({ rows: [{ bot_org_id: 1, bot_row_id: 3 }] }) },
    txAs: async (_ctx: unknown, fn: (tx: unknown) => unknown) => fn({}),
  };
  const repo = { findById: async () => bot, touchInbound: async () => undefined };
  const handlers = new Map<string, (p: never) => Promise<void>>();
  const retry = {
    defer,
    register: (c: string, h: (p: never) => Promise<void>) => handlers.set(c, h),
  };
  const svc = new InboundService(
    db as never,
    repo as never,
    { decrypt: () => 'tok' } as never,
    { incr: async () => 1, expire: async () => 1 } as never,
    { forToken: () => ({}) } as never,
    { recordInbound } as never,
    { enabled: false } as never,
    { handoffToFlow: async () => false, automate: async () => undefined } as never,
    retry as never,
  );
  svc.onModuleInit();
  return { svc, defer, handlers };
}

describe('telegram InboundService durability', () => {
  it('acknowledges a message that was stored', async () => {
    const { svc, defer } = build(async () => stored);
    await expect(svc.ingest('tok', '', update as never)).resolves.toEqual({
      ok: true,
      note: 'ok',
    });
    expect(defer).not.toHaveBeenCalled();
  });

  it('defers a message it failed to store and still answers 200', async () => {
    const { svc, defer } = build(vi.fn().mockRejectedValue(new Error('db down')));
    await expect(svc.ingest('tok', '', update as never)).resolves.toEqual({
      ok: true,
      note: 'ok',
    });
    expect(defer).toHaveBeenCalledWith('telegram', { orgId: 1, botRowId: 3, update });
  });

  it('answers 503 when the deferral itself fails, because nothing was kept and Telegram must redeliver', async () => {
    const { svc } = build(
      vi.fn().mockRejectedValue(new Error('db down')),
      vi.fn().mockRejectedValue(new Error('redis down')),
    );
    const err = await svc.ingest('tok', '', update as never).then(
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
    await expect(svc.ingest('tok', '', update as never)).resolves.toEqual({
      ok: true,
      note: 'ok',
    });
    expect(defer).not.toHaveBeenCalled();
  });

  it('registers a retry handler that stores the deferred update, and lets a failure surface for the queue to retry', async () => {
    const record = vi
      .fn()
      .mockResolvedValueOnce(stored)
      .mockRejectedValueOnce(new Error('still down'));
    const { handlers } = build(record);
    const run = handlers.get('telegram')!;
    await expect(run({ orgId: 1, botRowId: 3, update } as never)).resolves.toBeUndefined();
    await expect(run({ orgId: 1, botRowId: 3, update } as never)).rejects.toThrow('still down');
  });
});
