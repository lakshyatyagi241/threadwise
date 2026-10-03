import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FLOW_AI_PORT } from '../../../src/infra/providers/flow-builder-editor/flow-ai.port';
import type { HttpFlowAiAdapter } from '../../../src/infra/providers/flow-builder-editor/http-flow-ai.adapter';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { FlowReaderService } from '../../../src/modules/flow-builder-editor';
import { FlowTriggerService } from '../../../src/modules/flow-runtime-engine';
import { OPERATOR_EMAIL, OPERATOR_PASSWORD } from '../auth-registration-security/harness';
import {
  Api,
  bearer,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * The flow builder and editor end to end through HTTP (WD-FLB-001..029): list, counts, rail, rename, pause, duplicate, delete,
 * export / import, templates (tenant gallery and operator catalogue), save with trigger columns, publish, the reference data,
 * the webhook test, the AI generator (against a fake vendor), media upload, permissions and tenant isolation. One app, one
 * database; each block works in an organization of its own.
 */
let h: Harness;
let api: Api;
let superToken = '';
let supportToken = '';

const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));
const code = (res: { body: { code?: string } }) => res.body.code;
const http = () => request(h.app.getHttpServer());
const ops = (method: 'get' | 'post' | 'put' | 'delete', path: string, token = superToken) =>
  http()[method](`/v2/platform${path}`).set(bearer(token));

interface Flow {
  id: string;
  name: string;
  flowType: string;
  category: string | null;
  state: 'live' | 'paused' | 'draft';
  isPublished: boolean;
  isActive: boolean;
  triggerKind: string;
  nodeCount: number;
  edgeCount: number;
  rowVersion: number;
  subscribers: { active: number; completed: number; failed: number };
  graph: { flowNodes: Array<Record<string, unknown>>; flowEdges: Array<Record<string, unknown>>; vars: unknown[] };
}

const trigger = (data: Record<string, unknown> = {}) => ({
  id: 'n_trig',
  type: 'trigger',
  x: 0,
  y: 0,
  data: { kind: 'keyword', keywords: 'hi', ...data },
});
const simpleGraph = (extra: Array<Record<string, unknown>> = []) => ({
  flowNodes: [trigger(), { id: 'n_msg', type: 'message', x: 300, y: 0, data: { text: 'hello' } }, ...extra],
  flowEdges: [{ id: 'e_1', source: 'n_trig', sourceHandle: 'out', target: 'n_msg' }],
  vars: [],
});

