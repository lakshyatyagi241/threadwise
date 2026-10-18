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

/** What every send in this file is, for the ConsentGate. */
const SERVICE_CONSENT = { purpose: 'service_messaging' as const };

/** A Redis with just the commands the dispatcher uses: get, set EX/NX, eval (release if owner). */
class FakeRedis {
  store = new Map<string, string>();
  down = false;
  /** Fails only the result write (key without `:lock`), as a Redis blip right after the provider answered would. */
  failResultWrite = false;
  async get(k: string) {
    if (this.down) throw new Error('redis down');
    return this.store.get(k) ?? null;
  }
  async set(k: string, v: string, ..._opts: unknown[]) {
    if (this.down) throw new Error('redis down');
    if (this.failResultWrite && !k.endsWith(':lock')) throw new Error('redis blip');
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
  const gate = {
    check: vi.fn(async (..._args: unknown[]) => ({ decision: 'allow', reason: 'utility_exempt' })),
    purposeOfTemplate: vi.fn(async () => 'service_messaging'),
  };
  const registry = new ChannelAdapterRegistry([adapter]);
  const dispatcher = new ChannelDispatcher(
    registry,
    publisher as never,
    plans as never,
    guard,
    redis as never,
    gate as never,
  );
  return { dispatcher, redis, guard, publisher, plans, gate };
}

const recent = new Date(Date.now() - 3_600_000);
const req = (over: Record<string, unknown> = {}) => ({
  channel: channel(),
  envelope: text(),
  lastInboundAt: recent,
  consent: SERVICE_CONSENT,
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
    expect(
      await code(dispatcher.assertCanQueue(req({ lastInboundAt: old, consent: SERVICE_CONSENT }))),
    ).toBe('SERVICE_WINDOW_CLOSED');
    expect(
      await code(dispatcher.assertCanQueue(req({ lastInboundAt: null, consent: SERVICE_CONSENT }))),
    ).toBe('SERVICE_WINDOW_CLOSED');
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
      dispatcher.assertCanQueue(
        req({ envelope: template, lastInboundAt: old, consent: SERVICE_CONSENT }),
      ),
    ).resolves.toBeTruthy();
    const media = {
      kind: 'media',
      to: '919876543210',
      clientReference: 'm1',
      media: { key: 'k', mediaKind: 'image', mime: 'image/png' },
    };
    expect(
      await code(
        dispatcher.assertCanQueue(
          req({ envelope: media, lastInboundAt: old, consent: SERVICE_CONSENT }),
        ),
      ),
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
      dispatcher.assertCanQueue(
        req({ channel: open, lastInboundAt: null, consent: SERVICE_CONSENT }),
      ),
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
    expect(await code(dispatcher.send(req({ lastInboundAt: old, consent: SERVICE_CONSENT })))).toBe(
      'SERVICE_WINDOW_CLOSED',
    );
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

  it('Redis failing only after the provider accepted: the send succeeds, it is not reported as a retryable failure (RF-03)', async () => {
    const { dispatcher, redis } = build();
    redis.failResultWrite = true;
    const spy = vi.spyOn(sim, 'send');
    const out = await dispatcher.send(req());
    expect(out).toMatchObject({ replayed: false });
    expect(out.providerMessageId).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('the lock is released after a failure, so the next attempt can take it', async () => {
    const { dispatcher, redis } = build();
    await dispatcher.send(req({ envelope: text('/fail') })).catch(() => undefined);
    expect([...redis.store.keys()].some((k) => k.endsWith(':lock'))).toBe(false);
  });
});

describe('ChannelDispatcher: a WhatsApp group thread (g:<group id>)', () => {
  const GROUP = 'g:Y2FwaV9ncm91cDoxMjM0NTY3ODkwMTIzNDU2';
  const send = vi.fn(async () => ({ providerMessageId: 'wamid.1', acceptedAt: new Date() }));
  const whatsapp = {
    kind: 'whatsapp_cloud',
    live: true,
    capabilities: () => ({
      windowHours: 24,
      templates: true,
      reactions: true,
      typing: true,
      media: ['image', 'document'],
    }),
    windowInfo: () => ({ open: true, expiresAt: null }),
    send,
  } as unknown as ChannelAdapter;
  const wa = () =>
    channel({ kind: 'whatsapp_cloud', settings: { metered: false } as ChannelSettings });
  const to = (kind: string, extra: Record<string, unknown>) => ({
    clientReference: 'ref-g',
    attempt: 1,
    to: GROUP,
    kind,
    ...extra,
  });
  const allowed = [
    to('text', { body: 'hi' }),
    to('media', { media: { key: 'k', mediaKind: 'image', mime: 'image/jpeg' } }),
    to('template', { template: { name: 't', language: 'en', variables: {} } }),
  ];
  const refused = [
    to('reaction', { reaction: { providerMessageId: 'wamid.1', emoji: '👍' } }),
    to('interactive', { interactive: { type: 'location_request', body: 'Where?' } }),
  ];

  it.each(allowed.map((e) => [e.kind, e] as const))(
    'a %s is accepted on the Cloud API channel',
    async (_k, envelope) => {
      const { dispatcher } = build(whatsapp);
      const q = await dispatcher.assertCanQueue({
        channel: wa(),
        envelope,
        lastInboundAt: recent,
        consent: SERVICE_CONSENT,
      });
      expect(q.window.open).toBe(true);
    },
  );

  it.each(refused.map((e) => [e.kind, e] as const))(
    'a %s is refused at enqueue with a 422 and at send time, never calling the adapter',
    async (_k, envelope) => {
      const { dispatcher, guard } = build(whatsapp);
      const queue = await dispatcher
        .assertCanQueue({
          channel: wa(),
          envelope,
          lastInboundAt: recent,
          consent: SERVICE_CONSENT,
        })
        .catch((e: unknown) => e as AppError);
      expect(queue).toBeInstanceOf(AppError);
      expect((queue as AppError).code).toBe('CHANNEL_CAPABILITY_UNSUPPORTED');
      expect((queue as AppError).getStatus()).toBe(422);
      const sent = await dispatcher
        .send({ channel: wa(), envelope, lastInboundAt: recent, consent: SERVICE_CONSENT })
        .catch((e: unknown) => e as AppError);
      expect((sent as AppError).code).toBe('CHANNEL_CAPABILITY_UNSUPPORTED');
      expect(send).not.toHaveBeenCalled();
      expect(guard.beforeSend).not.toHaveBeenCalled();
    },
  );

  describe('a personal number (the unofficial QR engine)', () => {
    const qr = {
      ...(whatsapp as object),
      kind: 'whatsapp_qr',
      // The linked number's own capabilities: no templates, no 24 hour rule, files and places and cards, reactions.
      capabilities: () => ({
        windowHours: null,
        templates: false,
        reactions: true,
        typing: false,
        media: ['image', 'video', 'audio', 'document', 'location', 'contact'],
      }),
    } as unknown as ChannelAdapter;
    const qrChannel = () =>
      channel({ kind: 'whatsapp_qr', settings: { metered: false } as ChannelSettings });
    const qrAllowed = [
      to('text', { body: 'hi' }),
      to('media', { media: { key: 'k', mediaKind: 'image', mime: 'image/jpeg' } }),
      to('location', { location: { latitude: 1, longitude: 2 } }),
      to('contacts', {
        contacts: [{ name: 'A', phones: [{ phone: '+919800000001' }], emails: [] }],
      }),
      to('reaction', { reaction: { providerMessageId: 'wamid.1', emoji: '👍' } }),
    ];

    it.each(qrAllowed.map((e) => [e.kind, e] as const))(
      'a %s is accepted into a group',
      async (_k, envelope) => {
        const { dispatcher } = build(qr);
        const q = await dispatcher.assertCanQueue({
          channel: qrChannel(),
          envelope,
          lastInboundAt: recent,
          consent: SERVICE_CONSENT,
        });
        expect(q.window.open).toBe(true);
      },
    );

    it('refuses a template and buttons in a group with CHANNEL_CAPABILITY_UNSUPPORTED (422)', async () => {
      const { dispatcher } = build(qr);
      for (const envelope of [
        to('template', { template: { name: 't', language: 'en', variables: {} } }),
        to('interactive', { interactive: { type: 'location_request', body: 'Where?' } }),
      ]) {
        const e = await dispatcher
          .assertCanQueue({
            channel: qrChannel(),
            envelope,
            lastInboundAt: recent,
            consent: SERVICE_CONSENT,
          })
          .catch((x: unknown) => x as AppError);
        expect((e as AppError).code).toBe('CHANNEL_CAPABILITY_UNSUPPORTED');
        expect((e as AppError).getStatus()).toBe(422);
      }
      expect(send).not.toHaveBeenCalled();
    });

    it('a disconnected number refuses a group send like any other', async () => {
      const { dispatcher } = build(qr);
      const r = await code(
        dispatcher.assertCanQueue({
          channel: { ...qrChannel(), status: 'disconnected' } as ChannelRuntime,
          envelope: to('text', { body: 'hi' }),
          lastInboundAt: recent,
          consent: SERVICE_CONSENT,
        }),
      );
      expect(r).toBe('CHANNEL_DISCONNECTED');
    });
  });

  it('a normal phone thread on the same channel still sends through the adapter once', async () => {
    const { dispatcher } = build(whatsapp);
    const envelope = { ...text('hello', 'ref-phone'), attempt: 1 };
    const q = await dispatcher.assertCanQueue({
      channel: wa(),
      envelope,
      lastInboundAt: recent,
      consent: SERVICE_CONSENT,
    });
    expect(q.window.open).toBe(true);
    const r = await dispatcher.send({
      channel: wa(),
      envelope,
      lastInboundAt: recent,
      consent: SERVICE_CONSENT,
    });
    expect(r.providerMessageId).toBe('wamid.1');
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('ChannelDispatcher: the ConsentGate (BL-141)', () => {
  const deny = (reason: string) => ({ decision: 'deny', reason });

  it('a withdrawn contact is refused CONSENT_OPTED_OUT at queue time and at send time, and nothing is sent', async () => {
    const { dispatcher, gate } = build();
    const sendSpy = vi.spyOn(sim, 'send');
    gate.check.mockResolvedValue(deny('withdrawn') as never);
    const marketing = { purpose: 'marketing_messaging' as const, contactId: 7 };
    expect(await code(dispatcher.assertCanQueue(req({ consent: marketing })))).toBe(
      'CONSENT_OPTED_OUT',
    );
    expect(await code(dispatcher.send(req({ consent: marketing })))).toBe('CONSENT_OPTED_OUT');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('a missing grant under the strict switch is CONSENT_SEND_DENIED (422, no override)', async () => {
    const { dispatcher, gate } = build();
    gate.check.mockResolvedValue(deny('no_consent_recorded') as never);
    const e = (await dispatcher
      .send(req({ consent: { purpose: 'marketing_messaging' } }))
      .catch((x: unknown) => x)) as AppError;
    expect(e.code).toBe('CONSENT_SEND_DENIED');
    expect(e.getStatus()).toBe(422);
  });

  it('asks the gate with the contact, the channel kind and the purpose; a free-form reply in the window is a reply', async () => {
    const { dispatcher, gate } = build();
    await dispatcher.send(req({ consent: { purpose: 'service_messaging', contactId: 9 } }));
    expect(gate.check).toHaveBeenCalledWith(
      7,
      { type: 'contact', id: 9 },
      'simulator',
      'service_messaging',
      undefined,
      { replyWindowOpen: true },
    );
  });

  it('without a contact id the recipient key finds the contact; a template is never a reply', async () => {
    const { dispatcher, gate } = build();
    await dispatcher.send(req({ envelope: text('hi', 'ref-p') }));
    expect((gate.check.mock.calls as unknown as unknown[][]).at(-1)?.[1]).toEqual({
      type: 'phone',
      phone: '919876543210',
    });
    await dispatcher.send(
      req({
        envelope: {
          kind: 'template',
          to: '919876543210',
          clientReference: 'ref-t',
          template: { name: 'a', language: 'en' },
        },
        consent: { purpose: 'service_messaging' },
      }),
    );
    expect((gate.check.mock.calls as unknown as unknown[][]).at(-1)?.[5]).toEqual({
      replyWindowOpen: false,
    });
  });

  it('a replayed send returns the stored answer without asking again', async () => {
    const { dispatcher, gate } = build();
    await dispatcher.send(req({ envelope: text('hi', 'ref-same') }));
    const calls = gate.check.mock.calls.length;
    const again = await dispatcher.send(req({ envelope: text('hi', 'ref-same') }));
    expect(again.replayed).toBe(true);
    expect(gate.check.mock.calls.length).toBe(calls);
  });

  it('the purpose of an envelope: a template takes its category, everything else is service', async () => {
    const { dispatcher, gate } = build();
    gate.purposeOfTemplate.mockResolvedValue('marketing_messaging' as never);
    expect(await dispatcher.purposeFor(7, text())).toBe('service_messaging');
    expect(
      await dispatcher.purposeFor(7, {
        kind: 'template',
        to: '919876543210',
        clientReference: 'r',
        template: { name: 'promo', language: 'en' },
      }),
    ).toBe('marketing_messaging');
  });
});
