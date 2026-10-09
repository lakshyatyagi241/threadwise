/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are read loosely, as in the other e2e specs */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_LIBRARY_SECRET_MASK } from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { isBlockedAddress } from '../../../src/infra/providers/node-bridge-runtime/safe-fetch';
import { ApiLibraryRunService } from '../../../src/modules/api-library';
import { ApiLibraryRunner } from '../../../src/modules/api-library/api-library-runner.service';
import { ApiLibraryNodes } from '../../../src/modules/flow-runtime-engine/runtime/nodes/integrations/api-library-node';
import type { NodeContext, RunState } from '../../../src/modules/flow-runtime-engine/runtime/types';
import { interpolate } from '../../../src/modules/flow-runtime-engine/runtime/variables';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/** The API Library against the real app and a real Postgres, with a local HTTP server as the target. */
let h: Harness;
let api: Api;
let target: Server;
let base: string;
/** A second origin: where a saved secret must never be sent. */
let other: Server;
let otherBase: string;
let otherHits = 0;
const seen: Array<{
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}> = [];
const runner = () => h.app.get(ApiLibraryRunner, { strict: false });
const allowLoopback = () => {
  runner().safeFetch.isBlocked = (a) => a !== '127.0.0.1' && isBlockedAddress(a);
};
const strictAddressCheck = () => {
  runner().safeFetch.isBlocked = isBlockedAddress;
};

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  target = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      const path = (req.url ?? '').split('?')[0];
      if (path === '/people') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            data: { id: 7, name: 'Ada', city: 'Pune' },
            access_token: 'tok-in-answer',
          }),
        );
      } else if (path === '/fail') {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end('{"error":"down"}');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
  other = createServer((_req, res) => {
    otherHits += 1;
    res.writeHead(200);
    res.end('{}');
  });
  await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
  otherBase = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
  allowLoopback();
}, 240_000);

afterAll(async () => {
  await new Promise<void>((r) => target?.close(() => r()));
  await new Promise<void>((r) => other?.close(() => r()));
  await h?.stop();
});

const def = (over: Record<string, unknown> = {}) => ({
  name: 'GetPerson',
  method: 'POST',
  url: `${base}/people?id={{person_id}}`,
  variables: [{ name: 'person_id', source: 'flow', defaultValue: '7' }],
  headers: [
    { key: 'Authorization', value: 'Bearer REAL-TOKEN-123' },
    { key: 'X-Trace', value: 'abc' },
  ],
  body: { who: '{{person_id}}', password: 'hunter2' },
  mapping: [
    { path: 'data.name', contactProperty: 'first_name', defaultValue: '' },
    { path: 'data.city', contactProperty: 'city_x', defaultValue: 'Unknown' },
  ],
  responseVariables: ['data.id'],
  ...over,
});
const create = async (t: Tenant, over: Record<string, unknown> = {}) => {
  const res = await api.as(t.admin).post('/v2/api-library/apis').send(def(over));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Record<string, any>;
};