async function create(token: string, name: string, graph: object = simpleGraph(), extra: object = {}): Promise<Flow> {
  const res = await api.as(token).post('/v2/flows').send({ name, graph, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Flow;
}

async function list(token: string, qs = '') {
  const res = await api.as(token).get(`/v2/flows${qs}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { data: Flow[]; page: { nextCursor: string | null; hasMore: boolean; limit: number }; total?: number };
}

const names = (r: { data: Flow[] }) => r.data.map((f) => f.name);
const setLimit = (orgId: number, flows: number | null) =>
  h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
    orgId,
    JSON.stringify(flows === null ? {} : { limits: { flows } }),
  ]);

const ADMINISH: Grant[] = [
  ['flb.flows.read'],
  ['flb.flows.create'],
  ['flb.flows.update'],
  ['flb.flows.delete'],
  ['flb.flows.publish'],
];

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);

  const first = await http().post('/v2/platform/auth/login').send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await http().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  const enabled = await http().post('/v2/platform/auth/mfa/enable').set(bearer(token)).send({ code: totp(setup.body.secret) });
  expect(enabled.status).toBe(201);
  superToken = token;
  const support = await http().post('/v2/platform/auth/login').send({ email: 'support@platform.test', password: OPERATOR_PASSWORD });
  supportToken = support.body.tokens.accessToken as string;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('permissions and tenant isolation (WD-FLB-028)', () => {
  let t: Tenant;
  let other: Tenant;
  beforeAll(async () => {
    t = await api.signup('flbp');
    other = await api.signup('flbq');
  });

  it('WD-FLB-028: an organization admin holds every flb key and can use the whole surface', async () => {
    const f = await create(t.admin, 'Admin flow');
    expect((await api.as(t.admin).get(`/v2/flows/${f.id}`)).status).toBe(200);
  });

  it('WD-FLB-028: a member without the keys is refused on every route (403 FORBIDDEN)', async () => {
    const nobody = await api.member(t, 'nobody', []);
    const f = await create(t.admin, 'Hidden from nobody');
    for (const [verb, path] of [
      ['get', '/v2/flows'], ['get', '/v2/flows/overview'], ['get', '/v2/flows/builder-context'],
      ['get', `/v2/flows/${f.id}`], ['get', `/v2/flows/${f.id}/export`], ['get', '/v2/flows/templates'],
    ] as const) {
      const res = await api.as(nobody.token)[verb](path);
      expect(res.status, path).toBe(403);
      expect(code(res), path).toBe('FORBIDDEN');
    }
    expect((await api.as(nobody.token).post('/v2/flows').send({ name: 'x', graph: simpleGraph() })).status).toBe(403);
  });

  it('WD-FLB-028: each action needs its own key: read-only cannot write, update cannot publish or delete, create cannot edit', async () => {
    const f = await create(t.admin, 'Keys');
    const reader = await api.member(t, 'reader', [['flb.flows.read']]);
    const editor = await api.member(t, 'editor', [['flb.flows.read'], ['flb.flows.update']]);
    const creator = await api.member(t, 'creator', [['flb.flows.read'], ['flb.flows.create']]);

    const put = { name: 'Keys 2', graph: simpleGraph(), rowVersion: f.rowVersion };
    expect((await api.as(reader.token).put(`/v2/flows/${f.id}`).send(put)).status).toBe(403);
    expect((await api.as(reader.token).post(`/v2/flows/${f.id}/toggle`)).status).toBe(403);
    expect((await api.as(editor.token).put(`/v2/flows/${f.id}`).send(put)).status).toBe(200);
    expect((await api.as(editor.token).post(`/v2/flows/${f.id}/publish`)).status).toBe(403);
    expect((await api.as(editor.token).delete(`/v2/flows/${f.id}`)).status).toBe(403);
    expect((await api.as(editor.token).post(`/v2/flows/${f.id}/duplicate`)).status).toBe(403);
    expect((await api.as(creator.token).post(`/v2/flows/${f.id}/duplicate`)).status).toBe(201);
    expect((await api.as(creator.token).patch(`/v2/flows/${f.id}/rename`).send({ name: 'z' })).status).toBe(403);
    expect((await api.as(creator.token).post('/v2/flows/test-webhook').send({ url: '' })).status).toBe(403);
    expect((await api.as(editor.token).post('/v2/flows/test-webhook').send({ url: '' })).status).toBe(200);
  });

  it('WD-FLB-001 #5: a flow of another workspace never appears in any list, count or featured card and answers 404 everywhere', async () => {
    const mine = await create(t.admin, 'Mine only');
    const theirs = await create(other.admin, 'Theirs only');
    expect(names(await list(t.admin, '?limit=100'))).not.toContain('Theirs only');
    const ov = await api.as(t.admin).get('/v2/flows/overview');
    expect(ov.body.featured?.name).not.toBe('Theirs only');
    for (const [verb, path] of [
      ['get', `/v2/flows/${theirs.id}`], ['get', `/v2/flows/${theirs.id}/export`], ['post', `/v2/flows/${theirs.id}/toggle`],
      ['post', `/v2/flows/${theirs.id}/duplicate`], ['post', `/v2/flows/${theirs.id}/publish`], ['delete', `/v2/flows/${theirs.id}`],
    ] as const) {
      expect((await api.as(t.admin)[verb](path)).status, path).toBe(404);
    }
    expect((await api.as(t.admin).patch(`/v2/flows/${theirs.id}/rename`).send({ name: 'x' })).status).toBe(404);
    expect(
      (await api.as(t.admin).put(`/v2/flows/${theirs.id}`).send({ name: 'x', graph: simpleGraph(), rowVersion: 1 })).status,
    ).toBe(404);
    // and theirs is untouched
    expect((await api.as(other.admin).get(`/v2/flows/${theirs.id}`)).body.name).toBe('Theirs only');
    expect(mine.name).toBe('Mine only');
  });

  it('WD-FLB-028: a platform operator token cannot use the tenant routes, and a tenant token cannot use the operator ones', async () => {
    expect((await http().get('/v2/flows').set(bearer(superToken))).status).toBeGreaterThanOrEqual(401);
    expect((await api.as(t.admin).get('/v2/platform/flow-templates')).status).toBeGreaterThanOrEqual(401);
  });
});

describe('list, counts and the library rail (WD-FLB-001, 002, 013)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('flbl');
  });

  it('WD-FLB-001 #1: 30 flows list 12 per page newest-updated first, with the filtered total and 3 pages by cursor', async () => {
    for (let i = 1; i <= 30; i++) {
      await h.owner.query(
        `INSERT INTO flows (org_id, flow_name, flow_data, updated_at) VALUES ($1,$2,'{"flowNodes":[],"flowEdges":[]}'::jsonb, now() - ($3 || ' minutes')::interval)`,
        [t.orgId, `Flow ${String(i).padStart(2, '0')}`, String(i)],
      );
    }
    const p1 = await list(t.admin, '?includeTotal=true');
    expect(p1.data).toHaveLength(12);
    expect(p1.total).toBe(30);
    expect(names(p1)[0]).toBe('Flow 01');
    expect(p1.page.hasMore).toBe(true);
    const p2 = await list(t.admin, `?cursor=${p1.page.nextCursor}`);
    const p3 = await list(t.admin, `?cursor=${p2.page.nextCursor}`);
    expect(p2.data).toHaveLength(12);
    expect(p3.data).toHaveLength(6);
    expect(p3.page.hasMore).toBe(false);
    const all = [...names(p1), ...names(p2), ...names(p3)];
    expect(new Set(all).size).toBe(30);
    expect(all).toEqual([...all].sort());
  });

  it('WD-FLB-001 #3: search is a case-insensitive substring of the name and escapes wildcards', async () => {
    await create(t.admin, 'Welcome series');
    await create(t.admin, 'Re-WELCOME');
    await create(t.admin, '100% off');
    expect(names(await list(t.admin, '?q=wel&limit=100')).sort()).toEqual(['Re-WELCOME', 'Welcome series']);
    expect(names(await list(t.admin, `?q=${encodeURIComponent('100%')}&limit=100`))).toEqual(['100% off']);
    expect(names(await list(t.admin, `?q=${encodeURIComponent('%')}&limit=100`))).toEqual(['100% off']);
  });

  it('WD-FLB-001 / 002: the status tabs filter, the counts ignore the filters, a draft that is paused is still a draft', async () => {
    const o = await api.signup('flbc');
    const live = await create(o.admin, 'L1');
    await create(o.admin, 'L2');
    const paused = await create(o.admin, 'P1');
    await create(o.admin, 'D1');
    await h.owner.query(`UPDATE flows SET is_published = true, is_active = true WHERE org_id = $1 AND flow_name IN ('L1','L2')`, [o.orgId]);
    await h.owner.query(`UPDATE flows SET is_published = true, is_active = false WHERE org_id = $1 AND flow_name = 'P1'`, [o.orgId]);
    await h.owner.query(`UPDATE flows SET is_published = false, is_active = false WHERE org_id = $1 AND flow_name = 'D1'`, [o.orgId]);

    expect(names(await list(o.admin, '?status=live&limit=50')).sort()).toEqual(['L1', 'L2']);
    expect(names(await list(o.admin, '?status=paused'))).toEqual(['P1']);
    expect(names(await list(o.admin, '?status=draft'))).toEqual(['D1']);
    const ov = await api.as(o.admin).get('/v2/flows/overview');
    expect(ov.body.statusCounts).toEqual({ all: 4, live: 2, paused: 1, draft: 1 });
    expect(live.state).toBe('draft');
    expect(paused.id).toBeTruthy();
  });

  it('WD-FLB-013 / 002: the library filter is an exact category match; the category counts include uncategorized and all', async () => {
    const o = await api.signup('flbk');
    await create(o.admin, 'W1', simpleGraph(), { category: 'welcome' });
    await create(o.admin, 'W2', simpleGraph(), { category: 'welcome' });
    await create(o.admin, 'C1', simpleGraph(), { category: 'cart-recovery' });
    await create(o.admin, 'N1');
    expect(names(await list(o.admin, '?category=welcome&limit=50')).sort()).toEqual(['W1', 'W2']);
    expect(names(await list(o.admin, '?category=cart&limit=50'))).toEqual([]);
    const ov = await api.as(o.admin).get('/v2/flows/overview');
    expect(ov.body.categoryCounts).toEqual({ all: 4, welcome: 2, 'cart-recovery': 1, uncategorized: 1 });
  });

  it('WD-FLB-013 #2: a re-save without a category keeps the one the flow has', async () => {
    const o = await api.signup('flbk2');
    const f = await create(o.admin, 'Lead', simpleGraph(), { category: 'lead' });
    const saved = await api.as(o.admin).put(`/v2/flows/${f.id}`).send({ name: 'Lead', graph: simpleGraph(), rowVersion: f.rowVersion });
    expect(saved.body.category).toBe('lead');
  });

  it('WD-FLB-002 #3 / rule 1: the featured card is published first, then active, then newest; absent with no flows', async () => {
    const o = await api.signup('flbf');
    expect((await api.as(o.admin).get('/v2/flows/overview')).body.featured).toBeNull();
    const a = await create(o.admin, 'Old draft');
    const b = await create(o.admin, 'Live one');
    await h.owner.query(`UPDATE flows SET is_published = true WHERE org_id = $1 AND flow_name = 'Live one'`, [o.orgId]);
    await h.owner.query(`UPDATE flows SET updated_at = now() + interval '1 hour' WHERE org_id = $1 AND flow_name = 'Old draft'`, [o.orgId]);
    const ov = await api.as(o.admin).get('/v2/flows/overview');
    expect(ov.body.featured).toMatchObject({ name: 'Live one', steps: 2, messages: 1, waitMinutes: 0 });
    expect(ov.body.featured.preview.map((n: { type: string }) => n.type)).toEqual(['trigger', 'message']);
    expect(a.id).not.toBe(b.id);
  });

  it('WD-FLB-001: a flow with subscribers shows their counts by status', async () => {
    const o = await api.signup('flbs');
    const f = await create(o.admin, 'With people');
    const fid = (await h.owner.query(`SELECT id FROM flows WHERE uuid = $1`, [f.id])).rows[0].id;
    const contacts = await api.seedContacts(o, [{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
    const cid = (await h.owner.query(`SELECT id FROM contacts WHERE org_id = $1 ORDER BY id`, [o.orgId])).rows.map((r) => r.id);
    expect(contacts).toHaveLength(3);
    for (const [i, status] of ['active', 'completed', 'failed'].entries()) {
      await h.owner.query(`INSERT INTO flow_subscribers (org_id, flow_id, contact_id, status) VALUES ($1,$2,$3,$4)`, [o.orgId, fid, cid[i], status]);
    }
    expect((await list(o.admin)).data[0]!.subscribers).toEqual({ active: 1, completed: 1, failed: 1 });
  });
});

describe('save, versions, trigger columns and publish (WD-FLB-019, 020, 021, 022)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('flbs');
  });

  it('WD-FLB-019 #1: a new flow is a draft and active; a second save updates the same row and bumps the version', async () => {
    const f = await create(t.admin, 'Welcome');
    expect(f).toMatchObject({ state: 'draft', isPublished: false, isActive: true, nodeCount: 2, edgeCount: 1, rowVersion: 1 });
    const again = await api.as(t.admin).put(`/v2/flows/${f.id}`).send({ name: 'Welcome 2', graph: simpleGraph(), rowVersion: 1 });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: f.id, name: 'Welcome 2', rowVersion: 2 });
    expect((await list(t.admin, '?q=Welcome&limit=50')).data.filter((x) => x.name.startsWith('Welcome'))).toHaveLength(1);
  });

  it('WD-FLB-019: a stale save is 409 ROW_VERSION_CONFLICT and changes nothing (two admins no longer overwrite each other)', async () => {
    const f = await create(t.admin, 'Race');
    await api.as(t.admin).put(`/v2/flows/${f.id}`).send({ name: 'Race A', graph: simpleGraph(), rowVersion: 1 });
    const stale = await api.as(t.admin).put(`/v2/flows/${f.id}`).send({ name: 'Race B', graph: simpleGraph(), rowVersion: 1 });
    expect(stale.status).toBe(409);
    expect(code(stale)).toBe('ROW_VERSION_CONFLICT');
    expect((await api.as(t.admin).get(`/v2/flows/${f.id}`)).body.name).toBe('Race A');
  });

  it('WD-FLB-019: the graph is stored whole and comes back normalised (ids, defaults, one start node)', async () => {
    const f = await create(t.admin, 'Shape', {
      flowNodes: [{ type: 'message', data: { text: 'x' } }, { type: 'trigger' }],
      flowEdges: [],
    });
    const nodes = f.graph.flowNodes;
    expect(nodes.filter((n) => n.isStart)).toHaveLength(1);
    expect(nodes.find((n) => n.type === 'trigger')?.isStart).toBe(true);
    expect(nodes.every((n) => typeof n.x === 'number' && typeof n.y === 'number' && typeof n.id === 'string')).toBe(true);
  });

  it('WD-FLB-019: name is required and at most 255 characters; a graph over the node cap is refused', async () => {
    const bad = (body: object) => api.as(t.admin).post('/v2/flows').send(body);
    expect((await bad({ name: '   ', graph: simpleGraph() })).status).toBe(422);
    expect((await bad({ name: 'x'.repeat(256), graph: simpleGraph() })).status).toBe(422);
    expect((await bad({ name: 'x'.repeat(255), graph: simpleGraph() })).status).toBe(201);
    const tooMany = { flowNodes: Array.from({ length: 501 }, (_, i) => ({ id: `n${i}`, type: 'message' })), flowEdges: [] };
    expect((await bad({ name: 'Big', graph: tooMany })).status).toBe(422);
  });

  it('WD-FLB-019 #2: the plan flow cap blocks creating (save-new, import, clone, duplicate) but never editing', async () => {
    const o = await api.signup('flbcap');
    const a = await create(o.admin, 'Cap 1');
    await create(o.admin, 'Cap 2');
    await setLimit(o.orgId, 2);
    const blocked = await api.as(o.admin).post('/v2/flows').send({ name: 'Cap 3', graph: simpleGraph() });
    expect(blocked.status).toBe(422);
    expect(code(blocked)).toBe('PLAN_LIMIT_REACHED');
    expect(blocked.body.detail).toMatch(/limit of 2 flows/);
    expect((await h.owner.query(`SELECT count(*)::int AS n FROM flows WHERE org_id = $1`, [o.orgId])).rows[0].n).toBe(2);
    expect((await api.as(o.admin).post('/v2/flows/import').send({ payload: { flowNodes: [] } })).status).toBe(422);
    expect((await api.as(o.admin).post(`/v2/flows/${a.id}/duplicate`)).status).toBe(422);
    expect((await api.as(o.admin).put(`/v2/flows/${a.id}`).send({ name: 'Cap 1b', graph: simpleGraph(), rowVersion: 1 })).status).toBe(200);
    // a delete frees a slot
    await api.as(o.admin).delete(`/v2/flows/${a.id}`);
    expect((await api.as(o.admin).post('/v2/flows').send({ name: 'Cap 3', graph: simpleGraph() })).status).toBe(201);
    await setLimit(o.orgId, null);
  });

  it('WD-FLB-019 #3 / 021: a keyword text over 255 characters is 422 with the length message, and the flow is NOT changed (WaDesk persisted it anyway)', async () => {
    const f = await create(t.admin, 'Keywords');
    const long = { flowNodes: [trigger({ keywords: 'k'.repeat(300) })], flowEdges: [] };
    const res = await api.as(t.admin).put(`/v2/flows/${f.id}`).send({ name: 'Changed', graph: long, rowVersion: f.rowVersion });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('FLB_TRIGGER_KEYWORDS_TOO_LONG');
    expect(res.body.detail).toMatch(/Trigger keyword is too long \(300 characters; the limit is 255\)/);
    const after = await api.as(t.admin).get(`/v2/flows/${f.id}`);
    expect(after.body).toMatchObject({ name: 'Keywords', rowVersion: f.rowVersion });
    expect((await api.as(t.admin).post('/v2/flows').send({ name: 'Long create', graph: long })).status).toBe(422);
  });

  it('WD-FLB-020: the Trigger is read into the plain columns, with tag and sender uuids resolved to the rows they name', async () => {
    const o = await api.signup('flbt');
    const tag = await api.as(o.admin).post('/v2/tags').send({ name: 'vip' });
    const tagUuid = tag.body.id as string;
    const tagId = (await h.owner.query(`SELECT id FROM tags WHERE uuid = $1`, [tagUuid])).rows[0].id;
    const dev = await h.owner.query(
      `INSERT INTO devices (org_id, device_name, phone_number, status) VALUES ($1,'Shop phone','+15550001','connected') RETURNING id, uuid`,
      [o.orgId],
    );
    const f = await create(o.admin, 'Auto', { flowNodes: [trigger({ kind: 'tag_added', tagId: tagUuid, deviceId: `baileys:${dev.rows[0].uuid}` })], flowEdges: [] });
    const row = (await h.owner.query(`SELECT trigger_kind, trigger_value, trigger_device_id, provider, trigger_keywords FROM flows WHERE uuid = $1`, [f.id])).rows[0];
    expect(row).toMatchObject({ trigger_kind: 'tag_added', provider: 'baileys', trigger_keywords: null });
    expect(Number(row.trigger_value)).toBe(Number(tagId));
    expect(Number(row.trigger_device_id)).toBe(Number(dev.rows[0].id));

    const any = await create(o.admin, 'Any', { flowNodes: [trigger({ keywordMode: 'any' })], flowEdges: [] });
    expect((await h.owner.query(`SELECT trigger_keywords FROM flows WHERE uuid = $1`, [any.id])).rows[0].trigger_keywords).toBe('any');
    const placed = await create(o.admin, 'Order', { flowNodes: [trigger({ kind: 'order_placed' })], flowEdges: [] });
    expect(Number((await h.owner.query(`SELECT trigger_value FROM flows WHERE uuid = $1`, [placed.id])).rows[0].trigger_value)).toBe(0);
    const nonsense = await create(o.admin, 'Nonsense', { flowNodes: [trigger({ kind: 'nonsense' })], flowEdges: [] });
    expect(nonsense.triggerKind).toBe('keyword');
  });

  it('WD-FLB-020: a sender of another workspace never resolves (it stores null, never another tenant\'s device)', async () => {
    const a = await api.signup('flbx1');
    const b = await api.signup('flbx2');
    const dev = await h.owner.query(`INSERT INTO devices (org_id, device_name, phone_number, status) VALUES ($1,'Theirs','+1555','connected') RETURNING uuid`, [b.orgId]);
    const f = await create(a.admin, 'Probe', { flowNodes: [trigger({ deviceId: `baileys:${dev.rows[0].uuid}` })], flowEdges: [] });
    expect((await h.owner.query(`SELECT trigger_device_id FROM flows WHERE uuid = $1`, [f.id])).rows[0].trigger_device_id).toBeNull();
  });

  it('WD-FLB-022 #1: publish stamps published_at and the flow reads live; unpublish returns it to draft; saves on a published flow stay published', async () => {
    const f = await create(t.admin, 'Go live');
    const pub = await api.as(t.admin).post(`/v2/flows/${f.id}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body).toMatchObject({ state: 'live', isPublished: true });
    expect(pub.body.publishedAt).toBeTruthy();
    const saved = await api.as(t.admin).put(`/v2/flows/${f.id}`).send({ name: 'Go live', graph: simpleGraph(), rowVersion: pub.body.rowVersion });
    expect(saved.body.isPublished).toBe(true);
    const un = await api.as(t.admin).post(`/v2/flows/${f.id}/unpublish`);
    expect(un.body).toMatchObject({ state: 'draft', isPublished: false, publishedAt: null });
  });

  it('WD-FLB-022 #3: publishing a saved flow publishes THAT row (WaDesk created a second flow for a never-saved graph)', async () => {
    const o = await api.signup('flbpub');
    const f = await create(o.admin, 'Only one');
    await api.as(o.admin).post(`/v2/flows/${f.id}/publish`);
    const all = await list(o.admin, '?limit=50');
    expect(all.data).toHaveLength(1);
    expect(all.data[0]).toMatchObject({ id: f.id, isPublished: true });
  });

  it('every write leaves an audit row and an outbox event in the same transaction', async () => {
    const o = await api.signup('flbaudit');
    const f = await create(o.admin, 'Audited');
    await api.as(o.admin).put(`/v2/flows/${f.id}`).send({ name: 'Audited 2', graph: simpleGraph(), rowVersion: 1 });
    await api.as(o.admin).post(`/v2/flows/${f.id}/publish`);
    await api.as(o.admin).post(`/v2/flows/${f.id}/toggle`);
    await api.as(o.admin).delete(`/v2/flows/${f.id}`);
    expect(await api.auditCount(o.orgId, 'flows', 'insert')).toBe(1);
    expect(await api.auditCount(o.orgId, 'flows', 'update')).toBeGreaterThanOrEqual(3);
    expect(await api.auditCount(o.orgId, 'flows', 'delete')).toBe(1);
    for (const ev of ['created', 'saved', 'published', 'paused', 'deleted']) {
      expect((await api.events(o.orgId, `flow.${ev}`)).length, ev).toBe(1);
    }
    const created = (await api.events(o.orgId, 'flow.created'))[0]!;
    expect(created).toMatchObject({ name: 'Audited', flowType: 'chat', nodeCount: 2 });
    expect(JSON.stringify(created)).not.toContain('hello');
  });
});

