import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { InboundService } from './inbound.service';

/**
 * ASYNC-017/050: a webhook may only answer 2xx once every event of the delivery is durably stored. A failed store used to be logged
 * and answered with 200, so Meta never redelivered and the message was lost. The inbox write is idempotent per Meta message id, so a
 * redelivery of the whole batch is safe.
 */
const dm = (mid: string) => ({
  sender: { id: '555' },
  timestamp: 1_700_000_000_000,
  message: { mid, text: 'hi' },
});
const payload = (...messaging: object[]) => ({
  object: 'page',
  entry: [{ id: 'PAGE1', messaging }],
});

function build(recordInbound: (...a: unknown[]) => Promise<unknown>) {
  const page = { id: 9, pageId: 'PAGE1', name: 'Shop', status: 'connected' };
  const db = {
    primary: { execute: async () => ({ rows: [{ page_org_id: 1, page_row_id: 9 }] }) },
    txAs: async (_c: unknown, fn: (tx: unknown) => unknown) => fn({}),
  };
  return new InboundService(
    db as never,
    { findById: async () => page } as never,
    {} as never,
    { settings: { signingSecrets: [], verifyToken: 'v' } } as never,
    { recordInbound } as never,
    { handoffToFlow: async () => false, automate: async () => undefined } as never,
    { add: async () => undefined } as never,
  );
}

const stored = { stored: false, newThread: false, conversationId: 1, contactId: 1 };

describe('facebook InboundService durability', () => {
  it('acknowledges a delivery whose events were all stored', async () => {
    const svc = build(async () => stored);
    await expect(svc.receive(Buffer.from('{}'), '', payload(dm('m1'), dm('m2')))).resolves.toBe(
      'ok',
    );
  });

  it('still tries every event of the batch, then does NOT acknowledge if one failed to store', async () => {
    const recordInbound = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(stored);
    const err = await build(recordInbound)
      .receive(Buffer.from('{}'), '', payload(dm('m1'), dm('m2')))
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(recordInbound).toHaveBeenCalledTimes(2);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('acknowledges when the failure is a rule the data broke (an AppError): redelivery could never succeed', async () => {
    const svc = build(
      vi.fn().mockRejectedValue(new AppError(ERROR_CODES.VALIDATION_FAILED, 'bad shape')),
    );
    await expect(svc.receive(Buffer.from('{}'), '', payload(dm('m1')))).resolves.toBe('ok');
  });
});
