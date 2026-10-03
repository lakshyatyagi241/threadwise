import { describe, expect, it, vi } from 'vitest';
import { SIMULATOR_DEFAULTS, type ChannelSettings } from '@crm/contracts';
import {
  ChannelError,
  SimulatorAdapter,
  type ChannelAdapter,
  type ChannelRuntime,
} from '../../../src/infra/providers/chat-conversations';
import { AppError } from '../../../src/common/errors/app-error';
import { ChannelAdapterRegistry } from '../../../src/modules/chat-conversations/channel-adapter.registry';
import { ChannelDispatcher } from '../../../src/modules/chat-conversations/channel-dispatcher.service';

/** A Redis with just the commands the dispatcher uses: get, set EX/NX, eval (release if owner). */
class FakeRedis {
  store = new Map<string, string>();
  down = false;
  async get(k: string) {
    if (this.down) throw new Error('redis down');
    return this.store.get(k) ?? null;
  }
  async set(k: string, v: string, ..._opts: unknown[]) {
    if (this.down) throw new Error('redis down');
    if (_opts.includes('NX') && this.store.has(k)) return null;
    this.store.set(k, v);
    return 'OK';
  }
  async eval(_script: string, _n: number, key: string, owner: string) {
    if (this.store.get(key) === owner) this.store.delete(key);
    return 1;
  }
}

const sim = new SimulatorAdapter({ slowMs: 5, env: { NODE_ENV: 'test' } });

const settings = (
  window: 'auto' | 'open' | 'closed' = 'auto',
  metered = false,
): ChannelSettings => ({
  metered,
  simulator: { ...SIMULATOR_DEFAULTS, window },
});

const channel = (over: Partial<ChannelRuntime> = {}): ChannelRuntime => ({
  orgId: 7,
  uuid: '11111111-1111-4111-8111-111111111111',
  kind: 'simulator',
  status: 'connected',
  externalId: null,
  displayAddress: null,
  settings: settings(),
  capabilityOverrides: {},
  credentials: {},
  ...over,
});

const text = (body = 'hello', ref = 'msg-1') => ({
  kind: 'text',
  to: '919876543210',
  clientReference: ref,
  body,
});

function build(adapter: ChannelAdapter = sim) {
  const redis = new FakeRedis();
  const guard = {
    beforeSend: vi.fn(async () => undefined),
    withFooter: vi.fn(async ({ body }: { body: string }) => body),
  };
  const publisher = { enqueueReceipt: vi.fn(async () => 'job') };
  const plans = { assertWithinLimit: vi.fn(async () => undefined) };
  const registry = new ChannelAdapterRegistry([adapter]);
  const dispatcher = new ChannelDispatcher(
    registry,
    publisher as never,
    plans as never,
    guard,
    redis as never,
  );
  return { dispatcher, redis, guard, publisher, plans };
}

const recent = new Date(Date.now() - 3_600_000);
const req = (over: Record<string, unknown> = {}) => ({
  channel: channel(),
  envelope: text(),
  lastInboundAt: recent,
  ...over,
});
const code = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as AppError).code;