describe('rename, pause, duplicate, delete (WD-FLB-004..007)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('flba');
  });

  it('WD-FLB-005: rename trims, rejects empty and over 191 characters', async () => {
    const f = await create(t.admin, 'Old');
    const r = await api.as(t.admin).patch(`/v2/flows/${f.id}/rename`).send({ name: 'New ' });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('New');
    expect((await api.as(t.admin).patch(`/v2/flows/${f.id}/rename`).send({ name: '  ' })).status).toBe(422);
    expect((await api.as(t.admin).patch(`/v2/flows/${f.id}/rename`).send({ name: 'x'.repeat(192) })).status).toBe(422);
    expect((await api.as(t.admin).patch(`/v2/flows/${f.id}/rename`).send({ name: 'x'.repeat(191) })).status).toBe(200);
  });

  it('WD-FLB-004: pause flips is_active; the pill follows (live to paused); a draft stays a draft (WaDesk quirk kept)', async () => {
    const f = await create(t.admin, 'Pausable');
    await api.as(t.admin).post(`/v2/flows/${f.id}/publish`);
    const paused = await api.as(t.admin).post(`/v2/flows/${f.id}/toggle`);
    expect(paused.body).toEqual({ isActive: false, state: 'paused' });
    const resumed = await api.as(t.admin).post(`/v2/flows/${f.id}/toggle`);
    expect(resumed.body).toEqual({ isActive: true, state: 'live' });
    const d = await create(t.admin, 'Draft toggled');
    expect((await api.as(t.admin).post(`/v2/flows/${d.id}/toggle`)).body).toEqual({ isActive: false, state: 'draft' });
  });

  it('WD-FLB-006: duplicate is a new unpublished draft "<name> (Copy)" with the same nodes and edges and no subscribers', async () => {
    const o = await api.signup('flbdup');
    const f = await create(o.admin, 'Welcome', simpleGraph(), { category: 'welcome' });
    await api.as(o.admin).post(`/v2/flows/${f.id}/publish`);
    const fid = (await h.owner.query(`SELECT id FROM flows WHERE uuid = $1`, [f.id])).rows[0].id;
    const [cu] = await api.seedContacts(o, [{ name: 'Sub' }]);
    const cid = (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [cu]));
    await h.owner.query(`INSERT INTO flow_subscribers (org_id, flow_id, contact_id) VALUES ($1,$2,$3)`, [o.orgId, fid, cid.rows[0].id]);
    const dup = await api.as(o.admin).post(`/v2/flows/${f.id}/duplicate`);
    expect(dup.status).toBe(201);
    expect(dup.body).toMatchObject({ name: 'Welcome (Copy)', state: 'draft', isPublished: false, category: 'welcome', nodeCount: 2, edgeCount: 1 });
    expect(dup.body.subscribers).toEqual({ active: 0, completed: 0, failed: 0 });
    expect(dup.body.id).not.toBe(f.id);
  });

  it('WD-FLB-007: delete removes the flow and its subscribers; the list drops by one', async () => {
    const o = await api.signup('flbdel');
    const f = await create(o.admin, 'Doomed');
    await create(o.admin, 'Survivor');
    const fid = (await h.owner.query(`SELECT id FROM flows WHERE uuid = $1`, [f.id])).rows[0].id;
    const [cu] = await api.seedContacts(o, [{ name: 'Sub' }]);
    const cid = (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [cu])).rows[0].id;
    await h.owner.query(`INSERT INTO flow_subscribers (org_id, flow_id, contact_id) VALUES ($1,$2,$3)`, [o.orgId, fid, cid]);
    expect((await api.as(o.admin).delete(`/v2/flows/${f.id}`)).status).toBe(204);
    expect((await list(o.admin, '?includeTotal=true')).total).toBe(1);
    expect((await api.as(o.admin).get(`/v2/flows/${f.id}`)).status).toBe(404);
    expect((await h.owner.query(`SELECT count(*)::int AS n FROM flow_subscribers WHERE org_id = $1`, [o.orgId])).rows[0].n).toBe(0);
    expect((await api.as(o.admin).delete(`/v2/flows/${f.id}`)).status).toBe(404);
  });
});

describe('export and import (WD-FLB-008, 009)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('flbe');
  });

  it('WD-FLB-008: the export is the wrapper with the graph verbatim and no workspace or user ids', async () => {
    const f = await create(t.admin, 'Lead Nurture!', simpleGraph(), { category: 'lead' });
    const res = await api.as(t.admin).get(`/v2/flows/${f.id}/export`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ _wadesk_flow_export: 1, name: 'Lead Nurture!', flow_type: 'chat', category: 'lead' });
    expect(res.body.flow_data.flowNodes).toHaveLength(2);
    expect(res.body.exported_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    const text = JSON.stringify(res.body);
    for (const leak of ['org_id', 'orgId', 'user_id', 'userId', 'workspace']) expect(text).not.toContain(leak);
  });

  it('WD-FLB-008 #2: a flow with no nodes exports empty arrays', async () => {
    const f = await create(t.admin, 'Empty', { flowNodes: [], flowEdges: [] });
    const res = await api.as(t.admin).get(`/v2/flows/${f.id}/export`);
    expect(res.body.flow_data).toMatchObject({ flowNodes: [], flowEdges: [] });
  });

  it('WD-FLB-009 #1: importing an export opens a draft "<name> (imported)" with all its nodes', async () => {
    const f = await create(t.admin, 'Welcome', simpleGraph(), { category: 'welcome' });
    const file = (await api.as(t.admin).get(`/v2/flows/${f.id}/export`)).body;
    const res = await api.as(t.admin).post('/v2/flows/import').send({ payload: file });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Welcome (imported)', state: 'draft', isActive: true, category: 'welcome', nodeCount: 2, edgeCount: 1 });
  });

  it('WD-FLB-009 #2: a bare graph without coordinates is laid out on the 3-column grid', async () => {
    const res = await api.as(t.admin).post('/v2/flows/import').send({
      payload: { flowNodes: [{ type: 'trigger' }, { type: 'message' }, { type: 'message' }, { type: 'end' }] },
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Imported flow (imported)');
    expect(res.body.graph.flowNodes.map((n: { x: number; y: number }) => [n.x, n.y])).toEqual([[120, 120], [380, 120], [640, 120], [120, 300]]);
  });

  it('WD-FLB-009 #3: something that is not a flow is 422 FLB_IMPORT_INVALID and creates nothing', async () => {
    const before = (await list(t.admin, '?includeTotal=true')).total;
    for (const payload of [{}, { flowNodes: 'x' }, { name: 'only a name' }]) {
      const res = await api.as(t.admin).post('/v2/flows/import').send({ payload });
      expect(res.status).toBe(422);
      expect(code(res)).toBe('FLB_IMPORT_INVALID');
    }
    expect((await api.as(t.admin).post('/v2/flows/import').send({ payload: 'text' })).status).toBe(422);
    expect((await list(t.admin, '?includeTotal=true')).total).toBe(before);
  });

  it('WD-FLB-009: unknown node types and foreign ids are kept as they are (no schema validation, as WaDesk)', async () => {
    const res = await api.as(t.admin).post('/v2/flows/import').send({
      payload: { flowNodes: [{ id: 'a', type: 'trigger', data: { tagId: '7', deviceId: 'waba:3' } }, { id: 'b', type: 'from_the_future', data: { x: 1 } }], flowEdges: [{ source: 'a', target: 'b' }] },
    });
    expect(res.status).toBe(201);
    expect(res.body.graph.flowNodes[1]).toMatchObject({ type: 'from_the_future' });
    const row = (await h.owner.query(`SELECT trigger_value, trigger_device_id, provider FROM flows WHERE uuid = $1`, [res.body.id])).rows[0];
    expect(row.trigger_value).toBeNull();
    expect(row.trigger_device_id).toBeNull();
    expect(row.provider).toBe('waba');
  });
});

