import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { WabaWebhookService } from '../../../src/modules/whatsapp-cloud-api-waba/waba-webhook.service';

/**
 * AZ-015: one signature covers the whole body, so a customer's own app secret may authenticate a delivery only when every
 * number and WABA id in it belongs to that customer's workspace.
 */
const ROUTES: Record<string, { org: number; cfg: number }> = {
  'phone:111': { org: 1, cfg: 11 }, // victim, signs with the platform secret (no own secret)
  'phone:221': { org: 2, cfg: 21 }, // attacker, own secret
  'phone:222': { org: 2, cfg: 22 }, // attacker, second number
  'waba:wv': { org: 1, cfg: 11 },
  'waba:wx': { org: 2, cfg: 21 },
};
const OWN_SECRET: Record<number, string> = { 21: 'attacker-secret', 22: 'attacker-secret' };

function build() {
  const queue = {
    add: vi.fn(async () => undefined),
    getJobState: vi.fn(async () => 'unknown'),
    getJob: vi.fn(async () => undefined),
  };
  const db = {
    primary: {
      execute: vi.fn(async (q: { queryChunks: unknown[] }) => {
        // The bound values are the primitives among the chunks (the text parts are StringChunk objects).
        const params = q.queryChunks.filter((c) => c === null || typeof c !== 'object');
        const text = q.queryChunks
          .flatMap((c) =>
            c !== null && typeof c === 'object' ? (c as { value: string[] }).value : [],
          )
          .join('?');
        const wabaOnly = text.includes('(NULL,');
        const phone = wabaOnly ? null : (params[0] as string | null);
        const waba = wabaOnly ? (params[0] as string) : (params[1] as string | null);
        const hit = phone ? ROUTES[`phone:${phone}`] : waba ? ROUTES[`waba:${waba}`] : undefined;
        return { rows: hit ? [{ route_org_id: hit.org, route_config_id: hit.cfg }] : [] };
      }),
    },
    txAs: async (_o: unknown, fn: (tx: unknown) => unknown) => fn({}),
  };
  const repo = {
    findById: async (_tx: unknown, _org: number, id: number) =>
      OWN_SECRET[id] ? { credentials_json: `enc:${OWN_SECRET[id]}` } : { credentials_json: null },
  };
  const crypto = {
    decrypt: (v: string) => JSON.stringify({ app_secret: v.slice(4) }),
    encrypt: (v: string) => `sealed:${Buffer.from(v).toString('base64')}`,
  };
  const config = {
    get: (k: string) => (k === 'CREDENTIALS_ENCRYPTION_KEY' ? 'k'.repeat(32) : undefined),
  };
  const provider = {
    verifyWebhookSignature: (raw: Buffer, header: string, secret: string) =>
      header === `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`,
  };
  const providers = {
    verifyTokens: () => [],
    payloadProviders: async () => ({ custom: [], hasBuiltin: true }),
  };
  const svc = new WabaWebhookService(
    db as never,
    repo as never,
    crypto as never,
    config as never,
    { META_APP_SECRET: 'platform-secret', WABA_REQUIRE_INTERAKT_SIGNATURE: false } as never,
    provider as never,
    queue as never,
    { forward: async () => undefined } as never,
    providers as never,
  );
  return { svc, queue };
}

const change = (waba: string, phone: string) => ({
  id: waba,
  time: 1,
  changes: [{ field: 'messages', value: { metadata: { phone_number_id: phone }, messages: [] } }],
});
const raw = (...entries: unknown[]) =>
  Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: entries }));
const sign = (secret: string, body: Buffer) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
const send = (svc: WabaWebhookService, body: Buffer, secret: string) =>
  svc.receive({ rawBody: body, signatureHeader: sign(secret, body), queryKey: undefined });

