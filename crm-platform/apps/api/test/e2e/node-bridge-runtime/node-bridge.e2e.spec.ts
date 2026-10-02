import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  nodeBridgeResponseSchema,
  nodeBridgeTestResultSchema,
  nodeMessageSettingsSchema,
} from '@crm/contracts';
import { PlatformSettingsService } from '../../../src/modules/auth';
import {
  PACING_SETTINGS,
  type PacingSettingsSource,
} from '../../../src/modules/broadcasts/send-safety';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/**
 * The Node bridge slice end to end through HTTP (TW-NODE-052, 002, 029): real Postgres with the restricted role, real
 * Redis, the real AppModule. Only the bridge itself is faked, by a local HTTP stand-in.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));
let superToken = '';
let supportToken = '';

const ops = (m: 'get' | 'post' | 'patch', path = '') =>
  api()[m](`/v2/platform/node-bridge${path}`).set(bearer(superToken));
const support = (m: 'get' | 'post' | 'patch', path = '') =>
  api()[m](`/v2/platform/node-bridge${path}`).set(bearer(supportToken));
const pull = () => api().get('/api/whatsapp-message-settings');

async function read() {
  const res = await ops('get');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return nodeBridgeResponseSchema.parse(res.body);
}
async function save(serverUrl: string, token?: string) {
  const cur = await read();
  const res = await ops('patch').send({ serverUrl, token, rowVersion: cur.rowVersion });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return nodeBridgeResponseSchema.parse(res.body);
}
const events = async (like: string) =>
  (
    await h.owner.query(
      `SELECT event, actor_type, payload FROM security_events WHERE event LIKE $1 ORDER BY id`,
      [like],
    )
  ).rows as Array<{ event: string; actor_type: string; payload: { fields: string[] } }>;

const reset = async () => {
  await h.owner.query(
    `DELETE FROM platform_settings WHERE key LIKE 'inst.node_bridge%' OR key = 'node.pacing'`,
  );
  await h.owner.query(`DELETE FROM security_events WHERE event LIKE 'platform.node_%'`);
  h.app.get(PlatformSettingsService).invalidate(); // this process caches reads for a few seconds
  delete process.env.NODE_WEBHOOK_TOKEN;
};

let stub: Server;
let stubUrl = '';
let stubStatus = 200;
const stubSeen: Array<{ url: string; token: string | undefined }> = [];

beforeAll(async () => {
  h = await startHarness();
  const first = await api()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  const enabled = await api()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: totp(setup.body.secret) });
  expect(enabled.status).toBe(201);
  superToken = token;
  const sup = await api()
    .post('/v2/platform/auth/login')
    .send({ email: 'support@platform.test', password: OPERATOR_PASSWORD });
  supportToken = sup.body.tokens.accessToken as string;

  stub = createServer((req, res) => {
    stubSeen.push({ url: req.url!, token: req.headers['x-node-token'] as string | undefined });
    req.resume();
    req.on('end', () => res.writeHead(stubStatus).end('{}'));
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
}, 180_000);

afterAll(async () => {
  await new Promise((r) => stub?.close(r));
  await h?.stop();
});

beforeEach(async () => {
  await reset();
  stubSeen.length = 0;
  stubStatus = 200;
});

describe('TW-NODE-052 access', () => {
  it('refuses no token, lets any operator read, and keeps writes and the test to a super admin', async () => {
    expect((await api().get('/v2/platform/node-bridge')).status).toBe(401);
    expect((await support('get')).status).toBe(200);
    expect(
      (await support('patch').send({ serverUrl: 'http://x.test', rowVersion: 0 })).status,
    ).toBe(403);
    expect((await support('post', '/test').send({ serverUrl: stubUrl })).status).toBe(403);
    expect(
      (
        await support('patch', '/pacing').send({
          msgGap: 3,
          batchesGap: 50,
          bwMsgGap: 5,
          enableBatches: false,
          rowVersion: 0,
        })
      ).status,
    ).toBe(403);
    expect((await read()).serverUrl).toBe('');
  });
});

describe('TW-NODE-052 save', () => {
  it('starts empty with the Reference pacing defaults', async () => {
    const r = await read();
    expect(r).toMatchObject({
      serverUrl: '',
      tokenSet: false,
      rowVersion: 0,
      pacing: { msgGap: 3, batchesGap: 50, bwMsgGap: 5, enableBatches: false },
    });
  });

  it('saves the address and token, never returns the token, and stores it encrypted', async () => {
    const r = await save('http://localhost:8888', 's3cret-token-value');
    expect(r).toMatchObject({ serverUrl: 'http://localhost:8888', tokenSet: true, rowVersion: 1 });
    expect(JSON.stringify(r)).not.toContain('s3cret-token-value');
    const row = (
      await h.owner.query(
        `SELECT value, is_secret FROM platform_settings WHERE key = 'inst.node_bridge.token'`,
      )
    ).rows[0] as { value: string; is_secret: boolean };
    expect(row.is_secret).toBe(true);
    expect(JSON.stringify(row.value)).not.toContain('s3cret-token-value');
    const doc = (
      await h.owner.query(`SELECT value FROM platform_settings WHERE key = 'inst.node_bridge'`)
    ).rows[0] as { value: { serverUrl: string; port: number } };
    expect(doc.value).toMatchObject({ serverUrl: 'http://localhost:8888', port: 8888 });
  });

  it('a blank token keeps the stored one; a typed one replaces it', async () => {
    await save('http://localhost:8888', 'first-token');
    await save('http://localhost:9999', '');
    stubStatus = 200;
    await ops('post', '/test').send({ serverUrl: stubUrl });
    expect(stubSeen.at(-1)?.token).toBe('first-token');
    await save('http://localhost:9999', 'second-token');
    await ops('post', '/test').send({ serverUrl: stubUrl });
    expect(stubSeen.at(-1)?.token).toBe('second-token');
  });

  it('keeps the installer port when only the address changes', async () => {
    await h.owner.query(
      `INSERT INTO platform_settings (key, value, is_secret) VALUES ('inst.node_bridge', '{"serverUrl":"http://old.test","port":7777}'::jsonb, false)`,
    );
    h.app.get(PlatformSettingsService).invalidate();
    await save('http://new.test:1234');
    const doc = (
      await h.owner.query(`SELECT value FROM platform_settings WHERE key = 'inst.node_bridge'`)
    ).rows[0] as { value: { serverUrl: string; port: number } };
    expect(doc.value).toMatchObject({ serverUrl: 'http://new.test:1234', port: 7777 });
  });

  it('a blank address clears it', async () => {
    await save('http://localhost:8888', 'tok');
    expect((await save('')).serverUrl).toBe('');
  });

  it('refuses a stale version with 409 and a bad address with 422', async () => {
    await save('http://localhost:8888', 'tok');
    const stale = await ops('patch').send({ serverUrl: 'http://a.test', rowVersion: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
    const cur = await read();
    for (const bad of ['ftp://x.test', 'localhost:8888', 'http://', 'x'.repeat(192)]) {
      const res = await ops('patch').send({ serverUrl: bad, rowVersion: cur.rowVersion });
      expect(res.status, bad).toBe(422);
    }
    expect((await read()).serverUrl).toBe('http://localhost:8888');
  });

  it('audits who changed which fields, never the values', async () => {
    await save('http://localhost:8888', 'audit-me-not');
    const e = await events('platform.node_bridge_updated');
    expect(e).toHaveLength(1);
    expect(e[0]!.actor_type).toBe('platform_operator');
    expect(e[0]!.payload.fields.sort()).toEqual(['serverUrl', 'token']);
    expect(JSON.stringify(e)).not.toContain('audit-me-not');
  });
});

describe('TW-NODE-052 test connection', () => {
  it('reports connected, token rejected, other statuses and unreachable, and calls /api/refresh-settings', async () => {
    const run = async (body: Record<string, unknown>) => {
      const res = await ops('post', '/test').send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return nodeBridgeTestResultSchema.parse(res.body);
    };
    expect(await run({ serverUrl: stubUrl, token: 'abc' })).toEqual({
      ok: true,
      message: 'Connected — bridge reachable and token accepted.',
    });
    expect(stubSeen.at(-1)).toEqual({ url: '/api/refresh-settings', token: 'abc' });
    stubStatus = 401;
    expect((await run({ serverUrl: `${stubUrl}/`, token: 'abc' })).message).toBe(
      'Reached the bridge but the token was rejected (401). Check the X-Node-Token.',
    );
    stubStatus = 403;
    expect((await run({ serverUrl: stubUrl, token: 'abc' })).ok).toBe(false);
    stubStatus = 500;
    expect((await run({ serverUrl: stubUrl, token: 'abc' })).message).toBe(
      'Bridge responded with HTTP 500.',
    );
    expect(await run({ serverUrl: 'http://127.0.0.1:1', token: 'abc' })).toEqual({
      ok: false,
      message: 'Could not reach the bridge — check the URL and that the Node service is running.',
    });
  });

  it('refuses a blank or non-http address with 422 before calling anything', async () => {
    for (const serverUrl of ['', 'ftp://x.test', 'localhost:8888']) {
      const res = await ops('post', '/test').send({ serverUrl });
      expect(res.status, serverUrl).toBe(422);
    }
    expect(stubSeen).toHaveLength(0);
  });

  it('tests with the environment token when none is saved or typed', async () => {
    process.env.NODE_WEBHOOK_TOKEN = 'env-token';
    await ops('post', '/test').send({ serverUrl: stubUrl });
    expect(stubSeen.at(-1)?.token).toBe('env-token');
  });
});

describe('TW-NODE-029 pacing', () => {
  const pacing = (over: Record<string, unknown> = {}, rowVersion = 0) => ({
    msgGap: 7,
    batchesGap: 20,
    bwMsgGap: 9,
    enableBatches: true,
    rowVersion,
    ...over,
  });

  it('saves the four values and the bridge route returns them in its own wire format', async () => {
    const res = await ops('patch', '/pacing').send(pacing());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(nodeBridgeResponseSchema.parse(res.body)).toMatchObject({
      pacing: { msgGap: 7, batchesGap: 20, bwMsgGap: 9, enableBatches: true },
      pacingRowVersion: 1,
    });
    await save('http://localhost:8888', 'tok');
    const got = await pull().set('x-node-token', 'tok');
    expect(got.status).toBe(200);
    expect(nodeMessageSettingsSchema.parse(got.body)).toEqual({
      success: true,
      msg_gap: 7,
      batches_gap: 20,
      bw_msg_gap: 9,
      enable_batches: 1,
    });
  });

  it('enforces 1..600, 1..10000 and 1..1440, whole numbers only', async () => {
    for (const over of [
      { msgGap: 0 },
      { msgGap: 601 },
      { batchesGap: 0 },
      { batchesGap: 10001 },
      { bwMsgGap: 0 },
      { bwMsgGap: 1441 },
      { msgGap: 2.5 },
    ]) {
      expect((await ops('patch', '/pacing').send(pacing(over))).status, JSON.stringify(over)).toBe(
        422,
      );
    }
    for (const over of [
      { msgGap: 600 },
      { batchesGap: 10000 },
      { bwMsgGap: 1440 },
      { msgGap: 1 },
    ]) {
      const cur = await read();
      const res = await ops('patch', '/pacing').send(pacing(over, cur.pacingRowVersion));
      expect(res.status, JSON.stringify(over)).toBe(200);
    }
  });

  it('refuses a stale version and audits the changed fields', async () => {
    await ops('patch', '/pacing').send(pacing());
    expect((await ops('patch', '/pacing').send(pacing({}, 0))).status).toBe(409);
    const e = await events('platform.node_pacing_updated');
    expect(e).toHaveLength(1);
    expect(e[0]!.payload.fields.sort()).toEqual([
      'batchesGap',
      'bwMsgGap',
      'enableBatches',
      'msgGap',
    ]);
  });

  it('feeds the broadcast sender: the saved values are what a run reads, the daily cap keeps its default', async () => {
    const source = h.app.get<PacingSettingsSource>(PACING_SETTINGS);
    const tx = undefined as never;
    expect(await source.get(tx, 1)).toEqual({
      msgGapSeconds: 3,
      enableBatches: false,
      batchSize: 50,
      batchGapMinutes: 5,
      baileysDailyCap: 4000,
    });
    await ops('patch', '/pacing').send(pacing());
    expect(await source.get(tx, 1)).toEqual({
      msgGapSeconds: 7,
      enableBatches: true,
      batchSize: 20,
      batchGapMinutes: 9,
      baileysDailyCap: 4000,
    });
  });

  it('serves the defaults before anything is saved, with batching off as 0', async () => {
    await save('http://localhost:8888', 'tok');
    const got = await pull().set('x-node-token', 'tok');
    expect(got.body).toEqual({
      success: true,
      msg_gap: 3,
      batches_gap: 50,
      bw_msg_gap: 5,
      enable_batches: 0,
    });
  });
});

describe('TW-NODE-002 shared secret', () => {
  it('refuses a missing or wrong token, and everyone when no secret is configured', async () => {
    expect((await pull()).status).toBe(403); // nothing configured: fail closed
    expect((await pull().set('x-node-token', '')).status).toBe(403);
    await save('http://localhost:8888', 'right-token');
    expect((await pull()).status).toBe(403);
    expect((await pull().set('x-node-token', 'wrong-token')).status).toBe(403);
    expect((await pull().set('x-node-token', 'right-token-')).status).toBe(403);
    expect((await pull().set('x-node-token', 'right-token')).status).toBe(200);
  });

  it('falls back to NODE_WEBHOOK_TOKEN from the environment when none is saved; a saved one wins', async () => {
    process.env.NODE_WEBHOOK_TOKEN = 'env-token';
    expect((await pull().set('x-node-token', 'env-token')).status).toBe(200);
    await save('http://localhost:8888', 'saved-token');
    expect((await pull().set('x-node-token', 'env-token')).status).toBe(403);
    expect((await pull().set('x-node-token', 'saved-token')).status).toBe(200);
  });
});

describe('TW-NODE-004 console health card', () => {
  it('reads the address saved in the panel', async () => {
    await save(stubUrl, 'tok');
    const res = await ops('get').then(() =>
      api().get('/v2/platform/health').set(bearer(superToken)),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const bridge = (res.body.checks as Array<{ key: string; state: string; value: string }>).find(
      (c) => c.key === 'bridge',
    )!;
    expect(bridge.state).toBe('up');
    expect(bridge.value).toBe(new URL(stubUrl).host);
    expect(stubSeen.some((s) => s.token === 'tok')).toBe(true);
  });
});
