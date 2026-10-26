import { createHmac, timingSafeEqual } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { WabaWebhookService } from './waba-webhook.service';

const SECRET = 'platform-secret';
const body = (phone = 'p1', waba = 'w1') =>
  Buffer.from(
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: waba,
          changes: [
            {
              field: 'messages',
              value: { metadata: { phone_number_id: phone }, messages: [{ id: 'm1' }] },
            },
          ],
        },
      ],
    }),
  );
const sign = (raw: Buffer) => `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;

function build(redisOver: Record<string, unknown> = {}) {
  const store = new Map<string, string>();
  const redis = {
    exists: vi.fn(async (k: string) => (store.has(k) ? 1 : 0)),
    set: vi.fn(async (k: string, v: string) => void store.set(k, v)),
    ...redisOver,
  };
  const queue = { add: vi.fn(), getJob: vi.fn(), getJobState: vi.fn(async () => 'unknown') };
  const providers = {
    payloadProviders: vi.fn(async () => ({ custom: [], hasBuiltin: true })),
    verifyTokens: () => [],
  };
  const db = { privileged: vi.fn(), primary: { execute: vi.fn() }, txAs: vi.fn() };
  const fanout = { forward: vi.fn(async () => 0) };
  const provider = {
    // Compares in constant time, as the real provider does.
    verifyWebhookSignature: (raw: Buffer, header: string, secret: string) => {
      const want = Buffer.from(`sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`);
      const got = Buffer.from(header);
      return got.length === want.length && timingSafeEqual(got, want);
    },
  };
  const svc = new WabaWebhookService(
    db as never,
    redis as never,
    {} as never,
    { encrypt: (s: string) => s, decrypt: (s: string) => s } as never,
    { get: () => 'k'.repeat(32) } as never,
    {
      META_APP_SECRET: SECRET,
      WABA_REQUIRE_INTERAKT_SIGNATURE: false,
      WABA_TRUSTED_FORWARDER_IPS: [],
    } as never,
    provider as never,
    queue as never,
    fanout as never,
    providers as never,
  );
  return { svc, redis, queue, providers, db, fanout };
}

describe('WabaWebhookService.receive: load shape', () => {
  it('answers an exact replay of an authenticated delivery without any lookup', async () => {
    const { svc, queue, providers, fanout } = build();
    const raw = body();
    const input = { rawBody: raw, signatureHeader: sign(raw), queryKey: undefined };
    await svc.receive(input);
    await new Promise((r) => setImmediate(r));
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(providers.payloadProviders).toHaveBeenCalledTimes(1);

    const again = await svc.receive(input);
    expect(again).toEqual({ queued: 0 });
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(providers.payloadProviders).toHaveBeenCalledTimes(1);
    expect(fanout.forward).toHaveBeenCalledTimes(1);
  });

  it('never marks a refused delivery, so a forgery cannot hit the replay path', async () => {
    const { svc, redis } = build();
    await expect(
      svc.receive({ rawBody: body(), signatureHeader: 'sha256=bad', queryKey: undefined }),
    ).rejects.toThrow();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('reuses the provider lookup for the same numbers instead of taking a connection per delivery', async () => {
    const { svc, providers, db } = build();
    for (let i = 0; i < 5; i++) {
      const raw = Buffer.from(body().toString('utf8').replace('m1', `m${i}`));
      await svc.receive({ rawBody: raw, signatureHeader: sign(raw), queryKey: undefined });
    }
    expect(providers.payloadProviders).toHaveBeenCalledTimes(1);
    expect(db.primary.execute).not.toHaveBeenCalled();
  });

  it('still processes the delivery when Redis cannot answer', async () => {
    const { svc, queue } = build({
      exists: vi.fn().mockRejectedValue(new Error('redis down')),
      set: vi.fn().mockRejectedValue(new Error('redis down')),
    });
    const raw = body();
    await svc.receive({ rawBody: raw, signatureHeader: sign(raw), queryKey: undefined });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });
});

describe('WabaWebhookService.receive: numbers that are not ours', () => {
  /** The connections table holds one number: phone p1 of WABA w1. */
  const withOneConnection = () => {
    const ctx = build();
    ctx.db.privileged.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({ execute: async () => ({ rows: [{ phone: 'p1', waba: 'w1' }] }) }),
    );
    return ctx;
  };

  it('answers a delivery for a number no connection owns without a lookup, a job or a worker pass', async () => {
    const { svc, queue, providers, fanout, redis } = withOneConnection();
    const raw = body('someone-elses-number', 'other-waba');
    const out = await svc.receive({
      rawBody: raw,
      signatureHeader: sign(raw),
      queryKey: undefined,
    });
    expect(out).toEqual({ queued: 0 });
    expect(providers.payloadProviders).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    expect(fanout.forward).toHaveBeenCalledTimes(1); // forwarding to the platform's targets is unchanged
    await new Promise((r) => setImmediate(r));
    expect(redis.set).toHaveBeenCalledTimes(1); // and an exact repeat is absorbed
  });

  it('still refuses a forgery for a number that is not ours', async () => {
    const { svc, queue } = withOneConnection();
    await expect(
      svc.receive({
        rawBody: body('someone-elses-number', 'other-waba'),
        signatureHeader: 'sha256=bad',
        queryKey: undefined,
      }),
    ).rejects.toThrow();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('queues a delivery for one of our numbers as before', async () => {
    const { svc, queue, providers } = withOneConnection();
    const raw = body('p1');
    const out = await svc.receive({
      rawBody: raw,
      signatureHeader: sign(raw),
      queryKey: undefined,
    });
    expect(out).toEqual({ queued: 1 });
    expect(providers.payloadProviders).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('queues only the changes that could be ours when a delivery mixes both', async () => {
    const { svc, queue } = withOneConnection();
    const change = (phone: string) => ({
      field: 'messages',
      value: { metadata: { phone_number_id: phone }, messages: [{ id: phone }] },
    });
    const raw = Buffer.from(
      JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{ id: 'w1', changes: [change('p1'), change('other')] }],
      }),
    );
    // the second change names a number that is not ours, and a change that names a number is routed by it alone: only p1 is queued
    await svc.receive({ rawBody: raw, signatureHeader: sign(raw), queryKey: undefined });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('finds a connection added after the index loaded, by its first delivery', async () => {
    vi.useFakeTimers();
    try {
      const rows: Array<{ phone: string; waba: string }> = [{ phone: 'p1', waba: 'w1' }];
      const { svc, queue, db } = build();
      db.privileged.mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn({ execute: async () => ({ rows: [...rows] }) }),
      );
      const first = body('p1');
      await svc.receive({ rawBody: first, signatureHeader: sign(first), queryKey: undefined });
      expect(queue.add).toHaveBeenCalledTimes(1);

      rows.push({ phone: 'p-new', waba: 'w-new' }); // a number is connected a moment later
      vi.advanceTimersByTime(100); // past the 50 ms an index may be when a delivery names nothing it knows
      const fresh = body('p-new', 'w-new');
      const out = await svc.receive({
        rawBody: fresh,
        signatureHeader: sign(fresh),
        queryKey: undefined,
      });
      expect(out).toEqual({ queued: 1 });
      expect(queue.add).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not query the connection list once per delivery under a flood of foreign numbers', async () => {
    const { svc, db } = (() => {
      const ctx = build();
      ctx.db.privileged.mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn({ execute: async () => ({ rows: [{ phone: 'p1', waba: 'w1' }] }) }),
      );
      return ctx;
    })();
    for (let i = 0; i < 200; i++) {
      const raw = body(`foreign-${i}`, `fw-${i}`);
      await svc.receive({ rawBody: raw, signatureHeader: sign(raw), queryKey: undefined });
    }
    expect(db.privileged.mock.calls.length).toBeLessThan(20);
  });

  it('treats every number as possibly ours when the connection list cannot be read', async () => {
    const { svc, queue } = build(); // db.privileged answers nothing: the index never loads
    const raw = body('someone-elses-number', 'other-waba');
    const out = await svc.receive({
      rawBody: raw,
      signatureHeader: sign(raw),
      queryKey: undefined,
    });
    expect(out).toEqual({ queued: 1 });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });
});

describe('WabaWebhookService.receive: cache keys', () => {
  it('does not share a lookup between one id containing a comma and two ids', async () => {
    const { svc, providers } = build();
    const one = body('p1,p2');
    await svc.receive({ rawBody: one, signatureHeader: sign(one), queryKey: undefined });
    const other = Buffer.from(
      JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'w1',
            changes: [
              {
                field: 'messages',
                value: { metadata: { phone_number_id: 'p1' }, messages: [{ id: 'a' }] },
              },
              {
                field: 'messages',
                value: { metadata: { phone_number_id: 'p2' }, messages: [{ id: 'b' }] },
              },
            ],
          },
        ],
      }),
    );
    await svc.receive({ rawBody: other, signatureHeader: sign(other), queryKey: undefined });
    expect(providers.payloadProviders).toHaveBeenCalledTimes(2);
  });
});

describe('WabaWebhookService.receive: replay and failed jobs', () => {
  it('lets a repeat through when the job of the first one has failed', async () => {
    const { svc, queue } = build();
    const raw = body();
    const input = { rawBody: raw, signatureHeader: sign(raw), queryKey: undefined };
    await svc.receive(input);
    await new Promise((r) => setImmediate(r));
    (queue.getJobState as ReturnType<typeof vi.fn>).mockResolvedValue('failed');
    const again = await svc.receive(input);
    expect(again.queued).toBe(1);
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('does not keep a placeholder provider for the next delivery', async () => {
    const { svc, providers } = build();
    providers.payloadProviders.mockResolvedValue({
      custom: [{ key: 'new', baseUrl: '' }],
      hasBuiltin: false,
    } as never);
    for (const id of ['a', 'b']) {
      const raw = Buffer.from(body().toString('utf8').replace('m1', id));
      await svc
        .receive({ rawBody: raw, signatureHeader: sign(raw), queryKey: undefined })
        .catch(() => undefined);
    }
    expect(providers.payloadProviders).toHaveBeenCalledTimes(2);
  });
});
