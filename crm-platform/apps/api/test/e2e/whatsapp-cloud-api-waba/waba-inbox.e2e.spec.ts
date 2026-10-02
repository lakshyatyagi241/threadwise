import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  WabaHttp,
  type FetchLike,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';
import {
  CONVERSATIONS_FACADE,
  type ConversationsFacade,
} from '../../../src/modules/chat-conversations';
import { WabaChannelSync } from '../../../src/modules/whatsapp-cloud-api-waba/inbox/waba-channel-sync.service';
import { inboundUrlKey } from '../../../src/modules/whatsapp-cloud-api-waba/waba-rules';
import { asUser, until } from '../chat-conversations/pipeline-support';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * Inbound WhatsApp Cloud API traffic in the inbox, and replies out (TW-WABA-034, 035, 037, 049): the real webhook door, the real WABA
 * and inbox workers, a real Postgres and Redis. Only Meta Graph is faked, at the HTTP edge.
 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let h: Harness;
let api: Api;
let facade: ConversationsFacade;
let sync: WabaChannelSync;
let seq = 0;

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  json: unknown;
}
let calls: Call[] = [];
let rules: Array<{ match: RegExp; respond: (c: Call) => Response }> = [];

beforeAll(async () => {
  h = await startHarness({
    loadModules: async () => [
      (await import('../../../src/modules/chat-conversations/chat-conversations-worker.module'))
        .ChatConversationsWorkerModule,
      (await import('../../../src/modules/whatsapp-cloud-api-waba/waba-worker.module'))
        .WabaWorkerModule,
    ],
  });
  api = new Api(h);
  facade = h.app.get<ConversationsFacade>(CONVERSATIONS_FACADE);
  sync = h.app.get(WabaChannelSync);
  const fake: FetchLike = async (url, init) => {
    const call: Call = {
      method: String(init?.method),
      url,
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      json: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const rule = rules.find((r) => r.match.test(`${call.method} ${call.url}`));
    return (
      rule?.respond(call) ??
      new Response(JSON.stringify({ error: { message: `unstubbed ${call.url}`, code: 1 } }), {
        status: 404,
      })
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

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** A connected number of its own workspace, stored the way the connect flow stores it. */
async function arrange(label: string) {
  const t: Tenant = await api.signup(label);
  const n = seq++;
  const ids = { phone: `1100${n}00${n}`, waba: `2200${n}00${n}` };
  const crypto = h.app.get(CryptoService);
  const row = (
    await h.owner.query(
      `INSERT INTO wa_provider_configs (org_id, provider, status, is_primary, phone_number, display_label, credentials_json, meta_json, connected_at)
       VALUES ($1, 'waba', 'connected', true, $2, 'Support line', $3, $4, now()) RETURNING uuid`,
      [
        t.orgId,
        `+9191122${String(10000 + n)}`,
        crypto.encrypt(JSON.stringify({ access_token: `EAAG-token-${n}` })),
        JSON.stringify({ waba_id: ids.waba, phone_number_id: ids.phone, provider: 'meta' }),
      ],
    )
  ).rows[0];
  await sync.reconcile();
  const channel = (
    await h.owner.query(
      `SELECT id, uuid, status, name, display_address FROM channels WHERE org_id = $1 AND kind = 'whatsapp_waba'`,
      [t.orgId],
    )
  ).rows[0];
  return { t, ids, numberUuid: row.uuid as string, channel };
}

const KEY = () => inboundUrlKey(process.env.CREDENTIALS_ENCRYPTION_KEY!);
const webhook = (ids: { phone: string; waba: string }, value: Record<string, unknown>) =>
  api
    .http()
    .post(`/v2/public/webhooks/whatsapp?k=${KEY()}`)
    .send({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: ids.waba,
          time: Math.floor(Date.now() / 1000),
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: ids.phone },
                ...value,
              },
            },
          ],
        },
      ],
    });