describe('WhatsApp webhook: the body parser result is reused (EL-B09)', () => {
  const sendParsed = (svc: WabaWebhookService, body: Buffer, secret: string) =>
    svc.receive({
      rawBody: body,
      parsedBody: JSON.parse(body.toString('utf8')),
      signatureHeader: sign(secret, body),
      queryKey: undefined,
    });

  it('gives the same answer as parsing the raw bytes, for an accepted delivery', async () => {
    const body = raw(change('wx', '221'), change('wv', '111'));
    const a = await sendParsed(build().svc, body, 'platform-secret');
    const b = await send(build().svc, body, 'platform-secret');
    expect(a).toEqual(b);
    expect(a.queued).toBe(2);
  });

  it('enqueues the same job: the id comes from the raw bytes, the changes from the parsed body', async () => {
    const one = build();
    const two = build();
    const body = raw(change('wx', '221'));
    await sendParsed(one.svc, body, 'platform-secret');
    await send(two.svc, body, 'platform-secret');
    expect(one.queue.add.mock.calls[0]).toEqual(two.queue.add.mock.calls[0]);
  });

  it('still checks the signature against the raw bytes: a parsed body does not authenticate itself', async () => {
    const { svc, queue } = build();
    const body = raw(change('wx', '221'), change('wv', '111'));
    await expect(sendParsed(svc, body, 'attacker-secret')).rejects.toMatchObject({ status: 401 });
    // a parsed body that differs from the signed bytes cannot be smuggled in either: the signature covers the bytes
    const signed = raw(change('wx', '221'));
    await expect(
      svc.receive({
        rawBody: signed,
        parsedBody: JSON.parse(raw(change('wx', '221'), change('wv', '111')).toString()),
        signatureHeader: sign('attacker-secret', signed),
        queryKey: undefined,
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('falls back to parsing the raw bytes when there is no parsed object', async () => {
    const body = raw(change('wx', '221'));
    for (const parsedBody of [undefined, null, 'text', 42]) {
      const res = await build().svc.receive({
        rawBody: body,
        parsedBody,
        signatureHeader: sign('platform-secret', body),
        queryKey: undefined,
      });
      expect(res.queued).toBe(1);
    }
    await expect(
      build().svc.receive({
        rawBody: Buffer.from('not json'),
        parsedBody: undefined,
        signatureHeader: sign('platform-secret', Buffer.from('not json')),
        queryKey: undefined,
      }),
    ).rejects.toMatchObject({ status: 422 }); // AppError.validation, as before
  });
});

describe('WhatsApp webhook: signature scope (AZ-015)', () => {
  it('refuses a body naming a victim number next to the attacker own number, signed with the attacker secret', async () => {
    const { svc, queue } = build();
    const body = raw(change('wx', '221'), change('wv', '111'));
    await expect(send(svc, body, 'attacker-secret')).rejects.toMatchObject({ status: 401 });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('refuses a victim WABA id hidden behind an attacker number', async () => {
    const { svc, queue } = build();
    const body = raw(change('wv', '221'));
    await expect(send(svc, body, 'attacker-secret')).rejects.toMatchObject({ status: 401 });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('refuses an own-secret body that names an unknown number', async () => {
    const { svc } = build();
    await expect(
      send(svc, raw(change('wx', '221'), change('wx', '999')), 'attacker-secret'),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('accepts several numbers of the one workspace signed with its own secret', async () => {
    const { svc, queue } = build();
    const res = await send(svc, raw(change('wx', '221'), change('wx', '222')), 'attacker-secret');
    expect(res.queued).toBe(2);
    expect(queue.add).toHaveBeenCalledTimes(1);
    // The job carries message text and phone numbers: it is queued sealed, never as plain JSON.
    const data = (queue.add.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(Object.keys(data)).toEqual(['sealed']);
    expect(JSON.stringify(data)).not.toContain('"changes"');
  });

  it('accepts numbers of many workspaces signed with the platform secret', async () => {
    const { svc } = build();
    const res = await send(svc, raw(change('wx', '221'), change('wv', '111')), 'platform-secret');
    expect(res.queued).toBe(2);
  });

  it('refuses a body signed with a secret nobody holds', async () => {
    const { svc } = build();
    await expect(send(svc, raw(change('wx', '221')), 'nope')).rejects.toMatchObject({
      status: 401,
    });
  });
});
