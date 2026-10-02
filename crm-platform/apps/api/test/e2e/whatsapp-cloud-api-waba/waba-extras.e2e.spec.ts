import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  WabaHttp,
  type FetchLike,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';
import { inboundUrlKey } from '../../../src/modules/whatsapp-cloud-api-waba/waba-rules';
import { until } from '../chat-conversations/pipeline-support';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * The number extras end to end (TW-WABA-025, 026, 027, 028): the real API, a real Postgres and Redis, the WABA worker for the
 * webhook. Only Meta Graph is faked, at the HTTP edge, so every URL and body the platform sends is asserted.
 */
let h: Harness;
let api: Api;
let seq = 0;

interface Call {
  method: string;
  url: string;
  body: string | null;
}
let calls: Call[] = [];
let rules: Array<{ match: RegExp; respond: (c: Call) => Response }> = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const meta = (match: RegExp, body: unknown, status = 200) =>
  rules.push({ match, respond: () => json(body, status) });

beforeAll(async () => {
  h = await startHarness({
    loadModules: async () => [
      (await import('../../../src/modules/whatsapp-cloud-api-waba/waba-worker.module'))
        .WabaWorkerModule,
    ],
  });
  api = new Api(h);
  const fake: FetchLike = async (url, init) => {
    const form = init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : null;
    const call: Call = {
      method: String(init?.method),
      url,
      body: typeof init?.body === 'string' ? init.body : form ? JSON.stringify(form) : null,
    };
    calls.push(call);
    return (
      rules.find((r) => r.match.test(`${call.method} ${call.url}`))?.respond(call) ??
      json({ error: { message: `unstubbed ${call.method} ${call.url}`, code: 1 } }, 404)
    );
  };
  h.app.get(WabaHttp).fetchImpl = fake;
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  calls = [];
  rules = [];
});

async function arrange(label: string) {
  const t: Tenant = await api.signup(label);
  const n = seq++;
  const ids = { phone: `3300${n}00${n}`, waba: `4400${n}00${n}` };
  const crypto = h.app.get(CryptoService);
  const row = (
    await h.owner.query(
      `INSERT INTO wa_provider_configs (org_id, provider, status, is_primary, phone_number, display_label, credentials_json, meta_json, connected_at)
       VALUES ($1, 'waba', 'connected', true, $2, 'Acme Store', $3, $4, now()) RETURNING uuid`,
      [
        t.orgId,
        `+9191133${String(10000 + n)}`,
        crypto.encrypt(JSON.stringify({ access_token: `EAAG-token-${n}` })),
        JSON.stringify({ waba_id: ids.waba, phone_number_id: ids.phone, provider: 'meta' }),
      ],
    )
  ).rows[0];
  return { t, ids, id: row.uuid as string };
}
const meta_json = async (id: string) =>
  (await h.owner.query(`SELECT meta_json FROM wa_provider_configs WHERE uuid = $1`, [id])).rows[0]
    .meta_json as Record<string, unknown>;
const G = /graph\.facebook\.com\/v\d+\.\d+/;

