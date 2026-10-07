import { describe, expect, it, vi } from 'vitest';
import { UnrecoverableError } from 'bullmq';

vi.mock('../../../src/modules/outbound-webhooks/send', () => ({ send: vi.fn() }));

import { send } from '../../../src/modules/outbound-webhooks/send';
import { WebhookDeliveryProcessor } from '../../../src/modules/outbound-webhooks/webhook-delivery.processor';
import { WebhookDispatchConsumer } from '../../../src/modules/outbound-webhooks/webhook-dispatch.consumer';

const as = <T>(v: unknown) => v as T;
const db = { txAs: async (_t: unknown, fn: (tx: unknown) => unknown) => fn({}) };
const hook = (id: number, events: string[], status = true) => ({
  id,
  status,
  events,
  webhookUrl: `enc:url${id}`,
  secret: 'enc:secret',
});

describe('WebhookDispatchConsumer', () => {
  it('queues one job per active endpoint subscribed to the event, with a stable id, and none for the rest', async () => {
    const add = vi.fn();
    const repo = {
      active: vi
        .fn()
        .mockResolvedValue([
          hook(1, ['contact_created']),
          hook(2, ['*']),
          hook(3, ['task_created']),
          hook(4, []),
        ]),
    };
    const c = new WebhookDispatchConsumer(as(db), as(repo), as({ register: vi.fn() }), as({ add }));
    await c.handle({
      id: '77',
      orgId: 5,
      aggregateModule: 'contacts',
      aggregateId: '9',
      eventType: 'contact.created',
      payload: { uuid: 'u1' },
    });
    expect(add.mock.calls.map((x) => x[1].webhookId).sort()).toEqual([1, 2, 4]);
    expect(add.mock.calls[0]![2]).toMatchObject({
      jobId: expect.stringMatching(/^77-/),
      attempts: 6,
    });
    expect(add.mock.calls[0]![1].envelope).toMatchObject({
      id: '77',
      event: 'contact_created',
      data: { uuid: 'u1' },
    });
  });

  it('ignores an event type that is not a webhook event', async () => {
    const add = vi.fn();
    const repo = { active: vi.fn() };
    const c = new WebhookDispatchConsumer(as(db), as(repo), as({ register: vi.fn() }), as({ add }));
    await c.handle({
      id: '1',
      orgId: 5,
      aggregateModule: 'x',
      aggregateId: '1',
      eventType: 'wallet.charged',
      payload: {},
    });
    expect(add).not.toHaveBeenCalled();
    expect(repo.active).not.toHaveBeenCalled();
  });
});

describe('WebhookDeliveryProcessor', () => {
  const crypto = { decrypt: (s: string) => s.replace('enc:', '') };
  const job = (attemptsMade: number, attempts = 6) => ({
    attemptsMade,
    opts: { attempts },
    data: {
      orgId: 5,
      webhookId: 1,
      envelope: { id: '77', event: 'contact_created', createdAt: 'now', data: {} },
    },
  });
  const make = (target: unknown) => {
    const log = vi.fn().mockResolvedValue({});
    const result = vi.fn().mockResolvedValue(undefined);
    const repo = {
      findById: vi.fn().mockResolvedValue(target),
      logDelivery: log,
      recordResult: result,
    };
    return { p: new WebhookDeliveryProcessor(as(db), as(repo), as(crypto)), log, result };
  };
  const out = (o: Partial<Awaited<ReturnType<typeof send>>>) => ({
    ok: false,
    statusCode: 500,
    error: 'HTTP 500',
    latencyMs: 12,
    permanent: false,
    responseSnippet: null,
    ...o,
  });

  it('logs a success and clears the failing flag', async () => {
    vi.mocked(send).mockResolvedValueOnce(out({ ok: true, statusCode: 200, error: null }));
    const { p, log, result } = make(hook(1, ['*']));
    await expect(p.process(as(job(0)))).resolves.toEqual({ statusCode: 200 });
    expect(log).toHaveBeenCalledOnce();
    expect(result.mock.calls[0]![3]).toMatchObject({ ok: true, final: true });
  });

  it('a failed attempt with attempts left throws to retry and is not final', async () => {
    vi.mocked(send).mockResolvedValueOnce(out({}));
    const { p, result } = make(hook(1, ['*']));
    await expect(p.process(as(job(1)))).rejects.not.toBeInstanceOf(UnrecoverableError);
    expect(result.mock.calls[0]![3]).toMatchObject({ ok: false, final: false });
  });

  it('the last attempt, or an answer that cannot improve, is final and unrecoverable', async () => {
    vi.mocked(send).mockResolvedValueOnce(out({}));
    const last = make(hook(1, ['*']));
    await expect(last.p.process(as(job(5)))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(last.result.mock.calls[0]![3]).toMatchObject({ final: true });
    vi.mocked(send).mockResolvedValueOnce(
      out({ statusCode: 410, error: 'HTTP 410', permanent: true }),
    );
    const gone = make(hook(1, ['*']));
    await expect(gone.p.process(as(job(0)))).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('drops a delivery whose endpoint was deleted or switched off meanwhile', async () => {
    vi.mocked(send).mockClear();
    for (const target of [undefined, hook(1, ['*'], false)]) {
      const { p, log } = make(target);
      await expect(p.process(as(job(0)))).resolves.toEqual({ statusCode: null });
      expect(log).not.toHaveBeenCalled();
    }
    expect(send).not.toHaveBeenCalled();
  });
});
