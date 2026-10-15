import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { LineSenderService } from '../../../src/modules/channel-line/line-sender.service';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import { FakeLine, connectChannel, secretOf, tokenOf } from './support';

/** Connecting and managing LINE channels, against a real Postgres and a fake LINE. */
let h: Harness;
let api: Api;
const fake = new FakeLine();

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  fake.install(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => fake.reset());

const post = (t: Tenant, path: string, body?: object) =>
  api.http().post(path).set(bearer(t.admin)).set('idempotency-key', randomUUID()).send(body);
const rows = async (t: Tenant) =>
  (await h.owner.query(`SELECT * FROM line_channels WHERE org_id = $1 ORDER BY id`, [t.orgId]))
    .rows;
const code = (res: { body: { code?: string; error?: { code?: string } } }) =>
  res.body.code ?? res.body.error?.code;

describe('connect a channel', () => {
  it('validates the token with LINE, stores both secrets encrypted, registers the webhook and returns no secret', async () => {
    const t = await api.signup('lc1');
    const accessToken = tokenOf(1);
    const secret = secretOf(1);
    fake.info = {
      ok: true,
      status: 200,
      data: {
        userId: 'Ubot1',
        basicId: '@shop',
        displayName: 'Shop OA',
        pictureUrl: 'https://p.example.com/a.png',
      },
    };
    const res = await post(t, '/v2/line/channels', {
      channelAccessToken: accessToken,
      channelSecret: secret,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      basicId: '@shop',
      displayName: 'Shop OA',
      pictureUrl: 'https://p.example.com/a.png',
      lineChannelId: 'Ubot1',
      active: true,
      lastError: null,
      webhookError: null,
      rotationEnabled: false,
    });
    expect(res.body.webhookUrl).toMatch(/^https:\/\/.+\/v2\/line\/inbound\/[A-Za-z0-9]{48}$/);
    expect(JSON.stringify(res.body)).not.toContain(accessToken);
    expect(JSON.stringify(res.body)).not.toContain(secret);

    const [row] = await rows(t);
    expect(row.channel_access_token).toMatch(/^v1:/);
    expect(row.channel_access_token).not.toContain(accessToken);
    expect(row.channel_secret).toMatch(/^v1:/);
    expect(row.webhook_token).toBe(res.body.webhookUrl.split('/').pop());
    const crypto = h.app.get(CryptoService);
    expect(crypto.decrypt(row.channel_access_token)).toBe(accessToken);
    expect(crypto.decrypt(row.channel_secret)).toBe(secret);

    // LINE was asked with the pasted token, and told the webhook address.
    expect(fake.of('botInfo')[0]!.token).toBe(accessToken);
    expect(fake.of('setWebhookEndpoint')[0]).toMatchObject({
      token: accessToken,
      args: [res.body.webhookUrl],
    });

    expect(await api.auditCount(t.orgId, 'line_channels', 'insert')).toBe(1);
    expect((await api.events(t.orgId, 'line.channel.connected'))[0]).toMatchObject({
      basicId: '@shop',
      reconnected: false,
    });
  });

  it('the channel appears in the inbox as a connected `line` channel', async () => {
    const t = await api.signup('lc2');
    const c = await connectChannel(h, api, fake, t);
    const inbox = (
      await h.owner.query(
        `SELECT kind, status, external_id, display_address FROM channels WHERE org_id = $1`,
        [t.orgId],
      )
    ).rows;
    expect(inbox).toEqual([
      {
        kind: 'line',
        status: 'connected',
        external_id: String(c.rowId),
        display_address: c.basicId,
      },
    ]);
  });

  it('refuses a short token or secret before asking LINE', async () => {
    const t = await api.signup('lc3');
    const short = await post(t, '/v2/line/channels', {
      channelAccessToken: 'short',
      channelSecret: secretOf(3),
    });
    expect(short.status).toBe(422);
    expect(code(short)).toBe('VALIDATION_FAILED');
    const noSecret = await post(t, '/v2/line/channels', {
      channelAccessToken: tokenOf(3),
      channelSecret: 'tiny',
    });
    expect(noSecret.status).toBe(422);
    expect(fake.calls).toHaveLength(0);
  });

  it('a token LINE rejects saves nothing', async () => {
    const t = await api.signup('lc4');
    fake.info = { ok: false, status: 401, error: 'Authentication failed' };
    const res = await post(t, '/v2/line/channels', {
      channelAccessToken: tokenOf(4),
      channelSecret: secretOf(4),
    });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('LINE_TOKEN_REJECTED');
    expect(res.body.detail).toContain('Authentication failed');
    expect(await rows(t)).toHaveLength(0);
  });

  it('the same Official Account pasted again updates its row: same routing token, new secrets, active again', async () => {
    const t = await api.signup('lc5');
    const first = await connectChannel(h, api, fake, t, '@same');
    await h.owner.query(
      `UPDATE line_channels SET active = false, last_error = 'old' WHERE org_id = $1`,
      [t.orgId],
    );
    const again = await post(t, '/v2/line/channels', {
      channelAccessToken: 'second-access-token-aaaaaaaaaaaa',
      channelSecret: 'second-channel-secret-1',
    });
    expect(again.status).toBe(201);
    const all = await rows(t);
    expect(all).toHaveLength(1);
    expect(again.body.id).toBe(first.uuid);
    expect(all[0].webhook_token).toBe(first.webhookToken);
    expect(all[0]).toMatchObject({ active: true, last_error: null });
    expect(h.app.get(CryptoService).decrypt(all[0].channel_access_token)).toBe(
      'second-access-token-aaaaaaaaaaaa',
    );
    expect((await api.events(t.orgId, 'line.channel.connected')).at(-1)).toMatchObject({
      reconnected: true,
    });
  });

  it('another Official Account is a second row', async () => {
    const t = await api.signup('lc6');
    await connectChannel(h, api, fake, t, '@one');
    await connectChannel(h, api, fake, t, '@two');
    expect((await rows(t)).map((r) => r.basic_id)).toEqual(['@one', '@two']);
    const list = await api.http().get('/v2/line/channels').set(bearer(t.admin));
    expect(list.body.data.map((c: { basicId: string }) => c.basicId)).toEqual(['@one', '@two']);
  });

  it('when LINE refuses the webhook the channel is saved with the reason and a way to fix it', async () => {
    const t = await api.signup('lc7');
    fake.hook = { ok: false, status: 400, error: 'The webhook URL is invalid' };
    const res = await post(t, '/v2/line/channels', {
      channelAccessToken: tokenOf(7),
      channelSecret: secretOf(7),
    });
    expect(res.status).toBe(201);
    expect(res.body.webhookError).toContain('The webhook URL is invalid');
    expect(res.body.webhookError).toContain('public HTTPS');
    expect(res.body.lastError).toBe('The webhook URL is invalid');
    expect((await rows(t))[0].last_error).toBe('The webhook URL is invalid');
  });
});

