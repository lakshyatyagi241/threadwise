import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Api, bearer, startHarness, type Harness } from '../contacts-attributes-tags/support';
import { AES_KEY } from '../../support/wechat-crypto';
import {
  connect,
  connectBody,
  decrypt,
  installFakeWechat,
  post,
  refused,
  type Fake,
} from './support';

/** Connecting and managing WeChat Official Accounts (WECH), against a real Postgres and a fake WeChat. */
let h: Harness;
let api: Api;
let wechat: Fake;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  wechat = installFakeWechat(h);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => wechat.reset());

const rows = async (orgId: number) =>
  (await h.owner.query(`SELECT * FROM wechat_channels WHERE org_id = $1 ORDER BY id`, [orgId]))
    .rows;
const inboxChannels = async (orgId: number) =>
  (
    await h.owner.query(
      `SELECT * FROM channels WHERE org_id = $1 AND kind = 'wechat' ORDER BY id`,
      [orgId],
    )
  ).rows;

describe('WECH connect: validate with WeChat, store encrypted, show what to paste', () => {
  it('fetches an access token, stores every secret encrypted, returns none, and mirrors the channel into the inbox', async () => {
    const t = await api.signup('wc1');
    const body = connectBody({ accountName: 'Aurora Cafe' });
    const res = await post(api, t, '/v2/wechat/channels', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      appId: body.appId,
      accountName: 'Aurora Cafe',
      encMode: 'compat',
      hasEncodingAesKey: false,
      active: true,
      lastError: null,
      wxId: null,
    });
    expect(res.body.webhookUrl).toMatch(/^https:\/\/.+\/v2\/wechat\/inbound\/[A-Za-z0-9]{48}$/);
    const out = JSON.stringify(res.body);
    expect(out).not.toContain(body.appSecret);
    expect(out).not.toContain(body.verifyToken);
    expect(out).not.toContain('access-');

    expect(wechat.calls).toHaveLength(1);
    expect(wechat.calls[0]).toMatchObject({
      method: 'fetchAccessToken',
      args: [body.appId, body.appSecret],
    });

    const [row] = await rows(t.orgId);
    for (const col of ['app_secret', 'verify_token', 'cached_access_token']) {
      expect(row[col]).toMatch(/^v1:/);
    }
    expect(decrypt(h, row.app_secret)).toBe(body.appSecret);
    expect(decrypt(h, row.verify_token)).toBe(body.verifyToken);
    expect(decrypt(h, row.cached_access_token)).toMatch(/^access-/);
    expect(row.webhook_token).toBe(res.body.webhookUrl.split('/').pop());
    const left = new Date(row.token_expires_at).getTime() - Date.now();
    expect(left).toBeGreaterThan(7000 * 1000);
    expect(left).toBeLessThanOrEqual(7200 * 1000);

    const [ch] = await inboxChannels(t.orgId);
    expect(ch).toMatchObject({
      kind: 'wechat',
      name: 'Aurora Cafe',
      status: 'connected',
      external_id: String(row.id),
      display_address: body.appId,
    });
    expect(await api.auditCount(t.orgId, 'wechat_channels', 'insert')).toBe(1);
    expect((await api.events(t.orgId, 'wechat.channel.connected'))[0]).toMatchObject({
      appId: body.appId,
      reconnected: false,
    });
  });

  it('WeChat refusing the credentials saves nothing and says why', async () => {
    const t = await api.signup('wc2');
    wechat.answers.fetchAccessToken = () =>
      Promise.resolve({
        ok: false,
        data: { accessToken: '', expiresIn: 0 },
        errcode: 40125,
        error: '40125 invalid appsecret',
      });
    const res = await post(api, t, '/v2/wechat/channels', connectBody());
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('WECH_CREDENTIALS_REJECTED');
    expect(res.body.detail ?? res.body.message).toContain('40125 invalid appsecret');
    expect(await rows(t.orgId)).toHaveLength(0);
    expect(await inboxChannels(t.orgId)).toHaveLength(0);
  });

  it('validates the paste: required fields, the 43 character key, safe mode needs the key', async () => {
    const t = await api.signup('wc3');
    for (const bad of [
      { appId: '' },
      { appSecret: '' },
      { verifyToken: '' },
      { encodingAesKey: 'tooshort' },
      { encMode: 'safe' },
      { encMode: 'turbo' },
      { appId: 'x'.repeat(65) },
    ]) {
      const res = await post(api, t, '/v2/wechat/channels', connectBody(bad));
      expect(res.status, JSON.stringify(bad)).toBe(422);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
    expect(wechat.calls).toHaveLength(0);
    // A blank key is no key; a 43 character key in safe mode is accepted and kept encrypted.
    const ok = await post(
      api,
      t,
      '/v2/wechat/channels',
      connectBody({ encodingAesKey: '', accountName: '' }),
    );
    expect(ok.status).toBe(201);
    expect(ok.body.accountName).toBe('WeChat');
    const safe = await post(
      api,
      t,
      '/v2/wechat/channels',
      connectBody({ encMode: 'safe', encodingAesKey: AES_KEY }),
    );
    expect(safe.status, JSON.stringify(safe.body)).toBe(201);
    expect(safe.body).toMatchObject({ encMode: 'safe', hasEncodingAesKey: true });
    const [, row] = await rows(t.orgId);
    expect(row.encoding_aes_key).toMatch(/^v1:/);
    expect(JSON.stringify(safe.body)).not.toContain(AES_KEY);
  });

  it('the same AppID pasted again updates its row: same webhook address, new secret, active again', async () => {
    const t = await api.signup('wc4');
    const first = await connect(api, h, t);
    await h.owner.query(
      `UPDATE wechat_channels SET active = false, last_error = 'old' WHERE org_id = $1`,
      [t.orgId],
    );
    const again = await post(api, t, '/v2/wechat/channels', {
      appId: first.appId,
      appSecret: 'a-new-secret',
      verifyToken: 'newtoken',
      accountName: 'Renamed',
    });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    const all = await rows(t.orgId);
    expect(all).toHaveLength(1);
    expect(again.body.id).toBe(first.uuid);
    expect(all[0].webhook_token).toBe(first.webhookToken);
    expect(decrypt(h, all[0].app_secret)).toBe('a-new-secret');
    expect(decrypt(h, all[0].verify_token)).toBe('newtoken');
    expect(all[0]).toMatchObject({ active: true, last_error: null, account_name: 'Renamed' });
    expect((await api.events(t.orgId, 'wechat.channel.connected')).at(-1)).toMatchObject({
      reconnected: true,
    });
    expect(await inboxChannels(t.orgId)).toHaveLength(1);
  });

  it('two connects of the same AppID at once make one channel', async () => {
    const t = await api.signup('wc4b');
    const body = connectBody();
    const both = await Promise.all([
      post(api, t, '/v2/wechat/channels', body),
      post(api, t, '/v2/wechat/channels', { ...body, accountName: 'Second' }),
    ]);
    expect(both.map((r) => r.status)).toEqual([201, 201]);
    expect(await rows(t.orgId)).toHaveLength(1);
    expect(both[0]!.body.id).toBe(both[1]!.body.id);
  });

  it('another AppID is a second channel with its own address', async () => {
    const t = await api.signup('wc5');
    const a = await connect(api, h, t);
    const b = await connect(api, h, t);
    expect(a.webhookToken).not.toBe(b.webhookToken);
    expect(await rows(t.orgId)).toHaveLength(2);
    const list = await api.http().get('/v2/wechat/channels').set(bearer(t.admin));
    expect(list.body.data.map((c: { id: string }) => c.id)).toEqual([a.uuid, b.uuid]);
    expect(JSON.stringify(list.body)).not.toContain('secret-');
  });
});

