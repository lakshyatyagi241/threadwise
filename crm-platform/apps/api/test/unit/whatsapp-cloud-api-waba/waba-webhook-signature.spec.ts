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
  const queue = { add: vi.fn(async () => undefined), getJob: vi.fn(async () => undefined) };
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
  const crypto = { decrypt: (v: string) => JSON.stringify({ app_secret: v.slice(4) }) };
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