describe('re-hook, pause, disconnect', () => {
  it('re-hook registers the webhook again and clears the error; a refusal keeps it', async () => {
    const t = await api.signup('lc8');
    const c = await connectChannel(h, api, fake, t);
    await h.owner.query(`UPDATE line_channels SET last_error = 'old' WHERE id = $1`, [c.rowId]);
    fake.reset();
    const fine = await post(t, `/v2/line/channels/${c.uuid}/retry-webhook`);
    expect(fine.status).toBe(200);
    expect(fine.body).toMatchObject({ lastError: null, webhookError: null });
    expect(fake.of('setWebhookEndpoint')[0]!.token).toBe(c.accessToken);

    fake.hook = { ok: false, status: 400, error: 'No route' };
    const refused = await post(t, `/v2/line/channels/${c.uuid}/retry-webhook`);
    expect(refused.body.webhookError).toBe('LINE refused the webhook: No route');
    expect(refused.body.lastError).toBe('No route');
  });

  it('pause keeps the row and switches the inbox channel off; enable switches it on', async () => {
    const t = await api.signup('lc9');
    const c = await connectChannel(h, api, fake, t);
    const paused = await post(t, `/v2/line/channels/${c.uuid}/toggle`);
    expect(paused.body.active).toBe(false);
    expect(
      (await h.owner.query(`SELECT status FROM channels WHERE org_id = $1`, [t.orgId])).rows[0]
        .status,
    ).toBe('disconnected');
    const resumed = await post(t, `/v2/line/channels/${c.uuid}/toggle`);
    expect(resumed.body.active).toBe(true);
    expect(
      (await h.owner.query(`SELECT status FROM channels WHERE org_id = $1`, [t.orgId])).rows[0]
        .status,
    ).toBe('connected');
    expect(await api.auditCount(t.orgId, 'line_channels', 'update')).toBe(2);
  });

  it('disconnect removes the channel and its broadcasts; inbox threads stay; an event is emitted', async () => {
    const t = await api.signup('lc10');
    const c = await connectChannel(h, api, fake, t);
    const del = await api
      .http()
      .delete(`/v2/line/channels/${c.uuid}`)
      .set(bearer(t.admin))
      .set('idempotency-key', randomUUID());
    expect(del.status).toBe(204);
    expect(await rows(t)).toHaveLength(0);
    expect(
      (await h.owner.query(`SELECT status FROM channels WHERE org_id = $1`, [t.orgId])).rows[0]
        .status,
    ).toBe('disconnected');
    expect(await api.events(t.orgId, 'line.channel.disconnected')).toHaveLength(1);
    expect(await api.auditCount(t.orgId, 'line_channels', 'delete')).toBe(1);
  });
});

