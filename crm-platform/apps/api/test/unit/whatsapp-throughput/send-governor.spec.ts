import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, WABA_THROUGHPUT_SETTINGS_DEFAULTS } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { RedisSendGovernor } from '../../../src/infra/providers/whatsapp-cloud-api-waba/throughput/redis-send-governor';
import type { ThroughputStore } from '../../../src/infra/providers/whatsapp-cloud-api-waba/throughput/throughput-store';
import { WabaApiError } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-errors';
import {
  WabaHttp,
  sendTargetOf,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';
import type {
  SendGovernor,
  SendTarget,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/throughput/send-governor.port';
import { metaFailure } from '../../../src/infra/providers/whatsapp/meta-errors';
import { readWabaEnv } from '../../../src/config/domains/whatsapp-cloud-api-waba.env';

const target: SendTarget = {
  phoneNumberId: '100200300',
  recipient: '919900000001',
  businessInitiated: false,
};

function fakeStore(over: Partial<Record<keyof ThroughputStore, unknown>> = {}) {
  const store = {
    global: vi.fn(async () => ({ ...WABA_THROUGHPUT_SETTINGS_DEFAULTS })),
    reserve: vi.fn(async () => ({ status: 'ok', waitMs: 0, mps: 80, speedPct: 100 })),
    number: vi.fn(async () => null),
    tierUsed: vi.fn(async () => 0),
    recordSent: vi.fn(async () => undefined),
    recordWait: vi.fn(async () => undefined),
    recordDeferred: vi.fn(async () => undefined),
    recordMetaThrottle: vi.fn(async () => undefined),
    pushEvent: vi.fn(async () => undefined),
    ...over,
  };
  return store as unknown as ThroughputStore & typeof store;
}

describe('RedisSendGovernor', () => {
  it('lets a send straight through when it has its turn', async () => {
    const store = fakeStore();
    await new RedisSendGovernor(store).admit(target);
    expect(store.reserve).toHaveBeenCalledOnce();
    expect(store.recordWait).not.toHaveBeenCalled();
  });

  it('waits its turn in process and records the wait', async () => {
    const store = fakeStore({
      reserve: vi.fn(async () => ({ status: 'ok', waitMs: 40, mps: 80, speedPct: 100 })),
    });
    const t0 = Date.now();
    await new RedisSendGovernor(store).admit(target);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
    expect(store.recordWait).toHaveBeenCalledWith(target.phoneNumberId, 40);
  });

  it('does nothing when the platform switch is off', async () => {
    const store = fakeStore({
      global: vi.fn(async () => ({ ...WABA_THROUGHPUT_SETTINGS_DEFAULTS, enabled: false })),
    });
    await new RedisSendGovernor(store).admit(target);
    expect(store.reserve).not.toHaveBeenCalled();
  });

  it('hands a send back as a retryable throughput error carrying the wait it computed', async () => {
    const store = fakeStore({
      reserve: vi.fn(async () => ({ status: 'deferred', waitMs: 8_400, mps: 80, speedPct: 100 })),
    });
    const err = await new RedisSendGovernor(store).admit(target).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WabaApiError);
    const e = err as WabaApiError;
    expect(e.heldLocally).toBe(true);
    expect(e.retryable).toBe(true);
    expect(e.retryAfterMs).toBe(8_400);
    expect(store.recordDeferred).toHaveBeenCalled();
    // The queue's backoff reads the wait from the channel error, not from the table's 10 s.
    expect(metaFailure(e).retryAfterMs).toBe(8_400);
  });

  it('stops a paused number with the halt code every pipeline already pauses on', async () => {
    const store = fakeStore({
      reserve: vi.fn(async () => ({ status: 'paused', waitMs: 0, mps: 0, speedPct: 0 })),
    });
    const err = await new RedisSendGovernor(store).admit(target).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(ERROR_CODES.AUTH_SEND_HALTED);
  });

  describe('daily messaging tier', () => {
    const tmpl: SendTarget = { ...target, businessInitiated: true };
    const full = {
      number: vi.fn(async () => ({ tierCap: 1000, tierUnlimited: false, tierName: 'TIER_1K' })),
      tierUsed: vi.fn(async () => 1000),
    };

    it('only flags a full tier unless the operator turned enforcement on', async () => {
      const store = fakeStore(full);
      await new RedisSendGovernor(store).admit(tmpl);
      expect(store.reserve).toHaveBeenCalled();
    });

    it('holds template sends past the cap when enforcement is on, but not service replies', async () => {
      const store = fakeStore({
        ...full,
        global: vi.fn(async () => ({ ...WABA_THROUGHPUT_SETTINGS_DEFAULTS, enforceTierCap: true })),
      });
      const gov = new RedisSendGovernor(store);
      const err = await gov.admit(tmpl).catch((e: unknown) => e);
      expect((err as AppError).code).toBe(ERROR_CODES.AUTH_SEND_HALTED);
      expect(store.reserve).not.toHaveBeenCalled(); // no slot is burnt by a refused send
      await expect(gov.admit(target)).resolves.toBeUndefined();
    });

    it('never holds an unlimited tier', async () => {
      const store = fakeStore({
        number: vi.fn(async () => ({
          tierCap: 0,
          tierUnlimited: true,
          tierName: 'TIER_UNLIMITED',
        })),
        global: vi.fn(async () => ({ ...WABA_THROUGHPUT_SETTINGS_DEFAULTS, enforceTierCap: true })),
      });
      await expect(new RedisSendGovernor(store).admit(tmpl)).resolves.toBeUndefined();
    });
  });

  it('sends unpaced, and does not throw, when Redis cannot be read', async () => {
    const store = fakeStore({
      global: vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
    });
    await expect(new RedisSendGovernor(store).admit(target)).resolves.toBeUndefined();
    await expect(
      new RedisSendGovernor(
        fakeStore({
          recordSent: vi.fn(async () => {
            throw new Error('down');
          }),
        }),
      ).recordSent(target),
    ).resolves.toBeUndefined();
  });

  it('records only Meta’s throughput codes as a throttle', async () => {
    const store = fakeStore();
    const gov = new RedisSendGovernor(store);
    await gov.recordRefused(target, 131026);
    await gov.recordRefused(target, null);
    expect(store.recordMetaThrottle).not.toHaveBeenCalled();
    await gov.recordRefused(target, 130429);
    await gov.recordRefused(target, 131057);
    expect(store.recordMetaThrottle).toHaveBeenNthCalledWith(
      1,
      target.phoneNumberId,
      'throughput',
      true,
    );
    expect(store.recordMetaThrottle).toHaveBeenNthCalledWith(
      2,
      target.phoneNumberId,
      'upgrade',
      true,
    );
  });
});

describe('sendTargetOf', () => {
  const post = (path: string, json: unknown) => sendTargetOf({ method: 'POST', path, json });

  it('paces a message to a customer', () => {
    expect(
      post('/100200300/messages', {
        messaging_product: 'whatsapp',
        to: '919900000001',
        type: 'text',
      }),
    ).toEqual({
      phoneNumberId: '100200300',
      recipient: '919900000001',
      businessInitiated: false,
    });
  });

  it('paces a Marketing Messages Lite send like any other', () => {
    expect(post('/100200300/marketing_messages', { to: '9199', type: 'template' })).toEqual({
      phoneNumberId: '100200300',
      recipient: '9199',
      businessInitiated: true,
    });
  });

  it('counts a template as business-initiated', () => {
    expect(post('/100200300/messages', { to: '9199', type: 'template' })?.businessInitiated).toBe(
      true,
    );
  });

  it.each([
    ['a read receipt', '/100200300/messages', { status: 'read', message_id: 'wamid.X' }],
    ['a management call', '/100200300/settings', { to: '9199' }],
    ['a message without a recipient', '/100200300/messages', { type: 'text' }],
    ['another node', '/WABA123/messages', { to: '9199' }],
  ])('leaves %s alone', (_n, path, json) => {
    expect(post(path, json)).toBeNull();
  });

  it('leaves a GET alone', () => {
    expect(sendTargetOf({ method: 'GET', path: '/100200300/messages' })).toBeNull();
  });
});

describe('WabaHttp with a governor', () => {
  const auth = { provider: 'meta', accessToken: 'tok' } as const;
  function build(status = 200, body: unknown = { messages: [{ id: 'wamid.1' }] }) {
    const calls: string[] = [];
    const governor: SendGovernor = {
      admit: vi.fn(async () => void calls.push('admit')),
      recordSent: vi.fn(async () => void calls.push('sent')),
      recordRefused: vi.fn(async () => void calls.push('refused')),
    };
    const http = new WabaHttp(readWabaEnv({ META_APP_ID: 'a' }), governor);
    http.fetchImpl = async () => {
      calls.push('fetch');
      return new Response(JSON.stringify(body), { status });
    };
    return { http, governor, calls };
  }
  const send = {
    method: 'POST',
    path: '/100200300/messages',
    json: { to: '919900000001', type: 'text' },
  } as const;

  it('admits before the request and counts it after', async () => {
    const { http, calls } = build();
    await http.call(auth, send);
    expect(calls).toEqual(['admit', 'fetch', 'sent']);
  });

  it('does not call Meta when the governor refuses', async () => {
    const { http, governor, calls } = build();
    vi.mocked(governor.admit).mockRejectedValueOnce(WabaApiError.held(5_000, 'queue'));
    await expect(http.call(auth, send)).rejects.toBeInstanceOf(WabaApiError);
    expect(calls).not.toContain('fetch');
    expect(governor.recordRefused).not.toHaveBeenCalled();
  });

  it('reports Meta’s refusal code so the number slows down', async () => {
    const { http, governor } = build(429, { error: { code: 130429, message: 'Rate limit hit' } });
    await expect(http.call(auth, send)).rejects.toBeInstanceOf(WabaApiError);
    expect(governor.recordRefused).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumberId: '100200300' }),
      130429,
    );
  });

  it('does not govern a read receipt or a management call', async () => {
    const { http, governor } = build();
    await http.call(auth, {
      method: 'POST',
      path: '/100200300/messages',
      json: { status: 'read', message_id: 'x' },
    });
    await http.call(auth, { method: 'GET', path: '/100200300', query: { fields: 'throughput' } });
    expect(governor.admit).not.toHaveBeenCalled();
  });

  it('sends unpaced where no governor is provided', async () => {
    const http = new WabaHttp(readWabaEnv({ META_APP_ID: 'a' }));
    http.fetchImpl = async () =>
      new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 });
    await expect(http.call(auth, send)).resolves.toEqual({ messages: [{ id: 'wamid.1' }] });
  });
});

describe('Meta throughput error codes', () => {
  const err = (code: number) =>
    new WabaApiError('x', 400, code, null, null, null, null, false, { error: { code } });

  it('treats 131057 (a throughput upgrade in progress) as a retryable rate limit, a minute out', () => {
    const f = metaFailure(err(131057));
    expect(f.retryable).toBe(true);
    expect(f.code).toBe('RATE_LIMITED');
    expect(f.retryAfterMs).toBeGreaterThanOrEqual(60_000);
    expect(err(131057).retryable).toBe(true);
  });

  it('keeps 130429 retryable with Meta’s own wait when the limiter did not set one', () => {
    const f = metaFailure(err(130429));
    expect(f.retryable).toBe(true);
    expect(f.retryAfterMs).toBe(10_000);
  });
});
