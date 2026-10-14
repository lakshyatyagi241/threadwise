import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import { authToken, connect, fake, installFake, push, resetFake, textEvent } from './support';

/** Connecting and managing Viber channels (TW-VIB-001, 002, 007), against a real Postgres and a fake Viber. */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  installFake(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => resetFake());

const post = (t: Tenant, path: string, body?: string | object) =>
  api.http().post(path).set(bearer(t.admin)).set('idempotency-key', randomUUID()).send(body);
const list = (t: Tenant) => api.http().get('/v2/viber/channels').set(bearer(t.admin));
const rows = async (t: Tenant) =>
  (await h.owner.query(`SELECT * FROM viber_channels WHERE org_id = $1 ORDER BY id`, [t.orgId]))
    .rows;
const inboxChannels = async (t: Tenant) =>
  (await h.owner.query(`SELECT * FROM channels WHERE org_id = $1 AND kind = 'viber'`, [t.orgId]))
    .rows;

describe('TW-VIB-002: connect a channel', () => {
  it('validates the token, stores it encrypted, registers the webhook, mirrors the inbox channel and never returns the token', async () => {
    const t = await api.signup('vc1');
    const token = authToken();
    fake.account = {
      ok: true,
      status: 0,
      data: { id: 'acc-1', name: 'Shop', uri: 'shopuri', icon: 'https://cdn.viber.com/i.png' },
    };
    const res = await post(t, '/v2/viber/channels', { authToken: token });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      viberId: 'acc-1',
      name: 'Shop',
      uri: 'shopuri',
      avatar: 'https://cdn.viber.com/i.png',
      active: true,
      lastError: null,
      webhookError: null,
    });
    expect(res.body.webhookUrl).toMatch(/^https:\/\/.+\/v2\/viber\/inbound\/[A-Za-z0-9]{48}$/);
    expect(JSON.stringify(res.body)).not.toContain(token);

    const [row] = await rows(t);
    expect(row.auth_token).not.toContain(token);
    expect(row.auth_token).toMatch(/^v1:/);
    expect(row.webhook_token).toBe(res.body.webhookUrl.split('/').pop());

    // Viber was asked who the token belongs to, then to push to our address, as that bot.
    expect(fake.calls.map((c) => c.method)).toEqual(['getAccountInfo', 'setWebhook']);
    const hook = fake.calls[1]!;
    expect(hook.token).toBe(token);
    expect(hook.to).toBe(res.body.webhookUrl);
    expect(hook.sender).toEqual({ name: 'Shop', avatar: 'https://cdn.viber.com/i.png' });

    // The inbox has the channel, so threads and replies have somewhere to live.
    const [ch] = await inboxChannels(t);
    expect(ch).toMatchObject({
      kind: 'viber',
      status: 'connected',
      external_id: String(row.id),
      name: 'Shop',
      display_address: 'viber.com/shopuri',
    });

    expect(await api.auditCount(t.orgId, 'viber_channels', 'insert')).toBe(1);
    expect((await api.events(t.orgId, 'viber.channel.connected'))[0]).toMatchObject({
      name: 'Shop',
      reconnected: false,
    });
  });

  it('the same Viber account pasted again updates its row: same routing token, active again, error cleared', async () => {
    const t = await api.signup('vc2');
    const first = await connect(api, h, t, 'acc-same');
    await h.owner.query(
      `UPDATE viber_channels SET active = false, last_error = 'old' WHERE org_id = $1`,
      [t.orgId],
    );
    const again = await connect(api, h, t, 'acc-same', 'Shop renamed');
    const all = await rows(t);
    expect(all).toHaveLength(1);
    expect(again.uuid).toBe(first.uuid);
    expect(again.routing).toBe(first.routing);
    expect(all[0]).toMatchObject({ active: true, last_error: null, bot_name: 'Shop renamed' });
    expect((await api.events(t.orgId, 'viber.channel.connected')).at(-1)).toMatchObject({
      reconnected: true,
    });
    expect(await inboxChannels(t)).toHaveLength(1);
  });

  it('another Viber account is a second row, newest last', async () => {
    const t = await api.signup('vc3');
    await connect(api, h, t, 'acc-a', 'A');
    await connect(api, h, t, 'acc-b', 'B');
    const res = await list(t);
    expect(res.body.data.map((c: { name: string }) => c.name)).toEqual(['A', 'B']);
    expect(await inboxChannels(t)).toHaveLength(2);
  });

  it('a token Viber rejects saves nothing and says why (VIB_TOKEN_REJECTED, 422)', async () => {
    const t = await api.signup('vc4');
    fake.account = { ok: false, status: 2, error: '2 invalidAuthToken' };
    const res = await post(t, '/v2/viber/channels', { authToken: authToken() });
    expect(res.status).toBe(422);
    expect(res.body.code ?? res.body.error?.code).toBe('VIB_TOKEN_REJECTED');
    expect(JSON.stringify(res.body)).toContain('invalidAuthToken');
    expect(await rows(t)).toHaveLength(0);
    expect(fake.calls.map((c) => c.method)).toEqual(['getAccountInfo']);
  });

  it('a token that is too short never reaches Viber (422 validation)', async () => {
    const t = await api.signup('vc5');
    const res = await post(t, '/v2/viber/channels', { authToken: 'short' });
    expect(res.status).toBe(422);
    expect(fake.calls).toHaveLength(0);
  });

  it('a webhook Viber refuses still saves the channel, shows "needs attention" and says how to fix it', async () => {
    const t = await api.signup('vc6');
    fake.hook = { ok: false, status: 1, error: '1 invalidUrl' };
    const res = await post(t, '/v2/viber/channels', { authToken: authToken() });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.lastError).toBe('1 invalidUrl');
    expect(res.body.webhookError).toMatch(/refused the webhook: 1 invalidUrl/);
    expect(res.body.webhookError).toMatch(/public HTTPS/);
    expect((await rows(t))[0].last_error).toBe('1 invalidUrl');
  });
});