describe('token rotation', () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const put = (t: Tenant, uuid: string, body: object) =>
    api.http().put(`/v2/line/channels/${uuid}/rotation`).set(bearer(t.admin)).send(body);

  it('saves the key encrypted, mints the first token at once and then sends with it', async () => {
    const t = await api.signup('lr1');
    const c = await connectChannel(h, api, fake, t);
    const res = await put(t, c.uuid, {
      assertionKid: 'kid-1',
      assertionPrivateKey: privateKey,
      channelId: '1234567890',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      rotationEnabled: true,
      assertionKid: 'kid-1',
      lineChannelId: '1234567890',
      lastError: null,
    });
    expect(res.body.rotationExpiresAt).not.toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('BEGIN PRIVATE KEY');
    expect(JSON.stringify(res.body)).not.toContain('rotated-token-0001');

    const row = (await rows(t))[0];
    expect(row.assertion_private_key).toMatch(/^v1:/);
    expect(row.rotating_token).toMatch(/^v1:/);
    expect(row.rotating_token).not.toContain('rotated-token-0001');
    expect(fake.issued).toHaveLength(1);
    expect(fake.issued[0]!.split('.')).toHaveLength(3);

    // A send now carries the rotated token, not the pasted one.
    await h.app
      .get(LineSenderService)
      .reply(t.orgId, { channelRowId: c.rowId, to: 'Uabc', text: 'hi' });
    expect(fake.of('push')[0]!.token).toBe('rotated-token-0001');
    expect(fake.issued).toHaveLength(1);
  });

  it('asks for the numeric Channel ID when the channel has only the bot user id', async () => {
    const t = await api.signup('lr2');
    const c = await connectChannel(h, api, fake, t);
    const res = await put(t, c.uuid, { assertionKid: 'kid-1', assertionPrivateKey: privateKey });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('LINE_ROTATION_FAILED');
    expect(res.body.detail).toContain('Channel ID');
    expect(fake.issued).toHaveLength(0);
  });

  it('a key that cannot mint stays saved, with the reason on the channel, and the pasted token still sends', async () => {
    const t = await api.signup('lr3');
    const c = await connectChannel(h, api, fake, t);
    fake.issue = () => ({ ok: false, status: 400, error: 'invalid_client' });
    const res = await put(t, c.uuid, {
      assertionKid: 'kid-1',
      assertionPrivateKey: privateKey,
      channelId: '99',
    });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('LINE_ROTATION_FAILED');
    expect(res.body.detail).toContain('invalid_client');
    expect((await rows(t))[0].last_error).toContain('invalid_client');

    await h.app
      .get(LineSenderService)
      .reply(t.orgId, { channelRowId: c.rowId, to: 'Uabc', text: 'hi' });
    expect(fake.of('push')[0]!.token).toBe(c.accessToken);
  });

  it('a key that does not sign is refused with the reason', async () => {
    const t = await api.signup('lr4');
    const c = await connectChannel(h, api, fake, t);
    const res = await put(t, c.uuid, {
      assertionKid: 'kid-1',
      assertionPrivateKey: 'not a key',
      channelId: '99',
    });
    expect(res.status).toBe(422);
    expect(res.body.detail).toContain('could not sign');
    expect(fake.issued).toHaveLength(0);
  });

  it('blank fields turn rotation off and go back to the pasted token', async () => {
    const t = await api.signup('lr5');
    const c = await connectChannel(h, api, fake, t);
    await put(t, c.uuid, {
      assertionKid: 'kid-1',
      assertionPrivateKey: privateKey,
      channelId: '5',
    });
    const off = await put(t, c.uuid, { assertionKid: '', assertionPrivateKey: '' });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({
      rotationEnabled: false,
      assertionKid: null,
      rotationExpiresAt: null,
    });
    const row = (await rows(t))[0];
    expect(row).toMatchObject({
      assertion_private_key: null,
      rotating_token: null,
      rotating_token_expires_at: null,
    });
    fake.reset();
    await h.app
      .get(LineSenderService)
      .reply(t.orgId, { channelRowId: c.rowId, to: 'Uabc', text: 'hi' });
    expect(fake.of('push')[0]!.token).toBe(c.accessToken);
  });

  it('a rotated token close to its end is renewed on the next send', async () => {
    const t = await api.signup('lr6');
    const c = await connectChannel(h, api, fake, t);
    await put(t, c.uuid, {
      assertionKid: 'kid-1',
      assertionPrivateKey: privateKey,
      channelId: '5',
    });
    await h.owner.query(
      `UPDATE line_channels SET rotating_token_expires_at = now() + interval '3 hours' WHERE id = $1`,
      [c.rowId],
    );
    fake.issue = () => ({
      ok: true,
      status: 200,
      data: { accessToken: 'rotated-token-0002', keyId: 'k2', expiresIn: 2_592_000 },
    });
    await h.app
      .get(LineSenderService)
      .reply(t.orgId, { channelRowId: c.rowId, to: 'Uabc', text: 'hi' });
    expect(fake.of('push')[0]!.token).toBe('rotated-token-0002');
    expect(fake.issued).toHaveLength(2);
  });
});