describe('WECH server config: what the person pastes into the WeChat console', () => {
  it('shows the address and the Token to people who manage the channel only', async () => {
    const t = await api.signup('wc6');
    const a = await connect(api, h, t);
    const res = await api
      .http()
      .get(`/v2/wechat/channels/${a.uuid}/server-config`)
      .set(bearer(t.admin));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      webhookUrl: expect.stringMatching(new RegExp(`/v2/wechat/inbound/${a.webhookToken}$`)),
      verifyToken: a.verifyToken,
    });

    const viewer = await api.member(t, 'viewer', [['wechat.channels.read']]);
    const denied = await api
      .http()
      .get(`/v2/wechat/channels/${a.uuid}/server-config`)
      .set(bearer(viewer.token));
    expect(denied.status).toBe(403);
    const list = await api.http().get('/v2/wechat/channels').set(bearer(viewer.token));
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(a.verifyToken);
  });
});

describe('WECH re-check, pause and disconnect', () => {
  it('re-check fetches a new token and clears an old error; a refusal is reported and kept', async () => {
    const t = await api.signup('wc7');
    const a = await connect(api, h, t);
    await h.owner.query(`UPDATE wechat_channels SET last_error = 'stale' WHERE org_id = $1`, [
      t.orgId,
    ]);
    wechat.calls.length = 0;
    const good = await post(api, t, `/v2/wechat/channels/${a.uuid}/recheck`);
    expect(good.status).toBe(200);
    expect(good.body).toMatchObject({ checkError: null, channel: { lastError: null } });
    expect(wechat.calls.map((c) => c.method)).toEqual(['fetchAccessToken']);

    wechat.answers.fetchAccessToken = () =>
      Promise.resolve(refused(40164, 'invalid ip, not in whitelist'));
    const bad = await post(api, t, `/v2/wechat/channels/${a.uuid}/recheck`);
    expect(bad.status).toBe(200);
    expect(bad.body.checkError).toContain('access_token: 40164 invalid ip');
    expect(bad.body.channel.lastError).toContain('40164');
    expect((await rows(t.orgId))[0].last_error).toContain('40164');
  });

  it('pausing switches the inbox channel off, resuming on; both are audited', async () => {
    const t = await api.signup('wc8');
    const a = await connect(api, h, t);
    const off = await post(api, t, `/v2/wechat/channels/${a.uuid}/toggle`);
    expect(off.body.active).toBe(false);
    expect((await inboxChannels(t.orgId))[0].status).toBe('disconnected');
    const on = await post(api, t, `/v2/wechat/channels/${a.uuid}/toggle`);
    expect(on.body.active).toBe(true);
    expect((await inboxChannels(t.orgId))[0].status).toBe('connected');
    expect(await api.auditCount(t.orgId, 'wechat_channels', 'update')).toBe(2);
  });

  it('disconnecting removes the channel and its broadcasts, keeps the inbox threads and says so in the event log', async () => {
    const t = await api.signup('wc9');
    const a = await connect(api, h, t);
    const del = await api
      .http()
      .delete(`/v2/wechat/channels/${a.uuid}`)
      .set(bearer(t.admin))
      .set('idempotency-key', randomUUID());
    expect(del.status).toBe(204);
    expect(await rows(t.orgId)).toHaveLength(0);
    expect((await inboxChannels(t.orgId))[0].status).toBe('disconnected');
    expect(await api.auditCount(t.orgId, 'wechat_channels', 'delete')).toBe(1);
    expect((await api.events(t.orgId, 'wechat.channel.disconnected'))[0]).toMatchObject({
      uuid: a.uuid,
    });
    expect((await post(api, t, `/v2/wechat/channels/${a.uuid}/toggle`)).status).toBe(404);
  });
});

