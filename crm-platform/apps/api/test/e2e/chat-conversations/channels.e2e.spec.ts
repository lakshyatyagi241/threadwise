import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { QUEUES } from '../../../src/infra/queue/queues';
import { EmergencyHaltService } from '../../../src/modules/auth/security/emergency-halt.service';
import {
  ChannelDispatcher,
  ChannelRegistryService,
  ChannelsFacade,
} from '../../../src/modules/chat-conversations';
import type { ChannelRuntime } from '../../../src/infra/providers/chat-conversations';
import {
  Api,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import { connectNumber, linkChannel, whatsappChannel } from './whatsapp-support';

/** What every send in this file is, for the ConsentGate. */
const SERVICE_CONSENT = { purpose: 'service_messaging' as const };

/**
 * The channel registry, the dev simulator and the dispatcher through the whole app (plan-inbox-chat.md Phase 0), and the WhatsApp
 * channel as the inbox view of a number connected in the WABA domain (one WhatsApp stack: no credentials, no webhook of its own).
 * One app, one database, one Redis; each block works in an organization of its own.
 *
 * The simulator flag is set before the app is built (it is read at boot to bind the adapter). The production refusal is checked by
 * changing the environment for the length of one request, because the policy is evaluated on every call.
 */
process.env.CHANNEL_SIMULATOR_ENABLED = 'true';

let h: Harness;
let api: Api;
let ingest: Queue;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  const url = new URL(process.env.REDIS_URL!);
  ingest = new Queue(QUEUES.WEBHOOK_INGEST, {
    connection: { host: url.hostname, port: Number(url.port) },
  });
}, 240_000);

afterAll(async () => {
  await ingest?.close();
  await h?.stop();
});

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const READER: Grant[] = [['inbox.conversation.read']];

interface Channel {
  id: string;
  kind: string;
  name: string;
  status: string;
  externalId: string | null;
  displayAddress: string | null;
  capabilities: { windowHours: number | null; templates: boolean; media: string[] };
  settings: { metered: boolean; simulator?: { latencyMs: Record<string, number>; window: string } };
  hasCredentials: boolean;
  credentialHints: Record<string, string>;
  webhookUrl: string | null;
  businessAccountId?: string | null;
  rowVersion: number;
}