describe('business username (TW-WABA-025)', () => {
  it('claims a handle, stores it with the status Meta reports, and shows it with no suggestions', async () => {
    const x = await arrange('ex1');
    meta(new RegExp(`POST .*/${x.ids.phone}/username$`), { status: 'reserved' });
    const res = await api
      .as(x.t.admin)
      .post(`/v2/waba/numbers/${x.id}/username`)
      .send({ username: 'AcmeStore ' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ username: 'acmestore', status: 'reserved', suggestions: [] });
    expect(JSON.parse(calls[0]!.body!)).toEqual({ username: 'acmestore' });
    expect(await meta_json(x.id)).toMatchObject({
      wa_username: 'acmestore',
      wa_username_status: 'reserved',
    });
    const read = await api.as(x.t.admin).get(`/v2/waba/numbers/${x.id}/username`);
    expect(read.body).toMatchObject({ username: 'acmestore', status: 'reserved', suggestions: [] });
  });

  it("refuses a handle that breaks Meta's rules without calling Meta", async () => {
    const x = await arrange('ex2');
    const res = await api
      .as(x.t.admin)
      .post(`/v2/waba/numbers/${x.id}/username`)
      .send({ username: 'www.brand' });
    expect(res.status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it('explains Meta\'s error 100 as "register first / limited rollout"', async () => {
    const x = await arrange('ex3');
    meta(
      new RegExp(`POST .*/${x.ids.phone}/username$`),
      { error: { code: 100, message: 'Unsupported post request' } },
      400,
    );
    const res = await api
      .as(x.t.admin)
      .post(`/v2/waba/numbers/${x.id}/username`)
      .send({ username: 'acmestore' });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/limited rollout/);
    expect((await meta_json(x.id)).wa_username).toBeUndefined();
  });

  it('suggests valid handles when none is claimed, and clears the record on release even if Meta fails', async () => {
    const x = await arrange('ex4');
    meta(new RegExp(`GET .*/${x.ids.phone}\\?fields=username`), { username: 'acme_reserved' });
    const first = await api.as(x.t.admin).get(`/v2/waba/numbers/${x.id}/username`);
    expect(first.body.suggestions).toEqual(['acme_reserved', 'acmestore', 'acme_store']);

    await h.owner.query(
      `UPDATE wa_provider_configs SET meta_json = meta_json || '{"wa_username":"acmestore","wa_username_status":"approved"}'::jsonb WHERE uuid = $1`,
      [x.id],
    );
    meta(
      new RegExp(`DELETE .*/${x.ids.phone}/username$`),
      { error: { code: 1, message: 'boom' } },
      500,
    );
    const rel = await api.as(x.t.admin).delete(`/v2/waba/numbers/${x.id}/username`);
    expect(rel.status).toBe(200);
    expect(rel.body).toMatchObject({ username: null, status: null });
    expect((await meta_json(x.id)).wa_username).toBeNull();
  });

  it("follows Meta's business_username_update webhook: reserved becomes approved, deleted clears it", async () => {
    const x = await arrange('ex5');
    await h.owner.query(
      `UPDATE wa_provider_configs SET meta_json = meta_json || '{"wa_username":"acmestore","wa_username_status":"reserved"}'::jsonb WHERE uuid = $1`,
      [x.id],
    );
    const key = inboundUrlKey(process.env.CREDENTIALS_ENCRYPTION_KEY!);
    const hook = (value: Record<string, unknown>) =>
      api
        .http()
        .post(`/v2/public/webhooks/whatsapp?k=${key}`)
        .send({
          object: 'whatsapp_business_account',
          entry: [
            {
              id: x.ids.waba,
              changes: [
                {
                  field: 'business_username_update',
                  value: { metadata: { phone_number_id: x.ids.phone }, ...value },
                },
              ],
            },
          ],
        });
    expect((await hook({ username: 'acmestore', status: 'approved' })).status).toBe(200);
    await until('approved', async () =>
      (await meta_json(x.id)).wa_username_status === 'approved' ? true : undefined,
    );
    expect((await hook({ status: 'deleted' })).status).toBe(200);
    await until('cleared', async () =>
      (await meta_json(x.id)).wa_username === null ? true : undefined,
    );
  });
});

describe('QR codes (TW-WABA-027)', () => {
  it('creates a PNG code with the prefilled message, lists it, and deletes it', async () => {
    const x = await arrange('ex6');
    meta(new RegExp(`POST .*/${x.ids.phone}/message_qrdls$`), {
      code: 'ABC123',
      prefilled_message: 'Hi!',
      deep_link_url: 'https://wa.me/message/ABC123',
      qr_image_url: 'https://qr.test/abc.png',
    });
    meta(new RegExp(`GET .*/${x.ids.phone}/message_qrdls`), {
      data: [
        {
          code: 'ABC123',
          prefilled_message: 'Hi!',
          deep_link_url: 'https://wa.me/message/ABC123',
          qr_image_url: 'https://qr.test/abc.png',
        },
      ],
    });
    meta(new RegExp(`DELETE .*/${x.ids.phone}/message_qrdls/ABC123$`), { success: true });

    const made = await api
      .as(x.t.admin)
      .post(`/v2/waba/numbers/${x.id}/qr-codes`)
      .send({ prefilledMessage: 'Hi!' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body).toMatchObject({
      code: 'ABC123',
      deepLinkUrl: 'https://wa.me/message/ABC123',
    });
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      prefilled_message: 'Hi!',
      generate_qr_image: 'PNG',
    });

    const list = await api.as(x.t.admin).get(`/v2/waba/numbers/${x.id}/qr-codes`);
    expect(list.body.items).toHaveLength(1);
    expect(
      (await api.as(x.t.admin).delete(`/v2/waba/numbers/${x.id}/qr-codes/ABC123`)).status,
    ).toBe(204);
    expect(
      calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/message_qrdls/ABC123')),
    ).toBe(true);
  });

  it('refuses a message over 140 characters', async () => {
    const x = await arrange('ex7');
    const res = await api
      .as(x.t.admin)
      .post(`/v2/waba/numbers/${x.id}/qr-codes`)
      .send({ prefilledMessage: 'x'.repeat(141) });
    expect(res.status).toBe(422);
    expect(calls).toHaveLength(0);
  });
});

describe('live inbound check (TW-WABA-015)', () => {
  const subscribed = (x: { ids: { waba: string } }, apps: unknown[]) =>
    meta(new RegExp(`GET .*/${x.ids.waba}/subscribed_apps`), { data: apps });

  it('says not_subscribed, wrong_url, delivering_here or subscribed_default from where Meta delivers', async () => {
    const x = await arrange('ex9');
    const ours = (await api.as(x.t.admin).get('/v2/waba/webhook-config')).body.webhookUrl as string;
    expect(ours).toMatch(/\/v2\/public\/webhooks\/whatsapp\?k=/);
    const verdict = async () =>
      (await api.as(x.t.admin).get(`/v2/waba/numbers/${x.id}/inbound-check`)).body;

    subscribed(x, []);
    expect(await verdict()).toMatchObject({ verdict: 'not_subscribed', apps: [] });
    rules = [];
    subscribed(x, [
      {
        whatsapp_business_api_data: {
          name: 'Other',
          override_callback_uri: 'https://other.example/hook',
        },
      },
    ]);
    expect(await verdict()).toMatchObject({ verdict: 'wrong_url' });
    rules = [];
    subscribed(x, [
      {
        whatsapp_business_api_data: {
          name: 'Us',
          override_callback_uri: ours.toUpperCase().replace('HTTPS', 'https'),
        },
      },
    ]);
    expect((await verdict()).verdict).toBe('delivering_here');
    rules = [];
    subscribed(x, [{ whatsapp_business_api_data: { name: 'Default app' } }]);
    expect((await verdict()).verdict).toBe('subscribed_default');
  });

  it("is a 404 for another workspace's number and a 422 for a number with no token", async () => {
    const a = await arrange('ex10a');
    const b = await api.signup('ex10b');
    expect((await api.as(b.admin).get(`/v2/waba/numbers/${a.id}/inbound-check`)).status).toBe(404);
    await h.owner.query(`UPDATE wa_provider_configs SET credentials_json = NULL WHERE uuid = $1`, [
      a.id,
    ]);
    expect((await api.as(a.t.admin).get(`/v2/waba/numbers/${a.id}/inbound-check`)).status).toBe(
      422,
    );
  });
});

describe("another workspace's number is a 404 (isolation)", () => {
  it('cannot read or change the extras of a number it does not own', async () => {
    const a = await arrange('ex8a');
    const b = await api.signup('ex8b');
    for (const res of [
      await api.as(b.admin).get(`/v2/waba/numbers/${a.id}/username`),
      await api.as(b.admin).get(`/v2/waba/numbers/${a.id}/qr-codes`),
      await api.as(b.admin).post(`/v2/waba/numbers/${a.id}/sync-history`).send({}),
    ]) {
      expect(res.status).toBe(404);
    }
    expect(calls).toHaveLength(0);
    void G;
  });
});