describe('ChannelDispatcher.assertCanQueue: what is refused before anything is stored', () => {
  it('lets a free-form message through inside the window', async () => {
    const { dispatcher } = build();
    const r = await dispatcher.assertCanQueue(req());
    expect(r.window.open).toBe(true);
  });

  it('CHANNEL_DISCONNECTED when the channel is not connected', async () => {
    const { dispatcher } = build();
    for (const status of ['disconnected', 'error'] as const) {
      expect(await code(dispatcher.assertCanQueue(req({ channel: channel({ status }) })))).toBe(
        'CHANNEL_DISCONNECTED',
      );
    }
  });

  it('SERVICE_WINDOW_CLOSED for free-form text after 24 hours, or with no customer message yet', async () => {
    const { dispatcher } = build();
    const old = new Date(Date.now() - 25 * 3_600_000);
    expect(await code(dispatcher.assertCanQueue(req({ lastInboundAt: old })))).toBe(
      'SERVICE_WINDOW_CLOSED',
    );
    expect(await code(dispatcher.assertCanQueue(req({ lastInboundAt: null })))).toBe(
      'SERVICE_WINDOW_CLOSED',
    );
  });

  it('a template is allowed with the window closed; media, reactions and locations are not', async () => {
    const { dispatcher } = build();
    const old = new Date(Date.now() - 48 * 3_600_000);
    const template = {
      kind: 'template',
      to: '919876543210',
      clientReference: 't1',
      template: { name: 'order_update', language: 'en', variables: {} },
    };
    await expect(
      dispatcher.assertCanQueue(req({ envelope: template, lastInboundAt: old })),
    ).resolves.toBeTruthy();
    const media = {
      kind: 'media',
      to: '919876543210',
      clientReference: 'm1',
      media: { key: 'k', mediaKind: 'image', mime: 'image/png' },
    };
    expect(
      await code(dispatcher.assertCanQueue(req({ envelope: media, lastInboundAt: old }))),
    ).toBe('SERVICE_WINDOW_CLOSED');
  });

  it('the simulator window toggle forces the answer both ways', async () => {
    const { dispatcher } = build();
    const closed = channel({ settings: settings('closed') });
    expect(await code(dispatcher.assertCanQueue(req({ channel: closed })))).toBe(
      'SERVICE_WINDOW_CLOSED',
    );
    const open = channel({ settings: settings('open') });
    await expect(
      dispatcher.assertCanQueue(req({ channel: open, lastInboundAt: null })),
    ).resolves.toBeTruthy();
  });

  it('CHANNEL_CAPABILITY_UNSUPPORTED when the channel cannot carry the kind (an override switches templates off)', async () => {
    const { dispatcher } = build();
    const noTemplates = channel({ capabilityOverrides: { templates: false } });
    const template = {
      kind: 'template',
      to: '919876543210',
      clientReference: 't1',
      template: { name: 'x', language: 'en' },
    };
    expect(
      await code(dispatcher.assertCanQueue(req({ channel: noTemplates, envelope: template }))),
    ).toBe('CHANNEL_CAPABILITY_UNSUPPORTED');
    const noVideo = channel({ capabilityOverrides: { media: ['image'] } });
    const video = {
      kind: 'media',
      to: '919876543210',
      clientReference: 'v',
      media: { key: 'k', mediaKind: 'video', mime: 'video/mp4' },
    };
    expect(await code(dispatcher.assertCanQueue(req({ channel: noVideo, envelope: video })))).toBe(
      'CHANNEL_CAPABILITY_UNSUPPORTED',
    );
  });

  it('an invalid envelope is a validation error naming the field, not a crash', async () => {
    const { dispatcher } = build();
    const err = (await dispatcher
      .assertCanQueue(req({ envelope: { kind: 'text', to: '1', clientReference: '' } }))
      .catch((e: unknown) => e)) as AppError;
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.details?.map((d) => d.path)).toEqual(
      expect.arrayContaining(['clientReference', 'body']),
    );
  });

  it('checks the plan cap only for a metered channel and only when the caller supplies a count', async () => {
    const { dispatcher, plans } = build();
    await dispatcher.assertCanQueue(
      req({ channel: channel({ settings: settings('auto', true) }) }),
      {
        monthlyUsed: 99,
      },
    );
    expect(plans.assertWithinLimit).toHaveBeenCalledWith(7, 'monthly_messages', 99);

    plans.assertWithinLimit.mockClear();
    await dispatcher.assertCanQueue(
      req({ channel: channel({ settings: settings('auto', false) }) }),
      {
        monthlyUsed: 99,
      },
    );
    await dispatcher.assertCanQueue(
      req({ channel: channel({ settings: settings('auto', true) }) }),
    );
    expect(plans.assertWithinLimit).not.toHaveBeenCalled();
  });

  it('PLAN_LIMIT_REACHED from the entitlement service passes through untouched', async () => {
    const { dispatcher, plans } = build();
    plans.assertWithinLimit.mockRejectedValueOnce(
      new AppError('PLAN_LIMIT_REACHED' as never, 'cap', 422),
    );
    expect(
      await code(
        dispatcher.assertCanQueue(req({ channel: channel({ settings: settings('auto', true) }) }), {
          monthlyUsed: 1000,
        }),
      ),
    ).toBe('PLAN_LIMIT_REACHED');
  });
});

