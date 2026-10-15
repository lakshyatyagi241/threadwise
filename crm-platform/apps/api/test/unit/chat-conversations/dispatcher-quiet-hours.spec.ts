import { describe, expect, it, vi } from 'vitest';
import { SIMULATOR_DEFAULTS, type SendWindowDecision } from '@crm/contracts';
import {
  SimulatorAdapter,
  type ChannelRuntime,
} from '../../../src/infra/providers/chat-conversations';
import { AppError } from '../../../src/common/errors/app-error';
import { ChannelAdapterRegistry } from '../../../src/modules/chat-conversations/channel-adapter.registry';
import { ChannelDispatcher } from '../../../src/modules/chat-conversations/channel-dispatcher.service';
import { SendHeldError } from '../../../src/modules/chat-conversations/send-held.error';

/** Quiet hours at the dispatcher (BL-177): a marketing send inside them is HELD (SendHeldError), never denied; service sends are not asked. */

class FakeRedis {
  store = new Map<string, string>();
  async get(k: string) {
    return this.store.get(k) ?? null;
  }
  async set(k: string, v: string, ..._opts: unknown[]) {
    if (_opts.includes('NX') && this.store.has(k)) return null;
    this.store.set(k, v);
    return 'OK';
  }
  async eval(_s: string, _n: number, key: string, owner: string) {
    if (this.store.get(key) === owner) this.store.delete(key);
    return 1;
  }
}

const HOLD: SendWindowDecision = {
  decision: 'hold',
  reason: 'quiet_hours',
  until: '2026-10-16T03:30:00.000Z',
  zone: 'Asia/Kolkata',
  zoneSource: 'contact_field',
};

const channel = (over: Partial<ChannelRuntime> = {}): ChannelRuntime => ({
  orgId: 7,
  uuid: '11111111-1111-4111-8111-111111111111',
  kind: 'simulator',
  status: 'connected',
  externalId: null,
  displayAddress: null,
  settings: { metered: false, simulator: { ...SIMULATOR_DEFAULTS, window: 'open' } },
  capabilityOverrides: {},
  credentials: {},
  ...over,
});

const template = {
  kind: 'template',
  to: '919876543210',
  clientReference: 'bc-1',
  template: { name: 'promo', language: 'en', variables: {} },
};
const reply = {
  kind: 'text',
  to: '919876543210',
  clientReference: 'r-1',
  body: 'hello',
};

function build(decision: SendWindowDecision | 'none', consent: 'allow' | 'deny' = 'allow') {
  const adapter = new SimulatorAdapter({ slowMs: 1, env: { NODE_ENV: 'test' } });
  const send = vi.spyOn(adapter, 'send');
  const sendWindow = { check: vi.fn(async () => (decision === 'none' ? HOLD : decision)) };
  const gate = {
    check: vi.fn(async () =>
      consent === 'allow'
        ? { decision: 'allow', reason: 'policy_off' }
        : { decision: 'deny', reason: 'withdrawn' },
    ),
    purposeOfTemplate: vi.fn(async () => 'marketing_messaging'),
  };
  const dispatcher = new ChannelDispatcher(
    new ChannelAdapterRegistry([adapter]),
    { enqueueReceipt: vi.fn() } as never,
    { assertWithinLimit: vi.fn() } as never,
    { beforeSend: async () => undefined } as never,
    new FakeRedis() as never,
    gate as never,
    decision === 'none' ? undefined : (sendWindow as never),
  );
  return { dispatcher, send, sendWindow, gate };
}

const request = (envelope: unknown, purpose: 'marketing_messaging' | 'service_messaging') => ({
  channel: channel(),
  envelope,
  lastInboundAt: new Date(Date.now() - 3_600_000),
  consent: { purpose, contactId: 42 },
});

describe('ChannelDispatcher.send: quiet hours hold a marketing send', () => {
  it('holds a marketing template inside the quiet hours: SendHeldError with the instant, the adapter is not called', async () => {
    const { dispatcher, send, sendWindow } = build(HOLD);
    const err = (await dispatcher
      .send(request(template, 'marketing_messaging'))
      .catch((e: unknown) => e)) as SendHeldError;
    expect(err).toBeInstanceOf(SendHeldError);
    expect(err.hold).toEqual({
      reason: 'quiet_hours',
      until: '2026-10-16T03:30:00.000Z',
      zone: 'Asia/Kolkata',
      zoneSource: 'contact_field',
    });
    expect(send).not.toHaveBeenCalled();
    expect(sendWindow.check).toHaveBeenCalledWith(
      7,
      'message',
      { contactId: 42, phone: '919876543210', email: null },
      {},
    );
  });

  it('sends a marketing template when the hours are open', async () => {
    const { dispatcher, send } = build({ decision: 'allow' });
    const r = await dispatcher.send(request(template, 'marketing_messaging'));
    expect(r.providerMessageId).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('never asks about a service reply or a utility notice, even inside the quiet hours', async () => {
    const { dispatcher, send, sendWindow } = build(HOLD);
    await dispatcher.send(request(reply, 'service_messaging'));
    await dispatcher.send(request({ ...template, clientReference: 'u-1' }, 'service_messaging'));
    expect(sendWindow.check).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('a withdrawn contact is refused (CONSENT_OPTED_OUT), not held: the consent answer comes first', async () => {
    const { dispatcher, sendWindow } = build(HOLD, 'deny');
    const err = (await dispatcher
      .send(request(template, 'marketing_messaging'))
      .catch((e: unknown) => e)) as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('CONSENT_OPTED_OUT');
    expect(sendWindow.check).not.toHaveBeenCalled();
  });

  it('a send that was already made is replayed, not held again', async () => {
    const { dispatcher, send } = build({ decision: 'allow' });
    const first = await dispatcher.send(request(template, 'marketing_messaging'));
    expect(first.replayed).toBe(false);
    const again = await dispatcher.send(request(template, 'marketing_messaging'));
    expect(again.replayed).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a dispatcher built without the window service holds nothing (the old behaviour)', async () => {
    const { dispatcher, send } = build('none');
    await dispatcher.send(request(template, 'marketing_messaging'));
    expect(send).toHaveBeenCalledTimes(1);
  });
});