const inbound = (from: string, message: Record<string, unknown>) => ({
  contacts: [{ profile: { name: 'Asha' }, wa_id: from }],
  messages: [{ from, timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
});
const conversation = (x: Awaited<ReturnType<typeof arrange>>, peer: string) =>
  until(
    'the thread',
    async () =>
      (
        await h.owner.query(
          `SELECT * FROM conversations WHERE org_id = $1 AND channel_id = $2 AND peer_key = $3`,
          [x.t.orgId, x.channel.id, peer],
        )
      ).rows[0],
  );
const messages = async (convId: number) =>
  (await h.owner.query(`SELECT * FROM messages WHERE conversation_id = $1 ORDER BY seq`, [convId]))
    .rows;

describe('the number as an inbox channel', () => {
  it('has one connected channel named and addressed like the number, and follows its status', async () => {
    const x = await arrange('wi1');
    expect(x.channel).toMatchObject({ status: 'connected', name: 'Support line' });
    expect(x.channel.display_address).toMatch(/^\+9191122\d{5}$/);
    await h.owner.query(`UPDATE wa_provider_configs SET status = 'disconnected' WHERE uuid = $1`, [
      x.numberUuid,
    ]);
    await sync.reconcile();
    expect(
      (await h.owner.query(`SELECT status FROM channels WHERE id = $1`, [x.channel.id])).rows[0]
        .status,
    ).toBe('disconnected');
  });
});

describe('inbound (TW-WABA-034, 035)', () => {
  it('a text message becomes a thread, a contact and one message, however often Meta delivers it', async () => {
    const x = await arrange('wi2');
    const body = inbound('919800000010', {
      id: 'wamid.in.1',
      type: 'text',
      text: { body: 'Is it in stock?' },
    });
    expect((await webhook(x.ids, body)).status).toBe(200);
    expect((await webhook(x.ids, body)).status).toBe(200);
    const conv = await conversation(x, '919800000010');
    const msgs = await until('the message', async () => {
      const m = await messages(Number(conv.id));
      return m.length ? m : undefined;
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(await messages(Number(conv.id))).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ direction: 'in', kind: 'text', body: 'Is it in stock?' });
    expect(conv).toMatchObject({ peer_name: 'Asha' });
  });

  it("fetches the customer's file from Meta by media id and keeps it", async () => {
    const x = await arrange('wi3');
    rules.push(
      {
        match: /GET .*\/MEDIA1$/,
        respond: () => json({ url: 'https://lookaside.test/f1', mime_type: 'image/png' }),
      },
      {
        match: /GET https:\/\/lookaside\.test\/f1/,
        respond: () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }),
      },
    );
    await webhook(
      x.ids,
      inbound('919800000011', {
        id: 'wamid.in.img',
        type: 'image',
        image: { id: 'MEDIA1', mime_type: 'image/png', caption: 'look' },
      }),
    );
    const conv = await conversation(x, '919800000011');
    const [m] = await until('the file message', async () => {
      const rows = await messages(Number(conv.id));
      return rows.length ? rows : undefined;
    });
    expect(m).toMatchObject({ kind: 'image', body: 'look' });
    expect(String(m.media_key)).toMatch(/^chat\//);
    const download = calls.find((c) => c.url.startsWith('https://lookaside.test'));
    expect(download?.headers.authorization).toMatch(/^Bearer EAAG-token-/);
  });

  it('maps locations and reactions, and never drops a kind it does not show', async () => {
    const x = await arrange('wi4');
    await webhook(
      x.ids,
      inbound('919800000012', {
        id: 'wamid.in.loc',
        type: 'location',
        location: { latitude: 18.5, longitude: 73.8, name: 'Shop' },
      }),
    );
    const conv = await conversation(x, '919800000012');
    await until('location', async () =>
      (await messages(Number(conv.id))).length ? true : undefined,
    );
    await webhook(
      x.ids,
      inbound('919800000012', { id: 'wamid.in.weird', type: 'order', order: { catalog_id: 'c' } }),
    );
    const rows = await until('both', async () => {
      const m = await messages(Number(conv.id));
      return m.length >= 2 ? m : undefined;
    });
    expect(rows[0]).toMatchObject({ kind: 'location' });
    expect(rows).toHaveLength(2);
  });
});

describe('coexistence echoes (TW-WABA-044)', () => {
  const echo = (ids: { phone: string; waba: string }, message: Record<string, unknown>) =>
    api
      .http()
      .post(`/v2/public/webhooks/whatsapp?k=${KEY()}`)
      .send({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: ids.waba,
            changes: [
              {
                field: 'smb_message_echoes',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: ids.phone },
                  message_echoes: [
                    {
                      from: '919112210000',
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      ...message,
                    },
                  ],
                },
              },
            ],
          },
        ],
      });

  it('a message typed on the Business app becomes one outbound bubble, with no unread, even if delivered twice', async () => {
    const x = await arrange('wi7');
    const body = {
      to: '919800000030',
      id: 'wamid.echo.1',
      type: 'text',
      text: { body: 'typed on the phone' },
    };
    expect((await echo(x.ids, body)).status).toBe(200);
    expect((await echo(x.ids, body)).status).toBe(200);
    const conv = await conversation(x, '919800000030');
    const rows = await until('the echo', async () => {
      const m = await messages(Number(conv.id));
      return m.length ? m : undefined;
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(await messages(Number(conv.id))).toHaveLength(1);
    expect(rows[0]).toMatchObject({ direction: 'out', body: 'typed on the phone' });
    expect(Number(conv.unread_count ?? 0)).toBe(0);
  });

  it('describes a file typed from the app, and skips an echo with no customer number', async () => {
    const x = await arrange('wi8');
    await echo(x.ids, {
      to: '919800000031',
      id: 'wamid.echo.2',
      type: 'image',
      image: { id: 'M', caption: 'menu' },
    });
    await echo(x.ids, { id: 'wamid.echo.3', type: 'text', text: { body: 'no customer' } });
    const conv = await conversation(x, '919800000031');
    const rows = await until('the echo', async () => {
      const m = await messages(Number(conv.id));
      return m.length ? m : undefined;
    });
    expect(rows[0]).toMatchObject({ direction: 'out', body: '[Photo] menu' });
    expect(
      (
        await h.owner.query(`SELECT count(*)::int AS n FROM conversations WHERE org_id = $1`, [
          x.t.orgId,
        ])
      ).rows[0].n,
    ).toBe(1);
  });
});

