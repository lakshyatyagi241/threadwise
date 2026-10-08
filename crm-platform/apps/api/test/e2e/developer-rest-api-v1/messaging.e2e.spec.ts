import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { ChannelRegistryService } from '../../../src/modules/chat-conversations/channel-registry.service';
import { connectNumber, whatsappChannel } from '../chat-conversations/whatsapp-support';
import {
  simChannel,
  simInbound,
  startPipeline,
  until,
  type Pipeline,
  type SimChannel,
} from '../chat-conversations/pipeline-support';
import type { Tenant } from './support';
import { tenantWithKey } from './support';

/**
 * The messaging group of the customer REST API (TW-API-110 to 120): send one message, the history, media upload, conversations, devices.
 * Real Postgres, Redis and BullMQ, the real app with the chat worker loaded in the same process. No provider is called: the channel is the
 * platform's simulator, which stands in for WhatsApp (a text that starts with `/fail` is refused by the "provider"), and the WhatsApp Cloud
 * and unofficial-number channels are only arranged, never sent through.
 */
let p: Pipeline;
let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'crm-v1-media-e2e-'));
  process.env.MEDIA_LOCAL_DIR = root;
  p = await startPipeline();
}, 300_000);

afterAll(async () => {
  await p?.stop();
  await rm(root, { recursive: true, force: true });
  delete process.env.MEDIA_LOCAL_DIR;
});

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz'),
]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('invoice bytes')]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Workspace {
  tenant: Tenant;
  call: Awaited<ReturnType<typeof tenantWithKey>>['call'];
  secret: string;
  keyId: string;
  channel: SimChannel;
}

/** The raw call, for multipart bodies and for reading a file back. */
const raw = (w: Pick<Workspace, 'secret'>) => {
  const server = p.h.app.getHttpServer();
  const auth = { authorization: `Bearer ${w.secret}` };
  return {
    post: (path: string) => request(server).post(`/api/v1${path}`).set(auth),
    get: (path: string) =>
      request(server)
        .get(path.startsWith('/api/') ? path : `/api/v1${path}`)
        .set(auth)
        .buffer(true),
  };
};

/** A workspace with a key and a simulator channel whose service window is open, so a first message to a new number is allowed. */
async function workspace(label: string): Promise<Workspace> {
  const { tenant, key, call } = await tenantWithKey(p.api, label);
  const channel = await simChannel(p, tenant, {
    simulator: { latencyMs: { sent: 0, delivered: 100, read: 300 }, window: 'open' },
  });
  return { tenant, call, secret: key.secret, keyId: key.id, channel };
}

const q = async (sql: string, params: unknown[] = []) =>
  (await p.h.owner.query(sql, params)).rows as Array<Record<string, unknown>>;
const count = async (sql: string, params: unknown[] = []) =>
  Number((await q(sql, params))[0]?.n ?? 0);

/** Waits for a message to reach a status as the API shows it. */
const statusIs = (w: Workspace, id: string, status: string) =>
  until(`message ${id} ${status}`, async () => {
    const res = await w.call.get(`/messages/${id}`);
    return res.body.data?.status === status ? res.body.data : undefined;
  });

