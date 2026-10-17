import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../common/errors/app-error';
import { InboundService } from './inbound.service';

// The signature check has its own tests; here it only has to let the delivery through to the store.
vi.mock('./channel-rules', async (orig) => ({
  ...(await orig<typeof import('./channel-rules')>()),
  signatureMatches: () => true,
}));

/**
 * ASYNC-017/050: a webhook may only answer 2xx once the message is durably stored. A failed store used to be logged and answered
 * with 200, so Viber never redelivered and the customer's message was lost for good. The inbox write is idempotent per provider
 * message id, so letting the provider redeliver is safe.
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

function build(overrides: { recordInbound?: () => Promise<unknown> } = {}) {
  const channel = { id: 7, active: true, authToken: 'enc' };
  const db = {
    primary: { execute: async () => ({ rows: [{ channel_org_id: 1, channel_row_id: 7 }] }) },
    txAs: async (_ctx: unknown, fn: (tx: unknown) => unknown) => fn({}),
  };
  const repo = { findById: async () => channel, touchInbound: async () => undefined };
  const crypto = { decrypt: () => AUTH };
  const redis = { incr: async () => 1, expire: async () => 1 };
  const inbox = {
    recordInbound: overrides.recordInbound ?? (async () => ({ stored: true })),
    recordReceipt: async () => undefined,
    ensureThread: async () => undefined,
  };
  const svc = new InboundService(
    db as never,
    repo as never,
    {} as never,
    crypto as never,
    redis as never,
    inbox as never,
  );
  return svc;
}

describe('viber InboundService durability', () => {
  it('acknowledges a message that was stored', async () => {
    await expect(build().ingest('tok', raw, signature)).resolves.toEqual({ status: 0 });
  });

  it('does NOT acknowledge when storing the message fails, so Viber redelivers it', async () => {
    const svc = build({
      recordInbound: vi.fn().mockRejectedValue(new Error('db down')),
    });
    const err = await svc.ingest('tok', raw, signature).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });
});
