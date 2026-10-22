import { createHmac, timingSafeEqual } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { WabaWebhookService } from './waba-webhook.service';

const SECRET = 'platform-secret';
const body = (phone = 'p1') =>
  Buffer.from(
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'w1',
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