describe('WECH access control', () => {
  it("another workspace's channel is not found, and a reader cannot connect or change anything", async () => {
    const t = await api.signup('wc10');
    const u = await api.signup('wc10b');
    const a = await connect(api, h, t);
    for (const path of ['toggle', 'recheck']) {
      expect((await post(api, u, `/v2/wechat/channels/${a.uuid}/${path}`)).status).toBe(404);
    }
    expect(
      (await api.http().get(`/v2/wechat/channels/${a.uuid}/server-config`).set(bearer(u.admin)))
        .status,
    ).toBe(404);
    expect((await api.http().get('/v2/wechat/channels').set(bearer(u.admin))).body.data).toEqual(
      [],
    );

    const reader = await api.member(t, 'reader', [['wechat.channels.read']]);
    const connectDenied = await api
      .http()
      .post('/v2/wechat/channels')
      .set(bearer(reader.token))
      .set('idempotency-key', randomUUID())
      .send(connectBody());
    expect(connectDenied.status).toBe(403);
    expect(
      (
        await api
          .http()
          .post(`/v2/wechat/channels/${a.uuid}/toggle`)
          .set(bearer(reader.token))
          .set('idempotency-key', randomUUID())
      ).status,
    ).toBe(403);
    const nobody = await api.member(t, 'nobody', []);
    expect((await api.http().get('/v2/wechat/channels').set(bearer(nobody.token))).status).toBe(
      403,
    );
  });
});