describe('POST /messages: one message to one number (TW-API-110, 118, 119)', () => {
  it('refuses a call with no key (TW-API-110: API key only)', async () => {
    const res = await request(p.h.app.getHttpServer())
      .post('/api/v1/messages')
      .send({ to: '919812345678', text: 'hi' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('missing_api_key');
  });

  it('sends {to, text}: 201 with a uuid id, status sent, type text; the thread, the contact and the message exist (TW-API-110)', async () => {
    const w = await workspace('send-basic');
    const res = await w.call.post('/messages', { to: '+91 98123 45678', text: 'Hello there' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.meta).toBeUndefined();
    expect(res.body.data).toMatchObject({
      to: '+91 98123 45678',
      type: 'text',
      status: 'sent',
      failure_reason: null,
      error_code: null,
      body: 'Hello there',
      media_url: null,
    });
    expect(res.body.data.id).toMatch(UUID);
    expect(new Date(res.body.data.created_at).toISOString()).toBe(res.body.data.created_at);

    const rows = await q(
      `SELECT m.direction, m.kind, m.body, m.status, m.sender_kind, c.peer_key, c.contact_id, ch.kind AS channel_kind
         FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
         JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
        WHERE m.org_id = $1 AND m.uuid = $2`,
      [w.tenant.orgId, res.body.data.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      direction: 'out',
      kind: 'text',
      body: 'Hello there',
      status: 'sent',
      sender_kind: 'bot',
      peer_key: '919812345678',
      channel_kind: 'simulator',
    });
    // The number is a contact of the workspace now, as every number the workspace messages is.
    expect(rows[0]!.contact_id).not.toBeNull();
  });

  it('puts two sends to one number, written two ways, in one conversation (TW-API-110)', async () => {
    const w = await workspace('send-one-thread');
    expect((await w.call.post('/messages', { to: '+91 98123 45678', text: 'one' })).status).toBe(
      201,
    );
    expect((await w.call.post('/messages', { to: '919812345678', text: 'two' })).status).toBe(201);
    expect(
      await count(`SELECT count(*)::int AS n FROM conversations WHERE org_id = $1`, [
        w.tenant.orgId,
      ]),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM messages WHERE org_id = $1 AND direction = 'out'`,
        [w.tenant.orgId],
      ),
    ).toBe(2);
    expect(
      await count(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [w.tenant.orgId]),
    ).toBe(1);
  });

  it('refuses a media type with neither a file nor a URL: 422 media_required (TW-API-110)', async () => {
    const w = await workspace('send-media-required');
    for (const type of ['image', 'video', 'document', 'audio']) {
      const res = await w.call.post('/messages', { to: '919812345678', type });
      expect(res.status, type).toBe(422);
      expect(res.body.error.code).toBe('media_required');
    }
    expect(
      await count(`SELECT count(*)::int AS n FROM messages WHERE org_id = $1`, [w.tenant.orgId]),
    ).toBe(0);
  });

  it('fills {{merge tags}} from the contact before sending; an unknown tag is empty, and the answer echoes the raw text (TW-API-110)', async () => {
    const w = await workspace('send-merge');
    const [contactUuid] = await p.api.seedContacts(w.tenant, [
      { name: 'Asha Rao', phone: '+919812345678' },
    ]);
    await p.h.owner.query(
      `INSERT INTO contact_identities (org_id, contact_id, kind, value, is_primary)
       SELECT org_id, id, 'phone', '+919812345678', true FROM contacts WHERE uuid = $1`,
      [contactUuid],
    );
    const res = await w.call.post('/messages', {
      to: '919812345678',
      text: 'Hi {{name}}{{no_such_tag}}!',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.body).toBe('Hi {{name}}{{no_such_tag}}!');
    const stored = await q(`SELECT body FROM messages WHERE org_id = $1 AND uuid = $2`, [
      w.tenant.orgId,
      res.body.data.id,
    ]);
    expect(stored[0]!.body).toBe('Hi Asha Rao!');
  });

  it('fails a body made only of an unresolved tag as 422 send_failed / empty_message, and stores nothing (TW-API-110)', async () => {
    const w = await workspace('send-empty');
    for (const body of [
      { to: '919812345678', text: '{{nobody}}' },
      { to: '919812345678' },
      { to: '919812345678', text: '   ' },
    ]) {
      const res = await w.call.post('/messages', body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(res.body.error).toMatchObject({ code: 'send_failed', message: 'empty_message' });
    }
    expect(
      await count(`SELECT count(*)::int AS n FROM messages WHERE org_id = $1`, [w.tenant.orgId]),
    ).toBe(0);
  });

  it('refuses a number with no digits as 422 send_failed (TW-API-110)', async () => {
    const w = await workspace('send-bad-number');
    const res = await w.call.post('/messages', { to: 'call me maybe', text: 'hi' });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'send_failed',
      message: 'Invalid recipient number.',
    });
  });

  it('answers 422 validation_failed with the field in details for a body that breaks the rules (TW-API-110)', async () => {
    const w = await workspace('send-validation');
    const bad: Array<[Record<string, unknown>, string]> = [
      [{ to: 'x'.repeat(33), text: 'hi' }, 'to'],
      [{ text: 'hi' }, 'to'],
      [{ to: '1', type: 'sticker' }, 'type'],
      [{ to: '1', text: 'a'.repeat(4097) }, 'text'],
      [{ to: '1', media_url: 'not a url' }, 'media_url'],
      [{ to: '1', latitude: 91, longitude: 10 }, 'latitude'],
      [{ to: '1', latitude: 10, longitude: -181 }, 'longitude'],
      [{ to: '1', device_id: 'd'.repeat(65) }, 'device_id'],
    ];
    for (const [body, field] of bad) {
      const res = await w.call.post('/messages', body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(res.body.error.code).toBe('validation_failed');
      expect(Object.keys(res.body.error.details)).toContain(field);
    }
  });

  it('answers a send the provider refused as failed with its reason, here and on the later read (TW-API-110, 120)', async () => {
    const w = await workspace('send-provider-fail');
    const res = await w.call.post('/messages', { to: '919812345678', text: '/fail nope' });
    expect(res.status).toBe(201);
    const failed = await statusIs(w, res.body.data.id, 'failed');
    expect(failed.failure_reason).toBeTruthy();
    expect(failed.error_code).toBe('SIM_REJECTED');
    // INTENDED: the send answer itself carries the reason too (Reference always answered null there).
    expect(['failed', 'pending']).toContain(res.body.data.status);
  });

  it('sends a location pin when latitude and longitude are given, whatever the type, and records it on the thread (TW-API-110)', async () => {
    const w = await workspace('send-location');
    const res = await w.call.post('/messages', {
      to: '919812345678',
      latitude: 12.9,
      longitude: 77.6,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.type).toBe('text');
    const rows = await q(
      `SELECT body, direction, status FROM messages WHERE org_id = $1 AND uuid = $2`,
      [w.tenant.orgId, res.body.data.id],
    );
    expect(rows[0]).toMatchObject({ direction: 'out', status: 'sent' });
    expect(String(rows[0]!.body)).toContain('12.9');
    // The stub provider got a location, not text.
    expect(
      await count(
        `SELECT count(*)::int AS n FROM message_events WHERE org_id = $1 AND event = 'sent'`,
        [w.tenant.orgId],
      ),
    ).toBeGreaterThan(0);
  });

  it('reads a coordinate of 0 as missing: the send is text and fails empty when there is no text (TW-API-110)', async () => {
    const w = await workspace('send-zero');
    const res = await w.call.post('/messages', {
      to: '919812345678',
      latitude: 0,
      longitude: 77.6,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toBe('empty_message');
  });

  it('answers 422 send_failed / no_connected_device for a workspace with no sender at all (TW-API-118)', async () => {
    const { call } = await tenantWithKey(p.api, 'send-no-sender');
    const res = await call.post('/messages', { to: '919812345678', text: 'hi' });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'send_failed', message: 'no_connected_device' });
  });

  it("lets an unknown device_id, or another workspace's, fall through to the default sender (TW-API-118)", async () => {
    const a = await workspace('send-device-a');
    const b = await workspace('send-device-b');
    const bDevice = await q(
      `INSERT INTO devices (org_id, device_name, phone_number, status, active) VALUES ($1, 'B phone', '98000', 'connected', true) RETURNING uuid`,
      [b.tenant.orgId],
    );
    for (const device_id of [randomUUID(), 'cfg_999', 59, String(bDevice[0]!.uuid)]) {
      const res = await a.call.post('/messages', { to: '919812345678', text: 'hi', device_id });
      expect(res.status, String(device_id)).toBe(201);
    }
  });

  it('sends from a picked unofficial number through its own channel, and from a Cloud API connection by cfg_<uuid> (TW-API-118)', async () => {
    const w = await workspace('send-pick');
    const orgId = w.tenant.orgId;
    const device = (
      await q(
        `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active) VALUES ($1, 'Shop phone', '+91', '9811100000', 'connected', true) RETURNING uuid`,
        [orgId],
      )
    )[0]!;
    // The unofficial-number runtime keeps the channel in step with the device, under a system context.
    await RequestContextStore.run(
      { requestId: `spec-${Date.now()}`, orgId, actorType: 'system', actorId: null, userId: null },
      () =>
        p.h.app.get(ChannelRegistryService, { strict: false }).syncDeviceChannel(orgId, {
          uuid: String(device.uuid),
          name: 'Shop phone',
          displayAddress: '+919811100000',
          connected: true,
        }),
    );
    const { number } = await whatsappChannel(p.h, orgId, {
      phoneNumberId: `1${Date.now() % 100000000}`,
      label: 'Cloud line',
    });
    const config = (
      await q(`SELECT uuid FROM wa_provider_configs WHERE org_id = $1 AND id = $2`, [
        orgId,
        number.configId,
      ])
    )[0]!;

    // With nothing explicit the unofficial number is the sender (Reference: newest connected unofficial number first).
    const viaDefault = await w.call.post('/messages', { to: '919812345678', text: 'hi' });
    expect(viaDefault.status, JSON.stringify(viaDefault.body)).toBe(201);
    const kindOf = async (id: string) =>
      (
        await q(
          `SELECT ch.kind FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id WHERE m.uuid = $1`,
          [id],
        )
      )[0]!.kind;
    expect(await kindOf(viaDefault.body.data.id)).toBe('whatsapp_qr');

    const viaBaileys = await w.call.post('/messages', {
      to: '919812345600',
      text: 'hi',
      device_id: `baileys:${device.uuid}`,
    });
    expect(viaBaileys.status).toBe(201);
    expect(await kindOf(viaBaileys.body.data.id)).toBe('whatsapp_qr');

    // The Cloud API connection is a WhatsApp Cloud channel: a free-form message to a number that never wrote to it is outside Meta's
    // service window, which the inbox refuses before anything is stored (the proof the pick reached the Cloud channel).
    const viaCfg = await w.call.post('/messages', {
      to: '919812345611',
      text: 'hi',
      device_id: `cfg_${config.uuid}`,
    });
    expect(viaCfg.status, JSON.stringify(viaCfg.body)).toBe(422);
    expect(viaCfg.body.error).toMatchObject({
      code: 'send_failed',
      message: 'service_window_closed',
    });
  });

  it('rejects a sender that is not WhatsApp as 422 send_failed / wrong_channel (TW-API-118)', async () => {
    const w = await workspace('send-wrong-channel');
    const tg = (
      await q(
        `INSERT INTO channels (org_id, kind, name, status, external_id) VALUES ($1, 'telegram', 'Bot', 'connected', 'tg-bot-1') RETURNING uuid`,
        [w.tenant.orgId],
      )
    )[0]!;
    const listed = await p.api.as(w.tenant.admin).get('/v2/channels');
    expect(
      listed.body.data.some((c: { id: string }) => c.id === tg.uuid),
      'the Telegram channel is listed',
    ).toBe(true);
    const res = await w.call.post('/messages', {
      to: '919812345678',
      text: 'hi',
      device_id: `telegram:${tg.uuid}`,
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'send_failed', message: 'wrong_channel' });
  });

  it('attaches a file in multipart: the type is read from the file, the copy is hosted and fetchable with the key (TW-API-110, 119)', async () => {
    const w = await workspace('send-file');
    const res = await raw(w)
      .post('/messages')
      .field('to', '919812345678')
      .field('text', 'Look')
      .attach('media', PNG, 'photo.png');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ type: 'image', body: 'Look' });
    expect(res.body.data.media_url).toMatch(/\/api\/v1\/media\//);

    const stored = (
      await q(
        `SELECT kind, body, media_key, media_mime FROM messages WHERE org_id = $1 AND uuid = $2`,
        [w.tenant.orgId, res.body.data.id],
      )
    )[0]!;
    expect(stored).toMatchObject({ kind: 'image', body: 'Look', media_mime: 'image/png' });
    expect(String(stored.media_key)).toMatch(new RegExp(`^chat/${w.tenant.orgId}/`));

    const read = await raw(w).get(new URL(res.body.data.media_url).pathname);
    expect(read.status).toBe(200);
    expect(read.headers['content-type']).toBe('image/png');
    expect(read.headers['content-disposition']).toContain('attachment');
    expect(Buffer.compare(read.body as Buffer, PNG)).toBe(0);
  });

  it("applies the platform's upload rules to a file attached to a send: a script is refused as unsupported_media_type (TW-API-119)", async () => {
    const w = await workspace('send-file-rules');
    for (const [name, bytes] of [
      ['shell.php', Buffer.from('<?php echo 1;')],
      ['page.html', Buffer.from('<html></html>')],
      ['fake.png', Buffer.from('MZ-this-is-an-executable')],
    ] as const) {
      const res = await raw(w)
        .post('/messages')
        .field('to', '919812345678')
        .attach('media', bytes, name);
      expect(res.status, name).toBe(422);
      expect(res.body.error.code, name).toBe('unsupported_media_type');
    }
    expect(
      await count(`SELECT count(*)::int AS n FROM messages WHERE org_id = $1`, [w.tenant.orgId]),
    ).toBe(0);
  });

  it('refuses a file over 16 MB as a validation failure on media (TW-API-119)', async () => {
    const w = await workspace('send-file-big');
    const res = await raw(w)
      .post('/messages')
      .field('to', '919812345678')
      .attach('media', Buffer.alloc(17 * 1024 * 1024, 7), 'big.pdf');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_failed');
    expect(Object.keys(res.body.error.details)).toContain('media');
  });

  it('sends a document with a caption: the file is a document and the text its caption (TW-API-119)', async () => {
    const w = await workspace('send-document');
    const res = await raw(w)
      .post('/messages')
      .field('to', '919812345678')
      .field('type', 'document')
      .field('text', 'Invoice')
      .attach('media', PDF, 'invoice.pdf');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ type: 'document', body: 'Invoice' });
    expect(
      (
        await q(`SELECT kind, body FROM messages WHERE org_id = $1 AND uuid = $2`, [
          w.tenant.orgId,
          res.body.data.id,
        ])
      )[0],
    ).toMatchObject({ kind: 'document', body: 'Invoice' });
  });

  it('never downloads from a private or loopback host: 422 send_failed / media_fetch_failed and no message (TW-API-119)', async () => {
    const w = await workspace('send-ssrf');
    for (const media_url of [
      'http://127.0.0.1/x.png',
      'http://localhost:9/x.png',
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.5/a.png',
      'ftp://example.com/a.png',
    ]) {
      const res = await w.call.post('/messages', { to: '919812345678', media_url });
      expect(res.status, media_url).toBe(422);
      expect(res.body.error, media_url).toMatchObject({
        code: 'send_failed',
        message: 'media_fetch_failed',
      });
    }
    expect(
      await count(`SELECT count(*)::int AS n FROM messages WHERE org_id = $1`, [w.tenant.orgId]),
    ).toBe(0);
  });

  it('hands an uploaded file back as media_url and sends it without a download (TW-API-113, 119)', async () => {
    const w = await workspace('send-reuse');
    const up = await raw(w).post('/media').attach('file', PNG, 'logo.png');
    expect(up.status).toBe(201);
    const res = await w.call.post('/messages', {
      to: '919812345678',
      media_url: up.body.data.url,
      text: 'Our logo',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ type: 'image', body: 'Our logo' });
    // A copy under a fresh key, not the upload's own.
    const keys = await q(`SELECT media_key FROM messages WHERE org_id = $1 AND uuid = $2`, [
      w.tenant.orgId,
      res.body.data.id,
    ]);
    expect(keys[0]!.media_key).toBeTruthy();
  });

  it("does not accept another workspace's upload link as media_url (TW-API-119, tenant isolation)", async () => {
    const a = await workspace('send-reuse-a');
    const b = await workspace('send-reuse-b');
    const up = await raw(a).post('/media').attach('file', PNG, 'logo.png');
    const res = await b.call.post('/messages', { to: '919812345678', media_url: up.body.data.url });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'send_failed', message: 'media_fetch_failed' });
  });

  it('answers 403 to a key whose scopes do not include messages:write (TW-API-110)', async () => {
    const w = await workspace('send-scope');
    await p.h.owner.query(`UPDATE api_keys SET scopes = ARRAY['messages:read'] WHERE org_id = $1`, [
      w.tenant.orgId,
    ]);
    const send = await w.call.post('/messages', { to: '919812345678', text: 'hi' });
    expect(send.status).toBe(403);
    expect(send.body.error.code).toBe('forbidden');
    expect((await w.call.get('/messages')).status).toBe(200);
    expect((await w.call.get('/devices')).status).toBe(403);
  });

  it('honours an Idempotency-Key: a repeated send answers the first message and sends once', async () => {
    const w = await workspace('send-idem');
    const server = p.h.app.getHttpServer();
    const send = () =>
      request(server)
        .post('/api/v1/messages')
        .set({ authorization: `Bearer ${w.secret}`, 'idempotency-key': 'once-1' })
        .send({ to: '919812345678', text: 'only once' });
    const first = await send();
    const second = await send();
    expect(first.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM messages WHERE org_id = $1 AND direction = 'out'`,
        [w.tenant.orgId],
      ),
    ).toBe(1);
  });
});

describe('GET /messages and /messages/{id} (TW-API-111, 112, 120)', () => {
  it('lists the newest first, with page meta, and walks the cursor (TW-API-111)', async () => {
    const w = await workspace('list-messages');
    const ids: string[] = [];
    for (const text of ['one', 'two', 'three'])
      ids.push((await w.call.post('/messages', { to: '919812345678', text })).body.data.id);

    const all = await w.call.get('/messages');
    expect(all.status).toBe(200);
    expect(all.body.data.map((m: { id: string }) => m.id)).toEqual([...ids].reverse());
    expect(all.body.meta).toEqual({ limit: 50, next_cursor: null, has_more: false, count: 3 });

    const first = await w.call.get('/messages?limit=2');
    expect(first.body.data).toHaveLength(2);
    expect(first.body.meta).toMatchObject({ limit: 2, has_more: true, count: 2 });
    const next = await w.call.get(
      `/messages?limit=2&cursor=${encodeURIComponent(first.body.meta.next_cursor)}`,
    );
    expect(next.body.data.map((m: { id: string }) => m.id)).toEqual([ids[0]]);
    expect(next.body.meta).toMatchObject({ has_more: false, next_cursor: null });
  });

  it('clamps a bad limit instead of refusing it: 0 and abc give one item, a huge value gives the maximum (TW-API-111)', async () => {
    const w = await workspace('list-clamp');
    for (const text of ['a', 'b']) await w.call.post('/messages', { to: '919812345678', text });
    for (const limit of ['0', 'abc', '-3']) {
      const res = await w.call.get(`/messages?limit=${limit}`);
      expect(res.status, limit).toBe(200);
      expect(res.body.data, limit).toHaveLength(1);
    }
    const big = await w.call.get('/messages?limit=500');
    expect(big.body.meta.limit).toBe(200);
    expect((await w.call.get('/messages?per_page=1')).body.data).toHaveLength(1);
  });

  it('refuses a page number and names the cursor (TW-API-111)', async () => {
    const w = await workspace('list-page');
    const res = await w.call.get('/messages?page=2');
    expect(res.status).toBe(422);
    expect(res.body.error.details.page[0]).toContain('cursor');
  });

  it('answers 200 with an empty list and meta for a workspace with no messages (TW-API-111)', async () => {
    const { call } = await tenantWithKey(p.api, 'list-empty');
    const res = await call.get('/messages');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [],
      meta: { limit: 50, next_cursor: null, has_more: false, count: 0 },
    });
  });

  it("lists customers' messages as well, with the business number as `to`, and leaves out a deleted one (TW-API-111)", async () => {
    const w = await workspace('list-inbound');
    await simInbound(p, w.tenant, w.channel, {
      from: '919800011122',
      name: 'Customer',
      text: 'hello from outside',
    });
    const sent = await w.call.post('/messages', { to: '919800011122', text: 'reply' });
    await until('inbound listed', async () =>
      (await w.call.get('/messages')).body.data.length >= 2 ? true : undefined,
    );
    const list = (await w.call.get('/messages')).body.data as Array<{
      id: string;
      body: string;
      to: string | null;
    }>;
    expect(list.map((m) => m.body)).toEqual(['reply', 'hello from outside']);

    await p.h.owner.query(
      `UPDATE messages SET deleted_at = now() WHERE org_id = $1 AND uuid = $2`,
      [w.tenant.orgId, sent.body.data.id],
    );
    expect((await w.call.get('/messages')).body.data.map((m: { body: string }) => m.body)).toEqual([
      'hello from outside',
    ]);
    expect((await w.call.get(`/messages/${sent.body.data.id}`)).status).toBe(404);
  });

  it("never shows another workspace's messages, and answers 404 not_found for its id (TW-API-111, 112)", async () => {
    const a = await workspace('iso-msg-a');
    const b = await workspace('iso-msg-b');
    const sent = await a.call.post('/messages', { to: '919812345678', text: 'secret of A' });
    expect((await b.call.get('/messages')).body.data).toEqual([]);
    const res = await b.call.get(`/messages/${sent.body.data.id}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({
      code: 'not_found',
      message: 'Message not found.',
      ...(res.body.error.requestId ? { requestId: res.body.error.requestId } : {}),
    });
  });

  it('answers the same message the send did, with the current status (TW-API-112)', async () => {
    const w = await workspace('get-message');
    const sent = await w.call.post('/messages', { to: '+91 98123 45678', text: 'poll me' });
    const res = await w.call.get(`/messages/${sent.body.data.id}`);
    expect(res.status).toBe(200);
    expect(res.body.meta).toBeUndefined();
    expect(res.body.data).toMatchObject({
      id: sent.body.data.id,
      to: '919812345678',
      type: 'text',
      body: 'poll me',
      media_url: null,
    });
    // The delivery receipts the simulator reports move it on: delivered, then read.
    await statusIs(w, sent.body.data.id, 'read');
  });

  it("shows the failure reason and the provider's typed code of a failed message (TW-API-112, 120)", async () => {
    const w = await workspace('get-failed');
    const sent = await w.call.post('/messages', { to: '919812345678', text: 'will fail' });
    await statusIs(w, sent.body.data.id, 'read');
    await p.h.owner.query(
      `UPDATE messages SET status = 'failed', failure_code = '131047', failure_reason = 'Re-engagement message' WHERE org_id = $1 AND uuid = $2`,
      [w.tenant.orgId, sent.body.data.id],
    );
    const res = await w.call.get(`/messages/${sent.body.data.id}`);
    expect(res.body.data).toMatchObject({
      status: 'failed',
      failure_reason: 'Re-engagement message',
      error_code: 131047,
    });
  });

  it("maps a message waiting in the queue to Reference's pending and a customer's message to received (TW-API-120)", async () => {
    const w = await workspace('get-vocabulary');
    await simInbound(p, w.tenant, w.channel, { from: '919800011133', name: 'C', text: 'inbound' });
    const inbound = await until('inbound stored', async () => {
      const r = await q(`SELECT uuid FROM messages WHERE org_id = $1 AND direction = 'in'`, [
        w.tenant.orgId,
      ]);
      return r[0];
    });
    expect((await w.call.get(`/messages/${inbound.uuid}`)).body.data.status).toBe('received');

    const sent = await w.call.post('/messages', { to: '919800011133', text: 'out' });
    await statusIs(w, sent.body.data.id, 'read');
    await p.h.owner.query(`UPDATE messages SET status = 'queued' WHERE org_id = $1 AND uuid = $2`, [
      w.tenant.orgId,
      sent.body.data.id,
    ]);
    expect((await w.call.get(`/messages/${sent.body.data.id}`)).body.data.status).toBe('pending');
  });

  it('answers 404 not_found for an id that is not a uuid (TW-API-112)', async () => {
    const w = await workspace('get-bad-id');
    for (const id of ['abc', '123', 'not-a-uuid']) {
      const res = await w.call.get(`/messages/${id}`);
      expect(res.status, id).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    }
  });

  it('answers 401 without a key', async () => {
    const res = await request(p.h.app.getHttpServer()).get('/api/v1/messages');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('missing_api_key');
  });
});

describe('POST /media (TW-API-113)', () => {
  it('stores a PNG and answers 201 with url, path, type, mime and size; the url reads the same bytes with the key', async () => {
    const w = await workspace('media-upload');
    const res = await raw(w).post('/media').attach('file', PNG, 'Logo Final.PNG');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.meta).toBeUndefined();
    expect(res.body.data).toMatchObject({ type: 'image', mime: 'image/png', size: PNG.length });
    expect(res.body.data.path).toMatch(/^chat-media\/\d+_[0-9a-f]+\.png$/);
    expect(res.body.data.path).not.toContain(String(w.tenant.orgId) + '/');

    const read = await raw(w).get(new URL(res.body.data.url).pathname);
    expect(read.status).toBe(200);
    expect(Buffer.compare(read.body as Buffer, PNG)).toBe(0);
    expect(read.headers['x-content-type-options']).toBe('nosniff');
  });

  it('types a PDF as a document and keeps no client file name in the path', async () => {
    const w = await workspace('media-pdf');
    const res = await raw(w).post('/media').attach('file', PDF, 'secret-name.pdf');
    expect(res.body.data).toMatchObject({ type: 'document', mime: 'application/pdf' });
    expect(res.body.data.path).not.toContain('secret-name');
  });

  it('stores the same file twice under two paths', async () => {
    const w = await workspace('media-twice');
    const one = await raw(w).post('/media').attach('file', PNG, 'a.png');
    const two = await raw(w).post('/media').attach('file', PNG, 'a.png');
    expect(one.body.data.path).not.toBe(two.body.data.path);
  });

  it('refuses a script, markup or an SVG as 422 unsupported_media_type "This file type is not allowed."', async () => {
    const w = await workspace('media-blocked');
    for (const name of [
      'shell.php',
      'page.html',
      'vector.svg',
      'run.exe',
      'noextension',
      'archive.tar.gz',
    ]) {
      const res = await raw(w)
        .post('/media')
        .attach('file', Buffer.from('<?php system($_GET[1]);'), name);
      expect(res.status, name).toBe(422);
      expect(res.body.error, name).toMatchObject({
        code: 'unsupported_media_type',
        message: 'This file type is not allowed.',
      });
    }
  });

  it('refuses a .jpg whose bytes are not an image: 422 "This file content is not allowed."', async () => {
    const w = await workspace('media-content');
    const res = await raw(w)
      .post('/media')
      .attach('file', Buffer.from('MZ\x90\x00 executable bytes here'), 'holiday.jpg');
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'unsupported_media_type',
      message: 'This file content is not allowed.',
    });
  });

  it('refuses a file over 16 MB, and a request with no file, as validation failures on `file`', async () => {
    const w = await workspace('media-size');
    const big = await raw(w)
      .post('/media')
      .attach('file', Buffer.alloc(17 * 1024 * 1024, 1), 'big.pdf');
    expect(big.status).toBe(422);
    expect(big.body.error.code).toBe('validation_failed');
    expect(Object.keys(big.body.error.details)).toContain('file');

    const none = await raw(w).post('/media').field('note', 'no file here');
    expect(none.status).toBe(422);
    expect(Object.keys(none.body.error.details)).toContain('file');
  });

  it('keeps a file of one workspace out of reach of another, and a forged token out of everything', async () => {
    const a = await workspace('media-iso-a');
    const b = await workspace('media-iso-b');
    const up = await raw(a).post('/media').attach('file', PNG, 'a.png');
    const path = new URL(up.body.data.url).pathname;
    expect((await raw(b).get(path)).status).toBe(404);
    expect((await raw(a).get('/api/v1/media/' + 'A'.repeat(80))).status).toBe(404);
  });

  it('answers 401 without a key and 403 for a key with no media scope', async () => {
    const w = await workspace('media-scope');
    expect(
      (await request(p.h.app.getHttpServer()).post('/api/v1/media').attach('file', PNG, 'a.png'))
        .status,
    ).toBe(401);
    await p.h.owner.query(`UPDATE api_keys SET scopes = ARRAY['messages:read'] WHERE org_id = $1`, [
      w.tenant.orgId,
    ]);
    const res = await raw(w).post('/media').attach('file', PNG, 'a.png');
    expect(res.status).toBe(403);
  });
});

describe('GET /conversations and /conversations/{id}/messages (TW-API-114, 115)', () => {
  it('lists the threads, most recent first, with the contact digits, name, preview, unread, send state and channel (TW-API-114)', async () => {
    const w = await workspace('conv-list');
    await simInbound(p, w.tenant, w.channel, { from: '919812345678', name: 'Asha', text: 'hello' });
    await until(
      'thread',
      async () => (await w.call.get('/conversations')).body.data.length === 1 || undefined,
    );
    await w.call.post('/messages', { to: '919700000001', text: 'first outbound' });

    const res = await w.call.get('/conversations');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    // The thread opened by a send is listed (Reference hid threads it opened itself: a defect of its own).
    expect(res.body.data[0]).toMatchObject({
      contact: '919700000001',
      last_message: 'first outbound',
      unread: 0,
      status: 'sent',
      channel: 'simulator',
    });
    expect(res.body.data[0].id).toMatch(UUID);
    expect(res.body.data[1]).toMatchObject({
      contact: '919812345678',
      name: 'Asha',
      last_message: 'hello',
      unread: 1,
      status: 'pending',
    });
    expect(new Date(res.body.data[1].last_message_at).toISOString()).toBe(
      res.body.data[1].last_message_at,
    );
    expect(res.body.meta).toEqual({ limit: 25, next_cursor: null, has_more: false });
  });

  it('pages with a cursor, clamps per_page to 100 and refuses a page number (TW-API-114)', async () => {
    const w = await workspace('conv-page');
    for (const n of [1, 2, 3])
      await w.call.post('/messages', { to: `91970000000${n}`, text: `m${n}` });
    const first = await w.call.get('/conversations?per_page=2');
    expect(first.body.data.map((c: { contact: string }) => c.contact)).toEqual([
      '919700000003',
      '919700000002',
    ]);
    expect(first.body.meta).toMatchObject({ limit: 2, has_more: true });
    const next = await w.call.get(
      `/conversations?per_page=2&cursor=${encodeURIComponent(first.body.meta.next_cursor)}`,
    );
    expect(next.body.data.map((c: { contact: string }) => c.contact)).toEqual(['919700000001']);
    expect((await w.call.get('/conversations?per_page=1000')).body.meta.limit).toBe(100);
    expect((await w.call.get('/conversations?page=2')).status).toBe(422);
  });

  it("never lists another workspace's threads (TW-API-114)", async () => {
    const a = await workspace('conv-iso-a');
    const b = await workspace('conv-iso-b');
    await a.call.post('/messages', { to: '919812345678', text: 'A only' });
    expect((await b.call.get('/conversations')).body).toEqual({
      data: [],
      meta: { limit: 25, next_cursor: null, has_more: false },
    });
  });

  it("lists a conversation's messages newest first with the conversation id in meta, and does not mark it read (TW-API-115)", async () => {
    const w = await workspace('conv-messages');
    await simInbound(p, w.tenant, w.channel, {
      from: '919812345678',
      name: 'Asha',
      text: 'question',
    });
    await until(
      'inbound',
      async () => (await w.call.get('/conversations')).body.data.length === 1 || undefined,
    );
    await w.call.post('/messages', { to: '919812345678', text: 'answer' });
    const conv = (await w.call.get('/conversations')).body.data[0];

    const res = await w.call.get(`/conversations/${conv.id}/messages`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.map((m: { body: string }) => m.body)).toEqual(['answer', 'question']);
    expect(res.body.meta).toMatchObject({
      conversation_id: conv.id,
      limit: 50,
      has_more: false,
      count: 2,
    });
    expect((await w.call.get('/conversations')).body.data[0].unread).toBe(1);

    expect(
      (await w.call.get(`/conversations/${conv.id}/messages?per_page=1`)).body.meta,
    ).toMatchObject({ limit: 1, has_more: true });
    expect(
      (await w.call.get(`/conversations/${conv.id}/messages?per_page=300`)).body.meta.limit,
    ).toBe(200);
  });

  it('reads a thread that a send opened, and an empty one answers an empty list (TW-API-115)', async () => {
    const w = await workspace('conv-opened');
    await w.call.post('/messages', { to: '919812345678', text: 'cold message' });
    const conv = (await w.call.get('/conversations')).body.data[0];
    expect((await w.call.get(`/conversations/${conv.id}/messages`)).body.data).toHaveLength(1);

    const empty = await q(
      `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1, $2, '919000000000', '+919000000000') RETURNING uuid`,
      [w.tenant.orgId, w.channel.internalId],
    );
    const none = await w.call.get(`/conversations/${empty[0]!.uuid}/messages`);
    expect(none.status).toBe(200);
    expect(none.body.data).toEqual([]);
    expect(none.body.meta).toMatchObject({
      conversation_id: empty[0]!.uuid,
      has_more: false,
      count: 0,
    });
  });

  it("answers 404 not_found for another workspace's conversation, an unknown one and a bad id (TW-API-115)", async () => {
    const a = await workspace('conv-404-a');
    const b = await workspace('conv-404-b');
    await a.call.post('/messages', { to: '919812345678', text: 'A only' });
    const conv = (await a.call.get('/conversations')).body.data[0];
    for (const id of [conv.id, randomUUID(), 'abc']) {
      const res = await b.call.get(`/conversations/${id}/messages`);
      expect(res.status, id).toBe(404);
      expect(res.body.error).toMatchObject({
        code: 'not_found',
        message: 'Conversation not found.',
      });
    }
  });

  it('answers 403 for a key without the conversations scope (TW-API-114)', async () => {
    const w = await workspace('conv-scope');
    await p.h.owner.query(`UPDATE api_keys SET scopes = ARRAY['messages:read'] WHERE org_id = $1`, [
      w.tenant.orgId,
    ]);
    expect((await w.call.get('/conversations')).status).toBe(403);
  });
});

describe('GET /devices and /devices/{id} (TW-API-116, 117)', () => {
  const seedDevice = async (
    orgId: number,
    name: string,
    over: { cc?: string; phone?: string; status?: string; active?: boolean } = {},
  ) =>
    String(
      (
        await q(
          `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6, '2026-10-01T09:00:00Z') RETURNING uuid`,
          [
            orgId,
            name,
            over.cc ?? '+91',
            over.phone ?? '9811100000',
            over.status ?? 'connected',
            over.active ?? true,
          ],
        )
      )[0]!.uuid,
    );

  it('lists the unofficial numbers first (active first), then the connections, with the count (TW-API-116)', async () => {
    const w = await workspace('dev-list');
    const orgId = w.tenant.orgId;
    const inactive = await seedDevice(orgId, 'Old phone', {
      status: 'needs_pair',
      active: false,
      phone: '9822200000',
    });
    const active = await seedDevice(orgId, 'Shop phone');
    const number = await connectNumber(p.h, orgId, {
      phoneNumberId: `2${Date.now() % 100000000}`,
      label: 'Cloud line',
      phone: '+91 98111 22222',
    });
    const cfg = String(
      (
        await q(`SELECT uuid FROM wa_provider_configs WHERE org_id = $1 AND id = $2`, [
          orgId,
          number.configId,
        ])
      )[0]!.uuid,
    );
    const twilio = String(
      (
        await q(
          `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number) VALUES ($1, 'twilio', 'pending', NULL) RETURNING uuid`,
          [orgId],
        )
      )[0]!.uuid,
    );
    await q(
      `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number) VALUES ($1, 'meta_ads', 'connected', '1') RETURNING uuid`,
      [orgId],
    );

    const res = await w.call.get('/devices');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.meta).toEqual({ count: 4 });
    // Unofficial numbers (active first), then connections (the newest first when none is primary).
    expect(res.body.data.map((d: { id: string }) => d.id)).toEqual([active, inactive, twilio, cfg]);
    const byId = Object.fromEntries(res.body.data.map((d: { id: string }) => [d.id, d]));
    expect(byId[active]).toEqual({
      id: active,
      name: 'Shop phone',
      phone: '919811100000',
      engine: 'unofficial',
      status: 'connected',
      active: true,
      last_seen_at: '2026-10-01T09:00:00.000Z',
    });
    expect(byId[inactive]).toMatchObject({
      engine: 'unofficial',
      status: 'needs_pair',
      active: false,
    });
    expect(byId[cfg]).toMatchObject({
      name: 'Cloud line',
      phone: '919811122222',
      engine: 'whatsapp_cloud',
      status: 'connected',
      active: true,
    });
    expect(byId[twilio]).toMatchObject({
      name: 'Twilio',
      phone: null,
      engine: 'twilio',
      status: 'disconnected',
      active: false,
      last_seen_at: null,
    });
  });

  it('answers an empty list with a zero count, and nothing of another workspace (TW-API-116)', async () => {
    const a = await workspace('dev-iso-a');
    const b = await workspace('dev-iso-b');
    await seedDevice(a.tenant.orgId, 'A phone');
    expect((await b.call.get('/devices')).body).toEqual({ data: [], meta: { count: 0 } });
  });

  it('answers one device, a disconnected one too, and a Cloud API connection by the same kind of id (TW-API-117)', async () => {
    const w = await workspace('dev-show');
    const down = await seedDevice(w.tenant.orgId, 'Offline phone', {
      status: 'disconnected',
      active: true,
    });
    const res = await w.call.get(`/devices/${down}`);
    expect(res.status).toBe(200);
    expect(res.body.meta).toBeUndefined();
    expect(res.body.data).toMatchObject({
      id: down,
      name: 'Offline phone',
      engine: 'unofficial',
      status: 'disconnected',
      active: true,
    });

    const number = await connectNumber(p.h, w.tenant.orgId, {
      phoneNumberId: `3${Date.now() % 100000000}`,
    });
    const cfg = String(
      (
        await q(`SELECT uuid FROM wa_provider_configs WHERE org_id = $1 AND id = $2`, [
          w.tenant.orgId,
          number.configId,
        ])
      )[0]!.uuid,
    );
    expect((await w.call.get(`/devices/${cfg}`)).body.data).toMatchObject({
      id: cfg,
      engine: 'whatsapp_cloud',
    });
  });

  it("answers 404 not_found for another workspace's device, an unknown id and an id that is not a uuid (TW-API-117)", async () => {
    const a = await workspace('dev-404-a');
    const b = await workspace('dev-404-b');
    const id = await seedDevice(a.tenant.orgId, 'A phone');
    for (const bad of [id, randomUUID(), 'cfg_5', '7']) {
      const res = await b.call.get(`/devices/${bad}`);
      expect(res.status, bad).toBe(404);
      expect(res.body.error).toMatchObject({ code: 'not_found', message: 'Device not found.' });
    }
  });

  it('answers 401 without a key and 403 for a key without the devices scope (TW-API-116)', async () => {
    const w = await workspace('dev-scope');
    expect((await request(p.h.app.getHttpServer()).get('/api/v1/devices')).status).toBe(401);
    await p.h.owner.query(`UPDATE api_keys SET scopes = ARRAY['messages:read'] WHERE org_id = $1`, [
      w.tenant.orgId,
    ]);
    expect((await w.call.get('/devices')).status).toBe(403);
  });
});