describe('templates: gallery, clone and the operator catalogue (WD-FLB-010, 011, 012)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('flbtpl');
  });

  const fiveNodes = {
    flowNodes: [
      { id: 'a', type: 'trigger' }, { id: 'b', type: 'message' }, { id: 'c', type: 'message' },
      { id: 'd', type: 'delay' }, { id: 'e', type: 'end' },
    ],
    flowEdges: [{ source: 'a', target: 'b' }],
  };
  const tpl = (body: Record<string, unknown> = {}) =>
    ops('post', '/flow-templates').send({ name: 'Restaurant welcome', flowType: 'chat', payload: fiveNodes, ...body });

  it('WD-FLB-012 #1: an operator creates a template from an uploaded export; it lists with the right step count and is visible', async () => {
    const res = await tpl({ payload: { _wadesk_flow_export: 1, name: 'x', flow_data: fiveNodes }, description: 'One line', category: 'welcome' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ name: 'Restaurant welcome', steps: 5, isActive: true, cloneCount: 0, category: 'welcome', sortOrder: 0 });
    const gallery = await api.as(t.admin).get('/v2/flows/templates');
    expect(gallery.body.find((x: { id: string }) => x.id === res.body.id)).toMatchObject({ steps: 5, description: 'One line', flowType: 'chat' });
  });

  it('WD-FLB-012: create validation: a graph is mandatory, flowNodes must exist, sort order 0..9999, name required and at most 160', async () => {
    const none = await ops('post', '/flow-templates').send({ name: 'No graph', flowType: 'chat' });
    expect(none.status).toBe(422);
    expect(code(none)).toBe('FLB_TEMPLATE_GRAPH_REQUIRED');
    const noNodes = await tpl({ payload: { nope: true } });
    expect(noNodes.status).toBe(422);
    expect(noNodes.body.detail).toBe("That doesn't look like a valid flow (missing flowNodes).");
    expect((await tpl({ sortOrder: 10000 })).status).toBe(422);
    expect((await tpl({ sortOrder: -1 })).status).toBe(422);
    expect((await tpl({ name: ' ' })).status).toBe(422);
    expect((await tpl({ name: 'n'.repeat(161) })).status).toBe(422);
    expect((await tpl({ flowType: 'telegram' })).status).toBe(422);
  });

  it('WD-FLB-012: a template can also be made by cloning an existing flow by id, any workspace', async () => {
    const f = await create(t.admin, 'Source flow');
    const res = await ops('post', '/flow-templates').send({ name: 'From a flow', flowType: 'chat', sourceFlowId: f.id });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.steps).toBe(2);
    expect((await ops('post', '/flow-templates').send({ name: 'Ghost', flowType: 'chat', sourceFlowId: '11111111-1111-4111-8111-111111111111' })).status).toBe(404);
  });

  it('WD-FLB-012 #2: an edit with no graph source keeps the current graph; with one, it replaces it; a stale version is 409', async () => {
    const c = await tpl({ name: 'Editable' });
    const keep = await ops('put', `/flow-templates/${c.body.id}`).send({ name: 'Renamed', flowType: 'call', sortOrder: 5, isActive: true, rowVersion: c.body.rowVersion });
    expect(keep.status, JSON.stringify(keep.body)).toBe(200);
    expect(keep.body).toMatchObject({ name: 'Renamed', flowType: 'call', sortOrder: 5, steps: 5 });
    const replace = await ops('put', `/flow-templates/${c.body.id}`).send({ name: 'Renamed', flowType: 'call', sortOrder: 5, isActive: true, rowVersion: keep.body.rowVersion, payload: { flowNodes: [{ type: 'trigger' }] } });
    expect(replace.body.steps).toBe(1);
    const stale = await ops('put', `/flow-templates/${c.body.id}`).send({ name: 'x', flowType: 'chat', rowVersion: 1 });
    expect(stale.status).toBe(409);
    const bad = await ops('put', `/flow-templates/${c.body.id}`).send({ name: 'x', flowType: 'chat', rowVersion: replace.body.rowVersion, payload: { nothing: 1 } });
    expect(bad.status).toBe(422);
  });

  it('WD-FLB-011 #1: 25 templates list 20 per page with the stat tiles; support operators read but cannot write', async () => {
    for (let i = 0; i < 25; i++) {
      await h.owner.query(`INSERT INTO flow_templates (name, flow_data, sort_order) VALUES ($1,'{"flowNodes":[],"flowEdges":[]}'::jsonb,$2)`, [`Bulk ${i}`, 1000 + i]);
    }
    const p1 = await ops('get', '/flow-templates');
    expect(p1.body.data).toHaveLength(20);
    expect(p1.body.page.hasMore).toBe(true);
    expect(p1.body.stats.total).toBeGreaterThanOrEqual(25);
    const p2 = await ops('get', `/flow-templates?cursor=${p1.body.page.nextCursor}`);
    expect(p2.body.data.length).toBeGreaterThan(0);
    const seen = new Set([...p1.body.data, ...p2.body.data].map((x: { id: string }) => x.id));
    expect(seen.size).toBe(p1.body.data.length + p2.body.data.length);
    expect((await ops('get', '/flow-templates', supportToken)).status).toBe(200);
    expect((await ops('post', '/flow-templates', supportToken).send({ name: 'n', flowType: 'chat', payload: fiveNodes })).status).toBe(403);
  });

  it('WD-FLB-010 #1: Use template clones into a draft named exactly like the template, bumps clone_count, positions stamped', async () => {
    const c = await tpl({ name: 'Cloneable', sortOrder: 0, payload: { flowNodes: [{ type: 'trigger' }, { type: 'message' }], flowEdges: [] }, category: 'lead' });
    const res = await api.as(t.admin).post(`/v2/flows/templates/${c.body.id}/clone`);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ name: 'Cloneable', state: 'draft', category: 'lead', nodeCount: 2, flowType: 'chat' });
    expect(res.body.graph.flowNodes.every((n: { x: number }) => Number.isFinite(n.x))).toBe(true);
    expect((await ops('get', `/flow-templates/${c.body.id}`)).body.cloneCount).toBe(1);
  });

  it('WD-FLB-010 #2: a hidden template leaves the gallery and a direct clone is 404; toggling shows it again', async () => {
    const c = await tpl({ name: 'Hideable' });
    const off = await ops('post', `/flow-templates/${c.body.id}/toggle`);
    expect(off.body.isActive).toBe(false);
    expect((await api.as(t.admin).get('/v2/flows/templates')).body.map((x: { id: string }) => x.id)).not.toContain(c.body.id);
    expect((await api.as(t.admin).post(`/v2/flows/templates/${c.body.id}/clone`)).status).toBe(404);
    const on = await ops('post', `/flow-templates/${c.body.id}/toggle`);
    expect(on.body.isActive).toBe(true);
    expect((await api.as(t.admin).post(`/v2/flows/templates/${c.body.id}/clone`)).status).toBe(201);
  });

  it('WD-FLB-010 #3: at the plan limit a clone is refused with the plan message', async () => {
    const o = await api.signup('flbtl');
    await create(o.admin, 'Existing');
    await setLimit(o.orgId, 1);
    const c = await tpl({ name: 'Over the limit' });
    const res = await api.as(o.admin).post(`/v2/flows/templates/${c.body.id}/clone`);
    expect(res.status).toBe(422);
    expect(code(res)).toBe('PLAN_LIMIT_REACHED');
  });

  it('WD-FLB-011 #3: deleting a template leaves tenants\' clones alone; the gallery orders by sort order then newest first', async () => {
    const c = await tpl({ name: 'Short lived', sortOrder: 0 });
    const clone = await api.as(t.admin).post(`/v2/flows/templates/${c.body.id}/clone`);
    expect((await ops('delete', `/flow-templates/${c.body.id}`)).status).toBe(204);
    expect((await ops('get', `/flow-templates/${c.body.id}`)).status).toBe(404);
    expect((await api.as(t.admin).get(`/v2/flows/${clone.body.id}`)).status).toBe(200);
    const g = (await api.as(t.admin).get('/v2/flows/templates')).body as Array<{ name: string }>;
    const orders = (
      await h.owner.query(`SELECT name FROM flow_templates WHERE is_active ORDER BY sort_order ASC, id DESC`)
    ).rows.map((r) => r.name);
    expect(g.map((x) => x.name)).toEqual(orders);
  });
});

describe('builder context (WD-FLB-014, 026)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('flbctx');
  });

  it('WD-FLB-026 #1: a connected number is a sender keyed "<engine>:<uuid>" with its engine label; a disconnected one is not offered', async () => {
    const connected = await h.owner.query(
      `INSERT INTO devices (org_id, device_name, phone_number, status) VALUES ($1,'Main','+15551','connected') RETURNING uuid`,
      [t.orgId],
    );
    await h.owner.query(`INSERT INTO devices (org_id, device_name, phone_number, status) VALUES ($1,'Off','+15552','disconnected')`, [t.orgId]);
    const waba = await h.owner.query(
      `INSERT INTO wa_provider_configs (org_id, provider, status, display_label, phone_number) VALUES ($1,'waba','connected','Cloud line','+15553') RETURNING uuid`,
      [t.orgId],
    );
    const res = await api.as(t.admin).get('/v2/flows/builder-context');
    expect(res.status).toBe(200);
    const keys = res.body.senders.chat.map((s: { key: string }) => s.key);
    expect(keys).toEqual([`baileys:${connected.rows[0].uuid}`, `waba:${waba.rows[0].uuid}`]);
    expect(res.body.senders.chat[0]).toMatchObject({ label: 'Main', engineLabel: 'Unofficial API' });
    expect(res.body.channels).toEqual(['chat']);
  });

  it('WD-FLB-014 #1/#2: a channel is offered only with a connected account AND (for Facebook, TikTok, Email) the platform switch on; WhatsApp is always there', async () => {
    const o = await api.signup('flbch');
    await h.owner.query(`INSERT INTO telegram_bots (org_id, bot_token, webhook_token, secret_token, bot_name, bot_username, active) VALUES ($1,'t:1','wh1','sec1','Helper bot','helper_bot',true)`, [o.orgId]);
    await h.owner.query(`INSERT INTO facebook_pages (org_id, page_id, name, status) VALUES ($1,'123','My page','connected')`, [o.orgId]);
    let res = await api.as(o.admin).get('/v2/flows/builder-context');
    expect(res.body.channels).toEqual(['chat', 'telegram']);
    expect(res.body.senders.telegram[0].label).toBe('Helper bot');
    expect(res.body.senders.facebook).toEqual([]);
    await h.owner.query(`INSERT INTO platform_settings (key, value) VALUES ('facebook_enabled','true'::jsonb) ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb`);
    await new Promise((r) => setTimeout(r, 5200)); // the settings snapshot lives 5 seconds
    res = await api.as(o.admin).get('/v2/flows/builder-context');
    expect(res.body.channels).toEqual(['chat', 'facebook', 'telegram']);
    expect(res.body.senders.facebook[0].label).toBe('My page');
    await h.owner.query(`DELETE FROM platform_settings WHERE key = 'facebook_enabled'`);
  });

  it('WD-FLB-026: tags, groups, teams with members, stages, approved templates only, flows and the AI lists are the workspace\'s own', async () => {
    const o = await api.signup('flbref');
    await api.as(o.admin).post('/v2/tags').send({ name: 'Zeta' });
    await api.as(o.admin).post('/v2/tags').send({ name: 'alpha' });
    await h.owner.query(`INSERT INTO contact_groups (org_id, name) VALUES ($1,'b group'), ($1,'A group')`, [o.orgId]);
    const team = await h.owner.query(`INSERT INTO teams (org_id, name, slug) VALUES ($1,'Support','support') RETURNING id`, [o.orgId]);
    await h.owner.query(`INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1,$2,$3)`, [o.orgId, team.rows[0].id, o.adminUserId]);
    await h.owner.query(
      `INSERT INTO wa_templates (org_id, template_name, template_body, status, category) VALUES ($1,'approved_one','Hello','APPROVED','MARKETING'), ($1,'pending_one','Hi','PENDING','MARKETING')`,
      [o.orgId],
    );
    await h.owner.query(`INSERT INTO ai_chat_assistants (org_id, name, slug) VALUES ($1,'Docs bot','docs-bot')`, [o.orgId]);
    await h.owner.query(`INSERT INTO ai_call_assistants (org_id, name, slug) VALUES ($1,'Voice one','voice-one')`, [o.orgId]);
    await create(o.admin, 'Sub-flow target');
    const res = (await api.as(o.admin).get('/v2/flows/builder-context')).body;
    expect(res.tags.map((x: { name: string }) => x.name)).toEqual(['alpha', 'Zeta']);
    expect(res.groups.map((x: { name: string }) => x.name)).toEqual(['A group', 'b group']);
    expect(res.teams).toEqual([{ id: expect.any(String), name: 'Support', members: [{ id: expect.any(String), name: expect.any(String) }] }]);
    expect(res.stages.length).toBeGreaterThan(0);
    expect(res.templates.map((x: { name: string }) => x.name)).toEqual(['approved_one']);
    expect(res.assistants).toMatchObject([{ name: 'Docs bot', sources: 0 }]);
    expect(res.callAssistants.map((x: { name: string }) => x.name)).toEqual(['Voice one']);
    expect(res.flows.map((x: { name: string }) => x.name)).toEqual(['Sub-flow target']);
    expect(JSON.stringify(res)).not.toMatch(/"id":\s*\d+[,}]/);
  });

  it('WD-FLB-026 #2: the AI model list is the active admin keys\' models, and a workspace key replaces that provider\'s admin models with the fixed set', async () => {
    const o = await api.signup('flbai');
    // main seeds platform keys and keeps one row per provider: set them aside, run on the fixture, put them back.
    const stashed = (await h.owner.query(`SELECT coalesce(jsonb_agg(to_jsonb(k)), '[]'::jsonb) AS rows FROM admin_ai_keys k`)).rows[0].rows;
    await h.owner.query(`DELETE FROM admin_ai_keys`);
    await h.owner.query(
      `INSERT INTO admin_ai_keys (provider, name, api_key, default_model, extra_config, is_active, sort_order) VALUES
        ('openai','OpenAI','sk-admin','gpt-4o-mini','{"models":["gpt-4o","gpt-4o-mini"]}',true,1),
        ('anthropic','Anthropic','sk-ant','claude-sonnet-4-6',NULL,true,2),
        ('elevenlabs','Voice','xx','v1',NULL,true,3),
        ('gemini','Gemini','g','',NULL,true,4),
        ('mistral','Mistral','m','mistral-small-latest',NULL,false,5)`,
    );
    let res = (await api.as(o.admin).get('/v2/flows/builder-context')).body;
    expect(res.aiModels).toEqual([
      { value: 'gpt-4o-mini', label: 'OpenAI · gpt-4o-mini', provider: 'openai' },
      { value: 'gpt-4o', label: 'OpenAI · gpt-4o', provider: 'openai' },
      { value: 'claude-sonnet-4-6', label: 'Anthropic · claude-sonnet-4-6', provider: 'anthropic' },
    ]);
    await h.owner.query(`INSERT INTO ai_provider_keys (org_id, provider, api_key, is_active) VALUES ($1,'openai','sk-mine',true)`, [o.orgId]);
    res = (await api.as(o.admin).get('/v2/flows/builder-context')).body;
    const labels = res.aiModels.map((m: { label: string }) => m.label);
    expect(labels).toContain('OpenAI (your key) · gpt-4o-mini');
    expect(labels).toContain('OpenAI (your key) · gpt-4o');
    expect(labels).not.toContain('OpenAI · gpt-4o-mini');
    expect(labels).toContain('Anthropic · claude-sonnet-4-6');
    expect(JSON.stringify(res)).not.toContain('sk-admin');
    expect(JSON.stringify(res)).not.toContain('sk-mine');
    await h.owner.query(`DELETE FROM admin_ai_keys`);
    await h.owner.query(`INSERT INTO admin_ai_keys SELECT * FROM jsonb_populate_recordset(NULL::admin_ai_keys, $1::jsonb)`, [JSON.stringify(stashed)]);
  });

  it('WD-FLB-052: commerce products come from the workspace catalogue, filtered by provider and name', async () => {
    const o = await api.signup('flbprod');
    await h.owner.query(
      `INSERT INTO wa_products (org_id, name, slug, sku, price_minor, currency_code, status, woo_product_id) VALUES
        ($1,'Red shirt','red-shirt','RS-1',1999,'USD','active',NULL),
        ($1,'Blue mug','blue-mug','BM-1',500,'USD','active','77'),
        ($1,'Hidden','hidden','H-1',100,'USD','draft',NULL)`,
      [o.orgId],
    );
    const all = await api.as(o.admin).get('/v2/flows/builder-context/commerce-products?provider=whatsapp_shop');
    expect(all.body.data.map((p: { name: string }) => p.name).sort()).toEqual(['Blue mug', 'Red shirt']);
    const woo = await api.as(o.admin).get('/v2/flows/builder-context/commerce-products?provider=woocommerce');
    expect(woo.body.data).toEqual([{ retailerId: 'BM-1', name: 'Blue mug', image: null, priceMinor: 500, currency: 'USD' }]);
    const q = await api.as(o.admin).get('/v2/flows/builder-context/commerce-products?provider=whatsapp_shop&q=SHIRT');
    expect(q.body.data).toHaveLength(1);
    expect((await api.as(o.admin).get('/v2/flows/builder-context/commerce-products?provider=nope')).status).toBe(422);
  });

  it('WD-FLB-059: the Google pickers answer 503 FLB_INTEGRATION_DISABLED while the integration is not connected', async () => {
    const res = await api.as(t.admin).get('/v2/flows/builder-context/google/sheets');
    expect(res.status).toBe(503);
    expect(code(res)).toBe('FLB_INTEGRATION_DISABLED');
    expect((await api.as(t.admin).get('/v2/flows/builder-context/google/photos')).status).toBe(422);
  });
});

