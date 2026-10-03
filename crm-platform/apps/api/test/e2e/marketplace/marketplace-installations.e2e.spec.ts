import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  marketAppListSchema,
  marketConnectionEventListSchema,
  marketHookResultSchema,
  marketInstallationListSchema,
  marketInstallationSchema,
  marketInstallResultSchema,
  marketOperatorAppDetailSchema,
  marketSampleLeadResultSchema,
  marketTestResultSchema,
  marketUsageSchema,
  type MarketInstallation,
} from '@crm/contracts';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { DatabaseService } from '../../../src/infra/db/database.service';
import {
  ConnectorRegistry,
  PullConnector,
  type FetchLike,
} from '../../../src/infra/providers/marketplace';
import { LeadPipelineGateway } from '../../../src/modules/marketplace/lead-pipeline.gateway';
import { PullRunService } from '../../../src/modules/marketplace/pull-run.service';
import { PullSweepService } from '../../../src/modules/marketplace/pull.worker';
import { PullStateRepository } from '../../../src/modules/marketplace/pull-state.repository';
import {
  Api,
  bearer,
  code,
  hookPath,
  LeadPipelineStub,
  marketApi,
  miniManifest,
  operatorLogin,
  PUSH_RECIPE,
  pipelineDown,
  pipelineUp,
  platformApi,
  publishListing,
  publishVersion,
  pushManifest,
  startHarness,
  superOperator,
  type Harness,
  type Tenant,
} from './support';
import { OPERATOR_EMAIL } from '../auth-registration-security/harness';

/**
 * Installing, consenting, connecting and removing apps end to end through HTTP: install with permission consent, the webhook relay with a
 * stubbed lead pipeline (authentication by token and by signature, idempotency, mapping, 503 when the pipeline is down and no lead lost,
 * health), sample lead, rotating the secret, pausing, the re-consent rule when a new version asks for more, uninstall revoking access in
 * one transaction, the kill switch, a push recipe with explicit mapping and a sealed credential that never comes back, and the pull
 * worker's run against a fake portal. The real API, a real Postgres with row-level security, a real Redis.
 */
let h: Harness;
let api: Api;
let stub: LeadPipelineStub;
let superToken = '';
let reviewerToken = '';
let A: Tenant;
let B: Tenant;
let C: Tenant;
let D: Tenant;
let E: Tenant;
const tokens = () => ({ manage: superToken, review: reviewerToken });
const ops = () => platformApi(h, superToken);
const mp = (t: Tenant | string) => marketApi(h, typeof t === 'string' ? t : t.admin);

let aWebhook: MarketInstallation;
let aSecret = '';
let bWebhook: MarketInstallation;
let bSecret = '';

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  request(h.app.getHttpServer())
    .post(path)
    .set(headers)
    .send(body as object);

