import { createHash, createHmac } from 'node:crypto';
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

/**
 * The channel registry, the dev simulator, the public webhook door and the dispatcher through the whole app (plan-inbox-chat.md
 * Phase 0). One app, one database, one Redis; each block works in an organization of its own.
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

const SECRETS = {
  accessToken: 'EAAB-top-secret-access-token-7788',
  appSecret: 'app-secret-do-not-leak-9911',
};
const creds = (phoneNumberId = '1000000001') => ({ phoneNumberId, ...SECRETS });

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
  rowVersion: number;
  webhookVerifyToken?: string;
}

async function createWa(
  token: string,
  name = 'Main number',
  phoneNumberId?: string,
): Promise<Channel> {
  const res = await api
    .as(token)
    .post('/v2/channels')
    .send({ kind: 'whatsapp_cloud', name, credentials: creds(phoneNumberId) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
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
    ch = await createWa(t.admin);
  });

  it('listing channels needs the right to read conversations; with it, any member sees them', async () => {
    expect((await api.as(nobody.token).get('/v2/channels')).status).toBe(403);
    const res = await api.as(reader.token).get('/v2/channels');
    expect(res.status).toBe(200);
    expect(res.body.data.map((c: Channel) => c.id)).toContain(ch.id);
    expect((await api.as(reader.token).get(`/v2/channels/${ch.id}`)).status).toBe(200);
    expect((await api.as(nobody.token).get(`/v2/channels/${ch.id}`)).status).toBe(403);
  });

  it('connecting, editing, rotating, removing and the dev routes need inbox.channel.manage (a reader gets 403 on each)', async () => {
    const r = api.as(reader.token);
    expect(
      (
        await r
          .post('/v2/channels')
          .send({ kind: 'whatsapp_cloud', name: 'x', credentials: creds('1000000002') })
      ).status,
    ).toBe(403);
    expect(
      (await r.post('/v2/channels/simulator').set('idempotency-key', 'k1').send({})).status,
    ).toBe(403);
    expect((await r.patch(`/v2/channels/${ch.id}`).send({ rowVersion: 1, name: 'x' })).status).toBe(
      403,
    );
    expect((await r.post(`/v2/channels/${ch.id}/webhook-token`)).status).toBe(403);
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

describe('connecting a provider channel, and secrets never coming back', () => {
  let t: Tenant;
  let ch: Channel;

  beforeAll(async () => {
    t = await api.signup('chc');
    ch = await createWa(t.admin, 'Support line');
  });

  it('creates it disconnected (its adapter cannot send yet) with capabilities, a webhook URL and a verify token shown once', () => {
    expect(ch.id).toMatch(uuidRe);
    expect(ch).toMatchObject({
      kind: 'whatsapp_cloud',
      name: 'Support line',
      status: 'disconnected',
      externalId: '1000000001',
      hasCredentials: true,
      rowVersion: 1,
    });
    expect(ch.capabilities).toMatchObject({ windowHours: 24, templates: true });
    expect(ch.webhookUrl).toMatch(new RegExp(`/v2/webhooks/channels/${ch.id}$`));
    expect(ch.settings).toEqual({ metered: true });
    expect(ch.webhookVerifyToken).toMatch(/^[A-Za-z0-9_-]{30,}$/);
    expect(ch).not.toHaveProperty('orgId');
  });

  it('no response, list or single, carries a credential, the verify token or its hash; only last-four hints', async () => {
    const dump = JSON.stringify([
      (await api.as(t.admin).get('/v2/channels')).body,
      (await api.as(t.admin).get(`/v2/channels/${ch.id}`)).body,
      (
        await api
          .as(t.admin)
          .patch(`/v2/channels/${ch.id}`)
          .send({ rowVersion: ch.rowVersion, name: 'Support' })
      ).body,
    ]);
    for (const secret of [SECRETS.accessToken, SECRETS.appSecret, ch.webhookVerifyToken!]) {
      expect(dump).not.toContain(secret);
    }
    expect(dump).not.toMatch(/credentials_enc|credentialsEnc|webhook_token_hash|webhookTokenHash/);
    const got = (await api.as(t.admin).get(`/v2/channels/${ch.id}`)).body as Channel;
    expect(got.credentialHints).toEqual({ accessToken: '7788', appSecret: '9911' });
    expect(got).not.toHaveProperty('webhookVerifyToken');
  });

  it('at rest: the credentials are sealed (no plaintext anywhere in the row) and only a SHA-256 of the token is kept', async () => {
    const row = (
      await h.owner.query(`SELECT * FROM channels WHERE org_id = $1 AND uuid = $2`, [
        t.orgId,
        ch.id,
      ])
    ).rows[0];
    expect(row.credentials_enc).toMatch(/^v1:/);
    expect(JSON.stringify(row)).not.toContain(SECRETS.accessToken);
    expect(JSON.stringify(row)).not.toContain(SECRETS.appSecret);
    expect(JSON.stringify(row)).not.toContain(ch.webhookVerifyToken);
    expect(row.webhook_token_hash).toBe(
      createHash('sha256').update(ch.webhookVerifyToken!).digest('hex'),
    );
  });

  it('the write leaves one audit row and one outbox event, and no secret in either', async () => {
    expect(await api.auditCount(t.orgId, 'channels', 'insert')).toBe(1);
    const events = await api.events(t.orgId, 'channel.created');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ uuid: ch.id, kind: 'whatsapp_cloud', name: 'Support line' });
    const all = JSON.stringify([
      (await h.owner.query(`SELECT * FROM audit_log WHERE org_id = $1`, [t.orgId])).rows,
      (await h.owner.query(`SELECT * FROM event_outbox WHERE org_id = $1`, [t.orgId])).rows,
    ]);
    expect(all).not.toContain(SECRETS.accessToken);
    expect(all).not.toContain(SECRETS.appSecret);
    expect(all).not.toContain(ch.webhookVerifyToken);
  });

  it('validates the credentials: digits for the number id, a long enough token and secret, no unknown keys', async () => {
    const send = (credentials: unknown, kind = 'whatsapp_cloud') =>
      api.as(t.admin).post('/v2/channels').send({ kind, name: 'x', credentials });
    for (const bad of [
      { ...creds('abc') },
      { ...creds(), accessToken: 'short' },
      { phoneNumberId: '1000000009', accessToken: SECRETS.accessToken },
      { ...creds('1000000009'), extra: 'nope' },
    ]) {
      const res = await send(bad);
      expect(res.status, JSON.stringify(bad)).toBe(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
    expect((await send(creds('1000000009'), 'carrier_pigeon')).status).toBe(422);
    // `simulator` is not a kind a person connects with credentials.
    expect((await send({}, 'simulator')).status).toBe(422);
    expect(await count(`SELECT count(*) n FROM channels WHERE org_id = $1`, [t.orgId])).toBe(1);
  });

  it('the same provider account cannot be connected twice in a workspace (409), but another workspace may', async () => {
    const dup = await api
      .as(t.admin)
      .post('/v2/channels')
      .send({ kind: 'whatsapp_cloud', name: 'again', credentials: creds() });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('CHANNEL_ALREADY_CONNECTED');
    const other = await api.signup('chc2');
    await expect(createWa(other.admin, 'same number elsewhere')).resolves.toBeDefined();
  });

  it('a skeleton adapter can be stored but never switched on: connecting is refused, and nothing leaks into the answer', async () => {
    const res = await api
      .as(t.admin)
      .patch(`/v2/channels/${ch.id}`)
      .send({ rowVersion: 2, status: 'connected' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CHANNEL_KIND_UNAVAILABLE');
  });
});

describe('editing, rotating and removing', () => {
  let t: Tenant;
  let ch: Channel;

  beforeAll(async () => {
    t = await api.signup('che');
    ch = await createWa(t.admin, 'Editable', '2000000001');
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

  it('rotating credentials replaces only the keys sent, updates the hint and the external id, and audits without any secret', async () => {
    const res = await api
      .as(t.admin)
      .patch(`/v2/channels/${ch.id}`)
      .send({
        rowVersion: ch.rowVersion,
        credentials: { accessToken: 'EAAB-rotated-token-0042', phoneNumberId: '2000000002' },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.credentialHints).toEqual({ accessToken: '0042', appSecret: '9911' });
    expect(res.body.externalId).toBe('2000000002');
    expect(JSON.stringify(res.body)).not.toContain('rotated-token');
    const audit = JSON.stringify(
      (
        await h.owner.query(`SELECT delta FROM audit_log WHERE org_id = $1 AND action = 'update'`, [
          t.orgId,
        ])
      ).rows,
    );
    expect(audit).not.toContain('rotated-token');
    expect(audit).not.toContain(SECRETS.appSecret);
    expect(audit).toContain('[rotated]');
    ch = res.body as Channel;
  });

  it('a rotation that would leave the credentials invalid is a 422 and changes nothing', async () => {
    const res = await api
      .as(t.admin)
      .patch(`/v2/channels/${ch.id}`)
      .send({ rowVersion: ch.rowVersion, credentials: { phoneNumberId: 'not-digits' } });
    expect(res.status).toBe(422);
    expect((await api.as(t.admin).get(`/v2/channels/${ch.id}`)).body.rowVersion).toBe(
      ch.rowVersion,
    );
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

  it('the webhook verify token can be rotated: shown once, the old one stops working', async () => {
    const created = await createWa(t.admin, 'Hooked', '2000000003');
    const old = created.webhookVerifyToken!;
    const challenge = (token: string) =>
      api
        .http()
        .get(`/v2/webhooks/channels/${created.id}`)
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': 'abc123' });
    expect((await challenge(old)).status).toBe(200);

    const rotated = await api.as(t.admin).post(`/v2/channels/${created.id}/webhook-token`);
    expect(rotated.status).toBe(200);
    const fresh = rotated.body.webhookVerifyToken as string;
    expect(fresh).not.toBe(old);
    expect((await challenge(old)).status).toBe(401);
    const ok = await challenge(fresh);
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('abc123');
    expect((await api.as(t.admin).get(`/v2/channels/${created.id}`)).body).not.toHaveProperty(
      'webhookVerifyToken',
    );
  });

  it('removes a channel nobody has talked through: 204, gone, one audit row and one outbox event', async () => {
    const doomed = await createWa(t.admin, 'Doomed', '2000000004');
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
    const busy = await createWa(t.admin, 'Busy', '2000000005');
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
    chA = await createWa(a.admin, 'A only', '3000000001');
  });

  it("another workspace's admin gets 404 on every route naming the channel, and the list never shows it", async () => {
    const o = api.as(b.admin);
    expect((await o.get(`/v2/channels/${chA.id}`)).status).toBe(404);
    expect(
      (await o.patch(`/v2/channels/${chA.id}`).send({ rowVersion: 1, name: 'x' })).status,
    ).toBe(404);
    expect((await o.post(`/v2/channels/${chA.id}/webhook-token`)).status).toBe(404);
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
    expect(seenByA).toMatchObject({ uuid: chA.id, kind: 'whatsapp_cloud', status: 'disconnected' });
    expect(JSON.stringify(seenByA)).not.toMatch(/token|secret|credential/i);
    const list = await db.txAs({ orgId: a.orgId, userId: null }, (tx) => facade.list(tx, a.orgId));
    expect(list.map((c) => c.uuid)).toEqual([chA.id]);
  });
});

describe('channels created by other domains (the web chat widget)', () => {
  it('a widget channel inserted by its domain is listed with the web chat capabilities and no webhook, and has no token to rotate', async () => {
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
    const rotate = await api.as(t.admin).post(`/v2/channels/${id}/webhook-token`);
    expect(rotate.status).toBe(422);
    expect(rotate.body.code).toBe('CHANNEL_KIND_UNAVAILABLE');
    const challenge = await api
      .http()
      .get(`/v2/webhooks/channels/${id}`)
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': 'c' });
    expect(challenge.status).toBe(401);
  });
});

describe('the public webhook door', () => {
  let t: Tenant;
  let ch: Channel;
  const post = (id: string, body: string, signature?: string) => {
    const req = api
      .http()
      .post(`/v2/webhooks/channels/${id}`)
      .set('content-type', 'application/json');
    if (signature) req.set('x-hub-signature-256', signature);
    return req.send(body);
  };
  const sign = (body: string, secret = SECRETS.appSecret) =>
    `sha256=${createHmac('sha256', secret).update(Buffer.from(body)).digest('hex')}`;
  const payload = (id: string, text: string) =>
    JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ wa_id: '919812345678', profile: { name: 'Meera' } }],
                messages: [
                  {
                    id: id,
                    from: '919812345678',
                    type: 'text',
                    timestamp: '1760000000',
                    text: { body: text },
                  },
                ],
                statuses: [{ id: `out-${id}`, status: 'delivered', timestamp: '1760000050' }],
              },
            },
          ],
        },
      ],
    });

  beforeAll(async () => {
    t = await api.signup('chw');
    ch = await createWa(t.admin, 'Hooked', '4000000001');
  });

  it('the subscription challenge echoes hub.challenge for the right token only; an unknown channel is 404', async () => {
    const q = (id: string, token: string, mode = 'subscribe') =>
      api
        .http()
        .get(`/v2/webhooks/channels/${id}`)
        .query({ 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': 'xyz789' });
    const ok = await q(ch.id, ch.webhookVerifyToken!);
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('xyz789');
    expect((await q(ch.id, 'wrong-token')).status).toBe(401);
    expect((await q(ch.id, ch.webhookVerifyToken!, 'unsubscribe')).status).toBe(401);
    expect((await q('00000000-0000-4000-8000-000000000000', 'x')).status).toBe(404);
    expect((await q('not-a-uuid', 'x')).status).toBe(404);
  });

  it('a delivery with a wrong, missing or malformed signature is a 401 and queues nothing', async () => {
    const id = `wamid.bad.${Date.now()}`;
    const body = payload(id, 'hello');
    for (const sig of [
      sign(body, 'someone-elses-secret'),
      undefined,
      'sha256=zz',
      `md5=${'a'.repeat(32)}`,
    ]) {
      const res = await post(ch.id, body, sig);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('SIGNATURE_INVALID');
    }
    expect(await ingest.getJob(`ingest-${ch.id}-in-${id}`)).toBeUndefined();
  });

  it('a signature made over a different body does not verify (the raw bytes are what is signed)', async () => {
    const id = `wamid.swap.${Date.now()}`;
    const res = await post(ch.id, payload(id, 'tampered'), sign(payload(id, 'original')));
    expect(res.status).toBe(401);
  });

  it('a correctly signed delivery is answered at once and queued as a normalised message and receipt', async () => {
    const id = `wamid.good.${Date.now()}`;
    const body = payload(id, 'Hi, is this open?');
    const res = await post(ch.id, body, sign(body));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ received: true });

    const msg = await ingest.getJob(`ingest-${ch.id}-in-${id}`);
    expect(msg?.data).toMatchObject({
      type: 'inbound',
      orgId: t.orgId,
      channelUuid: ch.id,
      message: {
        providerMessageId: id,
        peerKey: '919812345678',
        peerName: 'Meera',
        kind: 'text',
        body: 'Hi, is this open?',
      },
    });
    const rc = await ingest.getJob(`ingest-${ch.id}-rc-out-${id}-delivered`);
    expect(rc?.data).toMatchObject({
      type: 'receipt',
      receipt: { providerMessageId: `out-${id}`, status: 'delivered' },
    });
  });

  it('a redelivery of the same message collapses into one job (the ledger stays the real guard)', async () => {
    const id = `wamid.dup.${Date.now()}`;
    const body = payload(id, 'twice');
    await post(ch.id, body, sign(body));
    await post(ch.id, body, sign(body));
    const jobs = (
      await ingest.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed'])
    ).filter((j) => j.id === `ingest-${ch.id}-in-${id}`);
    expect(jobs).toHaveLength(1);
  });

  it('a signed body that is not JSON is a 400, an empty body a 401', async () => {
    const junk = 'not json at all';
    expect((await post(ch.id, junk, sign(junk))).status).toBe(400);
    expect((await post(ch.id, '', sign(''))).status).toBe(401);
  });

  it('an unknown channel is 404, and a simulator channel has no public door (401 whatever is sent)', async () => {
    expect((await post('00000000-0000-4000-8000-000000000000', '{}', sign('{}'))).status).toBe(404);
    const sim = await createSim(t.admin);
    const body = '{"messages":[]}';
    expect((await post(sim.id, body, sign(body))).status).toBe(401);
    expect(
      (
        await api
          .http()
          .get(`/v2/webhooks/channels/${sim.id}`)
          .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': 'c' })
      ).status,
    ).toBe(401);
  });

  it('a disconnected channel still takes deliveries (the provider must not be made to retry)', async () => {
    expect(ch.status).toBe('disconnected');
    const id = `wamid.disc.${Date.now()}`;
    const body = payload(id, 'hello');
    expect((await post(ch.id, body, sign(body))).status).toBe(200);
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
    const wa = await createWa(t.admin, 'Real', '5000000001');
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
    });
    expect(first.providerMessageId).toMatch(/^sim\./);
    expect(first.replayed).toBe(false);
    const again = await dispatcher().send({
      channel: runtime,
      envelope: text(ref),
      lastInboundAt: recently(),
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
      }),
    ).rejects.toMatchObject({ code: 'SIM_REJECTED', retryable: false });
    const ref = `fl-${Date.now()}`;
    for (const attempt of [1, 2]) {
      await expect(
        dispatcher().send({
          channel: runtime,
          envelope: { ...text(ref, '/flaky'), attempt },
          lastInboundAt: recently(),
        }),
      ).rejects.toMatchObject({ code: 'SIM_FLAKY', retryable: true });
    }
    await expect(
      dispatcher().send({
        channel: runtime,
        envelope: { ...text(ref, '/flaky'), attempt: 3 },
        lastInboundAt: recently(),
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
      }),
    ).resolves.toBeTruthy();
  });

  it('the window is enforced at enqueue time: closed after 24 hours, forced either way by the simulator toggle; a template is always allowed', async () => {
    const old = new Date(Date.now() - 30 * 3_600_000);
    await expect(
      dispatcher().assertCanQueue({ channel: runtime, envelope: text('w1'), lastInboundAt: old }),
    ).rejects.toMatchObject({ code: 'SERVICE_WINDOW_CLOSED' });
    const tpl = {
      kind: 'template',
      to: '919876543210',
      clientReference: 'w2',
      template: { name: 'order_update', language: 'en' },
    };
    await expect(
      dispatcher().assertCanQueue({ channel: runtime, envelope: tpl, lastInboundAt: old }),
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
        { channel: metered, envelope: tpl, lastInboundAt: null },
        { monthlyUsed: 4 },
      ),
    ).resolves.toBeTruthy();
    await expect(
      dispatcher().assertCanQueue(
        { channel: metered, envelope: tpl, lastInboundAt: null },
        { monthlyUsed: 5 },
      ),
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    await expect(
      dispatcher().assertCanQueue(
        { channel: runtime, envelope: text('cap2'), lastInboundAt: recently() },
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
      dispatcher().send({ channel: cloud, envelope: text('x'), lastInboundAt: recently() }),
    ).rejects.toMatchObject({ code: 'CHANNEL_DISCONNECTED' });
  });
});