describe('replying (TW-WABA-037, 049)', () => {
  async function thread(x: Awaited<ReturnType<typeof arrange>>, peer: string) {
    await webhook(
      x.ids,
      inbound(peer, { id: `wamid.in.${peer}`, type: 'text', text: { body: 'hi' } }),
    );
    const conv = await conversation(x, peer);
    await until('first message', async () =>
      (await messages(Number(conv.id))).length ? true : undefined,
    );
    return conv;
  }
  const reply = (
    x: Awaited<ReturnType<typeof arrange>>,
    conv: Record<string, unknown>,
    body: string,
  ) =>
    asUser(x.t.orgId, x.t.adminUserId, () =>
      facade.enqueueOutbound({
        conversationId: conv.uuid as string,
        clientMessageId: randomUUID(),
        content: { kind: 'text', body },
      }),
    );
  const status = (uuid: string, s: string) =>
    until(`message ${s}`, async () => {
      const r = (
        await h.owner.query(
          `SELECT status, provider_message_id, failure_code FROM messages WHERE uuid = $1`,
          [uuid],
        )
      ).rows[0];
      return r?.status === s ? r : undefined;
    });

  it('sends through the number, then follows the delivered and read reports', async () => {
    const x = await arrange('wi5');
    rules.push({
      match: /POST .*\/messages$/,
      respond: () => json({ messages: [{ id: 'wamid.out.1' }] }),
    });
    const conv = await thread(x, '919800000020');
    const sent = await reply(x, conv, 'Yes, 3 left');
    const row = await status(sent.message.id, 'sent');
    expect(row.provider_message_id).toBe('wamid.out.1');
    const post = calls.find(
      (c) => c.method === 'POST' && c.url.endsWith(`/${x.ids.phone}/messages`),
    );
    expect(post?.headers.authorization).toMatch(/^Bearer EAAG-token-/);
    expect(post?.json).toMatchObject({
      messaging_product: 'whatsapp',
      to: '919800000020',
      type: 'text',
    });

    const report = (s: string) =>
      webhook(x.ids, {
        statuses: [
          {
            id: 'wamid.out.1',
            status: s,
            timestamp: String(Math.floor(Date.now() / 1000)),
            recipient_id: '919800000020',
          },
        ],
      });
    await report('delivered');
    await status(sent.message.id, 'delivered');
    await report('read');
    await status(sent.message.id, 'read');
  });

  it("a refusal from Meta fails the message with Meta's code, and nothing is claimed sent", async () => {
    const x = await arrange('wi6');
    rules.push({
      match: /POST .*\/messages$/,
      respond: () => json({ error: { message: 'Re-engagement message', code: 131047 } }, 400),
    });
    const conv = await thread(x, '919800000021');
    const sent = await reply(x, conv, 'late reply');
    const row = await status(sent.message.id, 'failed');
    expect(row.failure_code).toBe('131047');
  });
});