describe('ChannelDispatcher.send: the worker side', () => {
  it('runs the send guard with the text and the source before the adapter, then sends once', async () => {
    const { dispatcher, guard } = build();
    const order: string[] = [];
    guard.beforeSend.mockImplementation(async () => void order.push('guard'));
    const spy = vi.spyOn(sim, 'send').mockImplementation(async () => {
      order.push('adapter');
      return { providerMessageId: 'p1', acceptedAt: new Date() };
    });
    const r = await dispatcher.send(req({ envelope: text('hi there'), source: 'inbox' }));
    expect(order).toEqual(['guard', 'adapter']);
    expect(guard.beforeSend).toHaveBeenCalledWith({ orgId: 7, body: 'hi there', source: 'inbox' });
    expect(r).toMatchObject({ providerMessageId: 'p1', replayed: false });
    spy.mockRestore();
  });

  it('a halted or blocked send (the guard throws) never reaches the adapter', async () => {
    const { dispatcher, guard } = build();
    guard.beforeSend.mockRejectedValueOnce(
      new AppError('AUTH_SEND_HALTED' as never, 'halted', 503),
    );
    const spy = vi.spyOn(sim, 'send');
    expect(await code(dispatcher.send(req()))).toBe('AUTH_SEND_HALTED');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('re-checks that the channel is still connected and the window still open at send time', async () => {
    const { dispatcher } = build();
    expect(await code(dispatcher.send(req({ channel: channel({ status: 'disconnected' }) })))).toBe(
      'CHANNEL_DISCONNECTED',
    );
    const old = new Date(Date.now() - 30 * 3_600_000);
    expect(await code(dispatcher.send(req({ lastInboundAt: old })))).toBe('SERVICE_WINDOW_CLOSED');
  });

  it('is idempotent on the client reference: the same message twice calls the provider once and answers the same', async () => {
    const { dispatcher } = build();
    const spy = vi.spyOn(sim, 'send');
    const first = await dispatcher.send(req());
    const second = await dispatcher.send(req());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ providerMessageId: first.providerMessageId, replayed: true });
    spy.mockRestore();
  });

  it('a different client reference is a different message', async () => {
    const { dispatcher } = build();
    const spy = vi.spyOn(sim, 'send');
    await dispatcher.send(req({ envelope: text('a', 'one') }));
    await dispatcher.send(req({ envelope: text('a', 'two') }));
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('a failed send stores nothing, so the retry really sends', async () => {
    const { dispatcher } = build();
    const first = await dispatcher
      .send(req({ envelope: { ...text('/flaky'), attempt: 1 } }))
      .catch((e: unknown) => e);
    expect(first).toMatchObject({ code: 'SIM_FLAKY', retryable: true });
    const ok = await dispatcher.send(req({ envelope: { ...text('/flaky'), attempt: 3 } }));
    expect(ok.replayed).toBe(false);
  });

  it('two workers on one message: the second is told to come back (retryable), not allowed to send twice', async () => {
    const { dispatcher } = build();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const spy = vi.spyOn(sim, 'send').mockImplementation(async () => {
      await gate;
      return { providerMessageId: 'p1', acceptedAt: new Date() };
    });
    const a = dispatcher.send(req());
    await new Promise((r) => setTimeout(r, 10));
    const b = await dispatcher.send(req()).catch((e: unknown) => e);
    expect(b).toMatchObject({ code: 'DISPATCH_IN_FLIGHT', retryable: true });
    release();
    await a;
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('a permanent provider refusal comes through as a non-retryable ChannelError', async () => {
    const { dispatcher } = build();
    const err = await dispatcher.send(req({ envelope: text('/fail') })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChannelError);
    expect(err).toMatchObject({ code: 'SIM_REJECTED', retryable: false });
  });

  it('an unclassified adapter exception is treated as a transport failure: retryable', async () => {
    const boom: ChannelAdapter = {
      ...sim,
      kind: 'simulator',
      send: async () => Promise.reject(new Error('ECONNRESET')),
    } as never;
    Object.setPrototypeOf(boom, sim);
    const { dispatcher } = build(boom);
    const err = await dispatcher.send(req()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'PROVIDER_UNREACHABLE', retryable: true });
  });

  it('send plans the simulated receipts but queues none: the caller schedules them once the provider id is stored', async () => {
    const { dispatcher, publisher } = build();
    const r = await dispatcher.send(req());
    expect(publisher.enqueueReceipt).not.toHaveBeenCalled();
    expect(r.plannedReceipts.map((p) => [p.status, p.delayMs])).toEqual([
      ['sent', 0],
      ['delivered', 1000],
      ['read', 3000],
    ]);
  });

  it('scheduleReceipts queues each planned step with its delay, for this tenant and provider id', async () => {
    const { dispatcher, publisher } = build();
    const r = await dispatcher.send(req());
    await dispatcher.scheduleReceipts(channel(), r);
    const calls = publisher.enqueueReceipt.mock.calls as unknown as Array<
      [number, string, { providerMessageId: string; status: string }, { delayMs: number }]
    >;
    expect(calls.map((c) => [c[2].status, c[3].delayMs])).toEqual([
      ['sent', 0],
      ['delivered', 1000],
      ['read', 3000],
    ]);
    expect(calls.every((c) => c[0] === 7 && c[2].providerMessageId === r.providerMessageId)).toBe(
      true,
    );
  });

  it('a replayed send still carries the plan, so a retry after a crash can schedule the receipts the first run never did', async () => {
    const { dispatcher } = build();
    const first = await dispatcher.send(req());
    const again = await dispatcher.send(req());
    expect(again.replayed).toBe(true);
    expect(again.plannedReceipts).toEqual(first.plannedReceipts);
  });

  it('losing a simulated receipt does not fail the caller', async () => {
    const { dispatcher, publisher } = build();
    const r = await dispatcher.send(req());
    publisher.enqueueReceipt.mockRejectedValue(new Error('queue down'));
    await expect(dispatcher.scheduleReceipts(channel(), r)).resolves.toBeUndefined();
  });

  it('Redis down: retryable ChannelError, because idempotency cannot be promised', async () => {
    const { dispatcher, redis } = build();
    redis.down = true;
    const err = await dispatcher.send(req()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'DISPATCH_STORE_UNAVAILABLE', retryable: true });
  });

  it('the lock is released after a failure, so the next attempt can take it', async () => {
    const { dispatcher, redis } = build();
    await dispatcher.send(req({ envelope: text('/fail') })).catch(() => undefined);
    expect([...redis.store.keys()].some((k) => k.endsWith(':lock'))).toBe(false);
  });
});
