import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { InboundService } from './inbound.service';

/**
 * ASYNC-011/017: the Facebook webhook is ONE url for every workspace. A store that fails is kept in the webhook retry queue and Meta
 * keeps its 200, so one workspace's failure cannot make Meta throttle the webhook the others share. Only when something could not even
 * be kept does the delivery answer 503 so Meta redelivers it.
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
const stored = { stored: false, newThread: false, conversationId: 1, contactId: 1 };

function build(
  recordInbound: (...a: unknown[]) => Promise<unknown>,
  defer = vi.fn().mockResolvedValue(undefined),
) {
  const page = { id: 9, pageId: 'PAGE1', name: 'Shop', status: 'connected' };
  const db = {
    primary: { execute: async () => ({ rows: [{ page_org_id: 1, page_row_id: 9 }] }) },
    txAs: async (_c: unknown, fn: (tx: unknown) => unknown) => fn({}),
  };
  const handlers = new Map<string, (p: never) => Promise<void>>();
  const retry = {
    defer,
    register: (c: string, h: (p: never) => Promise<void>) => handlers.set(c, h),
  };
  const svc = new InboundService(
    db as never,
    { findById: async () => page } as never,
    {} as never,
    { settings: { signingSecrets: [], verifyToken: 'v' } } as never,
    { recordInbound } as never,
    { handoffToFlow: async () => false, automate: async () => undefined } as never,
    { add: async () => undefined } as never,
    retry as never,
  );
  svc.onModuleInit();
  return { svc, defer, handlers };
}

const receive = (svc: InboundService, ...events: object[]) =>
  svc.receive(Buffer.from('{}'), '', payload(...events));

describe('facebook InboundService durability', () => {
  it('acknowledges a delivery whose events were all stored', async () => {
    const { svc, defer } = build(async () => stored);
    await expect(receive(svc, dm('m1'), dm('m2'))).resolves.toBe('ok');
    expect(defer).not.toHaveBeenCalled();
  });

  it('defers only the event it failed to store, tries the others, and still answers 200', async () => {
    const recordInbound = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(stored);
    const { svc, defer } = build(recordInbound);
    await expect(receive(svc, dm('m1'), dm('m2'))).resolves.toBe('ok');
    expect(recordInbound).toHaveBeenCalledTimes(2);
    expect(defer).toHaveBeenCalledTimes(1);
    expect(defer.mock.calls[0]![0]).toBe('facebook');
    expect(defer.mock.calls[0]![1]).toMatchObject({
      kind: 'messaging',
      orgId: 1,
      pageRowId: 9,
      item: { message: { mid: 'm1' } },
    });
  });

  it('answers 503 when a deferral itself fails, because nothing was kept and Meta must redeliver', async () => {
    const { svc } = build(
      vi.fn().mockRejectedValue(new Error('db down')),
      vi.fn().mockRejectedValue(new Error('redis down')),
    );
    const err = await receive(svc, dm('m1')).then(
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
    await expect(receive(svc, dm('m1'))).resolves.toBe('ok');
    expect(defer).not.toHaveBeenCalled();
  });

  it('registers a retry handler that stores the deferred event, and lets a failure surface for the queue to retry', async () => {
    const record = vi
      .fn()
      .mockResolvedValueOnce(stored)
      .mockRejectedValueOnce(new Error('still down'));
    const { handlers } = build(record);
    const run = handlers.get('facebook')!;
    const item = { kind: 'messaging', orgId: 1, pageRowId: 9, item: dm('m1') };
    await expect(run(item as never)).resolves.toBeUndefined();
    await expect(run(item as never)).rejects.toThrow('still down');
  });

  it('retries a whole deferred entry, and throws the first failure so the queue retries it again', async () => {
    const { handlers } = build(vi.fn().mockRejectedValue(new Error('still down')));
    const entry = {
      kind: 'entry',
      entry: { pageId: 'PAGE1', messaging: [dm('m1')], feed: [], leadgen: [] },
    };
    await expect(handlers.get('facebook')!(entry as never)).rejects.toThrow('still down');
  });
});