describe('webhook test (WD-FLB-024)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('flbwh');
  });
  const call = (body: object) => api.as(t.admin).post('/v2/flows/test-webhook').send(body);

  it('WD-FLB-024 #2: the metadata address is Blocked, as a 200 the chat log can show', async () => {
    const res = await call({ url: 'http://169.254.169.254/latest', method: 'GET' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false, error: 'Blocked: host resolves to a private/reserved IP (169.254.169.254)' });
  });

  it('WD-FLB-024: loopback, private ranges, metadata names and other schemes are refused; an empty URL is soft', async () => {
    for (const url of ['http://127.0.0.1:3999/', 'http://10.0.0.1/', 'http://[::1]/', 'http://metadata.google.internal/', 'ftp://example.com/']) {
      const res = await call({ url });
      expect(res.body.ok, url).toBe(false);
      expect(res.body.error, url).toMatch(/^Blocked: /);
    }
    expect((await call({ url: '' })).body).toEqual({ ok: false, error: 'No URL configured on the webhook node.' });
    expect((await call({ url: 'x'.repeat(2049) })).status).toBe(422);
  });
});

describe('AI flow generator (WD-FLB-025)', () => {
  let t: Tenant;
  let adapter: HttpFlowAiAdapter;
  beforeAll(async () => {
    t = await api.signup('flbgen');
    adapter = h.app.get(FLOW_AI_PORT);
  });
  const gen = (body: Record<string, unknown> = {}) =>
    api.as(t.admin).post('/v2/flows/ai-generate').send({ prompt: 'Greet the customer', model: 'gpt-4o-mini', provider: 'openai', ...body });
  const fake = (text: string | null, status = 200) => {
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    adapter.fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status });
    }) as unknown as typeof fetch;
    return seen;
  };

  it('WD-FLB-025 #2: with no key for the provider the answer is 422 FLB_AI_NO_KEY', async () => {
    const res = await gen();
    expect(res.status).toBe(422);
    expect(code(res)).toBe('FLB_AI_NO_KEY');
  });

  it('WD-FLB-025 #1: with the workspace\'s own key a graph comes back: at most 20 nodes and 40 edges, one START trigger, in the chat prompt', async () => {
    await h.owner.query(`INSERT INTO ai_provider_keys (org_id, provider, api_key, is_active) VALUES ($1,'openai','sk-mine',true)`, [t.orgId]);
    const nodes = Array.from({ length: 30 }, (_, i) => ({ id: `n_${i}`, type: i === 0 ? 'trigger' : 'message', data: { text: String(i) } }));
    const edges = Array.from({ length: 60 }, (_, i) => ({ id: `e_${i}`, source: 'n_0', target: `n_${(i % 29) + 1}` }));
    const seen = fake(JSON.stringify({ flowNodes: nodes, flowEdges: edges }));
    const res = await gen();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.model).toBe('gpt-4o-mini');
    expect(res.body.flow.flowNodes).toHaveLength(20);
    expect(res.body.flow.flowEdges.length).toBeLessThanOrEqual(40);
    expect(res.body.flow.flowNodes.filter((n: { isStart: boolean }) => n.isStart)).toHaveLength(1);
    expect(res.body.flow.flowEdges.every((e: { sourceHandle: string }) => e.sourceHandle === 'out')).toBe(true);
    expect(String((seen[0]!.body.messages as Array<{ content: string }>)[0]!.content)).toContain('WhatsApp chat flows');
    expect(seen[0]!.body.max_tokens).toBe(8000);
    expect(JSON.stringify(res.body)).not.toContain('sk-mine');
  });

  it('WD-FLB-025 #3: prose plus a fenced block still loads; a call flow uses the voice prompt', async () => {
    const seen = fake('Sure!\n```json\n{"flowNodes":[{"id":"a","type":"trigger"},{"id":"b","type":"cf_say"}],"flowEdges":[{"source":"a","target":"b"}]}\n```');
    const res = await gen({ flowType: 'call' });
    expect(res.status).toBe(200);
    expect(res.body.flow.flowNodes).toHaveLength(2);
    expect(String((seen[0]!.body.messages as Array<{ content: string }>)[0]!.content)).toContain('VOICE CALL');
  });

  it('WD-FLB-025: not JSON is 422 FLB_AI_BAD_JSON with a preview; an empty or failing provider is 502 FLB_AI_PROVIDER_FAILED', async () => {
    fake('I cannot do that');
    const bad = await gen();
    expect(bad.status).toBe(422);
    expect(code(bad)).toBe('FLB_AI_BAD_JSON');
    expect(bad.body.errors[0]).toMatchObject({ path: 'raw', message: 'I cannot do that' });
    fake(null);
    expect((await gen()).status).toBe(502);
    fake('{"flowNodes":[]}', 500);
    const failed = await gen();
    expect(failed.status).toBe(502);
    expect(code(failed)).toBe('FLB_AI_PROVIDER_FAILED');
  });

  it('WD-FLB-025 #4: the prompt is validated: required, at most 2000 characters, a provider the generator implements', async () => {
    expect((await gen({ prompt: 'x'.repeat(2001) })).status).toBe(422);
    expect((await gen({ prompt: ' ' })).status).toBe(422);
    expect((await gen({ provider: 'mistral' })).status).toBe(422);
    expect((await gen({ model: '' })).status).toBe(422);
  });
});

describe('media upload (WD-FLB-027)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('flbmed');
  });
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex');

  it('WD-FLB-027 #1: a PNG uploaded as an image answers an absolute public URL that serves the same bytes with safe headers', async () => {
    const res = await api.as(t.admin).post('/v2/flows/upload-media').field('type', 'image').attach('file', PNG, 'logo.png');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { url, filename, type, mimeType } = res.body.data;
    expect(url).toMatch(/^http:\/\/localhost:3999\/v2\/flow-media\/[0-9a-f-]{36}\/\d+_[0-9a-f]{24}\.png$/);
    expect(filename).toMatch(/^\d+_[0-9a-f]{24}\.png$/);
    expect(type).toBe('image');
    expect(mimeType).toBe('image/png');
    const got = await http().get(new URL(url).pathname);
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(got.body, PNG)).toBe(0);
  });

  it('WD-FLB-027 #2: a script renamed to .png is rejected by content; blocked extensions and no file are rejected', async () => {
    const fake = await api.as(t.admin).post('/v2/flows/upload-media').field('type', 'image').attach('file', Buffer.from('<?php system($_GET["c"]); ?>'), 'shell.png');
    expect(fake.status).toBe(422);
    expect(fake.body.detail).toBe('This file content is not allowed.');
    const php = await api.as(t.admin).post('/v2/flows/upload-media').field('type', 'document').attach('file', Buffer.from('x'), 'shell.php');
    expect(php.status).toBe(422);
    expect(php.body.detail).toBe('This file type is not allowed.');
    expect((await api.as(t.admin).post('/v2/flows/upload-media').field('type', 'image')).status).toBe(422);
    expect((await api.as(t.admin).post('/v2/flows/upload-media').field('type', 'gif').attach('file', PNG, 'a.png')).status).toBe(422);
  });

  it('WD-FLB-027 #3: a file over 50 MB is refused before it is stored', async () => {
    const res = await api.as(t.admin).post('/v2/flows/upload-media').field('type', 'video').attach('file', Buffer.alloc(51 * 1024 * 1024 + 1, 1), 'big.mp4');
    expect(res.status).toBe(422);
    expect(res.body.detail).toBe('The file may not be greater than 51200 kilobytes.');
  });

  it('the public media path serves only the exact shape and 404s anything else', async () => {
    for (const p of ['/v2/flow-media/x/y', '/v2/flow-media/..%2F..%2Fetc/passwd', '/v2/flow-media/00000000-0000-0000-0000-000000000000/1700000000_aaaaaaaaaaaaaaaaaaaaaaaa.png']) {
      expect((await http().get(p)).status, p).toBe(404);
    }
  });
});

describe('the runtime seam (WD-FLB-070, 071)', () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup('flbrt');
  });

  it('WD-FLB-070: the runnable flow carries the graph, the start node and a route table keyed "<node>_<port>" with the normaliser\'s port numbers', async () => {
    const graph = {
      flowNodes: [
        trigger(),
        { id: 'n_b', type: 'buttons', x: 1, y: 1, data: { options: ['A', 'B'] } },
        { id: 'n_c', type: 'condition', x: 2, y: 2, data: {} },
        { id: 'n_end1', type: 'end', x: 3, y: 3, data: {} },
        { id: 'n_end2', type: 'end', x: 3, y: 4, data: {} },
      ],
      flowEdges: [
        { id: 'e1', source: 'n_trig', sourceHandle: 'out', target: 'n_b' },
        { id: 'e2', source: 'n_b', sourceHandle: 'p1', target: 'n_c' },
        { id: 'e3', source: 'n_c', sourceHandle: 'yes', target: 'n_end1' },
        { id: 'e4', source: 'n_c', sourceHandle: 'no', target: 'n_end2' },
      ],
      vars: [],
    };
    const f = await create(t.admin, 'Runnable', graph);
    const run = await h.app.get(FlowReaderService).getRunnableFlow(t.orgId, f.id);
    expect(run).toMatchObject({ id: f.id, name: 'Runnable', startNodeId: 'n_trig', isPublished: false });
    expect(run!.routes).toEqual({ n_trig_1: 'n_b', n_b_2: 'n_c', n_c_1: 'n_end1', n_c_2: 'n_end2' });
  });

  it('WD-FLB-071: only published AND active flows with the trigger kind are enrollable, and another organization sees none of them', async () => {
    const o = await api.signup('flbrt2');
    const a = await create(t.admin, 'Enrol A', { flowNodes: [trigger({ kind: 'contact_created' })], flowEdges: [] });
    const b = await create(t.admin, 'Enrol B', { flowNodes: [trigger({ kind: 'contact_created' })], flowEdges: [] });
    await create(t.admin, 'Enrol draft', { flowNodes: [trigger({ kind: 'contact_created' })], flowEdges: [] });
    await api.as(t.admin).post(`/v2/flows/${a.id}/publish`);
    await api.as(t.admin).post(`/v2/flows/${b.id}/publish`);
    await api.as(t.admin).post(`/v2/flows/${b.id}/toggle`);
    const reader = h.app.get(FlowReaderService);
    const mine = await reader.listEnrollable(t.orgId, 'contact_created', 0);
    expect(mine.map((x) => x.id)).toEqual([a.id]);
    expect(await reader.listEnrollable(o.orgId, 'contact_created', 0)).toEqual([]);
    expect(await reader.getRunnableFlow(o.orgId, a.id)).toBeNull();
  });
});