/** A WhatsApp number connected in the WABA domain and its inbox channel, read back the way the web reads it. */
async function createWa(
  t: Tenant,
  name = 'Main number',
  phoneNumberId = '1000000001',
): Promise<Channel> {
  const { channel } = await whatsappChannel(h, t.orgId, { phoneNumberId, label: name });
  const res = await api.as(t.admin).get(`/v2/channels/${channel.uuid}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Channel;
}

async function createSim(token: string, body: Record<string, unknown> = {}): Promise<Channel> {
  const res = await api
    .as(token)
    .post('/v2/channels/simulator')
    .set('idempotency-key', `sim-${Math.random()}`)
    .send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Channel;
}

const count = async (sql: string, params: unknown[]) =>
  Number((await h.owner.query(sql, params)).rows[0].n);

/** Runs `fn` with the environment changed, restoring it even when the assertion inside throws. */
async function withEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const before: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) before[k] = process.env[k];
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('permissions', () => {
  let t: Tenant;
  let reader: { token: string };
  let nobody: { token: string };
  let ch: Channel;

  beforeAll(async () => {
    t = await api.signup('chp');
    reader = await api.member(t, 'reader', READER);
    nobody = await api.member(t, 'nobody', []);
    ch = await createWa(t);
  });

  it('listing channels needs the right to read conversations; with it, any member sees them', async () => {
    expect((await api.as(nobody.token).get('/v2/channels')).status).toBe(403);
    const res = await api.as(reader.token).get('/v2/channels');
    expect(res.status).toBe(200);
    expect(res.body.data.map((c: Channel) => c.id)).toContain(ch.id);
    expect((await api.as(reader.token).get(`/v2/channels/${ch.id}`)).status).toBe(200);
    expect((await api.as(nobody.token).get(`/v2/channels/${ch.id}`)).status).toBe(403);
  });

  it('editing, removing and the dev routes need inbox.channel.manage (a reader gets 403 on each)', async () => {
    const r = api.as(reader.token);
    expect(
      (await r.post('/v2/channels/simulator').set('idempotency-key', 'k1').send({})).status,
    ).toBe(403);
    expect((await r.patch(`/v2/channels/${ch.id}`).send({ rowVersion: 1, name: 'x' })).status).toBe(
      403,
    );
    expect((await r.post(`/v2/channels/${ch.id}/health`)).status).toBe(403);
    expect((await r.delete(`/v2/channels/${ch.id}`)).status).toBe(403);
    expect(
      (
        await r
          .post(`/v2/dev/simulator/channels/${ch.id}/inbound`)
          .send({ from: '919876543210', text: 'x' })
      ).status,
    ).toBe(403);
    expect(
      (
        await r
          .post(`/v2/dev/simulator/channels/${ch.id}/receipt`)
          .send({ providerMessageId: 'p', status: 'read' })
      ).status,
    ).toBe(403);
  });

  it('the Owner and Admin presets of a new workspace hold the manage key; an Agent does not', async () => {
    const roles = await h.owner.query(
      `SELECT r.system_key FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id
       WHERE g.org_id = $1 AND g.permission_key = 'inbox.channel.manage' ORDER BY 1`,
      [t.orgId],
    );
    expect(roles.rows.map((r) => r.system_key)).toEqual(['admin', 'workspace_admin']);
  });
});

describe('a WhatsApp channel is the inbox view of a connected number', () => {
  let t: Tenant;
  let ch: Channel;
  let number: Awaited<ReturnType<typeof connectNumber>>;

  beforeAll(async () => {
    t = await api.signup('chc');
    number = await connectNumber(h, t.orgId, {
      phoneNumberId: '1000000100',
      label: 'Support line',
      phone: '+1 555 000 1111',
    });
    const row = await linkChannel(h, t.orgId, number);
    ch = (await api.as(t.admin).get(`/v2/channels/${row.uuid}`)).body as Channel;
  });

  it('is made from the connection: connected, with the number, the account id and the Cloud capabilities; it takes no credentials and has no webhook of its own', () => {
    expect(ch.id).toMatch(uuidRe);
    expect(ch).toMatchObject({
      kind: 'whatsapp_cloud',
      name: 'Support line',
      status: 'connected',
      externalId: '1000000100',
      displayAddress: '+1 555 000 1111',
      businessAccountId: number.wabaId,
      hasCredentials: false,
      credentialHints: {},
      webhookUrl: null,
      rowVersion: 1,
    });
    expect(ch.capabilities).toMatchObject({ windowHours: 24, templates: true });
    expect(ch.settings).toEqual({ metered: true });
    expect(ch).not.toHaveProperty('orgId');
  });

  it('is linked to the connection by a composite key, holds no secret at rest, and no response carries one', async () => {
    const row = (
      await h.owner.query(`SELECT * FROM channels WHERE org_id = $1 AND uuid = $2`, [
        t.orgId,
        ch.id,
      ])
    ).rows[0];
    expect(Number(row.waba_config_id)).toBe(number.configId);
    expect(row.credentials_enc).toBeNull();
    expect(row.webhook_token_hash).toBeNull();
    const dump = JSON.stringify([
      (await api.as(t.admin).get('/v2/channels')).body,
      (await api.as(t.admin).get(`/v2/channels/${ch.id}`)).body,
    ]);
    expect(dump).not.toMatch(
      /credentials_enc|credentialsEnc|webhook_token_hash|webhookTokenHash|accessToken|appSecret/,
    );
  });

  it('making it is idempotent, leaves one audit row and one outbox event, and finds the same channel again', async () => {
    const again = await linkChannel(h, t.orgId, number);
    expect(again.uuid).toBe(ch.id);
    expect(
      await count(`SELECT count(*) n FROM channels WHERE org_id = $1 AND kind = 'whatsapp_cloud'`, [
        t.orgId,
      ]),
    ).toBe(1);
    expect(await api.auditCount(t.orgId, 'channels', 'insert')).toBe(1);
    const events = await api.events(t.orgId, 'channel.created');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ uuid: ch.id, kind: 'whatsapp_cloud', name: 'Support line' });
  });

  it('a channel is not made by hand: there is no route to connect one with credentials (the number is connected under WhatsApp numbers)', async () => {
    const res = await api
      .as(t.admin)
      .post('/v2/channels')
      .send({
        kind: 'whatsapp_cloud',
        name: 'x',
        credentials: { phoneNumberId: '1000000009', accessToken: 'EAAB-token-12345' },
      });
    expect(res.status).toBe(404);
    expect((await api.as(t.admin).post(`/v2/channels/${ch.id}/subscribe`).send({})).status).toBe(
      404,
    );
    expect((await api.as(t.admin).post(`/v2/channels/${ch.id}/webhook-token`)).status).toBe(404);
    expect((await api.as(t.admin).get('/v2/channels/requirements/whatsapp_cloud')).status).toBe(
      404,
    );
  });

  it('an update cannot carry credentials: the connection owns them', async () => {
    const res = await api
      .as(t.admin)
      .patch(`/v2/channels/${ch.id}`)
      .send({ rowVersion: ch.rowVersion, credentials: { accessToken: 'EAAB-token-12345' } });
    expect(res.status).toBe(422);
  });

  it('a channel made before the link for the same phone number is adopted, not duplicated', async () => {
    const t2 = await api.signup('chc3');
    const early = await h.owner.query(
      `INSERT INTO channels (org_id, kind, name, status, external_id) VALUES ($1, 'whatsapp_cloud', 'Pasted earlier', 'needs_reauth', '1000000333') RETURNING id, uuid`,
      [t2.orgId],
    );
    const n = await connectNumber(h, t2.orgId, {
      phoneNumberId: '1000000333',
      label: 'Reconnected',
    });
    const row = await linkChannel(h, t2.orgId, n, { revive: true });
    expect(row.uuid).toBe(early.rows[0].uuid);
    expect(row).toMatchObject({
      wabaConfigId: n.configId,
      status: 'connected',
      name: 'Pasted earlier',
      lastError: null,
    });
    expect(await count(`SELECT count(*) n FROM channels WHERE org_id = $1`, [t2.orgId])).toBe(1);
  });

  it('a reconnected number brings its channel back from needs_reauth; a disconnected number shows it disconnected; a removed one detaches it', async () => {
    const t3 = await api.signup('chc4');
    const { number: n3, channel } = await whatsappChannel(h, t3.orgId, {
      phoneNumberId: '1000000444',
    });
    const statusOf = async () =>
      (
        await h.owner.query(`SELECT status, waba_config_id FROM channels WHERE id = $1`, [
          channel.id,
        ])
      ).rows[0];

    await h.owner.query(
      `UPDATE channels SET status = 'needs_reauth', last_error = '{"code":"CHANNEL_AUTH_EXPIRED","message":"x","at":"2026-10-01T00:00:00Z"}' WHERE id = $1`,
      [channel.id],
    );
    // The first inbound message finds the channel as it is: a lazy link never revives a refused token.
    await linkChannel(h, t3.orgId, n3);
    expect((await statusOf()).status).toBe('needs_reauth');
    await linkChannel(h, t3.orgId, n3, { revive: true });
    expect((await statusOf()).status).toBe('connected');

    await h.owner.query(`UPDATE wa_provider_configs SET status = 'disconnected' WHERE id = $1`, [
      n3.configId,
    ]);
    await linkChannel(h, t3.orgId, n3);
    expect((await statusOf()).status).toBe('disconnected');

    await h.owner.query(`UPDATE channels SET status = 'connected' WHERE id = $1`, [channel.id]);
    await h.owner.query(`DELETE FROM wa_provider_configs WHERE id = $1`, [n3.configId]);
    const detached = await statusOf();
    expect(detached.waba_config_id).toBeNull(); // ON DELETE SET NULL on the link column only: the channel and its threads stay
  });

  it("the link is a composite key: a channel cannot point at another workspace's number, and one number has one channel", async () => {
    const other = await api.signup('chc5');
    const foreign = await connectNumber(h, other.orgId, { phoneNumberId: '1000000555' });
    await expect(
      h.owner.query(
        `INSERT INTO channels (org_id, kind, name, waba_config_id) VALUES ($1, 'whatsapp_cloud', 'x', $2)`,
        [t.orgId, foreign.configId],
      ),
    ).rejects.toThrow(/fk_channels_waba_config/);
    await expect(
      h.owner.query(
        `INSERT INTO channels (org_id, kind, name, waba_config_id) VALUES ($1, 'whatsapp_cloud', 'again', $2)`,
        [t.orgId, number.configId],
      ),
    ).rejects.toThrow(/uq_channels_waba_config/);
  });

  it('a connected channel stays on its number: it is never connected by hand without a link', async () => {
    const orphan = await h.owner.query(
      `INSERT INTO channels (org_id, kind, name, status, external_id) VALUES ($1, 'whatsapp_cloud', 'Unlinked', 'disconnected', '1000000666') RETURNING uuid, row_version`,
      [t.orgId],
    );
    const res = await api
      .as(t.admin)
      .patch(`/v2/channels/${orphan.rows[0].uuid}`)
      .send({ rowVersion: Number(orphan.rows[0].row_version), status: 'connected' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CHANNEL_KIND_UNAVAILABLE');
  });
});

describe('editing and removing', () => {
  let t: Tenant;
  let ch: Channel;

  beforeAll(async () => {
    t = await api.signup('che');
    ch = await createWa(t, 'Editable', '2000000001');
  });

  it('renames with the row version, and a stale version is a 409 ROW_VERSION_CONFLICT', async () => {
    const ok = await api
      .as(t.admin)
      .patch(`/v2/channels/${ch.id}`)
      .send({ rowVersion: ch.rowVersion, name: 'Renamed', displayAddress: '+91 98765 43210' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({
      name: 'Renamed',
      displayAddress: '+91 98765 43210',
      rowVersion: ch.rowVersion + 1,
    });
    const stale = await api
      .as(t.admin)
      .patch(`/v2/channels/${ch.id}`)
      .send({ rowVersion: ch.rowVersion, name: 'Again' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
    ch = ok.body as Channel;
  });

  it('refuses an empty update and an invalid one', async () => {
    expect(
      (await api.as(t.admin).patch(`/v2/channels/${ch.id}`).send({ rowVersion: ch.rowVersion }))
        .status,
    ).toBe(422);
    expect(
      (
        await api
          .as(t.admin)
          .patch(`/v2/channels/${ch.id}`)
          .send({ rowVersion: ch.rowVersion, name: '   ' })
      ).status,
    ).toBe(422);
    expect(
      (
        await api
          .as(t.admin)
          .patch(`/v2/channels/${ch.id}`)
          .send({ rowVersion: ch.rowVersion, status: 'error' })
      ).status,
    ).toBe(422);
  });

  it('settings: metering can be switched on a provider channel; unknown settings are refused', async () => {
    const res = await api
      .as(t.admin)
      .patch(`/v2/channels/${ch.id}`)
      .send({ rowVersion: ch.rowVersion, settings: { metered: false } });
    expect(res.body.settings).toEqual({ metered: false });
    expect(
      (
        await api
          .as(t.admin)
          .patch(`/v2/channels/${ch.id}`)
          .send({ rowVersion: res.body.rowVersion, settings: { bogus: 1 } })
      ).status,
    ).toBe(422);
    ch = res.body as Channel;
  });

  it('removes a channel nobody has talked through: 204, gone, one audit row and one outbox event', async () => {
    const doomed = await createWa(t, 'Doomed', '2000000004');
    const res = await api.as(t.admin).delete(`/v2/channels/${doomed.id}`);
    expect(res.status).toBe(204);
    expect((await api.as(t.admin).get(`/v2/channels/${doomed.id}`)).status).toBe(404);
    expect(await api.auditCount(t.orgId, 'channels', 'delete')).toBe(1);
    expect(await api.events(t.orgId, 'channel.deleted')).toEqual([
      expect.objectContaining({ uuid: doomed.id }),
    ]);
  });

  it('a channel with conversations cannot be removed (409 CHANNEL_IN_USE) and nothing is audited or emitted', async (ctx) => {
    const fk = await h.owner.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'channel_id'`,
    );
    if (fk.rowCount === 0) ctx.skip();
    const busy = await createWa(t, 'Busy', '2000000005');
    const row = await h.owner.query(`SELECT id FROM channels WHERE org_id = $1 AND uuid = $2`, [
      t.orgId,
      busy.id,
    ]);
    await h.owner.query(
      `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1, $2, '919800000001', 'Customer')`,
      [t.orgId, row.rows[0].id],
    );
    const before = await api.auditCount(t.orgId, 'channels', 'delete');
    const res = await api.as(t.admin).delete(`/v2/channels/${busy.id}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CHANNEL_IN_USE');
    expect(await api.auditCount(t.orgId, 'channels', 'delete')).toBe(before);
    expect((await api.as(t.admin).get(`/v2/channels/${busy.id}`)).status).toBe(200);
  });
});

describe('tenant isolation', () => {
  let a: Tenant;
  let b: Tenant;
  let chA: Channel;

  beforeAll(async () => {
    a = await api.signup('cha');
    b = await api.signup('chb');
    chA = await createWa(a, 'A only', '3000000001');
  });

  it("another workspace's admin gets 404 on every route naming the channel, and the list never shows it", async () => {
    const o = api.as(b.admin);
    expect((await o.get(`/v2/channels/${chA.id}`)).status).toBe(404);
    expect(
      (await o.patch(`/v2/channels/${chA.id}`).send({ rowVersion: 1, name: 'x' })).status,
    ).toBe(404);
    expect((await o.post(`/v2/channels/${chA.id}/health`)).status).toBe(404);
    expect((await o.delete(`/v2/channels/${chA.id}`)).status).toBe(404);
    expect(
      (
        await o
          .post(`/v2/dev/simulator/channels/${chA.id}/inbound`)
          .send({ from: '919876543210', text: 'x' })
      ).status,
    ).toBe(404);
    expect((await o.get('/v2/channels')).body.data).toEqual([]);
    // and nothing changed for the owner
    const still = (await api.as(a.admin).get(`/v2/channels/${chA.id}`)).body as Channel;
    expect(still.name).toBe('A only');
  });

  it('the facade, called under another tenant, finds nothing and never carries credentials', async () => {
    const db = h.app.get(DatabaseService);
    const facade = h.app.get(ChannelsFacade);
    const seenByB = await db.txAs({ orgId: b.orgId, userId: null }, (tx) =>
      facade.findByUuid(tx, b.orgId, chA.id),
    );
    expect(seenByB).toBeNull();
    const seenByA = await db.txAs({ orgId: a.orgId, userId: null }, (tx) =>
      facade.findByUuid(tx, a.orgId, chA.id),
    );
    expect(seenByA).toMatchObject({ uuid: chA.id, kind: 'whatsapp_cloud', status: 'connected' });
    expect(JSON.stringify(seenByA)).not.toMatch(/token|secret|credential/i);
    const list = await db.txAs({ orgId: a.orgId, userId: null }, (tx) => facade.list(tx, a.orgId));
    expect(list.map((c) => c.uuid)).toEqual([chA.id]);
  });
});

describe('channels created by other domains (the web chat widget)', () => {
  it('a widget channel inserted by its domain is listed with the web chat capabilities and no webhook', async () => {
    const t = await api.signup('chw0');
    const widgetUuid = '66666666-6666-4666-8666-666666666666';
    const row = await h.owner.query(
      `INSERT INTO channels (org_id, kind, name, status, external_id) VALUES ($1, 'webchat', 'Site widget', 'connected', $2) RETURNING uuid`,
      [t.orgId, widgetUuid],
    );
    const id = row.rows[0].uuid as string;
    const list = (await api.as(t.admin).get('/v2/channels')).body.data as Channel[];
    const widget = list.find((c) => c.id === id)!;
    expect(widget).toMatchObject({
      kind: 'webchat',
      status: 'connected',
      webhookUrl: null,
      hasCredentials: false,
    });
    expect(widget.capabilities).toMatchObject({ windowHours: null, templates: false });
    const challenge = await api
      .http()
      .get(`/v2/webhooks/channels/${id}`)
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': 'c' });
    expect(challenge.status).toBe(401);
  });
});

describe("the WhatsApp webhook is the WABA domain's: a channel has no door of its own", () => {
  it('the per-channel URL refuses every delivery and every subscription challenge for a WhatsApp channel, whatever is sent', async () => {
    const t = await api.signup('chw');
    const ch = await createWa(t, 'Hooked', '4000000001');
    expect(ch.webhookUrl).toBeNull();
    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [] } }] }] });
    const post = await api
      .http()
      .post(`/v2/webhooks/channels/${ch.id}`)
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', 'sha256=' + 'a'.repeat(64))
      .send(body);
    expect(post.status).toBe(401);
    const challenge = await api
      .http()
      .get(`/v2/webhooks/channels/${ch.id}`)
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': 'c' });
    expect(challenge.status).toBe(401);
    expect(await ingest.getJob(`ingest-${ch.id}-in-nothing`)).toBeUndefined();
  });

  it('an unknown channel is 404', async () => {
    expect(
      (
        await api
          .http()
          .post('/v2/webhooks/channels/00000000-0000-4000-8000-000000000000')
          .set('content-type', 'application/json')
          .send('{}')
      ).status,
    ).toBe(404);
  });
});

describe('the dev simulator', () => {
  let t: Tenant;
  let sim: Channel;
  const job = (id: string) => ingest.getJob(id);

  beforeAll(async () => {
    t = await api.signup('chs');
    sim = await createSim(t.admin, { name: 'Pretend WhatsApp' });
  });

  it('creates a connected channel with no credentials, no webhook, a WhatsApp-like profile, and never metered', () => {
    expect(sim).toMatchObject({
      kind: 'simulator',
      name: 'Pretend WhatsApp',
      status: 'connected',
      hasCredentials: false,
      webhookUrl: null,
      credentialHints: {},
      externalId: null,
    });
    expect(sim.settings).toEqual({
      metered: false,
      simulator: { latencyMs: { sent: 0, delivered: 1000, read: 3000 }, window: 'auto' },
    });
    expect(sim.capabilities).toMatchObject({ windowHours: 24, templates: true });
  });

  it('is idempotent on the Idempotency-Key header', async () => {
    const send = () =>
      api
        .as(t.admin)
        .post('/v2/channels/simulator')
        .set('idempotency-key', 'same-key-1')
        .send({ name: 'Once' });
    const first = await send();
    const second = await send();
    expect(second.status).toBe(first.status);
    expect(second.body.id).toBe(first.body.id);
  });

  it('settings merge one level down: latency and the window toggle; metering cannot be turned on', async () => {
    const res = await api
      .as(t.admin)
      .patch(`/v2/channels/${sim.id}`)
      .send({
        rowVersion: sim.rowVersion,
        settings: { metered: true, simulator: { window: 'closed', latencyMs: { delivered: 500 } } },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.settings).toEqual({
      metered: false,
      simulator: { latencyMs: { sent: 0, delivered: 500, read: 3000 }, window: 'closed' },
    });
    sim = res.body as Channel;
  });

  it('an inbound message goes through the adapter and onto the ingest queue in its normalised shape', async () => {
    const res = await api.as(t.admin).post(`/v2/dev/simulator/channels/${sim.id}/inbound`).send({
      from: '919876543210',
      name: 'Asha',
      text: 'Hello shop',
      providerMessageId: 'sim-fixed-1',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toEqual({ providerMessageId: 'sim-fixed-1', deliveries: 1 });
    const queued = await job(`ingest-${sim.id}-in-sim-fixed-1`);
    expect(queued?.name).toBe('channel.ingest');
    expect(queued?.data).toMatchObject({
      type: 'inbound',
      orgId: t.orgId,
      channelUuid: sim.id,
      message: {
        providerMessageId: 'sim-fixed-1',
        peerKey: '919876543210',
        peerName: 'Asha',
        kind: 'text',
        body: 'Hello shop',
      },
    });
  });

  it('/dup delivers one message three times under one provider id (the ledger must make it one)', async () => {
    const res = await api
      .as(t.admin)
      .post(`/v2/dev/simulator/channels/${sim.id}/inbound`)
      .send({ from: '919876543210', text: '/dup same thing', providerMessageId: 'sim-dup-1' });
    expect(res.body.deliveries).toBe(3);
    const jobs = await Promise.all(
      ['', '-d1', '-d2'].map((s) => job(`ingest-${sim.id}-in-sim-dup-1${s}`)),
    );
    expect(jobs.every(Boolean)).toBe(true);
    expect(
      new Set(
        jobs.map(
          (j) => (j!.data as { message: { providerMessageId: string } }).message.providerMessageId,
        ),
      ),
    ).toEqual(new Set(['sim-dup-1']));
    expect(jobs.map((j) => (j!.data as { message: { body: string } }).message.body)).toEqual([
      'same thing',
      'same thing',
      'same thing',
    ]);
  });

  it('media and location messages normalise; a bad body is a 422 naming the field', async () => {
    const media = await api
      .as(t.admin)
      .post(`/v2/dev/simulator/channels/${sim.id}/inbound`)
      .send({
        from: '919876543210',
        kind: 'media',
        media: { mediaKind: 'image', mime: 'image/png', name: 'a.png' },
        providerMessageId: 'sim-media-1',
      });
    expect(media.status).toBe(202);
    expect((await job(`ingest-${sim.id}-in-sim-media-1`))?.data).toMatchObject({
      message: { kind: 'media', media: { mediaKind: 'image', mime: 'image/png' } },
    });
    const bad = await api
      .as(t.admin)
      .post(`/v2/dev/simulator/channels/${sim.id}/inbound`)
      .send({ from: 'abc', kind: 'media' });
    expect(bad.status).toBe(422);
    expect(bad.body.errors.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(['from', 'media']),
    );
  });

  it('a forced receipt is queued with its delay, and may be sent twice or out of order', async () => {
    const send = (status: string, delayMs = 0) =>
      api
        .as(t.admin)
        .post(`/v2/dev/simulator/channels/${sim.id}/receipt`)
        .send({ providerMessageId: 'sim.out.1', status, delayMs });
    expect((await send('read', 4000)).body).toEqual({ queued: true });
    await send('read');
    await send('sent');
    const all = await ingest.getJobs(['waiting', 'delayed']);
    const mine = all.filter((j) => j.id?.startsWith(`ingest-${sim.id}-rc-sim.out.1-`));
    expect(
      mine.map((j) => (j.data as { receipt: { status: string } }).receipt.status).sort(),
    ).toEqual(['read', 'read', 'sent']);
    expect(mine.some((j) => j.opts.delay === 4000)).toBe(true);
  });

  it('a real channel takes no simulated traffic (404), and an unknown uuid is 404 too', async () => {
    const wa = await createWa(t, 'Real', '5000000001');
    expect(
      (
        await api
          .as(t.admin)
          .post(`/v2/dev/simulator/channels/${wa.id}/inbound`)
          .send({ from: '919876543210', text: 'x' })
      ).status,
    ).toBe(404);
    expect(
      (
        await api
          .as(t.admin)
          .post(`/v2/dev/simulator/channels/00000000-0000-4000-8000-000000000000/receipt`)
          .send({ providerMessageId: 'p', status: 'read' })
      ).status,
    ).toBe(404);
  });

  it('is refused when the flag is off: no channel can be created (403) and the dev routes do not exist (404)', async () => {
    await withEnv({ CHANNEL_SIMULATOR_ENABLED: 'false' }, async () => {
      const create = await api
        .as(t.admin)
        .post('/v2/channels/simulator')
        .set('idempotency-key', 'off-1')
        .send({});
      expect(create.status).toBe(403);
      expect(create.body.code).toBe('CHANNEL_SIMULATOR_DISABLED');
      const inbound = await api
        .as(t.admin)
        .post(`/v2/dev/simulator/channels/${sim.id}/inbound`)
        .send({ from: '919876543210', text: 'x' });
      expect(inbound.status).toBe(404);
    });
  });

  it('PRODUCTION REFUSAL: even with the flag on, a production environment cannot create one or reach the dev routes', async () => {
    const before = await count(
      `SELECT count(*) n FROM channels WHERE org_id = $1 AND kind = 'simulator'`,
      [t.orgId],
    );
    await withEnv({ NODE_ENV: 'production', CHANNEL_SIMULATOR_ENABLED: 'true' }, async () => {
      const create = await api
        .as(t.admin)
        .post('/v2/channels/simulator')
        .set('idempotency-key', 'prod-1')
        .send({});
      expect(create.status).toBe(403);
      expect(create.body.code).toBe('CHANNEL_SIMULATOR_DISABLED');
      const inbound = await api
        .as(t.admin)
        .post(`/v2/dev/simulator/channels/${sim.id}/inbound`)
        .send({ from: '919876543210', text: 'x' });
      expect(inbound.status).toBe(404);
      const receipt = await api
        .as(t.admin)
        .post(`/v2/dev/simulator/channels/${sim.id}/receipt`)
        .send({ providerMessageId: 'p', status: 'read' });
      expect(receipt.status).toBe(404);
    });
    expect(
      await count(`SELECT count(*) n FROM channels WHERE org_id = $1 AND kind = 'simulator'`, [
        t.orgId,
      ]),
    ).toBe(before);
  });
});

describe('the dispatcher, through the real app', () => {
  let t: Tenant;
  let sim: Channel;
  let runtime: ChannelRuntime;
  const dispatcher = () => h.app.get(ChannelDispatcher);
  const inTenant = <T>(fn: () => Promise<T>) =>
    RequestContextStore.run(
      {
        requestId: 'dispatch',
        orgId: t.orgId,
        actorType: 'user',
        actorId: t.adminUserId,
        userId: t.adminUserId,
      },
      fn,
    );
  const text = (ref: string, body = 'hello') => ({
    kind: 'text',
    to: '919876543210',
    clientReference: ref,
    body,
  });
  const recently = () => new Date(Date.now() - 60_000);

  beforeAll(async () => {
    t = await api.signup('chd');
    sim = await createSim(t.admin);
    const svc = h.app.get(ChannelRegistryService);
    runtime = await inTenant(() =>
      h.app
        .get(DatabaseService)
        .tx(async (tx) => svc.runtime(tx, t.orgId, await svc.row(tx, t.orgId, sim.id))),
    );
  });

  it('sends through the simulator once per client reference and queues the three simulated receipts with their delays', async () => {
    const ref = `ref-${Date.now()}`;
    const first = await dispatcher().send({
      channel: runtime,
      envelope: text(ref),
      lastInboundAt: recently(),
      consent: SERVICE_CONSENT,
    });
    expect(first.providerMessageId).toMatch(/^sim\./);
    expect(first.replayed).toBe(false);
    const again = await dispatcher().send({
      channel: runtime,
      envelope: text(ref),
      lastInboundAt: recently(),
      consent: SERVICE_CONSENT,
    });
    expect(again).toMatchObject({ providerMessageId: first.providerMessageId, replayed: true });

    // The caller queues the simulated receipts after it has stored the provider's id; twice is safe (fixed job ids).
    await dispatcher().scheduleReceipts(runtime, first);
    await dispatcher().scheduleReceipts(runtime, first);
    const jobs = await ingest.getJobs(['delayed', 'waiting']);
    const receipts = jobs
      .filter((j) => j.id?.startsWith(`ingest-${sim.id}-rc-${first.providerMessageId}-`))
      .map((j) => [(j.data as { receipt: { status: string } }).receipt.status, j.opts.delay]);
    expect(receipts.sort()).toEqual(
      [
        ['delivered', 1000],
        ['read', 3000],
        ['sent', 0],
      ].sort(),
    );
  });

  it('/fail is a permanent ChannelError; /flaky is retryable until the third attempt', async () => {
    await expect(
      dispatcher().send({
        channel: runtime,
        envelope: text(`f-${Date.now()}`, '/fail'),
        lastInboundAt: recently(),
        consent: SERVICE_CONSENT,
      }),
    ).rejects.toMatchObject({ code: 'SIM_REJECTED', retryable: false });
    const ref = `fl-${Date.now()}`;
    for (const attempt of [1, 2]) {
      await expect(
        dispatcher().send({
          channel: runtime,
          envelope: { ...text(ref, '/flaky'), attempt },
          lastInboundAt: recently(),
          consent: SERVICE_CONSENT,
        }),
      ).rejects.toMatchObject({ code: 'SIM_FLAKY', retryable: true });
    }
    await expect(
      dispatcher().send({
        channel: runtime,
        envelope: { ...text(ref, '/flaky'), attempt: 3 },
        lastInboundAt: recently(),
        consent: SERVICE_CONSENT,
      }),
    ).resolves.toMatchObject({ replayed: false });
  });

  it('the emergency halt stops a send at send time, through the real send guard, and resumes after', async () => {
    const op = await h.owner.query(`SELECT id FROM platform_operators ORDER BY id LIMIT 1`);
    const halt = h.app.get(EmergencyHaltService);
    await halt.set(true, Number(op.rows[0].id));
    try {
      await expect(
        dispatcher().send({
          channel: runtime,
          envelope: text(`h-${Date.now()}`),
          lastInboundAt: recently(),
          consent: SERVICE_CONSENT,
        }),
      ).rejects.toMatchObject({ code: 'AUTH_SEND_HALTED' });
    } finally {
      await halt.set(false, Number(op.rows[0].id));
    }
    await expect(
      dispatcher().send({
        channel: runtime,
        envelope: text(`h2-${Date.now()}`),
        lastInboundAt: recently(),
        consent: SERVICE_CONSENT,
      }),
    ).resolves.toBeTruthy();
  });

  it('the window is enforced at enqueue time: closed after 24 hours, forced either way by the simulator toggle; a template is always allowed', async () => {
    const old = new Date(Date.now() - 30 * 3_600_000);
    await expect(
      dispatcher().assertCanQueue({
        channel: runtime,
        envelope: text('w1'),
        lastInboundAt: old,
        consent: SERVICE_CONSENT,
      }),
    ).rejects.toMatchObject({ code: 'SERVICE_WINDOW_CLOSED' });
    const tpl = {
      kind: 'template',
      to: '919876543210',
      clientReference: 'w2',
      template: { name: 'order_update', language: 'en' },
    };
    await expect(
      dispatcher().assertCanQueue({
        channel: runtime,
        envelope: tpl,
        lastInboundAt: old,
        consent: SERVICE_CONSENT,
      }),
    ).resolves.toBeTruthy();
    const forcedOpen = {
      ...runtime,
      settings: {
        ...runtime.settings,
        simulator: { ...runtime.settings.simulator!, window: 'open' as const },
      },
    };
    await expect(
      dispatcher().assertCanQueue({
        channel: forcedOpen,
        envelope: text('w3'),
        lastInboundAt: null,
        consent: SERVICE_CONSENT,
      }),
    ).resolves.toBeTruthy();
  });

  it('the monthly cap is checked against the real plan entitlement for a metered channel, never for the simulator', async () => {
    await h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
      t.orgId,
      JSON.stringify({ limits: { monthly_messages: 5 } }),
    ]);
    const metered: ChannelRuntime = {
      ...runtime,
      kind: 'whatsapp_cloud',
      settings: { metered: true },
    };
    const tpl = {
      kind: 'template',
      to: '919876543210',
      clientReference: 'cap',
      template: { name: 'n', language: 'en' },
    };
    await expect(
      dispatcher().assertCanQueue(
        { channel: metered, envelope: tpl, lastInboundAt: null, consent: SERVICE_CONSENT },
        { monthlyUsed: 4 },
      ),
    ).resolves.toBeTruthy();
    await expect(
      dispatcher().assertCanQueue(
        { channel: metered, envelope: tpl, lastInboundAt: null, consent: SERVICE_CONSENT },
        { monthlyUsed: 5 },
      ),
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    await expect(
      dispatcher().assertCanQueue(
        {
          channel: runtime,
          envelope: text('cap2'),
          lastInboundAt: recently(),
          consent: SERVICE_CONSENT,
        },
        { monthlyUsed: 500 },
      ),
    ).resolves.toBeTruthy();
  });

  it('a skeleton adapter never sends: a Cloud channel is refused as disconnected before its adapter is touched', async () => {
    const cloud: ChannelRuntime = {
      ...runtime,
      kind: 'whatsapp_cloud',
      status: 'disconnected',
      settings: { metered: true },
    };
    await expect(
      dispatcher().send({
        channel: cloud,
        envelope: text('x'),
        lastInboundAt: recently(),
        consent: SERVICE_CONSENT,
      }),
    ).rejects.toMatchObject({ code: 'CHANNEL_DISCONNECTED' });
  });
});