const installOf = async (t: Tenant, id: string): Promise<MarketInstallation> => {
  const res = await mp(t).get(`/installations/${id}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return marketInstallationSchema.parse(res.body);
};

const rows = async <T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T[]> => (await h.owner.query(query, params)).rows as T[];

beforeAll(async () => {
  // The worker module runs in the same process, so the pull job can be driven through the real queue.
  h = await startHarness({
    loadModules: async () => [
      (await import('../../../src/modules/marketplace')).MarketplaceWorkerModule,
    ],
  });
  api = new Api(h);
  stub = new LeadPipelineStub().install(h);
  superToken = await superOperator(h);
  await h.owner.query(
    `INSERT INTO platform_operators (email, full_name, password_hash, role)
     SELECT 'reviewer@platform.test', 'Reviewer', password_hash, 'auditor' FROM platform_operators WHERE email = $1`,
    [OPERATOR_EMAIL],
  );
  const role = await request(h.app.getHttpServer())
    .post('/v2/platform/roles')
    .set(bearer(superToken))
    .send({ name: 'Market reviewer', permissions: ['platform.market.review'] });
  expect(role.status, JSON.stringify(role.body)).toBe(201);
  const staff = await request(h.app.getHttpServer())
    .get('/v2/platform/staff')
    .set(bearer(superToken));
  const rv = (staff.body.data as Array<{ id: string; email: string }>).find(
    (s) => s.email === 'reviewer@platform.test',
  )!;
  expect(
    (
      await request(h.app.getHttpServer())
        .put(`/v2/platform/staff/${rv.id}/roles`)
        .set(bearer(superToken))
        .send({ roleIds: [role.body.id] })
    ).status,
  ).toBe(200);
  reviewerToken = await operatorLogin(h, 'reviewer@platform.test');

  for (const t of ['A', 'B', 'C', 'D', 'E'] as const) {
    const tenant = await api.signup(`mkt${t}`);
    if (t === 'A') A = tenant;
    if (t === 'B') B = tenant;
    if (t === 'C') C = tenant;
    if (t === 'D') D = tenant;
    if (t === 'E') E = tenant;
  }
  await publishListing(h, tokens(), {
    manifest: miniManifest({ scopes: ['contacts.read', 'deals.read'] }),
    firstParty: true,
  });
  await publishListing(h, tokens(), { manifest: pushManifest(), recipe: PUSH_RECIPE });
}, 400_000);

afterAll(async () => {
  await h?.stop();
});

describe('install a webhook lead source', () => {
  it('needs the exact permission list confirmed, then installs: audit row, outbox event, consent record, a source in the lead pipeline', async () => {
    const none = await mp(A).post('/apps/webhook/install', { acceptedScopes: [] });
    expect(none.status).toBe(422);
    expect(code(none)).toBe('MKT_CONSENT_REQUIRED');
    expect(none.body.errors).toEqual([{ path: 'acceptedScopes', message: 'missing:leads.write' }]);
    const extra = await mp(A).post('/apps/webhook/install', {
      acceptedScopes: ['leads.write', 'messages.send'],
    });
    expect(code(extra)).toBe('MKT_CONSENT_REQUIRED');
    expect(extra.body.errors).toEqual([
      { path: 'acceptedScopes', message: 'unexpected:messages.send' },
    ]);
    expect(stub.ensured).toEqual([]);

    const res = await mp(A).post('/apps/webhook/install', { acceptedScopes: ['leads.write'] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const out = marketInstallResultSchema.parse(res.body);
    aWebhook = out.installation;
    aSecret = out.inboundSecret!;
    expect(aSecret).toMatch(/^mkt_[A-Za-z0-9_-]{40,}$/);
    expect(aWebhook).toMatchObject({
      status: 'active',
      version: '1.0.0',
      needsReconsent: false,
      pendingVersion: null,
      credentials: [],
      killReason: null,
      health: { status: 'unknown', checkedAt: null, lastError: null },
      grantedScopes: [{ id: 'leads.write', label: 'Add leads', risk: 'medium' }],
      app: {
        slug: 'webhook',
        kind: 'integration',
        connectorType: 'webhook_relay',
        category: { slug: 'lead-sources' },
      },
      connection: {
        type: 'webhook_relay',
        status: 'active',
        inbound: {
          method: 'POST',
          auth: 'either',
          tokenHeader: 'x-marketplace-token',
          signatureHeader: 'x-marketplace-signature',
          secretHint: `ends in ${aSecret.slice(-4)}`,
        },
        counters: { received: 0, accepted: 0, duplicates: 0, failed: 0 },
      },
      installedBy: { name: 'Admin Person' },
    });
    expect(hookPath(aWebhook.connection!.inbound!.url)).toMatch(
      /^\/v2\/public\/marketplace\/hooks\/[0-9a-f]{32}$/,
    );
    expect(stub.ensured).toEqual([
      { orgId: A.orgId, providerKey: 'webhook', externalRef: aWebhook.id, name: 'Webhook' },
    ]);

    // Installed once only; the card shows the state and the operator's counter moved.
    const again = await mp(A).post('/apps/webhook/install', { acceptedScopes: ['leads.write'] });
    expect(again.status).toBe(409);
    expect(code(again)).toBe('MKT_ALREADY_INSTALLED');
    expect(stub.ensured).toHaveLength(1);
    const card = marketAppListSchema.parse((await mp(A).get('/apps?kind=integration')).body)
      .data[0]!;
    expect(card).toMatchObject({
      slug: 'webhook',
      installCount: 1,
      install: {
        installationId: aWebhook.id,
        status: 'active',
        health: 'unknown',
        needsReconsent: false,
      },
    });
    expect(
      marketInstallationListSchema.parse((await mp(A).get('/installations')).body).usage,
    ).toEqual({ installed: 1, limit: 0 });

    // The same-transaction records.
    const audit = await rows(
      `SELECT action, delta FROM audit_log WHERE org_id = $1 AND module = 'marketplace' ORDER BY id`,
      [A.orgId],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'insert',
      delta: {
        app: { new: 'webhook' },
        version: { new: '1.0.0' },
        scopes: { new: ['leads.write'] },
      },
    });
    const events = await rows<{ event_type: string; payload: Record<string, unknown> }>(
      `SELECT event_type, payload FROM event_outbox WHERE org_id = $1 AND aggregate_module = 'marketplace'`,
      [A.orgId],
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: 'marketplace.app.installed',
      payload: { app: 'webhook', installation: aWebhook.id, scopes: ['leads.write'] },
    });
    const consent = await rows(
      `SELECT action, scopes, previous_scopes, data_choice, consented_by FROM marketplace_consents WHERE org_id = $1`,
      [A.orgId],
    );
    expect(consent).toEqual([
      {
        action: 'install',
        scopes: ['leads.write'],
        previous_scopes: [],
        data_choice: null,
        consented_by: A.adminUserId,
      },
    ]);
  });

  it('the secret is sealed at rest and never comes back: not on the manage page, not in the list, not in the audit trail or the outbox', async () => {
    const row = (
      await rows<{ secret_enc: string; secret_hint: string }>(
        `SELECT secret_enc, secret_hint FROM marketplace_connections WHERE org_id = $1`,
        [A.orgId],
      )
    )[0]!;
    expect(row.secret_enc).not.toContain(aSecret);
    expect(row.secret_enc.startsWith('v1:')).toBe(true);
    expect(h.app.get(CryptoService).decrypt(row.secret_enc)).toBe(aSecret);
    expect(row.secret_hint).toBe(`ends in ${aSecret.slice(-4)}`);
    const texts = [
      JSON.stringify((await mp(A).get(`/installations/${aWebhook.id}`)).body),
      JSON.stringify((await mp(A).get('/installations')).body),
      JSON.stringify((await mp(A).get('/apps/webhook')).body),
      JSON.stringify((await mp(A).get(`/installations/${aWebhook.id}/events`)).body),
      JSON.stringify(await rows(`SELECT delta FROM audit_log WHERE org_id = $1`, [A.orgId])),
      JSON.stringify(await rows(`SELECT payload FROM event_outbox WHERE org_id = $1`, [A.orgId])),
    ];
    for (const t of texts) {
      expect(t).not.toContain(aSecret);
      expect(t).not.toContain(aSecret.slice(4));
    }
    expect(
      (await mp(A).get(`/installations/${aWebhook.id}`)).body.connection.inbound.secretHint,
    ).toBe(`ends in ${aSecret.slice(-4)}`);
  });
});

describe('deliveries to the webhook address', () => {
  const lead = (over: Record<string, unknown> = {}) => ({
    id: 'lead-1',
    name: 'Asha Verma',
    mobile: '98765 43210',
    email: 'ASHA@Example.com',
    requirement: 'Need a 2 BHK',
    utm_source: 'google',
    ...over,
  });
  let hook = '';
  const token = () => ({ 'x-marketplace-token': aSecret });

  it('no secret, a wrong secret and a secret for another connection are 401; an unknown address is 404; nothing reaches the pipeline', async () => {
    hook = hookPath(aWebhook.connection!.inbound!.url);
    const none = await post(hook, lead());
    expect(none.status).toBe(401);
    expect(code(none)).toBe('MKT_WEBHOOK_UNAUTHORIZED');
    expect((await post(hook, lead(), { 'x-marketplace-token': `${aSecret}x` })).status).toBe(401);
    expect((await post(hook, lead(), { authorization: `Bearer ${aSecret}` })).status).toBe(401);
    expect((await post(hook, lead(), { 'x-marketplace-signature': 'sha256=00' })).status).toBe(401);
    expect(
      (await post('/v2/public/marketplace/hooks/00000000000000000000000000000000', lead(), token()))
        .status,
    ).toBe(404);
    expect((await post('/v2/public/marketplace/hooks/not-a-key', lead(), token())).status).toBe(
      404,
    );
    expect(stub.ingested).toEqual([]);
    expect((await mp(A).get(`/installations/${aWebhook.id}`)).body.connection.counters).toEqual({
      received: 0,
      accepted: 0,
      duplicates: 0,
      failed: 0,
    });
  });

  it('a delivery with the token is mapped (aliases, phone, attribution) and handed to the pipeline; the same lead again is a duplicate and is not handed over twice', async () => {
    const res = await post(hook, lead(), token());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(marketHookResultSchema.parse(res.body)).toEqual({
      status: 'accepted',
      received: 1,
      accepted: 1,
      duplicates: 0,
      rejected: 0,
    });
    expect(stub.forOrg(A.orgId)).toHaveLength(1);
    const sent = stub.forOrg(A.orgId)[0]!;
    expect(sent.sourceId).toBe(9000);
    expect(sent.lead).toMatchObject({
      externalId: 'lead-1',
      fields: {
        name: 'Asha Verma',
        phone: '+919876543210',
        email: 'asha@example.com',
        message: 'Need a 2 BHK',
      },
      attribution: { platform: 'google' },
    });
    expect(sent.lead.raw).toMatchObject({ id: 'lead-1', requirement: 'Need a 2 BHK' });

    const repeat = await post(hook, lead(), token());
    expect(marketHookResultSchema.parse(repeat.body)).toEqual({
      status: 'duplicate',
      received: 1,
      accepted: 0,
      duplicates: 1,
      rejected: 0,
    });
    expect(stub.forOrg(A.orgId)).toHaveLength(1);
    const c = (await installOf(A, aWebhook.id)).connection!;
    expect(c.counters).toEqual({ received: 2, accepted: 1, duplicates: 1, failed: 0 });
    expect(c.lastEventAt).not.toBeNull();
    expect(c.lastSuccessAt).not.toBeNull();
    expect((await installOf(A, aWebhook.id)).health.status).toBe('healthy');
  });

  it('a body signed with the secret (HMAC SHA-256 over the exact bytes) is accepted too; a signature over other bytes is not', async () => {
    const raw = JSON.stringify(lead({ id: 'lead-sig' }));
    const sig = createHmac('sha256', aSecret).update(raw).digest('hex');
    const ok = await post(hook, raw, {
      'content-type': 'application/json',
      'x-marketplace-signature': `sha256=${sig}`,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(stub.forOrg(A.orgId).map((i) => i.lead.externalId)).toContain('lead-sig');
    const bad = await post(hook, `${raw} `, {
      'content-type': 'application/json',
      'x-marketplace-signature': `sha256=${sig}`,
    });
    expect(bad.status).toBe(401);
  });

  it('an array is several leads: the good ones go in, the ones that cannot be read are counted and reported, none are dropped silently', async () => {
    const res = await post(
      hook,
      [{ id: 'm-1', name: 'One' }, 'junk', { id: 'm-3', name: 'Three' }],
      token(),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      status: 'accepted',
      received: 3,
      accepted: 2,
      duplicates: 0,
      rejected: 1,
    });
    // Unreadable JSON never reaches the connection: the body parser answers it.
    const bad = await post(hook, 'this is not json', {
      'content-type': 'application/json',
      ...token(),
    });
    expect(bad.status).toBe(400);
    const empty = await post(hook, {}, token());
    expect(empty.status).toBe(422);
    expect(code(empty)).toBe('MKT_WEBHOOK_BAD_PAYLOAD');
    expect(empty.body.errors).toEqual([{ path: 'items.0', message: 'empty' }]);
    const big = await post(hook, { id: 'big', name: 'x'.repeat(300_000) }, token());
    expect(big.status).toBe(413);
  });

  it('when the pipeline is down the sender gets 503 and the delivery is recorded as failed; the retry of the same id is accepted and nothing is lost', async () => {
    pipelineDown(h);
    for (const id of ['f-1', 'f-2', 'f-3']) {
      const res = await post(hook, lead({ id }), token());
      expect(res.status, id).toBe(503);
      expect(code(res)).toBe('MKT_LEAD_PIPELINE_UNAVAILABLE');
    }
    const down = await installOf(A, aWebhook.id);
    // Three failures in a row move the installation to degraded, with the reason.
    expect(down.health).toMatchObject({
      status: 'degraded',
      lastError: 'MKT_LEAD_PIPELINE_UNAVAILABLE',
    });
    // failed counts what could not be taken in: these three deliveries and the two unreadable items of the earlier deliveries.
    expect(down.connection!.counters.failed).toBe(5);
    const events = marketConnectionEventListSchema.parse(
      (await mp(A).get(`/installations/${aWebhook.id}/events?limit=50`)).body,
    );
    expect(
      events.data
        .filter((e) => e.status === 'failed')
        .map((e) => e.externalId)
        .sort(),
    ).toEqual(['f-1', 'f-2', 'f-3']);
    expect(events.data.find((e) => e.externalId === 'f-1')!.error).toBe(
      'MKT_LEAD_PIPELINE_UNAVAILABLE',
    );

    const before = stub.forOrg(A.orgId).length;
    pipelineUp(h, stub);
    const retry = await post(hook, lead({ id: 'f-1' }), token());
    expect(retry.status).toBe(200);
    expect(retry.body.status).toBe('accepted');
    expect(stub.forOrg(A.orgId)).toHaveLength(before + 1);
    const healed = marketConnectionEventListSchema.parse(
      (await mp(A).get(`/installations/${aWebhook.id}/events?limit=50`)).body,
    );
    expect(healed.data.find((e) => e.externalId === 'f-1')).toMatchObject({
      status: 'accepted',
      error: null,
    });
    expect((await installOf(A, aWebhook.id)).health).toMatchObject({
      status: 'healthy',
      lastError: null,
    });
  });

  it('recent events page by cursor, newest first', async () => {
    const p1 = marketConnectionEventListSchema.parse(
      (await mp(A).get(`/installations/${aWebhook.id}/events?limit=3`)).body,
    );
    expect(p1.data).toHaveLength(3);
    expect(p1.page.hasMore).toBe(true);
    const p2 = marketConnectionEventListSchema.parse(
      (
        await mp(A).get(
          `/installations/${aWebhook.id}/events?limit=3&cursor=${encodeURIComponent(p1.page.nextCursor!)}`,
        )
      ).body,
    );
    expect(p2.data.map((e) => e.id).some((id) => p1.data.map((x) => x.id).includes(id))).toBe(
      false,
    );
    expect(new Date(p1.data[0]!.receivedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(p1.data[2]!.receivedAt).getTime(),
    );
    expect((await mp(A).get(`/installations/${aWebhook.id}/events?cursor=nope`)).status).toBe(422);
  });

  it('a connection that is over its rate limit is answered 429 (each recipe sets its own per-minute budget)', async () => {
    const res = await mp(B).post('/apps/webhook/install', { acceptedScopes: ['leads.write'] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    bWebhook = marketInstallResultSchema.parse(res.body).installation;
    bSecret = res.body.inboundSecret as string;
    const bHook = hookPath(bWebhook.connection!.inbound!.url);
    let limited = 0;
    for (let i = 0; i < 125; i++) {
      const r = await post(bHook, { id: 'same', name: 'Same' }, { 'x-marketplace-token': bSecret });
      if (r.status === 429) {
        limited += 1;
        expect(code(r)).toBe('RATE_LIMITED');
        expect(r.body.errors[0].path).toBe('retryAfterSeconds');
      } else {
        expect(r.status).toBe(200);
      }
    }
    expect(limited).toBe(5);
  });
});

describe('sample lead, test, rotate, configure, pause', () => {
  it('"send sample lead" goes through the whole path with an id of its own every time; a repeated Idempotency-Key replays the first answer and sends nothing twice', async () => {
    const before = stub.forOrg(A.orgId).length;
    const one = await mp(A).post(`/installations/${aWebhook.id}/sample`, {});
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    const parsed = marketSampleLeadResultSchema.parse(one.body);
    expect(parsed.status).toBe('accepted');
    expect(parsed.externalId).toMatch(/^sample-[0-9a-f-]{36}$/);
    const two = marketSampleLeadResultSchema.parse(
      (await mp(A).post(`/installations/${aWebhook.id}/sample`, { payloadName: 'Sample lead' }))
        .body,
    );
    expect(two.externalId).not.toBe(parsed.externalId);
    const sent = stub.forOrg(A.orgId).slice(before);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.lead).toMatchObject({
      fields: { name: 'Asha Verma', phone: '+919876543210', email: 'asha@example.com' },
    });
    expect(sent[0]!.lead.raw).toMatchObject({ sample: true });

    const key = crypto.randomUUID();
    const keyed = () =>
      request(h.app.getHttpServer())
        .post(`/v2/marketplace/installations/${aWebhook.id}/sample`)
        .set(bearer(A.admin))
        .set('Idempotency-Key', key)
        .send({});
    const first = await keyed();
    const replay = await keyed();
    expect(replay.body).toEqual(first.body);
    expect(stub.forOrg(A.orgId).slice(before)).toHaveLength(3);
    expect(
      (await mp(A).post(`/installations/${aWebhook.id}/sample`, { payloadName: 'Nope' })).status,
    ).toBe(422);
  });

  it('"test connection" runs the recipe sample through the mapping and records the health', async () => {
    const res = await mp(A).post(`/installations/${aWebhook.id}/test`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(marketTestResultSchema.parse(res.body)).toMatchObject({
      ok: true,
      code: null,
      message: null,
    });
    expect((await installOf(A, aWebhook.id)).health).toMatchObject({ status: 'healthy' });
  });

  it('configuring needs the row version; unknown credential fields are refused; the audit row names what changed, never a value', async () => {
    const cur = await installOf(A, aWebhook.id);
    const stale = await mp(A).patch(`/installations/${aWebhook.id}`, {
      rowVersion: cur.rowVersion + 9,
      config: { note: 'x' },
    });
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('ROW_VERSION_CONFLICT');
    const stray = await mp(A).patch(`/installations/${aWebhook.id}`, {
      rowVersion: cur.rowVersion,
      credentials: { apiKey: 'sk-live-should-never-be-stored' },
    });
    expect(stray.status).toBe(422);
    expect(stray.body.errors).toEqual([
      { path: 'credentials.apiKey', message: 'This app has no such field' },
    ]);
    const badKey = await mp(A).patch(`/installations/${aWebhook.id}`, {
      rowVersion: cur.rowVersion,
      config: { 'Bad Key': 1 },
    });
    expect(badKey.status).toBe(422);
    const ok = await mp(A).patch(`/installations/${aWebhook.id}`, {
      rowVersion: cur.rowVersion,
      config: { note: 'main website form' },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(marketInstallationSchema.parse(ok.body)).toMatchObject({
      config: { note: 'main website form' },
    });
    const trail = await rows<{ delta: { changed: { new: string[] } } }>(
      `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'marketplace' AND delta ? 'changed' ORDER BY id DESC LIMIT 1`,
      [A.orgId],
    );
    expect(trail[0]!.delta.changed.new).toEqual(['config']);
    expect(
      JSON.stringify(await rows(`SELECT delta FROM audit_log WHERE org_id = $1`, [A.orgId])),
    ).not.toContain('sk-live');
  });

  it('rotating the secret shows the new one once and kills the old one at once', async () => {
    const cur = await installOf(A, aWebhook.id);
    expect(
      (
        await mp(A).post(`/installations/${aWebhook.id}/rotate-secret`, {
          rowVersion: cur.rowVersion + 3,
        })
      ).status,
    ).toBe(409);
    const res = await mp(A).post(`/installations/${aWebhook.id}/rotate-secret`, {
      rowVersion: cur.rowVersion,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const out = marketInstallResultSchema.parse(res.body);
    expect(out.inboundSecret).toMatch(/^mkt_/);
    expect(out.inboundSecret).not.toBe(aSecret);
    expect(out.installation.connection!.inbound!.secretHint).toBe(
      `ends in ${out.inboundSecret!.slice(-4)}`,
    );
    expect(
      (
        await post(
          hookPath(aWebhook.connection!.inbound!.url),
          { id: 'after-rotate', name: 'X' },
          { 'x-marketplace-token': aSecret },
        )
      ).status,
    ).toBe(401);
    aSecret = out.inboundSecret!;
    expect(
      (
        await post(
          hookPath(aWebhook.connection!.inbound!.url),
          { id: 'after-rotate', name: 'X' },
          { 'x-marketplace-token': aSecret },
        )
      ).status,
    ).toBe(200);
    expect(JSON.stringify((await mp(A).get(`/installations/${aWebhook.id}`)).body)).not.toContain(
      aSecret,
    );
    // The old row version no longer saves.
    expect(
      (
        await mp(A).post(`/installations/${aWebhook.id}/rotate-secret`, {
          rowVersion: cur.rowVersion,
        })
      ).status,
    ).toBe(409);
  });

  it('pausing stops deliveries at once (409), resuming brings them back; a paused installation cannot send a sample', async () => {
    const hook = hookPath(aWebhook.connection!.inbound!.url);
    const cur = await installOf(A, aWebhook.id);
    const off = await mp(A).post(`/installations/${aWebhook.id}/disable`, {
      rowVersion: cur.rowVersion,
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body).toMatchObject({ status: 'disabled', connection: { status: 'paused' } });
    const paused = await post(
      hook,
      { id: 'while-paused', name: 'X' },
      { 'x-marketplace-token': aSecret },
    );
    expect(paused.status).toBe(409);
    expect(code(paused)).toBe('MKT_INSTALLATION_DISABLED');
    expect(code(await mp(A).post(`/installations/${aWebhook.id}/sample`, {}))).toBe(
      'MKT_INSTALLATION_DISABLED',
    );
    const on = await mp(A).post(`/installations/${aWebhook.id}/enable`, {
      rowVersion: off.body.rowVersion,
    });
    expect(on.body).toMatchObject({ status: 'active', connection: { status: 'active' } });
    expect(
      (await post(hook, { id: 'while-paused', name: 'X' }, { 'x-marketplace-token': aSecret }))
        .status,
    ).toBe(200);
  });
});

describe('a new version that asks for more permissions needs a new consent', () => {
  let aQuote: MarketInstallation;
  let bQuote: MarketInstallation;

  it('both workspaces install the mini app; a first-party mini app has no connection and no credentials', async () => {
    const a = await mp(A).post('/apps/quote-panel/install', {
      acceptedScopes: ['deals.read', 'contacts.read'],
    });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.inboundSecret).toBeNull();
    aQuote = marketInstallResultSchema.parse(a.body).installation;
    bQuote = marketInstallResultSchema.parse(
      (
        await mp(B).post('/apps/quote-panel/install', {
          acceptedScopes: ['contacts.read', 'deals.read'],
        })
      ).body,
    ).installation;
    expect(aQuote).toMatchObject({
      connection: null,
      credentials: [],
      version: '1.0.0',
      app: { kind: 'mini_app', connectorType: null },
    });
    expect(stub.ensured.filter((e) => e.providerKey === 'quote-panel')).toEqual([]);
  });

  it('publishing a version that asks for more leaves every installation on its old version and flags it; nothing moves without consent', async () => {
    const out = await publishVersion(h, tokens(), 'quote-panel', {
      manifest: miniManifest({
        version: '1.1.0',
        scopes: ['contacts.read', 'deals.read', 'contacts.write'],
      }),
      changelog: 'Quotes can now update the contact.',
    });
    expect(out).toMatchObject({
      upgraded: 0,
      awaitingConsent: 2,
      app: { publishedVersion: '1.1.0' },
    });
    const a = await installOf(A, aQuote.id);
    expect(a).toMatchObject({
      version: '1.0.0',
      needsReconsent: true,
      grantedScopes: [{ id: 'contacts.read' }, { id: 'deals.read' }],
    });
    expect(a.pendingVersion).toMatchObject({
      version: '1.1.0',
      newScopes: [{ id: 'contacts.write' }],
      scopes: [{ id: 'contacts.read' }, { id: 'deals.read' }, { id: 'contacts.write' }],
    });
    const card = marketAppListSchema.parse((await mp(A).get('/apps?q=quote')).body).data[0]!;
    expect(card).toMatchObject({ version: '1.0.0', install: { needsReconsent: true } });
    // A new installation would get the new version.
    const E1 = await mp(E).get('/apps/quote-panel');
    expect(E1.body).toMatchObject({
      version: '1.1.0',
      changelog: [
        { version: '1.1.0', notes: 'Quotes can now update the contact.' },
        { version: '1.0.0' },
      ],
    });
  });

  it('accepting needs the full new list, and the person must hold what it stands for', async () => {
    const wrong = await mp(A).post(`/installations/${aQuote.id}/consent`, {
      acceptedScopes: ['contacts.read', 'deals.read'],
    });
    expect(wrong.status).toBe(422);
    expect(code(wrong)).toBe('MKT_CONSENT_REQUIRED');
    // B's member can install but does not hold the contact update key that contacts.write stands for.
    const weak = await api.member(B, 'weakb', [['market.apps.read'], ['market.apps.install']]);
    const refused = await mp(weak.token).post(`/installations/${bQuote.id}/consent`, {
      acceptedScopes: ['contacts.read', 'contacts.write', 'deals.read'],
    });
    expect(refused.status).toBe(403);
    expect(code(refused)).toBe('MKT_SCOPE_EXCEEDS_INSTALLER');

    const ok = await mp(A).post(`/installations/${aQuote.id}/consent`, {
      acceptedScopes: ['deals.read', 'contacts.write', 'contacts.read'],
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(marketInstallationSchema.parse(ok.body)).toMatchObject({
      version: '1.1.0',
      needsReconsent: false,
      pendingVersion: null,
    });
    expect(ok.body.grantedScopes.map((s: { id: string }) => s.id).sort()).toEqual([
      'contacts.read',
      'contacts.write',
      'deals.read',
    ]);
    const ledger = await rows(
      `SELECT action, scopes, previous_scopes FROM marketplace_consents WHERE org_id = $1 AND action = 'reconsent'`,
      [A.orgId],
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ action: 'reconsent' });
    expect([...(ledger[0]!.scopes as string[])].sort()).toEqual([
      'contacts.read',
      'contacts.write',
      'deals.read',
    ]);
    expect([...(ledger[0]!.previous_scopes as string[])].sort()).toEqual([
      'contacts.read',
      'deals.read',
    ]);
    const ev = await rows<{ payload: { previousScopes: string[] } }>(
      `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = 'marketplace.app.scopes_changed'`,
      [A.orgId],
    );
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload.previousScopes).toEqual(['contacts.read', 'deals.read']);
    // Nothing is waiting any more.
    expect(
      code(
        await mp(A).post(`/installations/${aQuote.id}/consent`, {
          acceptedScopes: ['contacts.read', 'contacts.write', 'deals.read'],
        }),
      ),
    ).toBe('CONFLICT');
  });

  it('a later version that asks for no more than was granted moves the installation at once, with the narrower grant, and clears a waiting consent', async () => {
    const out = await publishVersion(h, tokens(), 'quote-panel', {
      manifest: miniManifest({ version: '1.2.0', scopes: ['contacts.read'] }),
      changelog: 'Needs less access.',
    });
    expect(out).toMatchObject({ upgraded: 2, awaitingConsent: 0 });
    for (const [t, id] of [
      [A, aQuote.id],
      [B, bQuote.id],
    ] as const) {
      const cur = await installOf(t, id);
      expect(cur, t.slug).toMatchObject({
        version: '1.2.0',
        needsReconsent: false,
        pendingVersion: null,
        grantedScopes: [{ id: 'contacts.read' }],
      });
      const audit = await rows(
        `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'marketplace' AND delta ? 'version' AND action = 'update'`,
        [t.orgId],
      );
      expect(JSON.stringify(audit)).toContain('1.2.0');
      expect(
        await rows(
          `SELECT 1 FROM event_outbox WHERE org_id = $1 AND event_type = 'marketplace.app.upgraded'`,
          [t.orgId],
        ),
      ).toHaveLength(1);
    }
  });

  it('uninstalling revokes access in the same transaction and records the data choice; the choice is announced for the domains that own the data', async () => {
    const bad = await mp(A).post(`/installations/${aQuote.id}/uninstall`, { dataChoice: 'purge' });
    expect(bad.status).toBe(422);
    expect((await mp(A).post(`/installations/${aQuote.id}/uninstall`, {})).status).toBe(422);
    const res = await mp(A).post(`/installations/${aQuote.id}/uninstall`, { dataChoice: 'delete' });
    expect(res.status).toBe(204);
    expect((await mp(A).get(`/installations/${aQuote.id}`)).status).toBe(404);
    expect((await mp(A).get('/installations?kind=mini_app')).body.data).toEqual([]);
    const ledger = await rows(
      `SELECT action, data_choice, installation_id, scopes FROM marketplace_consents WHERE org_id = $1 AND action = 'uninstall'`,
      [A.orgId],
    );
    expect(ledger).toEqual([
      {
        action: 'uninstall',
        data_choice: 'delete',
        installation_id: null,
        scopes: ['contacts.read'],
      },
    ]);
    const ev = await rows<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = 'marketplace.app.uninstalled'`,
      [A.orgId],
    );
    expect(ev[0]!.payload).toMatchObject({
      app: 'quote-panel',
      dataChoice: 'delete',
      installation: aQuote.id,
    });
    expect(
      await rows(
        `SELECT action FROM audit_log WHERE org_id = $1 AND action = 'delete' AND module = 'marketplace'`,
        [A.orgId],
      ),
    ).toHaveLength(1);
    // The place is free again, and the operator's counter followed.
    const usage = marketUsageSchema
      .parse((await ops().get('/usage')).body)
      .data.find((u) => u.slug === 'quote-panel')!;
    expect(usage.installs.total).toBe(1);
    expect(
      (await mp(A).post('/apps/quote-panel/install', { acceptedScopes: ['contacts.read'] })).status,
    ).toBe(201);
  });

  it('uninstalling a connection takes its address down at once and releases its lead source', async () => {
    const res = await mp(C).post('/apps/webhook/install', { acceptedScopes: ['leads.write'] });
    const inst = marketInstallResultSchema.parse(res.body);
    const hook = hookPath(inst.installation.connection!.inbound!.url);
    const token = { 'x-marketplace-token': inst.inboundSecret! };
    expect((await post(hook, { id: 'c-1', name: 'C' }, token)).status).toBe(200);
    expect(
      (await mp(C).post(`/installations/${inst.installation.id}/uninstall`, { dataChoice: 'keep' }))
        .status,
    ).toBe(204);
    expect((await post(hook, { id: 'c-2', name: 'C' }, token)).status).toBe(404);
    expect(stub.released).toContainEqual({ orgId: C.orgId, externalRef: inst.installation.id });
    expect(
      await rows(`SELECT 1 FROM marketplace_connections WHERE org_id = $1`, [C.orgId]),
    ).toEqual([]);
    expect(
      await rows(`SELECT 1 FROM marketplace_connection_events WHERE org_id = $1`, [C.orgId]),
    ).toEqual([]);
    expect(
      (
        await rows(
          `SELECT data_choice FROM marketplace_consents WHERE org_id = $1 AND action = 'uninstall'`,
          [C.orgId],
        )
      )[0],
    ).toEqual({ data_choice: 'keep' });
  });
});

