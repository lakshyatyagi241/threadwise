import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { InboundService } from './inbound.service';

/**
 * ASYNC-017/050: a webhook may only answer 2xx once the message is durably stored. A failed store used to be logged and answered
 * with 200, so Telegram never redelivered and the message was lost. The inbox write is idempotent per update ("a redelivered update is
 * stored once"), so letting Telegram redeliver is safe.
 */
const update = { update_id: 1, message: { message_id: 10, chat: { id: 5, type: 'private' }, from: { id: 5 }, text: 'hi' } };

function build(recordInbound: () => Promise<unknown>) {
  const bot = { id: 3, active: true, secretToken: null, botToken: 'enc' };
  const db = {
    primary: { execute: async () => ({ rows: [{ bot_org_id: 1, bot_row_id: 3 }] }) },
    txAs: async (_ctx: unknown, fn: (tx: unknown) => unknown) => fn({}),
  };
  const repo = { findById: async () => bot, touchInbound: async () => undefined };
  return new InboundService(
    db as never,
    repo as never,
    { decrypt: () => 'tok' } as never,
    { incr: async () => 1, expire: async () => 1 } as never,
    { forToken: () => ({}) } as never,
    { recordInbound } as never,
    { enabled: false } as never,
    { handoffToFlow: async () => false, automate: async () => undefined } as never,
  );
}

describe('telegram InboundService durability', () => {
  it('acknowledges a message that was stored', async () => {
    const svc = build(async () => ({ stored: true, newContact: false, contactId: 1, conversationId: 1, newThread: false }));
    await expect(svc.ingest('tok', '', update as never)).resolves.toEqual({ ok: true, note: 'ok' });
  });

  it('does NOT acknowledge when storing the message fails, so Telegram redelivers it', async () => {
    const svc = build(vi.fn().mockRejectedValue(new Error('db down')));
    const err = await svc.ingest('tok', '', update as never).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('acknowledges when the failure is a rule the data broke (an AppError): redelivery could never succeed', async () => {
    const svc = build(
      vi.fn().mockRejectedValue(new AppError(ERROR_CODES.VALIDATION_FAILED, 'bad shape')),
    );
    await expect(svc.ingest('tok', '', update as never)).resolves.toEqual({ ok: true, note: 'ok' });
  });
});