describe('TW-VIB-007: manage a channel', () => {
  it('"re-hook" registers again: success clears the error, failure records it', async () => {
    const t = await api.signup('vm1');
    const c = await connect(api, h, t);
    await h.owner.query(`UPDATE viber_channels SET last_error = 'stale' WHERE org_id = $1`, [
      t.orgId,
    ]);
    fake.calls.length = 0;

    const ok = await post(t, `/v2/viber/channels/${c.uuid}/retry-webhook`);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ lastError: null, webhookError: null });
    expect(fake.calls.map((x) => x.method)).toEqual(['setWebhook']);
    expect(fake.calls[0]!.token).toBe(c.token);

    fake.hook = { ok: false, status: 1, error: '1 invalidUrl' };
    const bad = await post(t, `/v2/viber/channels/${c.uuid}/retry-webhook`);
    expect(bad.status).toBe(200);
    expect(bad.body.lastError).toBe('1 invalidUrl');
    expect(bad.body.webhookError).toMatch(/refused the webhook/);
  });

  it('toggle pauses and resumes, with an audit row, and keeps the inbox channel in step', async () => {
    const t = await api.signup('vm2');
    const c = await connect(api, h, t);
    const off = await post(t, `/v2/viber/channels/${c.uuid}/toggle`);
    expect(off.body.active).toBe(false);
    expect((await inboxChannels(t))[0].status).toBe('disconnected');
    const on = await post(t, `/v2/viber/channels/${c.uuid}/toggle`);
    expect(on.body.active).toBe(true);
    expect((await inboxChannels(t))[0].status).toBe('connected');
    expect(await api.auditCount(t.orgId, 'viber_channels', 'update')).toBeGreaterThanOrEqual(2);
  });

  it('disconnect removes the Viber webhook and the channel, switches the inbox channel off and leaves its threads', async () => {
    const t = await api.signup('vm3');
    const c = await connect(api, h, t);
    expect((await push(api, c, textEvent('user-1', 'hello'))).status).toBe(200);
    fake.calls.length = 0;

    const res = await api.http().delete(`/v2/viber/channels/${c.uuid}`).set(bearer(t.admin));
    expect(res.status).toBe(204);
    expect(fake.calls.map((x) => x.method)).toEqual(['removeWebhook']);
    expect(fake.calls[0]!.token).toBe(c.token);
    expect(await rows(t)).toHaveLength(0);
    expect((await inboxChannels(t))[0].status).toBe('disconnected');
    const threads = await h.owner.query(`SELECT 1 FROM conversations WHERE org_id = $1`, [t.orgId]);
    expect(threads.rows).toHaveLength(1);
    expect((await api.events(t.orgId, 'viber.channel.disconnected'))[0]).toMatchObject({
      name: 'Shop',
    });
  });
});

describe('isolation and access', () => {
  it("another workspace's channel is not found, whatever the action", async () => {
    const a = await api.signup('vi1');
    const b = await api.signup('vi1b');
    const c = await connect(api, h, a);
    for (const [method, path] of [
      ['post', `/v2/viber/channels/${c.uuid}/retry-webhook`],
      ['post', `/v2/viber/channels/${c.uuid}/toggle`],
      ['delete', `/v2/viber/channels/${c.uuid}`],
      ['get', `/v2/viber/channels/${c.uuid}/users`],
    ] as const) {
      const res =
        method === 'post'
          ? await post(b, path)
          : await api.http()[method](path).set(bearer(b.admin));
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect((await list(b)).body.data).toEqual([]);
    expect((await list(a)).body.data).toHaveLength(1);
  });

  it('listing needs viber.channels.read, managing needs viber.channels.manage, and a sign-in is required', async () => {
    const t = await api.signup('vi2');
    const reader = await api.member(t, 'reader', [['viber.channels.read']]);
    const nobody = await api.member(t, 'nobody', [['tg.bots.read']]);
    expect((await api.http().get('/v2/viber/channels')).status).toBe(401);
    expect((await api.http().get('/v2/viber/channels').set(bearer(nobody.token))).status).toBe(403);
    expect((await api.http().get('/v2/viber/channels').set(bearer(reader.token))).status).toBe(200);
    const denied = await api
      .http()
      .post('/v2/viber/channels')
      .set(bearer(reader.token))
      .set('idempotency-key', randomUUID())
      .send({ authToken: authToken() });
    expect(denied.status).toBe(403);
  });

  it('the public door answers a channel that was just removed like an unknown one: 200, nothing written', async () => {
    const t = await api.signup('vi3');
    const c = await connect(api, h, t);
    await api.http().delete(`/v2/viber/channels/${c.uuid}`).set(bearer(t.admin));
    const res = await push(api, c, textEvent('user-9', 'late'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 0 });
    expect(
      (await h.owner.query(`SELECT 1 FROM messages WHERE org_id = $1`, [t.orgId])).rows,
    ).toHaveLength(0);
  });
});