describe('saving APIs', () => {
  it('creates, reads, lists and edits; a secret header is encrypted at rest and never read back', async () => {
    const t = await api.signup('alib1');
    const made = await create(t);
    expect(made).toMatchObject({
      name: 'GetPerson',
      method: 'POST',
      payloadType: 'application/json',
      rowVersion: 1,
      hasFunction: false,
      responseVariables: ['data.id'],
    });
    expect(made.headers).toEqual([
      { key: 'Authorization', value: API_LIBRARY_SECRET_MASK, secret: true },
      { key: 'X-Trace', value: 'abc', secret: false },
    ]);
    expect(JSON.stringify(made)).not.toContain('REAL-TOKEN-123');

    const stored = (
      await h.owner.query(`SELECT headers FROM api_library_apis WHERE uuid = $1`, [made.id])
    ).rows[0].headers as Array<{ key: string; value: string; secret: boolean }>;
    expect(JSON.stringify(stored)).not.toContain('REAL-TOKEN-123');
    expect(stored[1]).toEqual({ key: 'X-Trace', value: 'abc', secret: false });

    const got = await api.as(t.admin).get(`/v2/api-library/apis/${made.id}`);
    expect(got.status).toBe(200);
    expect(got.body.variables).toEqual([{ name: 'person_id', source: 'flow', defaultValue: '7' }]);
    expect(got.body.createdById).toBeTruthy();

    const list = await api.as(t.admin).get('/v2/api-library/apis');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).not.toHaveProperty('headers');
    expect(list.body.page).toMatchObject({ hasMore: false, nextCursor: null });

    // edit: the form sends everything back, the secret as the mask
    const {
      id: _i,
      name: _n,
      createdAt: _c,
      updatedAt: _u,
      createdById: _b,
      hasFunction: _h,
      ...rest
    } = got.body;
    const upd = await api
      .as(t.admin)
      .patch(`/v2/api-library/apis/${made.id}`)
      .send({ ...rest, url: `${base}/people?x={{person_id}}`, rowVersion: got.body.rowVersion });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(upd.body).toMatchObject({ rowVersion: 2, url: `${base}/people?x={{person_id}}` });

    // the stored secret survived the edit: a run still sends the real token
    seen.length = 0;
    const run = await api
      .as(t.admin)
      .post('/v2/api-library/apis/test')
      .send({ ...rest, url: `${base}/people?x={{person_id}}`, apiId: made.id });
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body.ok).toBe(true);
    expect(seen[0]!.headers.authorization).toBe('Bearer REAL-TOKEN-123');

    // a stale form loses
    const stale = await api
      .as(t.admin)
      .patch(`/v2/api-library/apis/${made.id}`)
      .send({ ...rest, rowVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
  });

  it('the name is unique per workspace ignoring case, and another workspace may use it', async () => {
    const a = await api.signup('alib2');
    const b = await api.signup('alib2b');
    await create(a, { name: 'Orders' });
    const dup = await api
      .as(a.admin)
      .post('/v2/api-library/apis')
      .send(def({ name: 'oRDERS' }));
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('ALIB_NAME_TAKEN');
    const other = await api
      .as(b.admin)
      .post('/v2/api-library/apis')
      .send(def({ name: 'Orders' }));
    expect(other.status).toBe(201);
  });

  it('refuses a bad definition with the rule that failed', async () => {
    const t = await api.signup('alib3');
    const post = (body: Record<string, unknown>) =>
      api.as(t.admin).post('/v2/api-library/apis').send(body);
    const bad = await post(def({ name: 'has space' }));
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    const get = await post(def({ method: 'GET' }));
    expect(get.status).toBe(422);
    expect(JSON.stringify(get.body)).toContain('GET requests cannot carry a payload');
    const undeclared = await post(def({ variables: [] }));
    expect(undeclared.status).toBe(422);
    expect(JSON.stringify(undeclared.body)).toContain('person_id');
    const noFn = await post(def({ functionCode: 'return 1' }));
    expect(noFn.status).toBe(422);
    const mask = await post(
      def({ headers: [{ key: 'Authorization', value: API_LIBRARY_SECRET_MASK }] }),
    );
    expect(mask.status).toBe(422);
  });

  it('pages by cursor, searches, and filters by method', async () => {
    const t = await api.signup('alib4');
    for (const [name, method] of [
      ['Alpha', 'GET'],
      ['Beta', 'POST'],
      ['Gamma', 'POST'],
    ] as const) {
      await create(t, {
        name,
        method,
        ...(method === 'GET'
          ? {
              body: null,
              url: `${base}/people`,
              variables: [],
              headers: [],
              mapping: [],
              responseVariables: [],
            }
          : {}),
      });
    }
    const p1 = await api.as(t.admin).get('/v2/api-library/apis?limit=2');
    expect(p1.body.data.map((x: any) => x.name)).toEqual(['Gamma', 'Beta']);
    expect(p1.body.page.hasMore).toBe(true);
    const p2 = await api
      .as(t.admin)
      .get(`/v2/api-library/apis?limit=2&cursor=${p1.body.page.nextCursor}`);
    expect(p2.body.data.map((x: any) => x.name)).toEqual(['Alpha']);
    expect((await api.as(t.admin).get('/v2/api-library/apis?search=alp')).body.data).toHaveLength(
      1,
    );
    expect((await api.as(t.admin).get('/v2/api-library/apis?method=POST')).body.data).toHaveLength(
      2,
    );
    expect((await api.as(t.admin).get('/v2/api-library/apis?method=TRACE')).status).toBe(422);
  });

  it('records an audit row and an outbox event for create, edit and delete', async () => {
    const t = await api.signup('alib5');
    const made = await create(t);
    expect(await api.auditCount(t.orgId, 'api_library', 'insert')).toBe(1);
    expect((await api.events(t.orgId, 'api_library.created'))[0]).toMatchObject({
      uuid: made.id,
      name: 'GetPerson',
    });
    const got = (await api.as(t.admin).get(`/v2/api-library/apis/${made.id}`)).body;
    const {
      id: _i,
      name: _n,
      createdAt: _c,
      updatedAt: _u,
      createdById: _b,
      hasFunction: _h,
      ...rest
    } = got;
    await api
      .as(t.admin)
      .patch(`/v2/api-library/apis/${made.id}`)
      .send({ ...rest, method: 'PUT' });
    expect(await api.auditCount(t.orgId, 'api_library', 'update')).toBe(1);
    const audit = await h.owner.query(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'api_library' AND action = 'update'`,
      [t.orgId],
    );
    expect(JSON.stringify(audit.rows[0].delta)).not.toContain('REAL-TOKEN-123');
    expect(audit.rows[0].delta.method).toEqual({ old: 'POST', new: 'PUT' });
    expect((await api.as(t.admin).delete(`/v2/api-library/apis/${made.id}`)).status).toBe(204);
    expect(await api.auditCount(t.orgId, 'api_library', 'delete')).toBe(1);
    expect(await api.events(t.orgId, 'api_library.deleted')).toHaveLength(1);
  });
});

describe('who may do what', () => {
  it('each action has its own permission; the pickers feed also opens to flow authors', async () => {
    const t = await api.signup('alib6');
    const made = await create(t);
    const reader = await api.member(t, 'alread', [['integ.apilibrary.read']]);
    expect((await api.as(reader.token).get('/v2/api-library/apis')).status).toBe(200);
    expect((await api.as(reader.token).get(`/v2/api-library/apis/${made.id}`)).status).toBe(200);
    expect((await api.as(reader.token).get('/v2/api-library/logs')).status).toBe(200);
    expect((await api.as(reader.token).get('/v2/api-library/contact-properties')).status).toBe(200);
    expect(
      (
        await api
          .as(reader.token)
          .post('/v2/api-library/apis')
          .send(def({ name: 'X1' }))
      ).status,
    ).toBe(403);
    expect(
      (await api.as(reader.token).patch(`/v2/api-library/apis/${made.id}`).send({})).status,
    ).toBe(403);
    expect((await api.as(reader.token).delete(`/v2/api-library/apis/${made.id}`)).status).toBe(403);
    expect((await api.as(reader.token).post('/v2/api-library/apis/test').send(def())).status).toBe(
      403,
    );
    expect(
      (
        await api
          .as(reader.token)
          .post('/v2/api-library/apis/test-function')
          .send({ functionCode: 'x', payload: {} })
      ).status,
    ).toBe(403);

    const author = await api.member(t, 'alflow', [['flb.flows.read']]);
    const options = await api.as(author.token).get('/v2/api-library/apis/options');
    expect(options.status).toBe(200);
    expect(options.body.data[0]).toMatchObject({
      id: made.id,
      name: 'GetPerson',
      responseVariables: ['data.id'],
    });
    expect(options.body.data[0]).not.toHaveProperty('url');
    expect(options.body.data[0]).not.toHaveProperty('headers');
    expect((await api.as(author.token).get('/v2/api-library/apis')).status).toBe(403);

    const creator = await api.member(t, 'alcreate', [['integ.apilibrary.create']]);
    expect(
      (
        await api
          .as(creator.token)
          .post('/v2/api-library/apis')
          .send(def({ name: 'X2' }))
      ).status,
    ).toBe(201);
    expect((await api.as(creator.token).get('/v2/api-library/apis')).status).toBe(403);

    const nobody = await api.member(t, 'alnone', [['record.contacts.read']]);
    expect((await api.as(nobody.token).get('/v2/api-library/apis')).status).toBe(403);
    expect((await api.as(nobody.token).get('/v2/api-library/apis/options')).status).toBe(403);
  });

  it('the Manager preset holds all five keys; Agent and Viewer hold none', async () => {
    const t = await api.signup('alib7');
    const rows = await h.owner.query(
      `SELECT r.system_key, count(*)::int AS n FROM roles r JOIN role_grants g ON g.org_id = r.org_id AND g.role_id = r.id
        WHERE r.org_id = $1 AND g.permission_key LIKE 'integ.apilibrary.%' GROUP BY r.system_key`,
      [t.orgId],
    );
    const by = Object.fromEntries(rows.rows.map((r) => [r.system_key, r.n]));
    expect(by).toEqual({ admin: 5, workspace_admin: 5, manager: 5 });
  });
});

describe('another workspace', () => {
  it('sees and touches nothing of a workspace that is not its own', async () => {
    const a = await api.signup('alib8');
    const b = await api.signup('alib8b');
    const made = await create(a);
    const run = await api
      .as(a.admin)
      .post('/v2/api-library/apis/test')
      .send(def({ apiId: made.id }));
    const logId = run.body.logId as string;
    expect(logId).toBeTruthy();

    expect((await api.as(b.admin).get('/v2/api-library/apis')).body.data).toEqual([]);
    expect((await api.as(b.admin).get('/v2/api-library/apis/options')).body.data).toEqual([]);
    for (const [method, path] of [
      ['get', `/v2/api-library/apis/${made.id}`],
      ['get', `/v2/api-library/apis/${made.id}/usage`],
      ['get', `/v2/api-library/apis/${made.id}/logs`],
      ['get', `/v2/api-library/logs/${logId}`],
      ['delete', `/v2/api-library/apis/${made.id}`],
    ] as const) {
      expect((await api.as(b.admin)[method](path)).status, path).toBe(404);
    }
    expect(
      (
        await api
          .as(b.admin)
          .patch(`/v2/api-library/apis/${made.id}`)
          .send({ ...def(), rowVersion: 1 })
      ).status,
    ).toBe(404);
    expect(
      (
        await api
          .as(b.admin)
          .post('/v2/api-library/apis/test')
          .send(def({ apiId: made.id }))
      ).status,
    ).toBe(404);
    expect((await api.as(b.admin).get('/v2/api-library/logs')).body.data).toEqual([]);
    expect((await api.as(b.admin).get(`/v2/api-library/logs?apiId=${made.id}`)).body.data).toEqual(
      [],
    );

    // the flow door too: B's workspace id with A's API id finds nothing
    const runs = h.app.get(ApiLibraryRunService, { strict: false });
    const miss = await runs.runForFlow({
      orgId: b.orgId,
      apiId: made.id,
      overrides: {},
      lookup: async () => undefined,
      context: {},
    });
    expect(miss).toEqual({ found: false });
  });

  it('the database refuses a row that names another workspace (RLS with check)', async () => {
    const a = await api.signup('alib9');
    const b = await api.signup('alib9b');
    const made = await create(a);
    // as the restricted app role in B's tenant context
    const { Client } = await import('pg');
    const app = new Client({ connectionString: process.env.DATABASE_URL });
    await app.connect();
    try {
      await app.query('BEGIN');
      await app.query(`SELECT set_config('app.org_id', $1, true)`, [String(b.orgId)]);
      expect(
        (await app.query(`SELECT 1 FROM api_library_apis WHERE uuid = $1`, [made.id])).rowCount,
      ).toBe(0);
      await expect(
        app.query(
          `INSERT INTO api_library_apis (org_id, name, method, url) VALUES ($1, 'Sneaky', 'GET', 'https://x.test')`,
          [a.orgId],
        ),
      ).rejects.toThrow(/row-level security/);
      await app.query('ROLLBACK');
    } finally {
      await app.end();
    }
  });
});

describe('test runs', () => {
  it('runs the definition, answers with status, headers, body and time, and logs it with the secrets masked', async () => {
    const t = await api.signup('alib10');
    seen.length = 0;
    const res = await api
      .as(t.admin)
      .post('/v2/api-library/apis/test')
      .send(
        def({
          url: `${base}/people?api_key=REAL-KEY&id={{person_id}}`,
          values: { person_id: '99' },
        }),
      );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: 200, errorKind: null, error: null });
    expect(res.body.durationMs).toBeGreaterThanOrEqual(0);
    expect(res.body.response.bodyJson.data).toEqual({ id: 7, name: 'Ada', city: 'Pune' });
    expect(res.body.response.contentType).toContain('application/json');
    expect(res.body.request.headers.Authorization).toBe(API_LIBRARY_SECRET_MASK);
    expect(res.body.request.url).toBe(`${base}/people?api_key=${API_LIBRARY_SECRET_MASK}&id=99`);
    expect(seen[0]!.url).toContain('id=99');
    expect(seen[0]!.headers.authorization).toBe('Bearer REAL-TOKEN-123');
    expect(JSON.parse(seen[0]!.body)).toEqual({ who: '99', password: 'hunter2' });

    const log = (await api.as(t.admin).get(`/v2/api-library/logs/${res.body.logId}`)).body;
    expect(log).toMatchObject({
      source: 'test',
      ok: true,
      statusCode: 200,
      method: 'POST',
      apiId: null,
      apiName: 'GetPerson',
    });
    expect(log.requestHeaders.Authorization).toBe(API_LIBRARY_SECRET_MASK);
    expect(JSON.parse(log.requestBody).password).toBe(API_LIBRARY_SECRET_MASK);
    expect(log.context.userId).toBeTruthy();
    expect(log.responseBody).not.toContain('tok-in-answer');
    expect(JSON.parse(log.responseBody).access_token).toBe(API_LIBRARY_SECRET_MASK);

    // nothing in the table is the real value
    const leak = await h.owner.query(
      `SELECT count(*)::int AS n FROM api_library_logs WHERE org_id = $1
        AND (request_headers::text || coalesce(request_body,'') || url || coalesce(response_body,'')) ~ 'REAL-(TOKEN|KEY)|hunter2|tok-in-answer'`,
      [t.orgId],
    );
    expect(leak.rows[0].n).toBe(0);
  });

  it('a processing function reshapes the payload before it is sent; one that fails is reported, not sent', async () => {
    const t = await api.signup('alib11');
    seen.length = 0;
    const fn =
      'function processPayload(payload) { payload.total = Number(payload.who) * 2; delete payload.password; return payload; }';
    const ok = await api
      .as(t.admin)
      .post('/v2/api-library/apis/test')
      .send(def({ functionCode: fn }));
    expect(ok.body).toMatchObject({ ok: true, processedPayload: { who: '7', total: 14 } });
    expect(JSON.parse(seen[0]!.body)).toEqual({ who: '7', total: 14 });

    seen.length = 0;
    const bad = await api
      .as(t.admin)
      .post('/v2/api-library/apis/test')
      .send(def({ functionCode: 'function processPayload(p) { throw new Error("nope"); }' }));
    expect(bad.status).toBe(200);
    expect(bad.body).toMatchObject({
      ok: false,
      status: null,
      errorKind: 'function',
      request: null,
    });
    expect(bad.body.error).toContain('nope');
    expect(seen).toHaveLength(0);

    const alone = await api
      .as(t.admin)
      .post('/v2/api-library/apis/test-function')
      .send({
        functionCode: fn,
        payload: { who: '{{person_id}}', password: 'x' },
        variables: [{ name: 'person_id', source: 'flow', defaultValue: '5' }],
      });
    expect(alone.status).toBe(200);
    expect(alone.body).toMatchObject({ ok: true, output: { who: '5', total: 10 }, error: null });
    const broken = await api
      .as(t.admin)
      .post('/v2/api-library/apis/test-function')
      .send({ functionCode: 'function processPayload(p) { return p.a.b.c; }', payload: {} });
    expect(broken.body.ok).toBe(false);
    const missingFn = await api
      .as(t.admin)
      .post('/v2/api-library/apis/test-function')
      .send({ functionCode: 'var x = 1;', payload: {} });
    expect(missingFn.body.error).toContain('processPayload');
  }, 30_000);

  it('a non-2xx answer is a failed run, not an HTTP error of ours', async () => {
    const t = await api.signup('alib12');
    const res = await api
      .as(t.admin)
      .post('/v2/api-library/apis/test')
      .send(def({ url: `${base}/fail`, variables: [], body: { a: 1 } }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, status: 503, errorKind: 'status' });
    expect(res.body.response.bodyJson).toEqual({ error: 'down' });
  });

  it('refuses private, internal and loopback addresses and logs the refusal', async () => {
    const t = await api.signup('alib13');
    strictAddressCheck();
    try {
      for (const url of [
        'http://10.0.0.5/x',
        'http://169.254.169.254/latest/meta-data',
        'http://192.168.1.10/',
        'http://[::1]/',
        'http://localhost/',
        `${base}/people`,
      ]) {
        const res = await api
          .as(t.admin)
          .post('/v2/api-library/apis/test')
          .send(def({ url, variables: [], body: { a: 1 } }));
        expect(res.status, url).toBe(200);
        expect(res.body, url).toMatchObject({
          ok: false,
          status: null,
          errorKind: 'blocked',
          response: null,
        });
      }
      const logs = await api.as(t.admin).get('/v2/api-library/logs?status=failed');
      expect(logs.body.data).toHaveLength(6);
      expect(logs.body.data.every((l: any) => l.errorKind === 'blocked')).toBe(true);
      // a bad scheme or a malformed URL never gets a request either
      const scheme = await api
        .as(t.admin)
        .post('/v2/api-library/apis/test')
        .send(def({ url: 'file:///etc/passwd', variables: [], body: { a: 1 } }));
      expect(scheme.status).toBe(422);
    } finally {
      allowLoopback();
    }
  });
});

describe('logs', () => {
  it('lists newest first with filters, per API and across APIs, and shows one in full', async () => {
    const t = await api.signup('alib14');
    const one = await create(t, { name: 'One' });
    const two = await create(t, { name: 'Two' });
    const call = (apiId: string, over: Record<string, unknown> = {}) =>
      api
        .as(t.admin)
        .post('/v2/api-library/apis/test')
        .send(def({ apiId, ...over }));
    await call(one.id);
    await call(one.id, { url: `${base}/fail`, variables: [], body: { a: 1 } });
    await call(two.id, { url: `${base}/people?needle=1&id={{person_id}}` });

    const all = await api.as(t.admin).get('/v2/api-library/logs');
    expect(all.body.data).toHaveLength(3);
    expect(all.body.data[0].apiName).toBe('Two');
    expect(
      (await api.as(t.admin).get(`/v2/api-library/logs?apiId=${one.id}`)).body.data,
    ).toHaveLength(2);
    expect(
      (await api.as(t.admin).get(`/v2/api-library/apis/${one.id}/logs`)).body.data,
    ).toHaveLength(2);
    expect(
      (await api.as(t.admin).get('/v2/api-library/logs?status=failed')).body.data,
    ).toHaveLength(1);
    expect(
      (await api.as(t.admin).get('/v2/api-library/logs?status=success')).body.data,
    ).toHaveLength(2);
    expect(
      (await api.as(t.admin).get('/v2/api-library/logs?statusCode=503')).body.data,
    ).toHaveLength(1);
    expect((await api.as(t.admin).get('/v2/api-library/logs?source=flow')).body.data).toEqual([]);
    expect(
      (await api.as(t.admin).get('/v2/api-library/logs?search=needle')).body.data,
    ).toHaveLength(1);
    expect((await api.as(t.admin).get('/v2/api-library/logs?search=ONE')).body.data).toHaveLength(
      2,
    );
    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect(
      (await api.as(t.admin).get(`/v2/api-library/logs?from=${encodeURIComponent(future)}`)).body
        .data,
    ).toEqual([]);
    expect(
      (await api.as(t.admin).get(`/v2/api-library/logs?to=${encodeURIComponent(future)}`)).body
        .data,
    ).toHaveLength(3);
    const p1 = await api.as(t.admin).get('/v2/api-library/logs?limit=2');
    const p2 = await api
      .as(t.admin)
      .get(`/v2/api-library/logs?limit=2&cursor=${p1.body.page.nextCursor}`);
    expect([...p1.body.data, ...p2.body.data].map((l: any) => l.id)).toEqual(
      all.body.data.map((l: any) => l.id),
    );

    const detail = await api.as(t.admin).get(`/v2/api-library/logs/${all.body.data[2].id}`);
    expect(detail.body).toMatchObject({ apiName: 'One', source: 'test', ok: true });
    expect(detail.body).toHaveProperty('responseHeaders');
    expect(
      (await api.as(t.admin).get(`/v2/api-library/logs/00000000-0000-4000-8000-000000000000`))
        .status,
    ).toBe(404);
  });
});

describe('deleting an API that flows use', () => {
  it('is refused with the flows listed; force removes it and its log stays', async () => {
    const t = await api.signup('alib15');
    const made = await create(t);
    const flow = (
      await h.owner.query(
        `INSERT INTO flows (org_id, flow_name, flow_data, is_published) VALUES ($1, 'Order status', $2::jsonb, true) RETURNING uuid`,
        [
          t.orgId,
          JSON.stringify({
            flowNodes: [
              { id: 'n1', type: 'trigger', data: {} },
              { id: 'n2', type: 'api_library', data: { apiId: made.id } },
              { id: 'n3', type: 'api_library', data: { apiId: made.id } },
            ],
            flowEdges: [],
          }),
        ],
      )
    ).rows[0].uuid as string;
    await h.owner.query(
      `INSERT INTO flows (org_id, flow_name, flow_data) VALUES ($1, 'Unrelated', '{"flowNodes":[{"id":"x","type":"api_library","data":{"apiId":"00000000-0000-4000-8000-000000000001"}}]}'::jsonb)`,
      [t.orgId],
    );

    const usage = await api.as(t.admin).get(`/v2/api-library/apis/${made.id}/usage`);
    expect(usage.body.data).toEqual([
      { kind: 'flow', id: flow, name: 'Order status', published: true, nodeCount: 2 },
    ]);

    await api
      .as(t.admin)
      .post('/v2/api-library/apis/test')
      .send(def({ apiId: made.id }));
    const refused = await api.as(t.admin).delete(`/v2/api-library/apis/${made.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('ALIB_IN_USE');
    expect(JSON.stringify(refused.body)).toContain('Order status');
    expect((await api.as(t.admin).get(`/v2/api-library/apis/${made.id}`)).status).toBe(200);

    const forced = await api.as(t.admin).delete(`/v2/api-library/apis/${made.id}?force=true`);
    expect(forced.status).toBe(204);
    expect((await api.as(t.admin).get(`/v2/api-library/apis/${made.id}`)).status).toBe(404);
    const logs = await api.as(t.admin).get(`/v2/api-library/logs?apiId=${made.id}`);
    expect(logs.body.data).toHaveLength(1);
    expect(logs.body.data[0]).toMatchObject({ apiName: 'GetPerson', apiId: made.id });

    // an API no flow uses deletes without force
    const free = await create(t, { name: 'Free' });
    expect((await api.as(t.admin).delete(`/v2/api-library/apis/${free.id}`)).status).toBe(204);
  });
});

describe('contact properties', () => {
  it('lists the contact fields a flow can write and the active custom properties, not the inactive ones', async () => {
    const t = await api.signup('alib16');
    await api.as(t.admin).post('/v2/attributes').send({ name: 'City X', key: 'city_x' });
    const off = await api.as(t.admin).post('/v2/attributes').send({ name: 'Old', key: 'old_prop' });
    await api
      .as(t.admin)
      .patch(`/v2/attributes/${off.body.id}`)
      .send({ isActive: false, rowVersion: off.body.rowVersion });
    const res = await api.as(t.admin).get('/v2/api-library/contact-properties');
    expect(res.status).toBe(200);
    const keys = res.body.data.map((p: any) => p.key);
    expect(keys).toEqual(expect.arrayContaining(['name', 'first_name', 'email', 'city_x']));
    expect(keys).not.toContain('old_prop');
    expect(res.body.data.find((p: any) => p.key === 'city_x')).toEqual({
      key: 'city_x',
      label: 'City X',
      kind: 'custom',
    });
    expect(res.body.data.find((p: any) => p.key === 'email').kind).toBe('system');
  });
});

describe('the flow node, end to end through the real services', () => {
  it('runs a saved API for a run, logs it as a flow run, saves variables and writes the mapped contact properties', async () => {
    const t = await api.signup('alib17');
    await api.as(t.admin).post('/v2/attributes').send({ name: 'City X', key: 'city_x' });
    const made = await create(t);
    const [contactUuid] = await api.seedContacts(t, [{ name: 'Seed', phone: '+919800000001' }]);
    const contactId = Number(
      (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [contactUuid])).rows[0].id,
    );

    const vars: Record<string, unknown> = { id: '123' };
    const notes: string[] = [];
    const run = {
      id: 1,
      uuid: '5b8f0f3e-8d1d-4f0e-9d5e-0a3d2d4a7c11',
      orgId: t.orgId,
      flowId: 0,
      contactId,
      contactUuid,
      vars,
    } as unknown as RunState;
    const ctx: NodeContext = {
      run,
      stepKey: 'k',
      node: {
        id: 'node-1',
        type: 'ApiLibrary',
        props: {
          data: {
            apiId: made.id,
            apiName: 'GetPerson',
            inputs: [{ name: 'person_id', value: '{{id}}' }],
            variable: 'person',
          },
        },
      },
      send: async () => ({ ok: true }),
      render: (x) => interpolate(x, vars),
      note: (x) => void notes.push(x),
      now: () => new Date(),
    };
    seen.length = 0;
    const node = h.app.get(ApiLibraryNodes, { strict: false });
    // The worker runs every flow step in a system context for the run's workspace (FlowRunProcessor); so does this.
    const exec = (c: NodeContext) =>
      RequestContextStore.run(
        { requestId: 'flr-test', orgId: t.orgId, actorType: 'system', actorId: null, userId: null },
        () => node.execute(c),
      );
    const result = await exec(ctx);
    expect(result).toEqual({ kind: 'advance', port: 1, branch: true });
    expect(seen[0]!.url).toBe('/people?id=123');
    expect(vars['person.data.name']).toBe('Ada');
    expect(vars['GetPerson.data.id']).toBe(7);
    expect(vars.city_x, notes.join(' | ')).toBe('Pune');

    const contact = (
      await h.owner.query(`SELECT first_name, data FROM contacts WHERE id = $1`, [contactId])
    ).rows[0];
    expect(contact.first_name).toBe('Ada');
    expect(contact.data.city_x).toBe('Pune');

    const logs = await api.as(t.admin).get(`/v2/api-library/apis/${made.id}/logs`);
    expect(logs.body.data[0]).toMatchObject({ source: 'flow', ok: true, apiId: made.id });
    const detail = await api.as(t.admin).get(`/v2/api-library/logs/${logs.body.data[0].id}`);
    expect(detail.body.context).toMatchObject({
      contactId: contactUuid,
      flowRunId: run.uuid,
      flowNodeId: 'node-1',
    });

    // a failing API leaves by the error port
    const bad = await create(t, {
      name: 'Bad',
      url: `${base}/fail`,
      variables: [],
      body: { a: 1 },
      mapping: [],
      responseVariables: [],
    });
    ctx.node.props.data = { apiId: bad.id, inputs: [], variable: 'person' };
    expect(await exec(ctx)).toEqual({ kind: 'advance', port: 2, branch: true });
    expect(vars['person.status']).toBe(503);

    // an API deleted since the flow was saved leaves by the error port too, and says so in the log
    await api.as(t.admin).delete(`/v2/api-library/apis/${bad.id}?force=true`);
    expect(await exec(ctx)).toEqual({ kind: 'advance', port: 2, branch: true });
    const goneLogs = await api.as(t.admin).get(`/v2/api-library/logs?apiId=${bad.id}&source=flow`);
    expect(goneLogs.body.data.map((l: any) => l.error)).toContain(
      'The API this step calls no longer exists.',
    );
  }, 30_000);
});

describe('a saved secret stays with the address it was saved for', () => {
  it('a test or an edit aimed at another host must have the secret typed again', async () => {
    const t = await api.signup('alib18');
    const made = await create(t);
    const got = (await api.as(t.admin).get(`/v2/api-library/apis/${made.id}`)).body;
    const {
      id: _i,
      name: _n,
      createdAt: _c,
      updatedAt: _u,
      createdById: _b,
      hasFunction: _h,
      ...rest
    } = got;

    otherHits = 0;
    const moved = await api
      .as(t.admin)
      .post('/v2/api-library/apis/test')
      .send({ ...rest, url: `${otherBase}/people`, apiId: made.id });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ ok: false, errorKind: 'invalid', request: null });
    expect(moved.body.error).toContain('Authorization');
    expect(otherHits).toBe(0);

    // typing the value again is the person's own secret, and goes where they point it
    const typed = await api
      .as(t.admin)
      .post('/v2/api-library/apis/test')
      .send({
        ...rest,
        url: `${otherBase}/people`,
        apiId: made.id,
        headers: [{ key: 'Authorization', value: 'Bearer MINE', secret: true }],
      });
    expect(typed.body.ok).toBe(true);
    expect(otherHits).toBe(1);

    // the same for an edit: a changed host drops the kept secret
    const edit = await api
      .as(t.admin)
      .patch(`/v2/api-library/apis/${made.id}`)
      .send({ ...rest, url: `${otherBase}/people` });
    expect(edit.status).toBe(422);
    expect(JSON.stringify(edit.body)).toContain('Authorization');
    // a changed path on the same host keeps it
    const samePlace = await api
      .as(t.admin)
      .patch(`/v2/api-library/apis/${made.id}`)
      .send({ ...rest, url: `${base}/people/other` });
    expect(samePlace.status).toBe(200);
  });
});