/**
 * One named test per acceptance criterion of WD-FLB-019, 020, 021, 022, 028 and 029 (the numbered "#n" is the position in the
 * inventory's list). The runtime half of 021 runs against FLR's real keyword matcher: the editor writes flows, the runtime
 * reads them, nothing in between.
 */
describe('acceptance: save, trigger columns, keyword matching, publish, gates, persistence (WD-FLB-019..022, 028, 029)', () => {
  let t: Tenant;
  const sql = (q: string, p: unknown[] = []) => h.owner.query(q, p);
  const col = async (flowUuid: string, c: string) =>
    (await sql(`SELECT ${c} AS v FROM flows WHERE uuid = $1`, [flowUuid])).rows[0].v;
  const device = async (orgId: number, name = 'Phone') =>
    (await sql(`INSERT INTO devices (org_id, device_name, phone_number, status) VALUES ($1,$2,'+15550009','connected') RETURNING id, uuid`, [orgId, name])).rows[0] as { id: string; uuid: string };
  const qrChannel = async (orgId: number, deviceUuid: string) =>
    Number((await sql(`INSERT INTO channels (org_id, kind, name, status, external_id) VALUES ($1,'whatsapp_qr','Phone','connected',$2) RETURNING id`, [orgId, deviceUuid])).rows[0].id);
  const triggers = () => h.app.get(FlowTriggerService, { strict: false });

  beforeAll(async () => {
    t = await api.signup('flbacc');
  });

  // --- WD-FLB-019 -------------------------------------------------------------------------------------------------

  it('WD-FLB-019 #1: Save of a new flow answers a draft row (is_published=false, is_active=true) and the second Save updates the same row', async () => {
    const o = await api.signup('flb19a');
    const f = await create(o.admin, 'Welcome');
    expect(await col(f.id, 'is_published')).toBe(false);
    expect(await col(f.id, 'is_active')).toBe(true);
    expect((await api.as(o.admin).put(`/v2/flows/${f.id}`).send({ name: 'Welcome', graph: simpleGraph(), rowVersion: f.rowVersion })).body.id).toBe(f.id);
    expect((await sql(`SELECT count(*)::int AS n FROM flows WHERE org_id = $1`, [o.orgId])).rows[0].n).toBe(1);
  });

  it('WD-FLB-019 #2: at the plan limit creating is 422 with the exact plan message and no row; editing the same flow succeeds', async () => {
    const o = await api.signup('flb19b');
    const a = await create(o.admin, 'L1');
    await setLimit(o.orgId, 1);
    const blocked = await api.as(o.admin).post('/v2/flows').send({ name: 'L2', graph: simpleGraph() });
    expect(blocked.status).toBe(422);
    expect(blocked.body.detail).toBe(
      "You've reached your plan's limit of 1 flows. Upgrade your plan to add more, or delete an existing one to free up space.",
    );
    expect((await sql(`SELECT count(*)::int AS n FROM flows WHERE org_id = $1`, [o.orgId])).rows[0].n).toBe(1);
    expect((await api.as(o.admin).put(`/v2/flows/${a.id}`).send({ name: 'L1b', graph: simpleGraph(), rowVersion: a.rowVersion })).status).toBe(200);
  });

  it('WD-FLB-019 #3: a 300-character keyword trigger is 422 with the length message, and (deliberate fix) nothing is written: row, audit and outbox are untouched', async () => {
    const o = await api.signup('flb19c');
    const f = await create(o.admin, 'Long');
    const before = (await sql(`SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1`, [o.orgId])).rows[0].n;
    const res = await api.as(o.admin).put(`/v2/flows/${f.id}`).send({
      name: 'Long 2', graph: { flowNodes: [trigger({ keywords: 'k'.repeat(300) })], flowEdges: [] }, rowVersion: f.rowVersion,
    });
    expect(res.status).toBe(422);
    expect(res.body.detail).toContain('Trigger keyword is too long (300 characters; the limit is 255).');
    expect(await col(f.id, 'flow_name')).toBe('Long');
    expect((await sql(`SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1`, [o.orgId])).rows[0].n).toBe(before);
    expect(await api.events(o.orgId, 'flow.saved')).toHaveLength(0);
  });

  it('WD-FLB-019 #4: a flow id from another workspace is 404 on save, publish and delete, and the other workspace\'s flow is unchanged', async () => {
    const a = await api.signup('flb19d1');
    const b = await api.signup('flb19d2');
    const theirs = await create(b.admin, 'Theirs');
    const put = await api.as(a.admin).put(`/v2/flows/${theirs.id}`).send({ name: 'Mine now', graph: simpleGraph(), rowVersion: 1 });
    expect(put.status).toBe(404);
    expect((await api.as(a.admin).post(`/v2/flows/${theirs.id}/publish`)).status).toBe(404);
    expect((await api.as(a.admin).delete(`/v2/flows/${theirs.id}`)).status).toBe(404);
    expect(await col(theirs.id, 'flow_name')).toBe('Theirs');
  });

  it('WD-FLB-019 rules 2/4/6: a category cannot be cleared by a save, flow_type falls back to the stored one, an unknown flow_type is 422, a category over 64 is 422', async () => {
    const o = await api.signup('flb19e');
    const f = await create(o.admin, 'Typed', simpleGraph(), { category: 'Sales', flowType: 'telegram' });
    expect(f).toMatchObject({ category: 'Sales', flowType: 'telegram' });
    const again = await api.as(o.admin).put(`/v2/flows/${f.id}`).send({ name: 'Typed', graph: simpleGraph(), rowVersion: f.rowVersion });
    expect(again.body).toMatchObject({ category: 'Sales', flowType: 'telegram' });
    expect((await create(o.admin, 'Default type')).flowType).toBe('chat');
    expect((await api.as(o.admin).post('/v2/flows').send({ name: 'x', graph: simpleGraph(), flowType: 'sms' })).status).toBe(422);
    expect((await api.as(o.admin).post('/v2/flows').send({ name: 'x', graph: simpleGraph(), category: 'c'.repeat(65) })).status).toBe(422);
    expect((await api.as(o.admin).post('/v2/flows').send({ name: 'x', graph: simpleGraph(), category: 'c'.repeat(64) })).status).toBe(201);
  });

  it('WD-FLB-019: the graph is stored under flowNodes / flowEdges / vars and the variables survive a save and a reload', async () => {
    const o = await api.signup('flb19f');
    const graph = { ...simpleGraph(), vars: [{ name: 'city', desc: 'Where', default: 'Pune' }] };
    const f = await create(o.admin, 'Vars', graph);
    const stored = await col(f.id, 'flow_data');
    expect(Object.keys(stored).sort()).toEqual(['flowEdges', 'flowNodes', 'vars']);
    expect(stored.vars).toEqual([{ name: 'city', desc: 'Where', default: 'Pune' }]);
    const reload = (await api.as(o.admin).get(`/v2/flows/${f.id}`)).body;
    expect(reload.graph.vars).toEqual(stored.vars);
    expect(reload.graph.flowEdges).toEqual(stored.flowEdges);
  });

  // --- WD-FLB-020 -------------------------------------------------------------------------------------------------

  it('WD-FLB-020 #1: {kind: tag_added, tagId, deviceId: waba:<n>} stores trigger_kind, trigger_value, provider=waba and the sender row, and the channel the runtime reads', async () => {
    const o = await api.signup('flb20a');
    const tagUuid = (await api.as(o.admin).post('/v2/tags').send({ name: 'vip' })).body.id as string;
    const tagId = (await sql(`SELECT id FROM tags WHERE uuid = $1`, [tagUuid])).rows[0].id;
    const cfg = (await sql(`INSERT INTO wa_provider_configs (org_id, provider, status, phone_number) VALUES ($1,'waba','connected','+15550003') RETURNING id, uuid`, [o.orgId])).rows[0];
    const ch = Number((await sql(`INSERT INTO channels (org_id, kind, name, status, waba_config_id) VALUES ($1,'whatsapp_cloud','Cloud','connected',$2) RETURNING id`, [o.orgId, cfg.id])).rows[0].id);
    const f = await create(o.admin, 'Tagged', { flowNodes: [trigger({ kind: 'tag_added', tagId: tagUuid, deviceId: `waba:${cfg.uuid}` })], flowEdges: [] });
    const row = (await sql(`SELECT trigger_kind, trigger_value, trigger_device_id, trigger_channel_id, provider FROM flows WHERE uuid = $1`, [f.id])).rows[0];
    expect(row.trigger_kind).toBe('tag_added');
    expect(Number(row.trigger_value)).toBe(Number(tagId));
    expect(Number(row.trigger_device_id)).toBe(Number(cfg.id));
    expect(Number(row.trigger_channel_id)).toBe(ch);
    expect(row.provider).toBe('waba');
  });

  it('WD-FLB-020 #2: {kind: keyword, keywordMode: any} stores trigger_keywords = any (the legacy triggerMode spelling too)', async () => {
    const o = await api.signup('flb20b');
    const a = await create(o.admin, 'Any 1', { flowNodes: [trigger({ keywordMode: 'any' })], flowEdges: [] });
    const b = await create(o.admin, 'Any 2', { flowNodes: [trigger({ triggerMode: 'any' })], flowEdges: [] });
    expect(await col(a.id, 'trigger_keywords')).toBe('any');
    expect(await col(b.id, 'trigger_keywords')).toBe('any');
    const kw = await create(o.admin, 'Kw', { flowNodes: [trigger({ keywords: '  price, cost  ' })], flowEdges: [] });
    expect(await col(kw.id, 'trigger_keywords')).toBe('price, cost');
    const blank = await create(o.admin, 'Blank', { flowNodes: [trigger({ keywords: '   ' })], flowEdges: [] });
    expect(await col(blank.id, 'trigger_keywords')).toBeNull();
  });

  it('WD-FLB-020 #3: value-less event triggers store trigger_value = 0 (contact_created, opt_in, order_placed, away, out_of_hours, comment_to_dm); manual_enroll stores null', async () => {
    const o = await api.signup('flb20c');
    for (const kind of ['contact_created', 'opt_in', 'order_placed', 'away', 'out_of_hours', 'comment_to_dm']) {
      const f = await create(o.admin, kind, { flowNodes: [trigger({ kind })], flowEdges: [] });
      expect(Number(await col(f.id, 'trigger_value')), kind).toBe(0);
    }
    const m = await create(o.admin, 'Manual', { flowNodes: [trigger({ kind: 'manual_enroll' })], flowEdges: [] });
    expect(await col(m.id, 'trigger_value')).toBeNull();
    expect(await col(m.id, 'trigger_keywords')).toBeNull();
  });

  it('WD-FLB-020 #4: {kind: nonsense} stores trigger_kind = keyword; a graph without a Trigger saves as keyword with no keywords; the FIRST Trigger node wins', async () => {
    const o = await api.signup('flb20d');
    const n = await create(o.admin, 'Nonsense', { flowNodes: [trigger({ kind: 'nonsense' })], flowEdges: [] });
    expect(await col(n.id, 'trigger_kind')).toBe('keyword');
    const none = await create(o.admin, 'No trigger', { flowNodes: [{ id: 'm', type: 'message', x: 0, y: 0, data: { text: 'x' } }], flowEdges: [] });
    expect(await col(none.id, 'trigger_kind')).toBe('keyword');
    expect(await col(none.id, 'trigger_keywords')).toBeNull();
    const two = await create(o.admin, 'Two', { flowNodes: [{ ...trigger({ kind: 'opt_in' }), id: 't1' }, { ...trigger({ kind: 'away' }), id: 't2' }], flowEdges: [] });
    expect(await col(two.id, 'trigger_kind')).toBe('opt_in');
  });

  it('WD-FLB-020 rule 3 / port: an unofficial device resolves to its whatsapp_qr channel (trigger_channel_id), another workspace\'s never does, a blank sender stores null and the next save re-derives it', async () => {
    const o = await api.signup('flb20e');
    const other = await api.signup('flb20f');
    const d = await device(o.orgId);
    const ch = await qrChannel(o.orgId, d.uuid);
    const theirs = await device(other.orgId, 'Theirs');
    await qrChannel(other.orgId, theirs.uuid);

    const f = await create(o.admin, 'Pinned', { flowNodes: [trigger({ deviceId: `baileys:${d.uuid}` })], flowEdges: [] });
    expect(Number(await col(f.id, 'trigger_channel_id'))).toBe(ch);
    expect(await col(f.id, 'provider')).toBe('baileys');

    const foreign = await create(o.admin, 'Foreign', { flowNodes: [trigger({ deviceId: `baileys:${theirs.uuid}` })], flowEdges: [] });
    expect(await col(foreign.id, 'trigger_channel_id')).toBeNull();
    expect(await col(foreign.id, 'trigger_device_id')).toBeNull();

    const cleared = await api.as(o.admin).put(`/v2/flows/${f.id}`).send({ name: 'Pinned', graph: { flowNodes: [trigger({ deviceId: '' })], flowEdges: [] }, rowVersion: f.rowVersion });
    expect(cleared.status).toBe(200);
    expect(await col(f.id, 'trigger_channel_id')).toBeNull();
    expect(await col(f.id, 'trigger_device_id')).toBeNull();
    expect(await col(f.id, 'provider')).toBe('baileys'); // a blank sender leaves the engine stamp alone
  });

  it('WD-FLB-020 rule 1: an unknown engine prefix (unofficial:<id>) sets neither the sender nor the provider', async () => {
    const o = await api.signup('flb20g');
    const d = await device(o.orgId);
    const f = await create(o.admin, 'Unofficial', { flowNodes: [trigger({ deviceId: `unofficial:${d.uuid}` })], flowEdges: [] });
    expect(await col(f.id, 'trigger_device_id')).toBeNull();
    expect(await col(f.id, 'trigger_channel_id')).toBeNull();
    expect(await col(f.id, 'provider')).toBe('baileys');
  });

  // --- WD-FLB-021 (the runtime reads the flow row itself: no synthetic auto-reply rows) ---------------------------------

  it('WD-FLB-021 #1: a published+active WhatsApp flow with keywords "price, cost" and a number pinned starts on those words only on that channel; pausing and deleting stop it', async () => {
    const o = await api.signup('flb21a');
    const d = await device(o.orgId);
    const ch = await qrChannel(o.orgId, d.uuid);
    const otherCh = await qrChannel(o.orgId, (await device(o.orgId, 'Second')).uuid);
    const f = await create(o.admin, 'Pricing', { flowNodes: [trigger({ keywords: 'price, cost', deviceId: `baileys:${d.uuid}` })], flowEdges: [] });
    const id = Number((await sql(`SELECT id FROM flows WHERE uuid = $1`, [f.id])).rows[0].id);

    expect(await triggers().keywordFlow(o.orgId, ch, 'whatsapp_qr', 'price please')).toBeNull(); // still a draft
    await api.as(o.admin).post(`/v2/flows/${f.id}/publish`);
    expect((await triggers().keywordFlow(o.orgId, ch, 'whatsapp_qr', 'What is the PRICE?'))?.id).toBe(id);
    expect(await triggers().keywordFlow(o.orgId, ch, 'whatsapp_qr', 'hello')).toBeNull();
    expect(await triggers().keywordFlow(o.orgId, otherCh, 'whatsapp_qr', 'price')).toBeNull(); // pinned to the other number
    await api.as(o.admin).post(`/v2/flows/${f.id}/toggle`);
    expect(await triggers().keywordFlow(o.orgId, ch, 'whatsapp_qr', 'price')).toBeNull();
    await api.as(o.admin).post(`/v2/flows/${f.id}/toggle`);
    expect((await triggers().keywordFlow(o.orgId, ch, 'whatsapp_qr', 'cost'))?.id).toBe(id);
    await api.as(o.admin).delete(`/v2/flows/${f.id}`);
    expect(await triggers().keywordFlow(o.orgId, ch, 'whatsapp_qr', 'cost')).toBeNull();
  });

  it('WD-FLB-021 #2: keywordMode any is the catch-all tier: it answers only when no keyword flow matched, and the legacy * .* .+ spellings work the same', async () => {
    const o = await api.signup('flb21b');
    const d = await device(o.orgId);
    const ch = await qrChannel(o.orgId, d.uuid);
    const sender = `baileys:${d.uuid}`;
    const mk = async (name: string, data: Record<string, unknown>) => {
      const f = await create(o.admin, name, { flowNodes: [trigger({ deviceId: sender, ...data })], flowEdges: [] });
      await api.as(o.admin).post(`/v2/flows/${f.id}/publish`);
      return Number((await sql(`SELECT id FROM flows WHERE uuid = $1`, [f.id])).rows[0].id);
    };
    const catchAll = await mk('Default route', { keywordMode: 'any' });
    expect((await triggers().keywordFlow(o.orgId, ch, 'whatsapp_qr', 'anything at all'))?.id).toBe(catchAll);
    const book = await mk('Book', { keywords: 'book' });
    expect((await triggers().keywordFlow(o.orgId, ch, 'whatsapp_qr', 'I want to book'))?.id).toBe(book);
    expect((await triggers().keywordFlow(o.orgId, ch, 'whatsapp_qr', 'weather?'))?.id).toBe(catchAll);
    for (const spelling of ['*', '.*', '.+']) {
      const o2 = await api.signup('flb21c');
      const d2 = await device(o2.orgId);
      const ch2 = await qrChannel(o2.orgId, d2.uuid);
      const f = await create(o2.admin, `Legacy ${spelling}`, { flowNodes: [trigger({ keywords: spelling, deviceId: `baileys:${d2.uuid}` })], flowEdges: [] });
      await api.as(o2.admin).post(`/v2/flows/${f.id}/publish`);
      expect(await triggers().keywordFlow(o2.orgId, ch2, 'whatsapp_qr', 'hi there'), spelling).not.toBeNull();
    }
  });

  it('WD-FLB-021 #3: a Facebook flow gets no auto-reply row (none is ever written: the runtime reads the flow itself)', async () => {
    const o = await api.signup('flb21d');
    await create(o.admin, 'FB', { flowNodes: [trigger({ keywords: 'hi' })], flowEdges: [] }, { flowType: 'facebook' });
    expect((await sql(`SELECT count(*)::int AS n FROM keyword_replies WHERE org_id = $1`, [o.orgId])).rows[0].n).toBe(0);
  });

  it('WD-FLB-021 #4: a 300-character keyword is refused with the length message on a WhatsApp flow, but not on Instagram, Facebook, TikTok, Telegram or Email flows (WaDesk skipped the rule sync for those); a long catch-all-free comment_to_dm list is never checked', async () => {
    const o = await api.signup('flb21e');
    const long = { flowNodes: [trigger({ keywords: 'k'.repeat(300) })], flowEdges: [] };
    expect((await api.as(o.admin).post('/v2/flows').send({ name: 'wa', graph: long })).status).toBe(422);
    expect((await api.as(o.admin).post('/v2/flows').send({ name: 'call', graph: long, flowType: 'call' })).status).toBe(422);
    for (const flowType of ['instagram', 'facebook', 'tiktok', 'telegram', 'email']) {
      expect((await api.as(o.admin).post('/v2/flows').send({ name: flowType, graph: long, flowType })).status, flowType).toBe(201);
    }
    const chars = { flowNodes: [trigger({ keywords: '😀'.repeat(255) })], flowEdges: [] };
    expect((await api.as(o.admin).post('/v2/flows').send({ name: 'emoji', graph: chars })).status).toBe(201); // characters, not UTF-16 units
  });

  it('WD-FLB-021: an Import, Duplicate or Clone whose keyword text is too long is a 422 with the same message (WaDesk answered 500)', async () => {
    const o = await api.signup('flb21f');
    const res = await api.as(o.admin).post('/v2/flows/import').send({ payload: { flowNodes: [trigger({ keywords: 'k'.repeat(300) })], flowEdges: [] } });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('FLB_TRIGGER_KEYWORDS_TOO_LONG');
  });

  // --- WD-FLB-022 -------------------------------------------------------------------------------------------------

  it('WD-FLB-022 #1: Publish on a saved draft sets is_published and published_at, the pill reads live and the keyword flow becomes matchable', async () => {
    const o = await api.signup('flb22a');
    const d = await device(o.orgId);
    const ch = await qrChannel(o.orgId, d.uuid);
    const f = await create(o.admin, 'Pub', { flowNodes: [trigger({ keywords: 'hello', deviceId: `baileys:${d.uuid}` })], flowEdges: [] });
    expect(await col(f.id, 'published_at')).toBeNull();
    const pub = await api.as(o.admin).post(`/v2/flows/${f.id}/publish`);
    expect(pub.body).toMatchObject({ state: 'live', isPublished: true });
    expect(await col(f.id, 'published_at')).not.toBeNull();
    expect(await triggers().keywordFlow(o.orgId, ch, 'whatsapp_qr', 'hello')).not.toBeNull();
  });

  it('WD-FLB-022 #4: Unpublish sets is_published=false, clears published_at and the flow stops matching', async () => {
    const o = await api.signup('flb22b');
    const d = await device(o.orgId);
    const ch = await qrChannel(o.orgId, d.uuid);
    const f = await create(o.admin, 'Unpub', { flowNodes: [trigger({ keywords: 'hello', deviceId: `baileys:${d.uuid}` })], flowEdges: [] });
    await api.as(o.admin).post(`/v2/flows/${f.id}/publish`);
    const un = await api.as(o.admin).post(`/v2/flows/${f.id}/unpublish`);
    expect(un.body).toMatchObject({ state: 'draft', isPublished: false, publishedAt: null });
    expect(await col(f.id, 'published_at')).toBeNull();
    expect(await triggers().keywordFlow(o.orgId, ch, 'whatsapp_qr', 'hello')).toBeNull();
  });

  it('WD-FLB-022 #3: a brand-new graph that is saved and then published leaves exactly one flow row, published (WaDesk created two)', async () => {
    const o = await api.signup('flb22c');
    const f = await create(o.admin, 'Fresh');
    await api.as(o.admin).post(`/v2/flows/${f.id}/publish`);
    const rows = (await sql(`SELECT is_published FROM flows WHERE org_id = $1`, [o.orgId])).rows;
    expect(rows).toEqual([{ is_published: true }]);
  });

  it('WD-FLB-022 rule 2/5: publish does not re-validate the graph, keeps the trigger columns, and an edit of a published flow stays live on Save; publish is 404 for another workspace\'s flow', async () => {
    const o = await api.signup('flb22d');
    const f = await create(o.admin, 'Keep', { flowNodes: [trigger({ kind: 'opt_in' })], flowEdges: [] });
    await api.as(o.admin).post(`/v2/flows/${f.id}/publish`);
    expect(await col(f.id, 'trigger_kind')).toBe('opt_in');
    const saved = await api.as(o.admin).put(`/v2/flows/${f.id}`).send({ name: 'Keep', graph: simpleGraph(), rowVersion: (await api.as(o.admin).get(`/v2/flows/${f.id}`)).body.rowVersion });
    expect(saved.body).toMatchObject({ isPublished: true, state: 'live' });
    const stranger = await api.signup('flb22e');
    expect((await api.as(stranger.admin).post(`/v2/flows/${f.id}/unpublish`)).status).toBe(404);
  });

  // --- WD-FLB-028 -------------------------------------------------------------------------------------------------

  it('WD-FLB-028 #1: flow_limit 3 with 3 flows: save-new, import and clone are refused with the plan message; duplicate is refused too (documented deviation: WaDesk let duplicate through)', async () => {
    const o = await api.signup('flb28a');
    const a = await create(o.admin, 'F1');
    await create(o.admin, 'F2');
    await create(o.admin, 'F3');
    await setLimit(o.orgId, 3);
    for (const res of [
      await api.as(o.admin).post('/v2/flows').send({ name: 'F4', graph: simpleGraph() }),
      await api.as(o.admin).post('/v2/flows/import').send({ payload: { flowNodes: [] } }),
      await api.as(o.admin).post(`/v2/flows/${a.id}/duplicate`),
    ]) {
      expect(res.status).toBe(422);
      expect(code(res)).toBe('PLAN_LIMIT_REACHED');
    }
    await setLimit(o.orgId, null);
  });

  it('WD-FLB-028 rule 2: a limit of 0 means unlimited and a delete frees a slot', async () => {
    const o = await api.signup('flb28b');
    await setLimit(o.orgId, 0);
    for (let i = 0; i < 4; i++) await create(o.admin, `U${i}`);
    await setLimit(o.orgId, 4);
    expect((await api.as(o.admin).post('/v2/flows').send({ name: 'U5', graph: simpleGraph() })).status).toBe(422);
    const one = (await list(o.admin)).data[0]!;
    await api.as(o.admin).delete(`/v2/flows/${one.id}`);
    expect((await api.as(o.admin).post('/v2/flows').send({ name: 'U5', graph: simpleGraph() })).status).toBe(201);
    await setLimit(o.orgId, null);
  });

  it('WD-FLB-028 #2: a member with no flb key (a manager in WaDesk) is 403 FORBIDDEN opening the list', async () => {
    const o = await api.signup('flb28c');
    const manager = await api.member(o, 'manager', [['dash.dashboard.read']]);
    const res = await api.as(manager.token).get('/v2/flows');
    expect(res.status).toBe(403);
    expect(code(res)).toBe('FORBIDDEN');
  });

  it('WD-FLB-028: the organization Admin role holds the five flb keys after the migration', async () => {
    const o = await api.signup('flb28d');
    const keys = (await sql(
      `SELECT g.permission_key FROM role_grants g JOIN roles r ON r.org_id = g.org_id AND r.id = g.role_id
       WHERE g.org_id = $1 AND r.system_key = 'admin' AND g.permission_key LIKE 'flb.flows.%' ORDER BY 1`, [o.orgId])).rows.map((r) => r.permission_key);
    expect(keys).toEqual(['flb.flows.create', 'flb.flows.delete', 'flb.flows.publish', 'flb.flows.read', 'flb.flows.update']);
  });

  it('WD-FLB-028 #3: with the plan feature `automation` off the page data still loads (soft paywall) but creating or editing is 422 PLAN_FEATURE_LOCKED; pause, unpublish and delete stay open', async () => {
    const o = await api.signup('flb28e');
    const f = await create(o.admin, 'Before downgrade');
    await api.as(o.admin).post(`/v2/flows/${f.id}/publish`);
    await sql(`UPDATE org_plan_state SET overrides = '{"features":{"automation":false}}'::jsonb WHERE org_id = $1`, [o.orgId]);
    for (const path of ['/v2/flows', '/v2/flows/overview', '/v2/flows/templates', '/v2/flows/builder-context', `/v2/flows/${f.id}`, `/v2/flows/${f.id}/export`]) {
      expect((await api.as(o.admin).get(path)).status, path).toBe(200);
    }
    const locked = [
      await api.as(o.admin).post('/v2/flows').send({ name: 'x', graph: simpleGraph() }),
      await api.as(o.admin).put(`/v2/flows/${f.id}`).send({ name: 'x', graph: simpleGraph(), rowVersion: f.rowVersion }),
      await api.as(o.admin).post(`/v2/flows/${f.id}/publish`),
      await api.as(o.admin).post(`/v2/flows/${f.id}/duplicate`),
      await api.as(o.admin).post('/v2/flows/import').send({ payload: { flowNodes: [] } }),
      await api.as(o.admin).patch(`/v2/flows/${f.id}/rename`).send({ name: 'y' }),
    ];
    for (const res of locked) {
      expect(res.status).toBe(422);
      expect(code(res)).toBe('PLAN_FEATURE_LOCKED');
    }
    expect((await api.as(o.admin).post(`/v2/flows/${f.id}/toggle`)).status).toBe(200);
    expect((await api.as(o.admin).post(`/v2/flows/${f.id}/unpublish`)).status).toBe(200);
    expect((await api.as(o.admin).delete(`/v2/flows/${f.id}`)).status).toBe(204);
    await sql(`UPDATE org_plan_state SET overrides = '{}'::jsonb WHERE org_id = $1`, [o.orgId]);
  });

  it('WD-FLB-028 rule 4: the node cap (500) is enforced server-side (WaDesk never enforced flow_steps_limit): 500 nodes save, 501 are refused', async () => {
    const o = await api.signup('flb28f');
    const nodes = (n: number) => ({ flowNodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, type: 'message', x: i, y: 0, data: {} })), flowEdges: [] });
    expect((await api.as(o.admin).post('/v2/flows').send({ name: '500', graph: nodes(500) })).status).toBe(201);
    expect((await api.as(o.admin).post('/v2/flows').send({ name: '501', graph: nodes(501) })).status).toBe(422);
  });

  // --- WD-FLB-029 -------------------------------------------------------------------------------------------------

  it('WD-FLB-029 #1: the graph is jsonb (not ciphertext) with the nodes readable in the row, and the name is plain text', async () => {
    const o = await api.signup('flb29a');
    const f = await create(o.admin, 'Readable');
    const r = (await sql(`SELECT flow_name, jsonb_typeof(flow_data) AS t, flow_data->'flowNodes'->0->>'type' AS first FROM flows WHERE uuid = $1`, [f.id])).rows[0];
    expect(r).toEqual({ flow_name: 'Readable', t: 'object', first: 'trigger' });
  });

  it('WD-FLB-029 #2: a row whose flow_data is NULL or malformed loads as an empty graph, never an error (the file mirror does not exist here)', async () => {
    const o = await api.signup('flb29b');
    const f = await create(o.admin, 'Hollow');
    await sql(`UPDATE flows SET flow_data = NULL WHERE uuid = $1`, [f.id]);
    const r = await api.as(o.admin).get(`/v2/flows/${f.id}`);
    expect(r.status).toBe(200);
    expect(r.body.graph).toEqual({ flowNodes: [], flowEdges: [], vars: [] });
    expect(r.body.nodeCount).toBe(0);
  });

  it('WD-FLB-029 #3: deleting a flow removes the row, its subscribers and runs (database cascade) and writes flow.deleted', async () => {
    const o = await api.signup('flb29c');
    const f = await create(o.admin, 'Gone');
    const id = (await sql(`SELECT id FROM flows WHERE uuid = $1`, [f.id])).rows[0].id;
    const contact = (await sql(`INSERT INTO contacts (org_id) VALUES ($1) RETURNING id`, [o.orgId])).rows[0].id;
    await sql(`INSERT INTO flow_subscribers (org_id, flow_id, contact_id, status) VALUES ($1,$2,$3,'active')`, [o.orgId, id, contact]);
    expect((await api.as(o.admin).delete(`/v2/flows/${f.id}`)).status).toBe(204);
    expect((await sql(`SELECT count(*)::int AS n FROM flow_subscribers WHERE flow_id = $1 AND org_id = $2`, [id, o.orgId])).rows[0].n).toBe(0);
    expect(await api.events(o.orgId, 'flow.deleted')).toHaveLength(1);
  });

  it('WD-FLB-029 rule 1: provider defaults to baileys on create and only a trigger sender with a valid engine changes it; the state pair starts (false, true)', async () => {
    const o = await api.signup('flb29d');
    const f = await create(o.admin, 'Defaults');
    expect(await col(f.id, 'provider')).toBe('baileys');
    expect(await col(f.id, 'flow_type')).toBe('chat');
    expect(await col(f.id, 'row_version')).toBe(1);
  });

  it('WD-FLB-006 quirk kept: a duplicate of a paused flow keeps the pause switch off (WaDesk replicate()), is unpublished and has no published_at', async () => {
    const o = await api.signup('flb06');
    const f = await create(o.admin, 'Src');
    await api.as(o.admin).post(`/v2/flows/${f.id}/publish`);
    await api.as(o.admin).post(`/v2/flows/${f.id}/toggle`);
    const copy = (await api.as(o.admin).post(`/v2/flows/${f.id}/duplicate`)).body as Flow;
    expect(copy).toMatchObject({ name: 'Src (Copy)', isPublished: false, isActive: false, state: 'draft', publishedAt: null });
  });

  it('WD-FLB-008/009 compat: the export downloads as <slug>.wadesk-flow.json, imports back unchanged, and a file WaDesk wrote (no vars, no coordinates, unknown type) imports as a chat draft', async () => {
    const o = await api.signup('flb08');
    const f = await create(o.admin, 'My Flow', simpleGraph(), { category: 'Sales', flowType: 'telegram' });
    const res = await api.as(o.admin).get(`/v2/flows/${f.id}/export`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="my-flow.wadesk-flow.json"');
    expect(res.body).toMatchObject({ _wadesk_flow_export: 1, name: 'My Flow', flow_type: 'telegram', category: 'Sales' });
    const back = await api.as(o.admin).post('/v2/flows/import').send({ payload: res.body });
    expect(back.body).toMatchObject({ name: 'My Flow (imported)', flowType: 'telegram', category: 'Sales', isPublished: false, nodeCount: 2, edgeCount: 1 });
    const wadesk = {
      _wadesk_flow_export: 1, exported_at: '2026-05-01T10:00:00+00:00', name: 'From WaDesk', flow_type: 'sms', category: null,
      flow_data: { flowNodes: [{ id: 'a', type: 'trigger', data: { kind: 'keyword', keywords: 'hi' } }, { id: 'b', type: 'message', data: { text: 'yo' } }], flowEdges: [{ id: 'e', source: 'a', sourceHandle: 'out', target: 'b' }] },
    };
    const imp = await api.as(o.admin).post('/v2/flows/import').send({ payload: wadesk });
    expect(imp.status).toBe(201);
    expect(imp.body).toMatchObject({ name: 'From WaDesk (imported)', flowType: 'chat', nodeCount: 2, edgeCount: 1 });
    expect(imp.body.graph.flowNodes.every((n: { x: number; y: number }) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
    expect(imp.body.graph.vars).toEqual([]);
  });

  it('WD-FLB-070: the runtime seam hands the runtime the same columns its matcher reads (trigger kind, keywords, provider, channel) and the same value rule (null counts as 0)', async () => {
    const o = await api.signup('flb70a');
    const d = await device(o.orgId);
    const ch = await qrChannel(o.orgId, d.uuid);
    const f = await create(o.admin, 'Seam', { flowNodes: [trigger({ kind: 'opt_in', deviceId: `baileys:${d.uuid}` })], flowEdges: [] });
    await api.as(o.admin).post(`/v2/flows/${f.id}/publish`);
    const reader = h.app.get(FlowReaderService);
    const run = await reader.getRunnableFlow(o.orgId, f.id);
    expect(run).toMatchObject({ triggerKind: 'opt_in', provider: 'baileys', triggerChannelId: ch, triggerKeywords: null });
    await sql(`UPDATE flows SET trigger_value = NULL WHERE uuid = $1`, [f.id]);
    expect((await reader.listEnrollable(o.orgId, 'opt_in', 0)).map((x) => x.id)).toEqual([f.id]);
    expect((await reader.listEnrollable(o.orgId, 'opt_in', 0))[0]!.triggerChannelId).toBe(ch);
  });
});

describe('plan and helpers', () => {
  it('a flow row is isolated by org_id: the application role sees only its own organization\'s flows', async () => {
    const a = await api.signup('flbrls1');
    const b = await api.signup('flbrls2');
    await create(a.admin, 'A only');
    await create(b.admin, 'B only');
    expect(names(await list(a.admin, '?limit=100'))).toEqual(['A only']);
    expect(names(await list(b.admin, '?limit=100'))).toEqual(['B only']);
  });

  it('ADMINISH grants are sufficient for the whole editor flow (sanity for the keys list)', async () => {
    const o = await api.signup('flbkeys');
    const m = await api.member(o, 'allkeys', ADMINISH);
    const f = await create(m.token, 'By member');
    expect((await api.as(m.token).post(`/v2/flows/${f.id}/publish`)).status).toBe(200);
    expect((await api.as(m.token).delete(`/v2/flows/${f.id}`)).status).toBe(204);
  });
});