describe('isolation and permissions', () => {
  it("another workspace's channel is 404 for every action", async () => {
    const t = await api.signup('li1');
    const u = await api.signup('li1b');
    const c = await connectChannel(h, api, fake, t);
    for (const path of ['retry-webhook', 'toggle']) {
      expect((await post(u, `/v2/line/channels/${c.uuid}/${path}`)).status).toBe(404);
    }
    expect(
      (await api.http().put(`/v2/line/channels/${c.uuid}/rotation`).set(bearer(u.admin)).send({}))
        .status,
    ).toBe(404);
    const del = await api
      .http()
      .delete(`/v2/line/channels/${c.uuid}`)
      .set(bearer(u.admin))
      .set('idempotency-key', randomUUID());
    expect(del.status).toBe(404);
    expect((await api.http().get('/v2/line/channels').set(bearer(u.admin))).body.data).toEqual([]);
  });

  it('each route needs its permission and a signed-in person', async () => {
    const t = await api.signup('li2');
    const c = await connectChannel(h, api, fake, t);
    const viewer = await api.member(t, 'viewer', []);
    expect((await api.http().get('/v2/line/channels').set(bearer(viewer.token))).status).toBe(403);
    const reader = await api.member(t, 'reader', [['line.channels.read']]);
    expect((await api.http().get('/v2/line/channels').set(bearer(reader.token))).status).toBe(200);
    const denied = await api
      .http()
      .post(`/v2/line/channels/${c.uuid}/toggle`)
      .set(bearer(reader.token))
      .set('idempotency-key', randomUUID());
    expect(denied.status).toBe(403);
    const deniedConnect = await api
      .http()
      .post('/v2/line/channels')
      .set(bearer(reader.token))
      .set('idempotency-key', randomUUID())
      .send({ channelAccessToken: tokenOf(9), channelSecret: secretOf(9) });
    expect(deniedConnect.status).toBe(403);
    expect((await api.http().get('/v2/line/channels')).status).toBe(401);
  });
});