describe('a push recipe: explicit mapping, a credential the admin pastes, sealed and write-only', () => {
  let push: MarketInstallation;
  let hook = '';
  const KEY = 'portal-secret-ABCD1234';

  it('the required credential is asked for, unknown fields are refused, and a secret field comes back only as set and its last four characters', async () => {
    const missing = await mp(D).post('/apps/acme-push/install', {
      acceptedScopes: ['leads.write'],
    });
    expect(missing.status).toBe(422);
    expect(code(missing)).toBe('MKT_CREDENTIAL_MISSING');
    expect(missing.body.errors).toEqual([{ path: 'credentials.portalKey', message: 'Required' }]);
    const stray = await mp(D).post('/apps/acme-push/install', {
      acceptedScopes: ['leads.write'],
      credentials: { portalKey: KEY, hack: 'x' },
    });
    expect(code(stray)).toBe('VALIDATION_FAILED');
    expect(
      await rows(`SELECT 1 FROM workspace_app_installations WHERE org_id = $1`, [D.orgId]),
    ).toEqual([]);
    expect(stub.ensured.filter((e) => e.orgId === D.orgId)).toEqual([]);

    const res = await mp(D).post('/apps/acme-push/install', {
      acceptedScopes: ['leads.write'],
      credentials: { portalKey: KEY, account: 'acme-7' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.inboundSecret).toBeNull();
    push = marketInstallResultSchema.parse(res.body).installation;
    expect(push.credentials).toEqual([
      { key: 'portalKey', label: 'Portal key', kind: 'secret', isSet: true, hint: 'ends in 1234' },
      { key: 'account', label: 'Account id', kind: 'text', isSet: true, hint: 'acme-7' },
    ]);
    expect(push.connection!.inbound).toMatchObject({
      auth: 'token',
      tokenHeader: 'x-acme-key',
      secretHint: null,
    });
    hook = hookPath(push.connection!.inbound!.url);

    const text = JSON.stringify([
      res.body,
      (await mp(D).get(`/installations/${push.id}`)).body,
      (await mp(D).get('/installations')).body,
    ]);
    expect(text).not.toContain('portal-secret');
    expect(text).not.toContain('ABCD');
    const stored = (
      await rows<{ credentials_enc: string; credential_hints: Record<string, string> }>(
        `SELECT credentials_enc, credential_hints FROM workspace_app_installations WHERE org_id = $1`,
        [D.orgId],
      )
    )[0]!;
    expect(stored.credentials_enc).not.toContain('portal-secret');
    expect(JSON.parse(h.app.get(CryptoService).decrypt(stored.credentials_enc))).toEqual({
      portalKey: KEY,
      account: 'acme-7',
    });
    expect(JSON.stringify(stored.credential_hints)).not.toContain('ABCD');
    expect(
      JSON.stringify(await rows(`SELECT delta FROM audit_log WHERE org_id = $1`, [D.orgId])),
    ).not.toContain('portal-secret');
    expect(
      JSON.stringify(await rows(`SELECT payload FROM event_outbox WHERE org_id = $1`, [D.orgId])),
    ).not.toContain('portal-secret');
  });

  it('the portal authenticates with the key it was given, in the recipe’s own header; the platform header is not a way in', async () => {
    const payload = {
      queries: [
        {
          query: {
            id: 'q-1',
            sender_name: 'Ravi',
            sender_mobile: '98765 43210',
            message: 'Need a quote',
            campaign: 'diwali',
          },
        },
        { query: { id: 'q-2', sender_name: 'Nameless' } },
      ],
    };
    expect((await post(hook, payload, {})).status).toBe(401);
    expect((await post(hook, payload, { 'x-acme-key': 'nope' })).status).toBe(401);
    expect((await post(hook, payload, { 'x-marketplace-token': KEY })).status).toBe(401);
    expect(stub.forOrg(D.orgId)).toEqual([]);
    const ok = await post(hook, payload, { 'x-acme-key': KEY });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toEqual({
      status: 'accepted',
      received: 2,
      accepted: 1,
      duplicates: 0,
      rejected: 1,
    });
    const sent = stub.forOrg(D.orgId);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.lead).toMatchObject({
      externalId: 'q-1',
      fields: { name: 'Ravi', phone: '+919876543210', message: 'Need a quote' },
      attribution: { platform: 'acme', campaign: 'diwali' },
    });
    expect(stub.ensured.find((e) => e.orgId === D.orgId)).toMatchObject({
      providerKey: 'acme-push',
      name: 'Acme Push',
    });
  });

  it('replacing a secret keeps the others, clearing a required one is refused, the old key stops working, and the audit trail never holds a value', async () => {
    const cur = await installOf(D, push.id);
    const cleared = await mp(D).patch(`/installations/${push.id}`, {
      rowVersion: cur.rowVersion,
      clearCredentials: ['portalKey'],
    });
    expect(cleared.status).toBe(422);
    expect(cleared.body.errors).toEqual([
      { path: 'clearCredentials.portalKey', message: 'A required field cannot be cleared' },
    ]);
    const next = 'new-portal-secret-WXYZ9876';
    const ok = await mp(D).patch(`/installations/${push.id}`, {
      rowVersion: cur.rowVersion,
      credentials: { portalKey: next },
      clearCredentials: ['account'],
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.credentials).toEqual([
      { key: 'portalKey', label: 'Portal key', kind: 'secret', isSet: true, hint: 'ends in 9876' },
      { key: 'account', label: 'Account id', kind: 'text', isSet: false, hint: null },
    ]);
    expect(ok.body.health).toMatchObject({ status: 'unknown' });
    const payload = {
      queries: [{ query: { id: 'q-9', sender_name: 'Meera', sender_mobile: '9123456780' } }],
    };
    expect((await post(hook, payload, { 'x-acme-key': KEY })).status).toBe(401);
    expect((await post(hook, payload, { 'x-acme-key': next })).status).toBe(200);
    expect(
      JSON.stringify(await rows(`SELECT delta FROM audit_log WHERE org_id = $1`, [D.orgId])),
    ).not.toContain('secret');
    expect(JSON.stringify(ok.body)).not.toContain('WXYZ');
    // The portal's key is not the platform's to rotate.
    const rotate = await mp(D).post(`/installations/${push.id}/rotate-secret`, {
      rowVersion: ok.body.rowVersion,
    });
    expect(rotate.status).toBe(409);
    expect(code(rotate)).toBe('MKT_NO_CONNECTION');
  });

  it('guessing the key is throttled per connection; the right key still works', async () => {
    let first = 0;
    let throttled = 0;
    for (let i = 0; i < 35; i++) {
      const r = await post(hook, { queries: [] }, { 'x-acme-key': `wrong-${i}` });
      if (i === 0) first = r.status;
      if (r.status === 429) throttled += 1;
    }
    expect(first).toBe(401);
    expect(throttled).toBeGreaterThan(0);
    const ok = await post(
      hook,
      { queries: [{ query: { id: 'q-10', sender_name: 'Zed', sender_mobile: '9123456781' } }] },
      { 'x-acme-key': 'new-portal-secret-WXYZ9876' },
    );
    expect(ok.status).toBe(200);
  });
});

describe('the kill switch', () => {
  it('switches off every installation of an app in one transaction: deliveries stop at once, management is refused, each workspace gets an audit row and an event', async () => {
    expect(
      marketUsageSchema
        .parse((await ops().get('/usage')).body)
        .data.find((u) => u.slug === 'webhook')!.installs.active,
    ).toBe(2);
    const killedAt = Date.now();
    const res = await ops().post('/apps/webhook/kill', {
      reason: 'Leaks leads to the wrong workspace',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      app: { status: 'killed', killReason: 'Leaks leads to the wrong workspace' },
      disabledInstallations: 2,
    });

    // Effective in the same request cycle, far inside the one-minute promise: the door reads the status on every delivery.
    for (const [hook, tokenValue] of [
      [hookPath(aWebhook.connection!.inbound!.url), aSecret],
      [hookPath(bWebhook.connection!.inbound!.url), bSecret],
    ] as const) {
      const r = await post(
        hook,
        { id: 'after-kill', name: 'X' },
        { 'x-marketplace-token': tokenValue },
      );
      expect(r.status).toBe(410);
      expect(code(r)).toBe('MKT_INSTALLATION_KILLED');
    }
    expect(Date.now() - killedAt).toBeLessThan(15_000);
    expect(stub.forOrg(A.orgId).map((i) => i.lead.externalId)).not.toContain('after-kill');

    const a = await installOf(A, aWebhook.id);
    expect(a).toMatchObject({
      status: 'killed',
      killReason: 'Leaks leads to the wrong workspace',
      connection: { status: 'disabled' },
    });
    for (const call of [
      () => mp(A).patch(`/installations/${aWebhook.id}`, { rowVersion: a.rowVersion, config: {} }),
      () => mp(A).post(`/installations/${aWebhook.id}/enable`, { rowVersion: a.rowVersion }),
      () => mp(A).post(`/installations/${aWebhook.id}/disable`, { rowVersion: a.rowVersion }),
      () => mp(A).post(`/installations/${aWebhook.id}/test`),
      () => mp(A).post(`/installations/${aWebhook.id}/sample`, {}),
      () => mp(A).post(`/installations/${aWebhook.id}/rotate-secret`, { rowVersion: a.rowVersion }),
    ]) {
      const r = await call();
      expect(r.status).toBe(409);
      expect(code(r)).toBe('MKT_INSTALLATION_KILLED');
    }

    for (const t of [A, B]) {
      const audit = await rows<{ delta: { status: { new: string }; reason: { new: string } } }>(
        `SELECT delta FROM audit_log WHERE org_id = $1 AND module = 'marketplace' AND delta ? 'reason'`,
        [t.orgId],
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]!.delta).toMatchObject({
        status: { new: 'killed' },
        reason: { new: 'Leaks leads to the wrong workspace' },
      });
      expect(
        await rows(
          `SELECT 1 FROM event_outbox WHERE org_id = $1 AND event_type = 'marketplace.app.killed'`,
          [t.orgId],
        ),
      ).toHaveLength(1);
    }
    expect(
      await rows(`SELECT 1 FROM security_events WHERE event = 'platform.market.app_killed'`),
    ).toHaveLength(1);
  });

  it('a killed app leaves the catalogue; a workspace that has it still sees it and can uninstall; a workspace that does not cannot install it', async () => {
    expect(
      marketAppListSchema
        .parse((await mp(E).get('/apps?kind=integration')).body)
        .data.map((a) => a.slug),
    ).toEqual(['acme-push']);
    expect((await mp(E).get('/apps/webhook')).status).toBe(404);
    const refused = await mp(E).post('/apps/webhook/install', { acceptedScopes: ['leads.write'] });
    expect(refused.status).toBe(404);
    expect(code(refused)).toBe('MKT_APP_NOT_FOUND');
    expect(
      marketAppListSchema
        .parse((await mp(A).get('/apps?kind=integration')).body)
        .data.map((a) => a.slug),
    ).toEqual(['acme-push']);
    const page = (await mp(A).get('/apps/webhook')).body;
    expect(page).toMatchObject({ slug: 'webhook', install: { status: 'killed' } });
    const listed = marketInstallationListSchema.parse(
      (await mp(A).get('/installations?status=killed')).body,
    );
    expect(listed.data.map((i) => i.app.slug)).toEqual(['webhook']);
    expect(
      (await mp(B).post(`/installations/${bWebhook.id}/uninstall`, { dataChoice: 'keep' })).status,
    ).toBe(204);
    const usage = marketUsageSchema
      .parse((await ops().get('/usage')).body)
      .data.find((u) => u.slug === 'webhook')!;
    expect(usage).toMatchObject({ status: 'killed', installs: { active: 0, killed: 1, total: 1 } });
  });

  it('a second kill is refused; a killed listing cannot be published until it is restored, fixed and approved again; killed installations stay off', async () => {
    expect(code(await ops().post('/apps/webhook/kill', { reason: 'Again, for the test' }))).toBe(
      'MKT_VERSION_STATE',
    );
    expect(code(await ops().post('/apps/webhook/kill', { reason: 'no' }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(code(await platformApi(h, reviewerToken).post('/apps/webhook/publish', {}))).toBe(
      'MKT_VERSION_STATE',
    );
    expect((await ops().post('/apps/webhook/unkill', {})).body.status).toBe('hidden');
    const detail = marketOperatorAppDetailSchema.parse((await ops().get('/apps/webhook')).body);
    const out = await publishVersion(h, tokens(), 'webhook', {
      manifest: { ...detail.manifest, version: '1.0.1' } as never,
      recipe: detail.recipe as never,
      changelog: 'Fixed.',
    });
    expect(out).toMatchObject({
      app: { status: 'published', publishedVersion: '1.0.1' },
      upgraded: 0,
      awaitingConsent: 0,
    });
    expect((await installOf(A, aWebhook.id)).status).toBe('killed');
    const fresh = await mp(E).post('/apps/webhook/install', { acceptedScopes: ['leads.write'] });
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(201);
    expect(fresh.body.installation.version).toBe('1.0.1');
    expect(
      (
        await post(
          hookPath(fresh.body.installation.connection.inbound.url),
          { id: 'e-1', name: 'E' },
          { 'x-marketplace-token': fresh.body.inboundSecret },
        )
      ).status,
    ).toBe(200);
  });
});

describe('the pull worker (framework): schedule, run, failure handling', () => {
  const portalItems = [
    { id: 40, name: 'Old', mobile: '9876543210' },
    { id: 43, name: 'New', mobile: '9876543211' },
    { id: 42, name: 'Nameless' },
  ];
  let fakeFetch: FetchLike;
  let connectionId = 0;
  let installationUuid = '';
  const pull = () => h.app.get(PullConnector);
  const runner = () => h.app.get(PullRunService);
  const pullInternals = () =>
    pull() as unknown as {
      fetchImpl: FetchLike;
      guard: (u: string) => Promise<void>;
      implemented: boolean;
    };
  const calls: string[] = [];

  beforeAll(async () => {
    const recipe = {
      schemaVersion: 1,
      key: 'portal-pull',
      name: 'Portal Pull',
      category: 'lead-sources',
      connector: {
        type: 'pull',
        request: {
          method: 'GET',
          baseUrl: 'https://api.portal-example.com',
          path: '/v1/enquiries',
          query: { after: '{{cursor}}' },
          headers: { 'X-Api-Key': '{{cred.apiKey}}' },
        },
        response: { itemsPath: 'data.items' },
        cursor: { from: 'id' },
        pollIntervalSeconds: 300,
      },
      authFields: [{ key: 'apiKey', label: 'API key', kind: 'secret', required: true }],
      mapping: {
        mode: 'explicit',
        externalId: { from: 'id' },
        fields: [
          { to: 'name', from: 'name', required: true },
          { to: 'phone', from: 'mobile', transform: ['phone'], required: true },
        ],
      },
      errorMapping: [
        {
          status: 401,
          code: 'bad_key',
          message: 'The API key was refused.',
          retry: false,
          health: 'needs_reauth',
        },
      ],
    };
    const manifest = {
      manifestVersion: 1,
      id: 'portal-pull',
      name: 'Portal Pull',
      kind: 'integration',
      category: 'lead-sources',
      version: '1.0.0',
      description: 'A portal polled on a schedule, for the test.',
      scopes: ['leads.write'],
      connector: { type: 'pull' },
    };
    // The type is a framework: it cannot be published until it is marked implemented. The test flips the flag for its own duration.
    const registry = h.app.get(ConnectorRegistry);
    (registry.get('pull') as unknown as { implemented: boolean }).implemented = true;
    try {
      await publishListing(h, tokens(), { manifest: manifest as never, recipe: recipe as never });
    } finally {
      (registry.get('pull') as unknown as { implemented: boolean }).implemented = false;
    }
    const res = await mp(E).post('/apps/portal-pull/install', {
      acceptedScopes: ['leads.write'],
      credentials: { apiKey: 'portal-api-key-0001' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    installationUuid = res.body.installation.id as string;
    expect(res.body.inboundSecret).toBeNull();
    expect(res.body.installation.connection).toMatchObject({
      type: 'pull',
      pollIntervalSeconds: 300,
      inbound: null,
    });
    connectionId = Number(
      (
        await rows<{ id: string }>(
          `SELECT id FROM marketplace_connections WHERE org_id = $1 AND connector_type = 'pull'`,
          [E.orgId],
        )
      )[0]!.id,
    );

    pullInternals().guard = async () => undefined;
    fakeFetch = async (url, init) => {
      calls.push(`${init.method} ${url} ${JSON.stringify(init.headers)}`);
      return { status: 200, text: async () => JSON.stringify({ data: { items: portalItems } }) };
    };
    pullInternals().fetchImpl = (u, i) => fakeFetch(u, i);
  }, 120_000);

  it('a type that is only a framework could not be published without the flag (the listing exists because the test set it)', async () => {
    expect(pullInternals().implemented).toBe(false);
    expect(h.app.get(ConnectorRegistry).isImplemented('pull')).toBe(false);
  });

  it('a new pull connection is due at once; the sweep lists it; a poll fetches with the sealed key, hands the leads to the pipeline, moves the cursor and schedules the next poll', async () => {
    const db = h.app.get(DatabaseService);
    const due = await db.privileged((tx) => h.app.get(PullStateRepository).due(tx, 50));
    expect(due).toContainEqual({ orgId: E.orgId, connectionId });

    const before = stub.forOrg(E.orgId).length;
    const out = await runner().run(E.orgId, connectionId);
    expect(out).toEqual({ status: 'ok', accepted: 2, duplicates: 0, failed: 0 });
    expect(calls[0]).toBe(
      'GET https://api.portal-example.com/v1/enquiries?after= {"X-Api-Key":"portal-api-key-0001"}',
    );
    const sent = stub.forOrg(E.orgId).slice(before);
    expect(sent.map((s) => s.lead.externalId)).toEqual(['40', '43']);
    expect(sent[0]!.lead.fields).toMatchObject({ name: 'Old', phone: '+919876543210' });
    const state = (
      await rows<{
        poll_cursor: string;
        next_poll_at: Date;
        accepted_count: string;
        received_count: string;
        failed_count: string;
        lead_source_id: string;
      }>(
        `SELECT poll_cursor, next_poll_at, accepted_count, received_count, failed_count, lead_source_id FROM marketplace_connections WHERE id = $1 AND org_id = $2`,
        [connectionId, E.orgId],
      )
    )[0]!;
    expect(state.poll_cursor).toBe('43');
    expect(state.next_poll_at.getTime() - Date.now()).toBeGreaterThan(250_000);
    expect(Number(state.accepted_count)).toBe(2);
    expect(Number(state.received_count)).toBe(3); // the nameless item is counted as received and rejected
    expect(Number(state.failed_count)).toBe(1);
    expect(Number(state.lead_source_id)).toBeGreaterThanOrEqual(9000);
    expect(
      await db.privileged((tx) => h.app.get(PullStateRepository).due(tx, 50)),
    ).not.toContainEqual({ orgId: E.orgId, connectionId });

    // The next poll resumes from the cursor and the pipeline's idempotency absorbs a repeat.
    await h.owner.query(
      `UPDATE marketplace_connections SET next_poll_at = now() - interval '1 second' WHERE id = $1`,
      [connectionId],
    );
    const again = await runner().run(E.orgId, connectionId);
    expect(again).toMatchObject({ status: 'ok', accepted: 0, duplicates: 2 });
    expect(calls[1]).toContain('?after=43');
  });

  it('a refusal by the portal that retrying cannot fix stops the connection and says why; a transient failure backs off and keeps it active', async () => {
    fakeFetch = async () => ({ status: 401, text: async () => '{"error":"bad key"}' });
    const refused = await runner().run(E.orgId, connectionId);
    expect(refused.status).toBe('failed');
    const stopped = (
      await rows<{ status: string; last_error: string }>(
        `SELECT status, last_error FROM marketplace_connections WHERE id = $1`,
        [connectionId],
      )
    )[0]!;
    expect(stopped).toEqual({ status: 'error', last_error: 'The API key was refused.' });
    expect((await installOf(E, installationUuid)).health).toMatchObject({
      status: 'needs_reauth',
      lastError: 'The API key was refused.',
    });
    // A stopped connection is not polled, and running it by hand does nothing.
    await h.owner.query(
      `UPDATE marketplace_connections SET next_poll_at = now() - interval '1 second' WHERE id = $1`,
      [connectionId],
    );
    expect(
      await h.app
        .get(DatabaseService)
        .privileged((tx) => h.app.get(PullStateRepository).due(tx, 50)),
    ).not.toContainEqual({ orgId: E.orgId, connectionId });
    expect((await runner().run(E.orgId, connectionId)).status).toBe('skipped');

    await h.owner.query(
      `UPDATE marketplace_connections SET status = 'active', consecutive_failures = 0 WHERE id = $1`,
      [connectionId],
    );
    fakeFetch = async () => ({ status: 503, text: async () => 'busy' });
    expect((await runner().run(E.orgId, connectionId)).status).toBe('failed');
    const backoff = (
      await rows<{ status: string; next_poll_at: Date; consecutive_failures: number }>(
        `SELECT status, next_poll_at, consecutive_failures FROM marketplace_connections WHERE id = $1`,
        [connectionId],
      )
    )[0]!;
    expect(backoff.status).toBe('active');
    expect(backoff.consecutive_failures).toBe(1);
    expect(backoff.next_poll_at.getTime() - Date.now()).toBeGreaterThan(250_000);
    expect((await installOf(E, installationUuid)).health.status).toBe('degraded');
  });

  it('a paused installation is not polled, and a poll that cannot reach the pipeline keeps its cursor so nothing is skipped', async () => {
    await h.owner.query(
      `UPDATE marketplace_connections SET status = 'active', consecutive_failures = 0, poll_cursor = '10' WHERE id = $1`,
      [connectionId],
    );
    fakeFetch = async () => ({
      status: 200,
      text: async () =>
        JSON.stringify({ data: { items: [{ id: 77, name: 'Late', mobile: '9876543299' }] } }),
    });
    pipelineDown(h);
    const down = await runner().run(E.orgId, connectionId);
    expect(down).toMatchObject({ status: 'retry', failed: 1 });
    expect(
      (
        await rows<{ poll_cursor: string }>(
          `SELECT poll_cursor FROM marketplace_connections WHERE id = $1`,
          [connectionId],
        )
      )[0]!.poll_cursor,
    ).toBe('10');
    pipelineUp(h, stub);
    expect(await runner().run(E.orgId, connectionId)).toMatchObject({ status: 'ok', accepted: 1 });
    expect(
      (
        await rows<{ poll_cursor: string }>(
          `SELECT poll_cursor FROM marketplace_connections WHERE id = $1`,
          [connectionId],
        )
      )[0]!.poll_cursor,
    ).toBe('77');

    const cur = await installOf(E, installationUuid);
    await mp(E).post(`/installations/${installationUuid}/disable`, { rowVersion: cur.rowVersion });
    await h.owner.query(
      `UPDATE marketplace_connections SET next_poll_at = now() - interval '1 second' WHERE id = $1`,
      [connectionId],
    );
    expect(
      await h.app
        .get(DatabaseService)
        .privileged((tx) => h.app.get(PullStateRepository).due(tx, 50)),
    ).not.toContainEqual({ orgId: E.orgId, connectionId });
    expect((await runner().run(E.orgId, connectionId)).status).toBe('skipped');
  });

  it('the worker path end to end: the sweep queues a job per due connection and the processor runs it', async () => {
    await h.owner.query(
      `UPDATE workspace_app_installations SET status = 'active', disabled_at = NULL WHERE org_id = $1`,
      [E.orgId],
    );
    await h.owner.query(
      `UPDATE marketplace_connections SET status = 'active', consecutive_failures = 0, poll_cursor = '70', next_poll_at = now() - interval '1 second' WHERE id = $1`,
      [connectionId],
    );
    fakeFetch = async () => ({
      status: 200,
      text: async () =>
        JSON.stringify({ data: { items: [{ id: 90, name: 'Queued', mobile: '9876543288' }] } }),
    });
    const queued = await h.app.get(PullSweepService).run();
    expect(queued).toBeGreaterThanOrEqual(1);
    let cursor = '';
    for (let i = 0; i < 40 && cursor !== '90'; i++) {
      await new Promise((r) => setTimeout(r, 250));
      cursor = (
        await rows<{ poll_cursor: string }>(
          `SELECT poll_cursor FROM marketplace_connections WHERE id = $1`,
          [connectionId],
        )
      )[0]!.poll_cursor;
    }
    expect(cursor).toBe('90');
    expect(stub.forOrg(E.orgId).map((i) => i.lead.externalId)).toContain('90');
    // Delivery rows past their retention are trimmed by the same worker (30 days).
    await h.owner.query(
      `UPDATE marketplace_connection_events SET received_at = now() - interval '31 days' WHERE org_id = $1 AND external_id = '90'`,
      [E.orgId],
    );
    expect(await h.app.get(PullSweepService).trim()).toBeGreaterThanOrEqual(1);
    expect(
      await rows(
        `SELECT 1 FROM marketplace_connection_events WHERE org_id = $1 AND external_id = '90'`,
        [E.orgId],
      ),
    ).toEqual([]);
  });
});

describe('against the real lead pipeline (no stub)', () => {
  it('a webhook delivery becomes a contact through the pipeline�s own ports, a repeat is a duplicate, and uninstalling releases the lead source', async () => {
    const F = await api.signup('mktF');
    const gateway = h.app.get(LeadPipelineGateway);
    // Forget the stub: the gateway looks the pipeline's ports up in the application again.
    gateway.use({ ingest: undefined, directory: undefined });
    const res = await mp(F).post('/apps/webhook/install', { acceptedScopes: ['leads.write'] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const inst = marketInstallResultSchema.parse(res.body);
    const sources = await rows<{ kind: string; provider_key: string }>(
      `SELECT kind, provider_key FROM lead_sources WHERE org_id = $1`,
      [F.orgId],
    );
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ kind: 'connector', provider_key: 'webhook' });

    const hook = hookPath(inst.installation.connection!.inbound!.url);
    const token = { 'x-marketplace-token': inst.inboundSecret! };
    const body = {
      id: 'real-1',
      name: 'Priya Shah',
      mobile: '98200 11223',
      email: 'priya@example.com',
      requirement: 'Brochure please',
      utm_source: 'google',
    };
    const first = await post(hook, body, token);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ status: 'accepted', accepted: 1 });
    const contacts = await rows<{ name: string; phone: string; email: string }>(
      `SELECT name, phone, email FROM contacts WHERE org_id = $1`,
      [F.orgId],
    );
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      name: 'Priya Shah',
      phone: '+919820011223',
      email: 'priya@example.com',
    });
    const again = await post(hook, body, token);
    expect(again.body).toMatchObject({ status: 'duplicate', duplicates: 1 });
    expect(await rows(`SELECT 1 FROM contacts WHERE org_id = $1`, [F.orgId])).toHaveLength(1);
    expect((await mp(F).post(`/installations/${inst.installation.id}/sample`, {})).status).toBe(
      200,
    );

    expect(
      (await mp(F).post(`/installations/${inst.installation.id}/uninstall`, { dataChoice: 'keep' }))
        .status,
    ).toBe(204);
    expect(await rows(`SELECT 1 FROM lead_sources WHERE org_id = $1`, [F.orgId])).toEqual([]);
    expect(await rows(`SELECT 1 FROM contacts WHERE org_id = $1`, [F.orgId])).toHaveLength(2);
    // Put the stub back for whoever runs next.
    stub.install(h);
  });
});

describe('what the operator sees afterwards', () => {
  it('usage per app reflects installations, health and the deliveries of the last day', async () => {
    const usage = marketUsageSchema.parse((await ops().get('/usage')).body);
    const webhook = usage.data.find((u) => u.slug === 'webhook')!;
    expect(webhook.events.last24h.accepted).toBeGreaterThan(5);
    // f-2 and f-3 failed while the pipeline was down and were never sent again; f-1 was retried and became accepted.
    expect(webhook.events.last24h.failed).toBe(2);
    expect(webhook.events.last24h.duplicate).toBeGreaterThanOrEqual(1);
    const push = usage.data.find((u) => u.slug === 'acme-push')!;
    expect(push.installs).toEqual({ active: 1, disabled: 0, killed: 0, total: 1 });
    expect(
      marketUsageSchema
        .parse((await ops().get('/usage')).body)
        .data.find((u) => u.slug === 'portal-pull')!.installs.total,
    ).toBe(1);
  });
});