describe('log retention', () => {
  it('the daily sweep deletes runs older than the retention and keeps the rest', async () => {
    const t = await api.signup('alib19');
    const made = await create(t);
    await api
      .as(t.admin)
      .post('/v2/api-library/apis/test')
      .send(def({ apiId: made.id }));
    await h.owner.query(
      `INSERT INTO api_library_logs (org_id, api_name, source, method, url, ok, created_at)
       VALUES ($1, 'Old', 'test', 'GET', 'https://x.test', true, now() - interval '31 days'),
              ($1, 'Older', 'test', 'GET', 'https://x.test', true, now() - interval '100 days')`,
      [t.orgId],
    );
    const { ApiLibraryRetentionService } =
      await import('../../../src/modules/api-library/api-library-retention.service');
    const { DatabaseService } = await import('../../../src/infra/db/database.service');
    const sweep = new ApiLibraryRetentionService(h.app.get(DatabaseService));
    expect(await sweep.sweep()).toBeGreaterThanOrEqual(2);
    const left = await h.owner.query(`SELECT api_name FROM api_library_logs WHERE org_id = $1`, [
      t.orgId,
    ]);
    expect(left.rows.map((r) => r.api_name)).toEqual(['GetPerson']);
  });
});

describe('numbered pages', () => {
  const names = (r: any) => r.body.data.map((x: any) => x.name);

  it('lists APIs by page with the total, the last page, a page beyond it, and filters that change the total', async () => {
    const t = await api.signup('alib20');
    const other = await api.signup('alib20b');
    for (const n of ['A1', 'A2', 'A3', 'A4', 'A5']) await create(t, { name: n });
    await create(other, { name: 'Elsewhere' });
    const get = (q: string) => api.as(t.admin).get(`/v2/api-library/apis?${q}`);

    const p1 = await get('page=1&limit=2');
    expect(names(p1)).toEqual(['A5', 'A4']);
    expect(p1.body).toMatchObject({ total: 5, pageSize: 2, totalPages: 3 });
    expect(p1.body.page).toMatchObject({
      page: 1,
      total: 5,
      totalPages: 3,
      pageSize: 2,
      hasMore: true,
      nextCursor: null,
    });
    const p2 = await get('page=2&limit=2');
    expect(names(p2)).toEqual(['A3', 'A2']);
    const p3 = await get('page=3&limit=2');
    expect(names(p3)).toEqual(['A1']);
    expect(p3.body.page.hasMore).toBe(false);
    const beyond = await get('page=9&limit=2');
    expect(beyond.status).toBe(200);
    expect(beyond.body).toMatchObject({ data: [], total: 5, totalPages: 3 });
    expect(names(await get('page=1&limit=2&order=asc'))).toEqual(['A1', 'A2']);

    // page mode ignores the cursor; without `page` the answer is the old cursor shape
    const cursor = (await get('limit=2')).body.page.nextCursor;
    expect(names(await get(`page=1&limit=2&cursor=${cursor}`))).toEqual(['A5', 'A4']);
    const plain = await get('limit=2');
    expect(plain.body).not.toHaveProperty('total');
    expect(plain.body.page).not.toHaveProperty('total');

    // filters change the total; the other workspace's API never counts
    const filtered = await get('page=1&limit=10&search=a3');
    expect(filtered.body).toMatchObject({ total: 1, totalPages: 1 });
    expect((await get('page=1&limit=10&method=GET')).body.total).toBe(0);
    expect((await api.as(other.admin).get('/v2/api-library/apis?page=1&limit=10')).body.total).toBe(
      1,
    );

    expect((await get('page=0')).status).toBe(422);
    expect((await get('page=x')).status).toBe(422);
  });

  it("pages the logs, per API and across APIs, with filters, and counts only the caller's workspace", async () => {
    const t = await api.signup('alib21');
    const other = await api.signup('alib21b');
    const one = await create(t, { name: 'One' });
    const two = await create(t, { name: 'Two' });
    const run = (tok: string, apiId: string, over: Record<string, unknown> = {}) =>
      api
        .as(tok)
        .post('/v2/api-library/apis/test')
        .send(def({ apiId, ...over }));
    for (let i = 0; i < 3; i++) await run(t.admin, one.id);
    await run(t.admin, one.id, { url: `${base}/fail`, variables: [], body: { a: 1 } });
    await run(t.admin, two.id);
    const o = await create(other, { name: 'Theirs' });
    await run(other.admin, o.id);

    const get = (q: string, path = '/v2/api-library/logs') => api.as(t.admin).get(`${path}?${q}`);
    const p1 = await get('page=1&limit=2');
    expect(p1.body.data).toHaveLength(2);
    expect(p1.body).toMatchObject({ total: 5, totalPages: 3, pageSize: 2 });
    expect(p1.body.page).toMatchObject({ page: 1, hasMore: true });
    const p2 = await get('page=2&limit=2');
    const p3 = await get('page=3&limit=2');
    expect(p3.body.data).toHaveLength(1);
    const ids = [...p1.body.data, ...p2.body.data, ...p3.body.data].map((l: any) => l.id);
    expect(new Set(ids).size).toBe(5);
    expect((await get('page=4&limit=2')).body).toMatchObject({ data: [], total: 5 });

    expect((await get('page=1&limit=10&status=failed')).body.total).toBe(1);
    expect((await get(`page=1&limit=10&apiId=${one.id}`)).body.total).toBe(4);
    expect((await get('page=1&limit=10', `/v2/api-library/apis/${two.id}/logs`)).body.total).toBe(
      1,
    );
    expect((await get('page=1&limit=10&search=zzz-none')).body).toMatchObject({
      total: 0,
      totalPages: 1,
      data: [],
    });
    const future = encodeURIComponent(new Date(Date.now() + 3_600_000).toISOString());
    expect((await get(`page=1&limit=10&from=${future}`)).body.total).toBe(0);
    expect((await get(`page=1&limit=10&to=${future}`)).body.total).toBe(5);
    expect((await api.as(other.admin).get('/v2/api-library/logs?page=1&limit=10')).body.total).toBe(
      1,
    );

    // a run older than the retention window is outside the numbered pages (the sweep removes it anyway)
    await h.owner.query(
      `INSERT INTO api_library_logs (org_id, api_name, source, method, url, ok, created_at) VALUES ($1,'Ancient','test','GET','https://x.test',true, now() - interval '90 days')`,
      [t.orgId],
    );
    expect((await get('page=1&limit=10')).body.total).toBe(5);
    expect(
      (
        await get(
          'page=1&limit=10&from=' +
            encodeURIComponent(new Date(Date.now() - 200 * 86_400_000).toISOString()),
        )
      ).body.total,
    ).toBe(6);

    // no `page`: the cursor shape, unchanged
    const plain = await get('limit=2');
    expect(plain.body).not.toHaveProperty('total');
    expect(plain.body.page.hasMore).toBe(true);
  });
});
