import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  Api,
  bearer,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import { Inbox } from '../team-inbox-conversations/support';

/**
 * Field-level authorization, mass assignment, response exposure and input ambiguity
 * (AUTHZ-013, 041..050, 091, 092, 094).
 *
 * Against the real app, real Postgres (restricted role, RLS) and real Redis. Rows are read back with the owner connection, so an
 * assertion is about what was STORED, not about what the response said. Every negative has a positive next to it: the same body without
 * the injected fields must succeed, so a rejection can never hide a broken route.
 *
 *   041  tenant / id / audit fields injected into create and update bodies are ignored or rejected (org_id, uuid, created_*, ...)
 *   045  privilege flags (role, isAdmin, permissions, passwordHash, plan, deletedAt, __proto__) are ignored or rejected
 *   044  system columns (id, uuid, org_id, created_at, row_version) of a PATCH survive an attempt to write them
 *   042  owner / assignee fields reach only users of the SAME tenant
 *   046  reassigning needs the reassign right where one exists
 *   050  an `own`-scope member cannot reassign a record out of their own view
 *   043  GET bodies carry no secret value and no other tenant's id (value scan against the database, key scan against the schema)
 *   047  custom field values versus the field-metadata permissions
 *   091  duplicate JSON keys behave like the single key that wins, never as a bypass
 *   092  array / nested / repeated query parameters never widen what a list returns
 *   094  path ids with encoded slashes, dots, case, unicode and traversal never reach another tenant's object or another route
 *   013  API key creation: injected fields do not mint a key for another tenant or revoke / extend it
 *
 * Which schemas are strict and which strip unknown keys is printed at the end of the run (informational: both are accepted, an unknown
 * key is never stored).
 */

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
interface Res {
  status: number;
  text: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- responses are read by name in assertions
  json: any;
}
interface RouteInfo {
  id: string;
  file: string;
  method: string;
  path: string;
  url: string;
  gate: string;
  permissions: string[];
  objectIdParams: string[];
  v1Api: boolean;
}
type Row = Record<string, unknown>;

let h: Harness;
let api: Api;
let A: Tenant;
let B: Tenant;
let bAdminUuid = '';
let _aAdminUuid = '';
let adminRoleUuid = '';
let viewerRoleUuid = '';
let _agentRoleUuid = '';
let colleague: { token: string; userId: number; uuid: string };
const T0 = Date.now() - 5 * 60_000;
const OLD = '2001-01-01T00:00:00.000Z';
const notes = {
  schemaMode: {} as Record<string, string>,
  policy: [] as string[],
  uncovered: [] as string[],
};

// ---- http ------------------------------------------------------------------------------------------------------------------------

let xff = 0;
const nextIp = () => `10.77.${Math.floor(xff / 250) % 250}.${xff++ % 250}`;

async function send(
  method: Method,
  url: string,
  token: string | null,
  body?: unknown,
  o: { raw?: string; headers?: Record<string, string> } = {},
): Promise<Res> {
  const http = request(h.app.getHttpServer());
  let req = http[method](url).set('x-forwarded-for', nextIp());
  if (token) req = req.set(bearer(token));
  if (method !== 'get') req = req.set('Idempotency-Key', randomUUID());
  for (const [k, v] of Object.entries(o.headers ?? {})) req = req.set(k, v);
  if (o.raw !== undefined) req = req.set('content-type', 'application/json').send(o.raw);
  else if (body !== undefined && method !== 'get' && method !== 'delete') {
    req = req.send(body as object);
  }
  const res = await req;
  return { status: res.status, text: typeof res.text === 'string' ? res.text : '', json: res.body };
}
const ok = (r: Res) => r.status >= 200 && r.status < 300;
const rejected = (r: Res) => r.status === 400 || r.status === 422;
const show = (r: Res) => `${r.status} ${r.text.slice(0, 700)}`;

let seq = 1;
const next = () => seq++;
const phone = () => `+9199${String(60000000 + next()).padStart(8, '0')}`;
const marker = (k: string) => `FL-${k}-${next()}`;
const LINE = { description: 'Consulting', qty: '2', unitPrice: '50.00' };

// ---- database helpers ------------------------------------------------------------------------------------------------------------

let uuidTables: string[] = [];
async function discover() {
  const r = await h.owner.query(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'uuid'
        AND table_name IN (SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'org_id')`,
  );
  uuidTables = (r.rows as Array<{ table_name: string }>).map((x) => x.table_name);
}

/** The row (as jsonb) a uuid belongs to, whichever table holds it. */
async function rowOf(uuid: string): Promise<{ table: string; row: Row } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) return null;
  const sql = uuidTables
    .map((t) => `SELECT '${t}' AS t, to_jsonb(x) AS r FROM "${t}" x WHERE x.uuid::text = $1`)
    .join(' UNION ALL ');
  const r = await h.owner.query(sql, [uuid.toLowerCase()]);
  const hit = r.rows[0] as { t: string; r: Row } | undefined;
  return hit ? { table: hit.t, row: hit.r } : null;
}
async function rowIn(table: string, uuid: string): Promise<Row | null> {
  const r = await h.owner.query(`SELECT to_jsonb(x) AS r FROM "${table}" x WHERE x.uuid = $1`, [
    uuid,
  ]);
  return (r.rows[0]?.r as Row | undefined) ?? null;
}
async function countOf(table: string, orgId: number): Promise<number> {
  const r = await h.owner.query(`SELECT count(*)::int AS n FROM "${table}" WHERE org_id = $1`, [
    orgId,
  ]);
  return r.rows[0].n as number;
}
const changedKeys = (a: Row, b: Row) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]),
  );
async function uuidOfUser(id: number): Promise<string> {
  return (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [id])).rows[0].uuid as string;
}
async function roleUuid(orgId: number, name: string): Promise<string> {
  return (
    await h.owner.query(`SELECT uuid FROM roles WHERE org_id = $1 AND name = $2`, [orgId, name])
  ).rows[0].uuid as string;
}

/** Walks a JSON value; the callback sees every key / value pair with its path. */
function walk(v: unknown, fn: (path: string, key: string, value: unknown) => void, path = '$') {
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, fn, `${path}[${i}]`));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Row)) {
      fn(`${path}.${k}`, k, x);
      walk(x, fn, `${path}.${k}`);
    }
  }
}

/** Places where a response repeats tenant B's id / slug or an id the caller injected. */
function echoes(json: unknown, injected: string[] = []): string[] {
  const out: string[] = [];
  walk(json, (path, key, value) => {
    if (/^(org_?id|tenant_?id|workspace_?id|organization_?id|workspace_?slug)$/i.test(key)) {
      if (value === B.orgId || value === String(B.orgId) || value === B.slug) out.push(path);
    }
    if (typeof value === 'string' && (value === B.slug || injected.includes(value))) out.push(path);
  });
  return out;
}

// ---- injected fields -------------------------------------------------------------------------------------------------------------

function tenantFields(mode: 'create' | 'patch'): Row {
  return {
    orgId: B.orgId,
    org_id: B.orgId,
    organizationId: B.orgId,
    tenantId: B.slug,
    tenant_id: B.slug,
    workspaceId: B.slug,
    workspace_id: B.slug,
    workspaceSlug: B.slug,
    id: randomUUID(),
    uuid: randomUUID(),
    createdAt: OLD,
    created_at: OLD,
    updatedAt: OLD,
    updated_at: OLD,
    createdBy: B.adminUserId,
    created_by: B.adminUserId,
    createdByUserId: bAdminUuid,
    updatedBy: B.adminUserId,
    updated_by: B.adminUserId,
    legacyId: 'legacy-hack',
    submittedByAgentId: B.adminUserId,
    row_version: 9999,
    ...(mode === 'create' ? { rowVersion: 9999 } : {}),
  };
}
function privilegeFields(includeStatus: boolean): Row {
  // JSON.parse makes `__proto__` an OWN key, the way a hostile client sends it (an object literal would set the prototype instead).
  const o = JSON.parse(
    '{"__proto__":{"isAdmin":true,"polluted":"yes"},"constructor":{"prototype":{"isAdmin":true}}}',
  ) as Row;
  Object.assign(o, {
    role: 'admin',
    roleId: adminRoleUuid,
    roleIds: [adminRoleUuid],
    isAdmin: true,
    is_admin: true,
    isOwner: true,
    isSuperAdmin: true,
    is_super_admin: true,
    permissions: ['*'],
    grants: [{ permissionKey: '*', effect: 'allow', recordScope: 'all' }],
    passwordHash: '$argon2id$v=19$injected',
    password_hash: '$argon2id$v=19$injected',
    emailVerifiedAt: OLD,
    email_verified_at: OLD,
    emailVerified: true,
    mfaEnabled: false,
    deletedAt: OLD,
    deleted_at: OLD,
    isArchived: true,
    lifecycleState: 'deleted',
    planId: 'enterprise',
    plan: 'enterprise',
    billingStatus: 'active',
    walletBalance: 999999,
    credits: 999999,
    isSystem: true,
    approved: true,
    verified: true,
    ...(includeStatus ? { status: 'closed' } : {}),
  });
  return o;
}

// ---- families --------------------------------------------------------------------------------------------------------------------

interface Fam {
  key: string;
  /** Permission keys of the member who writes (create + update + read). */
  grants: string[];
  createUrl: string;
  prep?: () => Promise<Row>;
  body: (m: string, c: Row) => Row;
  idOf?: (j: Res['json']) => string;
  /** Keys of the legitimate body that are also in the injection set: the family really accepts them. */
  skip?: string[];
  patch?: {
    method: 'patch' | 'put';
    url: (id: string) => string;
    body: (m: string, rv: number, c: Row) => Row;
    /** Columns the legitimate change is allowed to move. */
    cols: string[];
    noRowVersion?: boolean;
  };
  /** Extra fields only this family has (money, state machines). */
  extra?: Row;
}

const ROLE_GRANT = { permissionKey: 'record.contacts.read', effect: 'allow', recordScope: 'own' };
const GRAPH = {
  flowNodes: [
    { id: 'n_trig', type: 'trigger', x: 0, y: 0, data: { kind: 'keyword', keywords: 'hi' } },
    { id: 'n_msg', type: 'message', x: 300, y: 0, data: { text: 'hello' } },
  ],
  flowEdges: [{ id: 'e_1', source: 'n_trig', sourceHandle: 'out', target: 'n_msg' }],
  vars: [],
};
const field = (id: string, kind: string, over: Row = {}) => ({
  id,
  type: 'field',
  kind,
  label: id,
  ...over,
});

/** A role without any permission: handing it out never exceeds what the member who hands it out holds. */
async function emptyRole(): Promise<string> {
  const r = await h.owner.query(`INSERT INTO roles (org_id, name) VALUES ($1, $2) RETURNING uuid`, [
    A.orgId,
    marker('empty-role'),
  ]);
  return r.rows[0].uuid as string;
}

const FAMILIES: Fam[] = [
  {
    key: 'contacts',
    grants: ['record.contacts.create', 'record.contacts.update', 'record.contacts.read'],
    createUrl: '/v2/contacts',
    skip: ['status', 'lifecycleState'],
    body: (m) => ({ name: m, phone: phone(), email: `${m.toLowerCase()}@example.test` }),
    patch: {
      method: 'patch',
      url: (id) => `/v2/contacts/${id}`,
      body: (m, rv) => ({ name: `${m}-u`, rowVersion: rv }),
      cols: ['name', 'first_name', 'last_name'],
    },
  },
  {
    key: 'companies',
    grants: ['record.companies.create', 'record.companies.update', 'record.companies.read'],
    createUrl: '/v2/companies',
    body: (m) => ({ name: m, email: `${m.toLowerCase()}@example.test` }),
    patch: {
      method: 'patch',
      url: (id) => `/v2/companies/${id}`,
      body: (m, rv) => ({ name: `${m}-u`, rowVersion: rv }),
      cols: ['name'],
    },
  },
  {
    key: 'tasks',
    grants: ['record.tasks.create', 'record.tasks.update', 'record.tasks.read'],
    createUrl: '/v2/tasks',
    skip: ['status'],
    body: (m) => ({ title: m }),
    patch: {
      method: 'patch',
      url: (id) => `/v2/tasks/${id}`,
      body: (m, rv) => ({ title: `${m}-u`, rowVersion: rv }),
      cols: ['title'],
    },
  },
  {
    key: 'deals',
    grants: ['record.deals.create', 'record.deals.update', 'record.deals.read'],
    createUrl: '/v2/deals',
    prep: async () => {
      const res = await send('get', '/v2/pipelines', A.admin);
      const p = (res.json as Array<Row>).find((x) => x.isDefault) as Row;
      const stage = (p.stages as Array<Row>).find((s) => s.kind === 'open') as Row;
      return { pipelineId: p.id, stageId: stage.id };
    },
    body: (m, c) => ({ title: m, pipelineId: c.pipelineId, stageId: c.stageId, value: '100.00' }),
    patch: {
      method: 'patch',
      url: (id) => `/v2/deals/${id}`,
      body: (m, rv) => ({ title: `${m}-u`, rowVersion: rv }),
      cols: ['title'],
    },
    extra: { won: true, wonAt: OLD, lostAt: OLD, closedAt: OLD, probability: 100 },
  },
  {
    key: 'tags',
    grants: ['record.tags.create', 'record.tags.update', 'record.tags.read'],
    createUrl: '/v2/tags',
    body: (m) => ({ name: m }),
    patch: {
      method: 'patch',
      url: (id) => `/v2/tags/${id}`,
      body: (m, rv) => ({ name: `${m}-u`, rowVersion: rv }),
      cols: ['name'],
    },
  },
  {
    key: 'contact-groups',
    grants: [
      'record.contact-groups.create',
      'record.contact-groups.update',
      'record.contact-groups.read',
    ],
    createUrl: '/v2/contact-groups',
    body: (m) => ({ name: m }),
    patch: {
      method: 'patch',
      url: (id) => `/v2/contact-groups/${id}`,
      body: (m, rv) => ({ name: `${m}-u`, rowVersion: rv }),
      cols: ['name'],
    },
  },
  {
    key: 'segments',
    grants: ['record.segments.create', 'record.segments.update', 'record.segments.read'],
    createUrl: '/v2/segments',
    body: (m) => ({
      name: m,
      visibility: 'shared',
      rules: {
        type: 'group',
        combinator: 'and',
        children: [{ type: 'condition', field: 'name', operator: 'contains', value: m }],
      },
    }),
    patch: {
      method: 'patch',
      url: (id) => `/v2/segments/${id}`,
      body: (m, rv) => ({ name: `${m}-u`, rowVersion: rv }),
      cols: ['name'],
    },
  },
  {
    key: 'forms',
    grants: ['record.forms.create', 'record.forms.update', 'record.forms.read'],
    createUrl: '/v2/forms',
    body: (m) => ({
      name: m,
      definition: {
        title: 'Get in touch',
        steps: [
          {
            id: 'main',
            blocks: [
              field('name', 'short_text', {
                required: true,
                bind: { object: 'contact', property: 'name' },
              }),
              field('email', 'email', {
                required: true,
                bind: { object: 'contact', property: 'email' },
              }),
            ],
          },
        ],
        settings: { phoneCountryCode: '91', successMessage: '<p>Thanks</p>' },
        mapping: { company: { match: 'name_or_domain' } },
        after: { tags: ['Website'] },
      },
    }),
    patch: {
      method: 'patch',
      url: (id) => `/v2/forms/${id}`,
      body: (m, rv) => ({ name: `${m}-u`, rowVersion: rv }),
      cols: ['name'],
    },
    extra: { publishedAt: OLD, publicKey: 'hijacked-public-key', submissionCount: 99999 },
  },
  {
    key: 'flows',
    grants: ['flb.flows.create', 'flb.flows.update', 'flb.flows.read'],
    createUrl: '/v2/flows',
    body: (m) => ({ name: m, graph: GRAPH }),
    patch: {
      method: 'patch',
      url: (id) => `/v2/flows/${id}/rename`,
      body: (m, rv) => ({ name: `${m}-u`, rowVersion: rv }),
      cols: ['name', 'flow_name'],
      // the rename route takes the name only: a rowVersion in the body is not read (recorded, not a finding for this file)
      noRowVersion: true,
    },
    extra: { published: true, publishedAt: OLD, isActive: true },
  },
  {
    key: 'roles',
    grants: ['admin.role.manage', 'record.contacts.read'],
    createUrl: '/v2/roles',
    skip: ['grants', 'permissions'],
    body: (m) => ({ name: m, grants: [ROLE_GRANT] }),
    patch: {
      method: 'patch',
      url: (id) => `/v2/roles/${id}`,
      body: (m, rv) => ({ name: `${m}-u`, rowVersion: rv }),
      cols: ['name'],
    },
    extra: { isBuiltin: true, is_builtin: true, system: true, key: 'owner' },
  },
  {
    key: 'users',
    grants: ['admin.user.manage', 'org.member.invite', 'org.member.role_assign'],
    createUrl: '/v2/users',
    skip: ['role', 'roleId', 'roleIds', 'emailVerifiedAt', 'emailVerified'],
    prep: async () => ({ roleId: await emptyRole() }),
    body: (m, c) => ({
      email: `${m.toLowerCase()}@example.test`,
      fullName: m,
      password: 'Str0ngPassw0rd#1',
      roleIds: [c.roleId],
    }),
    patch: {
      method: 'patch',
      url: (id) => `/v2/users/${id}`,
      body: (m, rv) => ({ fullName: `${m}-u`, rowVersion: rv }),
      cols: ['full_name', 'name'],
    },
    extra: {
      isActive: true,
      is_active: true,
      lockedUntil: null,
      failedLogins: 0,
      mustChangePassword: false,
    },
  },
  {
    key: 'webhooks',
    grants: ['webhooks.manage'],
    createUrl: '/v2/webhooks',
    body: (m) => ({
      name: m,
      url: 'https://8.8.8.8/in',
      events: ['contact_created'],
      secret: `whsec_${m}`,
    }),
    patch: {
      method: 'patch',
      url: (id) => `/v2/webhooks/${id}`,
      body: (m) => ({ name: `${m}-u` }),
      cols: ['name'],
      noRowVersion: true,
    },
    extra: { failureCount: 0, disabledAt: null, lastDeliveryAt: OLD },
  },
  {
    key: 'lead-sources',
    grants: ['leads.sources.manage'],
    createUrl: '/v2/lead-sources',
    body: (m) => ({ name: m }),
    patch: {
      method: 'patch',
      url: (id) => `/v2/lead-sources/${id}`,
      body: (m, rv) => ({ name: `${m}-u`, rowVersion: rv }),
      cols: ['name'],
    },
    extra: { token: 'hijacked-token', hookToken: 'hijacked-token', leadCount: 99999 },
  },
  {
    key: 'teams',
    grants: ['inbox.team.manage'],
    createUrl: '/v2/workspace/teams',
    body: (m) => ({ name: m }),
    patch: {
      method: 'patch',
      url: (id) => `/v2/workspace/teams/${id}`,
      body: (m, rv) => ({ name: `${m}-u`, rowVersion: rv }),
      cols: ['name'],
    },
  },
  {
    key: 'invoices',
    grants: ['record.invoices.create', 'record.invoices.update', 'record.invoices.read'],
    createUrl: '/v2/invoices',
    body: (m) => ({ buyerName: m, lines: [LINE] }),
    patch: {
      method: 'patch',
      url: (id) => `/v2/invoices/${id}`,
      body: (m, rv) => ({ buyerName: `${m}-u`, rowVersion: rv }),
      cols: ['buyer_name'],
    },
    extra: {
      total: '0.01',
      totalMinor: 1,
      subtotal: '0.01',
      amountPaid: '999999.00',
      amountPaidMinor: 99999900,
      paidAt: OLD,
      number: 'INV-HACK-1',
      publicToken: 'hijacked-public-token',
      issuedAt: OLD,
    },
  },
  {
    key: 'sales-orders',
    grants: [
      'record.sales-orders.create',
      'record.sales-orders.update',
      'record.sales-orders.read',
    ],
    createUrl: '/v2/sales-orders',
    body: (m) => ({ buyerName: m, lines: [LINE] }),
    patch: {
      method: 'patch',
      url: (id) => `/v2/sales-orders/${id}`,
      body: (m, rv) => ({ buyerName: `${m}-u`, rowVersion: rv }),
      cols: ['buyer_name'],
    },
    extra: {
      total: '0.01',
      totalMinor: 1,
      fulfilledAt: OLD,
      invoiceId: randomUUID(),
      number: 'SO-HACK-1',
    },
  },
  {
    key: 'catalog-products',
    grants: ['cat.products.create', 'cat.products.update', 'cat.products.read'],
    createUrl: '/v2/catalog/products',
    body: (m) => ({ name: m, priceMajor: '1299.50', currencyCode: 'INR' }),
    patch: {
      method: 'put',
      url: (id) => `/v2/catalog/products/${id}`,
      body: (m, rv) => ({
        name: `${m}-u`,
        priceMajor: '1299.50',
        currencyCode: 'INR',
        rowVersion: rv,
      }),
      cols: ['name'],
    },
    extra: { metaProductId: 'hijacked', retailerId: 'hijacked', reviewStatus: 'approved' },
  },
  {
    key: 'api-keys',
    grants: ['api.keys.create', 'api.keys.read'],
    createUrl: '/v2/developer/keys',
    idOf: (j) => j.key.id,
    body: (m) => ({ name: m }),
    extra: {
      prefix: 'wsk_hijacked',
      keyHash: 'hijacked',
      key_hash: 'hijacked',
      secret: 'wsk_hijacked_secret',
      revokedAt: OLD,
      expiresAt: '2099-01-01T00:00:00.000Z',
      lastUsedAt: OLD,
      scopes: undefined,
    },
  },
  {
    key: 'support-tickets',
    grants: ['support.ticket.create', 'support.ticket.read'],
    createUrl: '/v2/support/tickets',
    body: (m) => ({
      reason: 'billing',
      name: m,
      email: `${m.toLowerCase()}@example.test`,
      subject: m,
      message: `${m} body`,
    }),
    extra: {
      ticketNumber: 'T-HACK',
      priority: 'urgent',
      assignedTo: 999999,
      closedAt: OLD,
      internal: true,
    },
  },
  {
    key: 'invitations',
    grants: ['org.member.invite', 'org.member.role_assign'],
    createUrl: '/v2/workspace/members/invite',
    idOf: (j) => j.member.id,
    skip: ['role', 'roleId', 'roleIds', 'isAdmin', 'isOwner'],
    prep: async () => ({ roleId: await emptyRole() }),
    body: (m, c) => ({ fullName: m, email: `${m.toLowerCase()}@example.test`, roleId: c.roleId }),
    extra: { acceptedAt: OLD, token: 'hijacked-invite-token', invitedBy: 999999 },
  },
];

interface Ready {
  ctx: Row;
  member: { token: string; userId: number };
  table: string;
  baseId: string;
}
const readyCache = new Map<string, Promise<Ready>>();

/** The owner / assignee of a record as the API shows it: contacts carry `ownerId`, the others an `owner` / `assignee` object. */
const ownerIn = (j: Row | undefined): string | null =>
  (j?.ownerId as string | undefined) ??
  ((j?.owner as Row | null | undefined)?.id as string | undefined) ??
  ((j?.assignee as Row | null | undefined)?.id as string | undefined) ??
  null;

const idOfRes = (f: Fam, r: Res): string => (f.idOf ? f.idOf(r.json) : (r.json?.id as string));

function ready(f: Fam): Promise<Ready> {
  let p = readyCache.get(f.key);
  if (!p) {
    p = (async () => {
      const ctx = (await f.prep?.()) ?? {};
      const member = await api.member(
        A,
        `m-${f.key}`.slice(0, 20),
        f.grants.map((k) => [k, 'all'] as Grant),
      );
      const res = await send('post', f.createUrl, A.admin, f.body(marker(f.key), ctx));
      if (!ok(res)) throw new Error(`setup ${f.key}: POST ${f.createUrl} -> ${show(res)}`);
      const id = idOfRes(f, res);
      const hit = await rowOf(id);
      if (!hit) throw new Error(`setup ${f.key}: no row for ${id}`);
      return { ctx, member, table: hit.table, baseId: id };
    })();
    readyCache.set(f.key, p);
  }
  return p;
}

/** An object created by the admin, plus its row, for an update test. */
async function fresh(f: Fam, r: Ready) {
  const res = await send('post', f.createUrl, A.admin, f.body(marker(f.key), r.ctx));
  expect(ok(res), `setup create ${f.key}: ${show(res)}`).toBe(true);
  const id = idOfRes(f, res);
  const hit = (await rowOf(id))!;
  return { id, row: hit.row, rv: Number(hit.row.row_version ?? 1) };
}

const SYSTEM_COLS = ['id', 'uuid', 'org_id', 'created_at', 'created_by'];
const ALWAYS_MOVES = [
  'updated_at',
  'updated_by',
  'row_version',
  'search_vector',
  'normalized_email',
  'normalized_phone',
];

function injectionFor(f: Fam, kind: 'tenant' | 'privilege', mode: 'create' | 'patch'): Row {
  const skip = new Set(f.skip ?? []);
  const base =
    kind === 'tenant'
      ? tenantFields(mode)
      : { ...privilegeFields(!skip.has('status')), ...(f.extra ?? {}) };
  for (const k of skip) delete base[k];
  return base;
}
const injectedIds = (inj: Row) =>
  [inj.id, inj.uuid].filter((x): x is string => typeof x === 'string');
const noPollution = () => {
  expect(({} as Row).isAdmin).toBeUndefined();
  expect(({} as Row).polluted).toBeUndefined();
};

afterEach(noPollution);

// ---- setup -----------------------------------------------------------------------------------------------------------------------

beforeAll(async () => {
  process.env.CHANNEL_SIMULATOR_ENABLED = 'true';
  h = await startHarness();
  api = new Api(h);
  await discover();
  A = await api.signup('fl-a');
  B = await api.signup('fl-b');
  const open = JSON.stringify({
    features: { form_builder: true },
    limits: { api_keys: 500, api_rate_limit_per_minute: -1 },
  });
  for (const t of [A, B]) {
    await h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
      t.orgId,
      open,
    ]);
  }
  bAdminUuid = await uuidOfUser(B.adminUserId);
  _aAdminUuid = await uuidOfUser(A.adminUserId);
  adminRoleUuid = (
    await h.owner.query(
      `SELECT r.uuid FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND ur.org_id = $2 LIMIT 1`,
      [A.adminUserId, A.orgId],
    )
  ).rows[0].uuid as string;
  viewerRoleUuid = await roleUuid(A.orgId, 'Viewer');
  _agentRoleUuid = await roleUuid(A.orgId, 'Agent');
  const c = await api.member(A, 'colleague', []);
  colleague = { ...c, uuid: await uuidOfUser(c.userId) };
}, 600_000);

afterAll(async () => {
  console.info(
    `[field-level] request schema behaviour on an unknown key (informational): ${JSON.stringify(notes.schemaMode)}`,
  );
  if (notes.policy.length)
    console.info(`[field-level] POLICY-DECISION: ${JSON.stringify(notes.policy)}`);
  if (notes.uncovered.length)
    console.info(`[field-level] not covered: ${JSON.stringify(notes.uncovered)}`);
  await h?.stop();
}, 120_000);

// ---- 1. mass assignment ----------------------------------------------------------------------------------------------------------

for (const f of FAMILIES) {
  describe(`mass assignment: ${f.key}`, () => {
    it(`AUTHZ-041 ${f.key}: the legitimate body creates the object (positive control, schema strictness probe)`, async () => {
      const r = await ready(f);
      const plain = await send('post', f.createUrl, r.member.token, f.body(marker(f.key), r.ctx));
      expect(ok(plain), show(plain)).toBe(true);
      const row = (await rowOf(idOfRes(f, plain)))!;
      expect(Number(row.row.org_id)).toBe(A.orgId);
      const probe = await send('post', f.createUrl, r.member.token, {
        ...f.body(marker(f.key), r.ctx),
        zzUnknownField: 'x',
      });
      expect(probe.status, show(probe)).toBeLessThan(500);
      notes.schemaMode[f.key] = ok(probe) ? 'strip-unknown' : `strict(${probe.status})`;
    });

    it(`AUTHZ-041 ${f.key}: injected orgId, id, createdAt and createdBy on create are ignored`, async () => {
      const r = await ready(f);
      const inj = injectionFor(f, 'tenant', 'create');
      const beforeB = await countOf(r.table, B.orgId);
      const res = await send('post', f.createUrl, r.member.token, {
        ...inj,
        ...f.body(marker(f.key), r.ctx),
      });
      expect(res.status, show(res)).toBeLessThan(500);
      expect(ok(res) || rejected(res), `neither stored nor rejected cleanly: ${show(res)}`).toBe(
        true,
      );
      expect(await countOf(r.table, B.orgId), 'a row appeared in tenant B').toBe(beforeB);
      expect(
        echoes(res.json, injectedIds(inj)),
        'response echoes an injected tenant or id',
      ).toEqual([]);
      if (ok(res)) {
        const id = idOfRes(f, res);
        expect(injectedIds(inj)).not.toContain(id);
        const hit = (await rowOf(id))!;
        expect(Number(hit.row.org_id)).toBe(A.orgId);
        expect(hit.row.uuid).toBe(id);
        expect(new Date(hit.row.created_at as string).getTime()).toBeGreaterThan(T0);
        if (hit.row.created_by != null) expect(Number(hit.row.created_by)).toBe(r.member.userId);
        if ('updated_by' in hit.row && hit.row.updated_by != null) {
          expect(Number(hit.row.updated_by)).not.toBe(B.adminUserId);
        }
        if (typeof hit.row.row_version === 'number')
          expect(hit.row.row_version as number).toBeLessThan(100);
        if ('legacy_id' in hit.row) expect(hit.row.legacy_id).not.toBe('legacy-hack');
      }
    });

    it(`AUTHZ-045 ${f.key}: injected role, admin, password, plan and __proto__ fields on create are ignored`, async () => {
      const r = await ready(f);
      const inj = injectionFor(f, 'privilege', 'create');
      const beforeB = await countOf(r.table, B.orgId);
      const res = await send('post', f.createUrl, r.member.token, {
        ...inj,
        ...f.body(marker(f.key), r.ctx),
      });
      expect(res.status, show(res)).toBeLessThan(500);
      expect(ok(res) || rejected(res), show(res)).toBe(true);
      expect(await countOf(r.table, B.orgId)).toBe(beforeB);
      if (ok(res)) {
        const hit = (await rowOf(idOfRes(f, res)))!;
        expect(Number(hit.row.org_id)).toBe(A.orgId);
        expect(hit.row.deleted_at ?? null, 'deleted_at taken from the body').toBeNull();
        for (const k of [
          'password_hash',
          'is_admin',
          'is_owner',
          'is_super_admin',
          'plan',
          'plan_id',
          'credits',
        ]) {
          if (k in hit.row && !(f.skip ?? []).includes(k)) {
            expect(String(hit.row[k] ?? ''), `${k} taken from the body`).not.toMatch(
              /injected|enterprise|999999|^true$/,
            );
          }
        }
        // the privileged shape of the object stays what the route produces: a user keeps the roles it was given
        if (f.key === 'users') {
          const roles = await h.owner.query(
            `SELECT r.uuid FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id WHERE u.uuid = $1`,
            [idOfRes(f, res)],
          );
          expect(roles.rows.map((x) => x.uuid)).toEqual([r.ctx.roleId]);
          expect(String(hit.row.password_hash)).not.toContain('injected');
        }
        if (f.key === 'invitations') {
          const roles = JSON.stringify(hit.row);
          expect(roles).not.toContain(adminRoleUuid);
        }
      }
    });

    if (f.patch) {
      const p = f.patch;

      it(`AUTHZ-041 ${f.key}: the legitimate update changes the row (positive control)`, async () => {
        const r = await ready(f);
        const o = await fresh(f, r);
        const res = await send(
          p.method,
          p.url(o.id),
          r.member.token,
          p.body(marker(f.key), o.rv, r.ctx),
        );
        expect(ok(res), show(res)).toBe(true);
        const after = (await rowIn(r.table, o.id))!;
        const moved = changedKeys(o.row, after);
        expect(
          moved.some((k) => p.cols.includes(k)),
          `none of ${p.cols} changed; moved ${moved}`,
        ).toBe(true);
        expect(moved.filter((k) => !p.cols.includes(k) && !ALWAYS_MOVES.includes(k))).toEqual([]);
      });

      it(`AUTHZ-041 ${f.key}: injected orgId, id, createdAt and createdBy on update change nothing but the legitimate field`, async () => {
        const r = await ready(f);
        const o = await fresh(f, r);
        const inj = injectionFor(f, 'tenant', 'patch');
        const beforeB = await countOf(r.table, B.orgId);
        const res = await send(p.method, p.url(o.id), r.member.token, {
          ...inj,
          ...p.body(marker(f.key), o.rv, r.ctx),
        });
        expect(res.status, show(res)).toBeLessThan(500);
        expect(ok(res) || rejected(res), show(res)).toBe(true);
        const after = (await rowIn(r.table, o.id))!;
        expect(after, 'row vanished or moved to another uuid').not.toBeNull();
        const moved = changedKeys(o.row, after);
        expect(
          moved.filter((k) => SYSTEM_COLS.includes(k)),
          'system columns moved',
        ).toEqual([]);
        expect(
          moved.filter((k) => !p.cols.includes(k) && !ALWAYS_MOVES.includes(k)),
          'unexpected columns moved',
        ).toEqual([]);
        if (!ok(res)) expect(moved, 'a rejected update still changed the row').toEqual([]);
        expect(await countOf(r.table, B.orgId)).toBe(beforeB);
        expect(echoes(res.json, injectedIds(inj))).toEqual([]);
        if (ok(res) && res.json?.id) expect(res.json.id).toBe(o.id);
      });

      it(`AUTHZ-045 ${f.key}: injected role, admin, password, plan, deletedAt and __proto__ fields on update change nothing`, async () => {
        const r = await ready(f);
        const o = await fresh(f, r);
        const inj = injectionFor(f, 'privilege', 'patch');
        const res = await send(p.method, p.url(o.id), r.member.token, {
          ...inj,
          ...p.body(marker(f.key), o.rv, r.ctx),
        });
        expect(res.status, show(res)).toBeLessThan(500);
        expect(ok(res) || rejected(res), show(res)).toBe(true);
        const after = (await rowIn(r.table, o.id))!;
        const moved = changedKeys(o.row, after);
        expect(
          moved.filter((k) => !p.cols.includes(k) && !ALWAYS_MOVES.includes(k)),
          'unexpected columns moved',
        ).toEqual([]);
        expect(after.deleted_at ?? null).toBeNull();
        if (!ok(res)) expect(moved).toEqual([]);
        // the object is still reachable by the legitimate writer (the injected deletedAt / isArchived did not hide it)
        const row2 = await rowOf(o.id);
        expect(row2).not.toBeNull();
      });

      it(`AUTHZ-044 ${f.key}: createdAt, id, org_id and row_version in an update body leave the system columns alone`, async () => {
        const r = await ready(f);
        const o = await fresh(f, r);
        const foreignId = randomUUID();
        const res = await send(p.method, p.url(o.id), r.member.token, {
          ...p.body(marker(f.key), o.rv, r.ctx),
          createdAt: OLD,
          created_at: OLD,
          id: foreignId,
          uuid: foreignId,
          org_id: B.orgId,
          orgId: B.orgId,
          row_version: 9999,
        });
        expect(res.status, show(res)).toBeLessThan(500);
        expect(ok(res) || rejected(res), show(res)).toBe(true);
        const after = (await rowIn(r.table, o.id))!;
        expect(after).not.toBeNull();
        for (const k of ['id', 'uuid', 'org_id', 'created_at'])
          expect(after[k], k).toEqual(o.row[k]);
        if (ok(res) && typeof o.row.row_version === 'number') {
          expect(after.row_version, 'row_version is the server counter, +1 per write').toBe(
            (o.row.row_version as number) + 1,
          );
        }
        if (!p.noRowVersion) {
          // optimistic lock still wins over everything else in the body
          const stale = await send(p.method, p.url(o.id), r.member.token, {
            ...p.body(marker(f.key), o.rv + 50, r.ctx),
          });
          expect(stale.status, `a wrong rowVersion must be a conflict: ${show(stale)}`).toBe(409);
          const still = (await rowIn(r.table, o.id))!;
          expect(JSON.stringify(still)).toBe(JSON.stringify(after));
        }
      });
    }
  });
}

// ---- 1b. workspace settings (singleton rows) -------------------------------------------------------------------------------------

describe('mass assignment: workspace settings', () => {
  it('AUTHZ-046 workspace branding: injected slug, plan, status and org fields do not change the organization', async () => {
    const member = await api.member(A, 'branding', [['auth.branding.update', 'all']]);
    const org = async () =>
      (await h.owner.query(`SELECT to_jsonb(o) AS r FROM organizations o WHERE id = $1`, [A.orgId]))
        .rows[0].r as Row;
    const plan = async () =>
      (
        await h.owner.query(`SELECT to_jsonb(p) AS r FROM org_plan_state p WHERE org_id = $1`, [
          A.orgId,
        ])
      ).rows[0].r as Row;
    const bBefore = (
      await h.owner.query(`SELECT to_jsonb(o) AS r FROM organizations o WHERE id = $1`, [B.orgId])
    ).rows[0].r as Row;
    const before = await org();
    const planBefore = await plan();
    const okRes = await send('patch', '/v2/account/branding', member.token, {
      messageFooter: 'FL footer',
    });
    expect(ok(okRes), show(okRes)).toBe(true);
    const mid = await org();
    const res = await send('patch', '/v2/account/branding', member.token, {
      ...privilegeFields(true),
      ...tenantFields('patch'),
      slug: 'hijacked-slug',
      name: 'Hijacked Org',
      messageFooter: 'FL footer 2',
      ownerUserId: B.adminUserId,
      ownerId: bAdminUuid,
      suspendedAt: OLD,
      trialEndsAt: '2099-01-01T00:00:00.000Z',
    });
    expect(res.status, show(res)).toBeLessThan(500);
    expect(ok(res) || rejected(res)).toBe(true);
    const after = await org();
    const allowed = new Set([...changedKeys(before, mid), 'updated_at', 'row_version', 'settings']);
    expect(
      changedKeys(mid, after).filter((k) => !allowed.has(k)),
      'organization columns moved',
    ).toEqual([]);
    for (const k of ['id', 'uuid', 'slug', 'name', 'status', 'created_at'])
      expect(after[k], k).toEqual(before[k]);
    expect(await plan(), 'the plan row moved').toEqual(planBefore);
    const bAfter = (
      await h.owner.query(`SELECT to_jsonb(o) AS r FROM organizations o WHERE id = $1`, [B.orgId])
    ).rows[0].r as Row;
    expect(bAfter, 'tenant B organization moved').toEqual(bBefore);
    expect(echoes(res.json)).toEqual([]);
  });

  it('AUTHZ-046 translation settings: injected plan and org fields do not change the plan or the organization', async () => {
    const member = await api.member(A, 'i18n', [
      ['i18n.translation_settings.read', 'all'],
      ['i18n.translation_settings.update', 'all'],
    ]);
    const plan = async () =>
      (
        await h.owner.query(`SELECT to_jsonb(p) AS r FROM org_plan_state p WHERE org_id = $1`, [
          A.orgId,
        ])
      ).rows[0].r as Row;
    const planBefore = await plan();
    const got = await send('get', '/v2/workspace/translation-settings', member.token);
    expect(got.status, show(got)).toBe(200);
    const rv = Number(got.json.rowVersion ?? 0);
    const res = await send('patch', '/v2/workspace/translation-settings', member.token, {
      ...privilegeFields(true),
      ...tenantFields('patch'),
      enabled: false,
      rowVersion: rv,
    });
    expect(res.status, show(res)).toBeLessThan(500);
    expect(ok(res) || rejected(res), show(res)).toBe(true);
    expect(await plan(), 'the plan row moved').toEqual(planBefore);
    const bRow = await h.owner.query(
      `SELECT count(*)::int AS n FROM organizations WHERE slug = 'hijacked'`,
    );
    expect(bRow.rows[0].n).toBe(0);
    expect(echoes(res.json)).toEqual([]);
  });
});

// ---- 13. API key creation --------------------------------------------------------------------------------------------------------

describe('API key creation', () => {
  it('AUTHZ-013 API keys: injected tenant, revocation, expiry and prefix fields do not shape the minted key', async () => {
    const member = await api.member(A, 'keymaker', [
      ['api.keys.create', 'all'],
      ['api.keys.read', 'all'],
    ]);
    const res = await send('post', '/v2/developer/keys', member.token, {
      ...tenantFields('create'),
      ...privilegeFields(true),
      name: marker('key'),
      prefix: 'wsk_hijacked',
      keyHash: 'hijacked',
      revokedAt: OLD,
      expiresAt: '2099-01-01T00:00:00.000Z',
      lastUsedAt: OLD,
    });
    expect(res.status, show(res)).toBeLessThan(500);
    expect(ok(res), show(res)).toBe(true);
    const row = (await rowOf(res.json.key.id))!;
    expect(row.table).toBe('api_keys');
    expect(Number(row.row.org_id)).toBe(A.orgId);
    expect(row.row.revoked_at ?? null).toBeNull();
    expect(row.row.expires_at ?? null).toBeNull();
    expect(String(row.row.prefix ?? res.json.key.prefix)).not.toContain('hijacked');
    expect(String(res.json.secret)).toMatch(/^wsk_/);
    expect(String(res.json.secret)).not.toContain('hijacked');
    expect(res.json.key.scopes ?? []).toEqual([]);
    expect(echoes(res.json)).toEqual([]);
    // the secret is shown once: a later read of the key never carries it nor the stored hash
    const list = await send('get', '/v2/developer/keys', member.token);
    expect(list.status).toBe(200);
    expect(list.text).not.toContain(res.json.secret);
    for (const col of ['key_hash', 'hash', 'secret_hash']) {
      if (typeof row.row[col] === 'string' && (row.row[col] as string).length > 12) {
        expect(list.text).not.toContain(row.row[col] as string);
      }
    }
  });

  it('AUTHZ-013 API keys: a member without api.keys.create cannot mint one even with every field in the body', async () => {
    const reader = await api.member(A, 'keyreader', [['api.keys.read', 'all']]);
    const before = await countOf('api_keys', A.orgId);
    const res = await send('post', '/v2/developer/keys', reader.token, {
      name: marker('key'),
      scopes: [],
    });
    expect(res.status, show(res)).toBe(403);
    expect(await countOf('api_keys', A.orgId)).toBe(before);
  });
});

// ---- 2. owner / assignee fields --------------------------------------------------------------------------------------------------

interface OwnerFam {
  key: string;
  field: 'ownerId' | 'assigneeId';
  read: string;
  create: string;
  update: string;
  createUrl: string;
  detail: (id: string) => string;
  body: (m: string, c: Row) => Row;
  patchBody: (m: string, rv: number) => Row;
  prep?: () => Promise<Row>;
}
const OWNER_FAMS: OwnerFam[] = [
  {
    key: 'contacts',
    field: 'ownerId',
    read: 'record.contacts.read',
    create: 'record.contacts.create',
    update: 'record.contacts.update',
    createUrl: '/v2/contacts',
    detail: (id) => `/v2/contacts/${id}`,
    body: (m) => ({ name: m, phone: phone() }),
    patchBody: (m, rv) => ({ name: `${m}-u`, rowVersion: rv }),
  },
  {
    key: 'companies',
    field: 'ownerId',
    read: 'record.companies.read',
    create: 'record.companies.create',
    update: 'record.companies.update',
    createUrl: '/v2/companies',
    detail: (id) => `/v2/companies/${id}`,
    body: (m) => ({ name: m }),
    patchBody: (m, rv) => ({ name: `${m}-u`, rowVersion: rv }),
  },
  {
    key: 'tasks',
    field: 'assigneeId',
    read: 'record.tasks.read',
    create: 'record.tasks.create',
    update: 'record.tasks.update',
    createUrl: '/v2/tasks',
    detail: (id) => `/v2/tasks/${id}`,
    body: (m) => ({ title: m }),
    patchBody: (m, rv) => ({ title: `${m}-u`, rowVersion: rv }),
  },
  {
    key: 'deals',
    field: 'ownerId',
    read: 'record.deals.read',
    create: 'record.deals.create',
    update: 'record.deals.update',
    createUrl: '/v2/deals',
    detail: (id) => `/v2/deals/${id}`,
    prep: async () => {
      const res = await send('get', '/v2/pipelines', A.admin);
      const p = (res.json as Array<Row>).find((x) => x.isDefault) as Row;
      const stage = (p.stages as Array<Row>).find((s) => s.kind === 'open') as Row;
      return { pipelineId: p.id, stageId: stage.id };
    },
    body: (m, c) => ({ title: m, pipelineId: c.pipelineId, stageId: c.stageId }),
    patchBody: (m, rv) => ({ title: `${m}-u`, rowVersion: rv }),
  },
];

for (const f of OWNER_FAMS) {
  describe(`owner and assignee fields: ${f.key}`, () => {
    let ctx: Row = {};
    let allScope: { token: string; userId: number; uuid: string };
    let ownScope: { token: string; userId: number; uuid: string };
    beforeAll(async () => {
      ctx = (await f.prep?.()) ?? {};
      const a = await api.member(A, `own-all-${f.key}`.slice(0, 20), [
        [f.read, 'all'],
        [f.create, 'all'],
        [f.update, 'all'],
      ]);
      allScope = { ...a, uuid: await uuidOfUser(a.userId) };
      const o = await api.member(A, `own-own-${f.key}`.slice(0, 20), [
        [f.read, 'own'],
        [f.create, 'own'],
        [f.update, 'own'],
      ]);
      ownScope = { ...o, uuid: await uuidOfUser(o.userId) };
    }, 120_000);

    const make = async (owner: string | null) => {
      const res = await send('post', f.createUrl, A.admin, {
        ...f.body(marker(f.key), ctx),
        ...(owner ? { [f.field]: owner } : {}),
      });
      expect(ok(res), `setup: ${show(res)}`).toBe(true);
      const hit = (await rowOf(res.json.id))!;
      return { id: res.json.id as string, rv: Number(hit.row.row_version ?? 1), table: hit.table };
    };
    const ownerOf = async (id: string) => ownerIn((await send('get', f.detail(id), A.admin)).json);

    it(`AUTHZ-042 ${f.key}: a ${f.field} of another tenant is refused on create and nothing is stored`, async () => {
      const name = marker(f.key);
      const before = await countOf(
        (await ready(FAMILIES.find((x) => x.key === f.key)!)).table,
        A.orgId,
      );
      const res = await send('post', f.createUrl, allScope.token, {
        ...f.body(name, ctx),
        [f.field]: bAdminUuid,
      });
      expect(res.status, show(res)).toBeLessThan(500);
      expect(ok(res), `foreign user accepted as ${f.field}: ${show(res)}`).toBe(false);
      expect(rejected(res) || res.status === 404, show(res)).toBe(true);
      expect(
        await countOf((await ready(FAMILIES.find((x) => x.key === f.key)!)).table, A.orgId),
      ).toBe(before);
    });

    it(`AUTHZ-042 ${f.key}: a ${f.field} of another tenant is refused on update and the owner does not move`, async () => {
      const o = await make(colleague.uuid);
      const res = await send('patch', f.detail(o.id), allScope.token, {
        ...f.patchBody(marker(f.key), o.rv),
        [f.field]: bAdminUuid,
      });
      expect(res.status, show(res)).toBeLessThan(500);
      expect(ok(res), `foreign user accepted: ${show(res)}`).toBe(false);
      expect(await ownerOf(o.id)).toBe(colleague.uuid);
    });

    it(`AUTHZ-042 ${f.key}: a ${f.field} that is a user of the same workspace works on create and update (positive control)`, async () => {
      const name = marker(f.key);
      const created = await send('post', f.createUrl, allScope.token, {
        ...f.body(name, ctx),
        [f.field]: colleague.uuid,
      });
      expect(ok(created), show(created)).toBe(true);
      expect(ownerIn(created.json)).toBe(colleague.uuid);
      const o = await make(null);
      const moved = await send('patch', f.detail(o.id), allScope.token, {
        ...f.patchBody(marker(f.key), o.rv),
        [f.field]: colleague.uuid,
      });
      expect(ok(moved), show(moved)).toBe(true);
      expect(await ownerOf(o.id)).toBe(colleague.uuid);
    });

    it(`AUTHZ-042 ${f.key}: ${f.field} as an id of a user who is not a member (a role uuid, a random uuid, a non-uuid) is refused`, async () => {
      const o = await make(colleague.uuid);
      for (const bad of [
        adminRoleUuid,
        randomUUID(),
        'not-a-uuid',
        '0',
        '',
        ['x'],
        { id: bAdminUuid },
      ]) {
        const res = await send('patch', f.detail(o.id), allScope.token, {
          ...f.patchBody(marker(f.key), o.rv),
          [f.field]: bad,
        });
        expect(res.status, `${JSON.stringify(bad)} -> ${show(res)}`).toBeLessThan(500);
        if (bad === '') continue;
        expect(ok(res), `${JSON.stringify(bad)} accepted`).toBe(false);
      }
      expect(await ownerOf(o.id)).toBe(colleague.uuid);
    });

    it(`AUTHZ-050 ${f.key}: an own-scope member cannot hand a record to a colleague and thereby remove it from their own view`, async () => {
      const o = await make(ownScope.uuid);
      expect((await send('get', f.detail(o.id), ownScope.token)).status).toBe(200);
      const res = await send('patch', f.detail(o.id), ownScope.token, {
        ...f.patchBody(marker(f.key), o.rv),
        [f.field]: colleague.uuid,
      });
      expect(res.status, show(res)).toBeLessThan(500);
      if (ok(res)) {
        const after = await send('get', f.detail(o.id), ownScope.token);
        notes.policy.push(
          `${f.key}: own-scope member moved ${f.field} to a colleague (HTTP ${res.status}) and then got ${after.status} on the detail`,
        );
        expect(
          after.status,
          `own-scope member hid the record by reassigning it (policy: scope is checked on the old owner only)`,
        ).toBe(200);
      }
    });

    it(`AUTHZ-050 ${f.key}: an own-scope member cannot create a record owned by a colleague and thereby hide it from themselves`, async () => {
      const res = await send('post', f.createUrl, ownScope.token, {
        ...f.body(marker(f.key), ctx),
        [f.field]: colleague.uuid,
      });
      expect(res.status, show(res)).toBeLessThan(500);
      if (ok(res)) {
        const after = await send('get', f.detail(res.json.id), ownScope.token);
        notes.policy.push(
          `${f.key}: own-scope member created a record owned by a colleague (HTTP ${res.status}); detail answers ${after.status}`,
        );
        expect(after.status, 'own-scope member created a record outside their own scope').toBe(200);
      }
    });

    it(`AUTHZ-050 ${f.key}: an own-scope member cannot change a record owned by somebody else, nor take it over`, async () => {
      const o = await make(colleague.uuid);
      const res = await send('patch', f.detail(o.id), ownScope.token, {
        ...f.patchBody(marker(f.key), o.rv),
        [f.field]: ownScope.uuid,
      });
      expect(res.status, show(res)).toBeLessThan(500);
      expect(ok(res), show(res)).toBe(false);
      expect(await ownerOf(o.id)).toBe(colleague.uuid);
    });
  });
}

describe('owner and assignee fields: bulk and conversation assignment', () => {
  it('AUTHZ-042 contacts: bulk assign refuses a user of another tenant and accepts a colleague', async () => {
    const m = await api.member(A, 'bulkassign', [
      ['record.contacts.update', 'all'],
      ['record.contacts.read', 'all'],
    ]);
    const [id] = await api.seedContacts(A, [{ name: marker('bulk'), phone: phone() }]);
    const bad = await send('post', '/v2/contacts/assignee', m.token, {
      ids: [id],
      ownerId: bAdminUuid,
    });
    expect(bad.status, show(bad)).toBeLessThan(500);
    expect(ok(bad) && !(bad.json?.succeeded ?? []).includes(id) ? true : !ok(bad), show(bad)).toBe(
      true,
    );
    expect(JSON.stringify(bad.json?.succeeded ?? [])).not.toContain(id);
    const goodRes = await send('post', '/v2/contacts/assignee', m.token, {
      ids: [id],
      ownerId: colleague.uuid,
    });
    expect(ok(goodRes), show(goodRes)).toBe(true);
    expect(goodRes.json.succeeded).toContain(id);
    const bulkBad = await send('post', '/v2/contacts/bulk/update', m.token, {
      ids: [id],
      values: { ownerId: bAdminUuid },
    });
    expect(bulkBad.status, show(bulkBad)).toBeLessThan(500);
    expect(JSON.stringify(bulkBad.json?.succeeded ?? [])).not.toContain(id);
    const hit = (await rowOf(id))!;
    expect(Number(hit.row.owner_id)).toBe(colleague.userId);
  });

  it('AUTHZ-046 inbox: assign_self only claims; assign hands a conversation to a colleague, never to another tenant', async () => {
    const inbox = new Inbox(h, api);
    const ch = await inbox.channel(A.admin);
    const conv = async () => inbox.conversation(A, ch.id, { messages: 1 });
    const rvOf = async (id: number) =>
      Number(
        (await h.owner.query(`SELECT row_version FROM conversations WHERE id = $1`, [id])).rows[0]
          .row_version,
      );
    const assigneeOf = async (id: number) =>
      (await h.owner.query(`SELECT assignee_user_id FROM conversations WHERE id = $1`, [id]))
        .rows[0].assignee_user_id as number | null;

    const claimer = await api.member(A, 'claimer', [
      ['inbox.conversation.read', 'all'],
      ['inbox.conversation.assign_self', 'all'],
    ]);
    const claimerUuid = await uuidOfUser(claimer.userId);
    const peer = await api.member(A, 'inboxpeer', [['inbox.conversation.read', 'all']]);
    const peerUuid = await uuidOfUser(peer.userId);
    const assigner = await api.member(A, 'assigner', [
      ['inbox.conversation.read', 'all'],
      ['inbox.conversation.assign', 'all'],
    ]);

    const c1 = await conv();
    const toOther = await send('post', `/v2/inbox/conversations/${c1.uuid}/assign`, claimer.token, {
      userId: peerUuid,
      rowVersion: await rvOf(c1.id),
    });
    expect(toOther.status, `claim-only member gave a conversation away: ${show(toOther)}`).toBe(
      403,
    );
    expect(await assigneeOf(c1.id)).toBeNull();

    const own = await send('post', `/v2/inbox/conversations/${c1.uuid}/assign`, claimer.token, {
      userId: claimerUuid,
      rowVersion: await rvOf(c1.id),
    });
    expect(ok(own), `positive control (claim): ${show(own)}`).toBe(true);
    expect(await assigneeOf(c1.id)).toBe(claimer.userId);

    const unassign = await send(
      'post',
      `/v2/inbox/conversations/${c1.uuid}/assign`,
      claimer.token,
      {
        userId: null,
        rowVersion: await rvOf(c1.id),
      },
    );
    expect(unassign.status, `claim-only member unassigned: ${show(unassign)}`).toBe(403);
    expect(await assigneeOf(c1.id)).toBe(claimer.userId);

    const c2 = await conv();
    const foreign = await send(
      'post',
      `/v2/inbox/conversations/${c2.uuid}/assign`,
      assigner.token,
      {
        userId: bAdminUuid,
        rowVersion: await rvOf(c2.id),
      },
    );
    expect(foreign.status, show(foreign)).toBeLessThan(500);
    expect(ok(foreign), `foreign user accepted as assignee: ${show(foreign)}`).toBe(false);
    expect(await assigneeOf(c2.id)).toBeNull();

    const good = await send('post', `/v2/inbox/conversations/${c2.uuid}/assign`, assigner.token, {
      userId: peerUuid,
      rowVersion: await rvOf(c2.id),
      assigneeUserId: B.adminUserId,
      orgId: B.orgId,
    });
    expect(ok(good), `positive control (assign): ${show(good)}`).toBe(true);
    expect(await assigneeOf(c2.id)).toBe(peer.userId);
    // somebody who cannot open the inbox cannot be given a conversation either
    const closed = await send('post', `/v2/inbox/conversations/${c2.uuid}/assign`, assigner.token, {
      userId: colleague.uuid,
      rowVersion: await rvOf(c2.id),
    });
    expect(ok(closed), show(closed)).toBe(false);
    expect(await assigneeOf(c2.id)).toBe(peer.userId);
    expect(echoes(good.json)).toEqual([]);
  });
});

// ---- 3. response exposure --------------------------------------------------------------------------------------------------------

const SENSITIVE_KEY =
  /password|secret|token|hash|apiKey|api_key|private|webhookSecret|credential|accessToken|refreshToken|totp|mfa|recovery/i;
const MASKED = /^(\*{3,}|•{3,}|x{4,}|\.{3,})|(\*{3,}|•{3,}|…|\.\.\.)$/i;
/** Columns that hold a value the product hands out on purpose (a public embed token, a form key, an invoice link). */
const PUBLIC_COLUMNS = new Set<string>([
  'widgets.embed_token',
  'forms.public_key',
  'lead_sources.token',
  'invoices.public_token',
  'sales_docs.public_token',
]);

/** Values handed out on purpose to the people who hold the route's permission. Each entry is reported as a policy decision, not hidden. */
const KNOWN_EXPOSED = [
  {
    route: '/v2/waba/webhook-config',
    path: '$.verifyToken',
    why: 'the Meta webhook verify token is shown in clear to the workspace admin who registers the callback URL at Meta (Reference shows it too)',
  },
];

describe('response exposure', () => {
  it('AUTHZ-043 GET bodies of every readable route carry no stored secret value and no other tenant data (admin and read-only member)', async () => {
    const mod = (await import(
      /* @vite-ignore */ pathToFileURL(
        join(__dirname, '../../../../../tools/authz-audit/lib/routes.mjs'),
      ).href
    )) as { scanRoutes: () => RouteInfo[] };
    const gets = mod
      .scanRoutes()
      .filter((r) => r.method === 'GET' && r.gate === 'permission' && !r.v1Api);
    expect(gets.length).toBeGreaterThan(100);

    // arrange: objects that hold secrets, in A; something to leak in B
    const seeds = {
      webhookSecret: `whsec_FLSEEDSECRET${next()}`,
      password: 'Str0ngPassw0rd#1',
    };
    const w = await send('post', '/v2/webhooks', A.admin, {
      name: marker('wh'),
      url: 'https://8.8.8.8/in',
      events: ['contact_created'],
      secret: seeds.webhookSecret,
    });
    const key = await send('post', '/v2/developer/keys', A.admin, { name: marker('key') });
    await send('post', '/v2/lead-sources', A.admin, { name: marker('ls') });
    await send('post', '/v2/users', A.admin, {
      email: `${marker('u').toLowerCase()}@example.test`,
      fullName: 'Exposure User',
      password: seeds.password,
      roleIds: [viewerRoleUuid],
    });
    await send('post', '/v2/webhooks', B.admin, {
      name: marker('bwh'),
      url: 'https://8.8.4.4/in',
      events: ['contact_created'],
      secret: `whsec_FLBSECRET${next()}`,
    });
    await send('post', '/v2/contacts', B.admin, { name: marker('bct'), phone: phone() });
    const ch = await new Inbox(h, api).channel(A.admin);
    expect(ch.id).toBeTruthy();
    const secretsIssued = [seeds.webhookSecret, key.json?.secret as string].filter(Boolean);
    expect(secretsIssued.length, `setup: webhook ${show(w)}; key ${show(key)}`).toBe(2);

    // the values to look for: every secret-like text column of tenant A (a hit is a stored secret on the wire), and tenant B's uuids
    const cols = await h.owner.query(
      `SELECT c.table_name, c.column_name FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.data_type IN ('text', 'character varying')
          AND c.column_name ~* '(secret|token|password|hash|private|credential|ciphertext|encrypted|api_key|totp|recovery|signing)'
          AND c.table_name IN (SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'org_id')`,
    );
    const stored = new Map<string, string>();
    for (const { table_name, column_name } of cols.rows as Array<{
      table_name: string;
      column_name: string;
    }>) {
      const r = await h.owner.query(
        `SELECT DISTINCT "${column_name}" AS v FROM "${table_name}" WHERE org_id = $1 AND length("${column_name}") >= 16 LIMIT 40`,
        [A.orgId],
      );
      for (const { v } of r.rows as Array<{ v: string }>)
        stored.set(v, `${table_name}.${column_name}`);
    }
    for (const s of secretsIssued) stored.set(s, 'issued.secret');
    const bIds = new Set<string>();
    for (const t of uuidTables) {
      const r = await h.owner.query(
        `SELECT uuid::text AS u FROM "${t}" WHERE org_id = $1 LIMIT 200`,
        [B.orgId],
      );
      for (const { u } of r.rows as Array<{ u: string }>) bIds.add(u);
    }
    expect(bIds.size).toBeGreaterThan(5);

    // fill path parameters from tenant A's rows
    const ids = new Map<string, string>();
    for (const t of uuidTables) {
      const r = await h.owner
        .query(`SELECT uuid::text AS u FROM "${t}" WHERE org_id = $1 ORDER BY id LIMIT 1`, [
          A.orgId,
        ])
        .catch(() => null);
      if (r?.rows[0]) ids.set(t, r.rows[0].u as string);
    }
    const tableFor = (route: RouteInfo, param: string): string | null => {
      const segs = route.path.split('/').filter(Boolean);
      const at = segs.indexOf(`:${param}`);
      const base = (at > 0 ? segs[at - 1]! : '').replace(/-/g, '_');
      for (const v of [base, base.replace(/ies$/, 'y'), base.replace(/s$/, ''), `${base}s`])
        if (ids.has(v)) return v;
      return null;
    };
    const fillUrl = (route: RouteInfo): string | null => {
      let miss = false;
      const url = route.url.replace(/:(\w+)/g, (_m, name: string) => {
        const t = tableFor(route, name);
        if (!t) {
          miss = true;
          return '';
        }
        return ids.get(t)!;
      });
      return miss ? null : url;
    };

    const readKeys = [
      ...new Set(
        gets.flatMap((r) => r.permissions.slice(0, 1)).filter((k) => /\.(read|view|list)$/.test(k)),
      ),
    ];
    const reader = await api
      .member(
        A,
        'allreader',
        readKeys.map((k) => [k, 'all'] as Grant),
      )
      .catch(() => null);
    const actors: Array<[string, string]> = [['admin', A.admin]];
    if (reader) actors.push(['reader', reader.token]);

    const hits = {
      values: [] as string[],
      keys: [] as string[],
      foreign: [] as string[],
      server: [] as string[],
    };
    let called = 0;
    let unresolved = 0;
    const jobs: Array<{ route: RouteInfo; url: string; actor: string; token: string }> = [];
    for (const route of gets) {
      const url = fillUrl(route);
      if (!url) {
        unresolved++;
        continue;
      }
      for (const [actor, token] of actors) jobs.push({ route, url, actor, token });
    }
    let cursor = 0;
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        while (cursor < jobs.length) {
          const job = jobs[cursor++]!;
          const res = await send('get', job.url, job.token);
          called++;
          const tag = `${job.actor} GET ${job.route.url}`;
          if (res.status >= 500) hits.server.push(`${tag} -> ${res.status}`);
          if (res.status !== 200) continue;
          for (const [value, where] of stored) {
            if (res.text.includes(value) && !PUBLIC_COLUMNS.has(where))
              hits.values.push(`${tag} carries ${where}`);
          }
          const text = res.text;
          for (const u of bIds)
            if (text.includes(u)) hits.foreign.push(`${tag} carries tenant B id ${u}`);
          walk(res.json, (path, k, v) => {
            if (!SENSITIVE_KEY.test(k)) return;
            if (
              v === null ||
              typeof v === 'boolean' ||
              typeof v === 'number' ||
              v === '' ||
              (Array.isArray(v) && v.length === 0)
            )
              return;
            if (typeof v === 'string' && (MASKED.test(v) || v.length < 6)) return;
            if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return; // a timestamp (tokenRotatedAt)
            if (/Mode$|Type$|Kind$|Status$/.test(k)) return; // an enum label (credentialMode: platform_token)
            const known = KNOWN_EXPOSED.find(
              (x) => x.route === job.route.url && x.path === path.replace(/\[\d+\]/g, '[]'),
            );
            if (known) {
              notes.policy.push(`${known.route} ${known.path}: ${known.why}`);
              return;
            }
            if (typeof v === 'object') return;
            hits.keys.push(`${tag} ${path} = ${String(v).slice(0, 24)}`);
          });
        }
      }),
    );
    console.info(
      `[field-level] exposure sweep: ${called} GET calls over ${gets.length} routes (${unresolved} routes without a fixture id)`,
    );
    notes.uncovered.push(
      `exposure sweep skipped ${unresolved} GET routes for want of a row to fill the path`,
    );
    expect(hits.server, 'GET routes answering 5xx').toEqual([]);
    expect(hits.foreign, 'tenant B ids in tenant A bodies').toEqual([]);
    expect(hits.values, 'stored secret values on the wire').toEqual([]);
    expect(hits.keys, 'sensitive-looking keys carrying an unmasked value').toEqual([]);
  });

  it('AUTHZ-049 webhook, API key and user responses never return the secret, the hash or a password after creation', async () => {
    const m = await api.member(A, 'integ', [
      ['webhooks.manage', 'all'],
      ['webhooks.read', 'all'],
      ['api.keys.read', 'all'],
      ['admin.user.manage', 'all'],
    ]);
    const secret = `whsec_FLDETAIL${next()}`;
    const created = await send('post', '/v2/webhooks', m.token, {
      name: marker('wh'),
      url: 'https://8.8.8.8/in',
      events: ['contact_created'],
      secret,
    });
    expect(ok(created), show(created)).toBe(true);
    const row = (await rowOf(created.json.id))!;
    for (const url of ['/v2/webhooks', `/v2/webhooks/${created.json.id}`]) {
      const res = await send('get', url, m.token);
      if (res.status === 404) continue;
      expect(res.status, show(res)).toBe(200);
      expect(res.text, url).not.toContain(secret);
      for (const col of Object.keys(row.row).filter((c) => /secret|token|hash/i.test(c))) {
        const v = row.row[col];
        if (typeof v === 'string' && v.length > 12)
          expect(res.text, `${url} carries ${col}`).not.toContain(v);
      }
    }
    const users = await send('get', '/v2/users?limit=200', m.token);
    expect(users.status).toBe(200);
    expect(users.text).not.toMatch(/\$argon2|password_?hash|"passwordHash"/i);
    const hashes = (
      await h.owner.query(
        `SELECT password_hash FROM users WHERE org_id = $1 AND password_hash IS NOT NULL`,
        [A.orgId],
      )
    ).rows;
    for (const { password_hash } of hashes as Array<{ password_hash: string }>)
      expect(users.text).not.toContain(password_hash);
    expect(users.text).not.toContain(bAdminUuid);
  });
});

// ---- 4. custom fields ------------------------------------------------------------------------------------------------------------

describe('custom fields and the field-metadata permissions', () => {
  let contactId = '';
  let _contactRv = 1;
  const f: Record<string, { id: string; rowVersion: number }> = {};

  beforeAll(async () => {
    const mkSection = async (moduleKey: string) => {
      const s = await send('post', '/v2/field-sections', A.admin, {
        moduleKey,
        name: `FL ${moduleKey}`,
      });
      expect(ok(s), show(s)).toBe(true);
      return s.json.id as string;
    };
    const contactSection = await mkSection('contacts');
    const companySection = await mkSection('companies');
    const mkField = async (
      key: string,
      over: Row,
      moduleKey = 'contacts',
      sectionId = contactSection,
    ) => {
      const r = await send('post', '/v2/fields', A.admin, {
        moduleKey,
        sectionId,
        key,
        label: key,
        fieldType: 'text',
        ...over,
      });
      expect(ok(r), `field ${key}: ${show(r)}`).toBe(true);
      f[key] = { id: r.json.id, rowVersion: r.json.rowVersion };
    };
    await mkField('cf_plain', {});
    await mkField('cf_readonly', { isReadOnly: true });
    await mkField('cf_hidden', { isHidden: true });
    await mkField('cf_masked', { isMasked: true });
    await mkField('co_plain', {}, 'companies', companySection);
    const [id] = await api.seedContacts(A, [
      {
        name: marker('cf'),
        phone: phone(),
        data: { cf_readonly: 'seed-ro', cf_masked: 'seed-secret-123' },
      },
    ]);
    contactId = id!;
    _contactRv = Number(((await rowOf(contactId))!.row.row_version as number) ?? 1);
  }, 120_000);

  const dataOf = async () => (await rowOf(contactId))!.row.data as Row;
  const rvNow = async () => Number(((await rowOf(contactId))!.row.row_version as number) ?? 1);

  it('AUTHZ-047 a member who may update contacts but holds no property permission can write an ordinary custom field value', async () => {
    const m = await api.member(A, 'cfwriter', [
      ['record.contacts.update', 'all'],
      ['record.contacts.read', 'all'],
    ]);
    const res = await send('patch', `/v2/contacts/${contactId}`, m.token, {
      customFields: { cf_plain: 'written' },
      rowVersion: await rvNow(),
    });
    expect(ok(res), show(res)).toBe(true);
    expect((await dataOf()).cf_plain).toBe('written');
  });

  it('AUTHZ-047 a read-only custom field cannot be set through the contact update or create body (the bulk route already refuses it)', async () => {
    const m = await api.member(A, 'cfwriter2', [
      ['record.contacts.update', 'all'],
      ['record.contacts.create', 'all'],
      ['record.contacts.read', 'all'],
    ]);
    const bulk = await send('post', '/v2/contacts/bulk/update', m.token, {
      ids: [contactId],
      values: { customFields: { cf_readonly: 'bulk-write' } },
    });
    expect(bulk.status, `control: bulk refuses a read-only field: ${show(bulk)}`).toBe(422);
    const res = await send('patch', `/v2/contacts/${contactId}`, m.token, {
      customFields: { cf_readonly: 'single-write' },
      rowVersion: await rvNow(),
    });
    expect(res.status, show(res)).toBeLessThan(500);
    expect(
      (await dataOf()).cf_readonly,
      'read-only property overwritten through PATCH /v2/contacts/:id',
    ).toBe('seed-ro');
    expect(ok(res), `PATCH accepted a read-only property: ${show(res)}`).toBe(false);
    const created = await send('post', '/v2/contacts', m.token, {
      name: marker('cf'),
      phone: phone(),
      customFields: { cf_readonly: 'create-write' },
    });
    expect(created.status, show(created)).toBeLessThan(500);
    if (ok(created)) {
      const stored = ((await rowOf(created.json.id))!.row.data as Row) ?? {};
      expect(
        stored.cf_readonly,
        'read-only property set through POST /v2/contacts',
      ).toBeUndefined();
    }
  });

  it('AUTHZ-047 a hidden custom field cannot be set through the contact update body', async () => {
    const m = await api.member(A, 'cfwriter3', [
      ['record.contacts.update', 'all'],
      ['record.contacts.read', 'all'],
    ]);
    const res = await send('patch', `/v2/contacts/${contactId}`, m.token, {
      customFields: { cf_hidden: 'sneaky' },
      rowVersion: await rvNow(),
    });
    expect(res.status, show(res)).toBeLessThan(500);
    expect((await dataOf()).cf_hidden, 'hidden property written through PATCH').toBeUndefined();
  });

  it('AUTHZ-047 an unknown custom field key and a prototype key are refused or ignored, never stored under a system column', async () => {
    const m = await api.member(A, 'cfwriter4', [
      ['record.contacts.update', 'all'],
      ['record.contacts.read', 'all'],
    ]);
    const before = (await rowOf(contactId))!.row;
    const body = JSON.parse(
      '{"customFields":{"__proto__":{"isAdmin":true},"org_id":9,"name":"x","not_a_field":"v"},"rowVersion":' +
        (await rvNow()) +
        '}',
    ) as Row;
    const res = await send('patch', `/v2/contacts/${contactId}`, m.token, body);
    expect(res.status, show(res)).toBeLessThan(500);
    const after = (await rowOf(contactId))!.row;
    expect(Number(after.org_id)).toBe(A.orgId);
    expect(after.name).toBe(before.name);
    noPollution();
  });

  it('AUTHZ-047 holding contact-properties.update without contacts.update does not allow writing a value; holding contacts.update does not allow editing field metadata', async () => {
    const props = await api.member(A, 'props', [
      ['record.contact-properties.read', 'all'],
      ['record.contact-properties.update', 'all'],
      ['record.contact-properties.create', 'all'],
    ]);
    const valueWrite = await send('patch', `/v2/contacts/${contactId}`, props.token, {
      customFields: { cf_plain: 'by-props' },
      rowVersion: await rvNow(),
    });
    expect(valueWrite.status, show(valueWrite)).toBe(403);
    expect((await dataOf()).cf_plain).not.toBe('by-props');

    const writer = await api.member(A, 'cfwriter5', [
      ['record.contacts.update', 'all'],
      ['record.contacts.read', 'all'],
    ]);
    const meta = await send('patch', `/v2/fields/${f.cf_readonly!.id}`, writer.token, {
      isReadOnly: false,
      rowVersion: f.cf_readonly!.rowVersion,
    });
    expect(meta.status, show(meta)).toBe(403);
    const mk = await send('post', '/v2/fields', writer.token, {
      moduleKey: 'contacts',
      sectionId: randomUUID(),
      key: 'cf_by_writer',
      label: 'x',
      fieldType: 'text',
    });
    expect(mk.status, show(mk)).toBe(403);
    const row = (
      await h.owner.query(`SELECT is_read_only FROM fields WHERE uuid = $1`, [f.cf_readonly!.id])
    ).rows[0];
    expect(row.is_read_only).toBe(true);
  });

  it('AUTHZ-047 the contact-properties permissions do not open company fields, and the other way round', async () => {
    const contactProps = await api.member(A, 'cprops', [
      ['record.contact-properties.read', 'all'],
      ['record.contact-properties.update', 'all'],
      ['record.contact-properties.create', 'all'],
    ]);
    const own = await send('patch', `/v2/fields/${f.cf_plain!.id}`, contactProps.token, {
      label: 'FL label',
      rowVersion: f.cf_plain!.rowVersion,
    });
    expect(ok(own), `positive control: ${show(own)}`).toBe(true);
    f.cf_plain!.rowVersion = own.json.rowVersion;
    const foreignModule = await send('patch', `/v2/fields/${f.co_plain!.id}`, contactProps.token, {
      label: 'FL hijack',
      rowVersion: f.co_plain!.rowVersion,
    });
    expect(
      foreignModule.status,
      `contact-properties edited a company field: ${show(foreignModule)}`,
    ).toBe(403);
    expect(
      (await h.owner.query(`SELECT label FROM fields WHERE uuid = $1`, [f.co_plain!.id])).rows[0]
        .label,
    ).toBe('co_plain');

    const companyProps = await api.member(A, 'coprops', [
      ['record.company-properties.read', 'all'],
      ['record.company-properties.update', 'all'],
    ]);
    const cross = await send('patch', `/v2/fields/${f.cf_plain!.id}`, companyProps.token, {
      label: 'FL hijack 2',
      rowVersion: f.cf_plain!.rowVersion,
    });
    expect(cross.status, `company-properties edited a contact field: ${show(cross)}`).toBe(403);
    const ownCompany = await send('patch', `/v2/fields/${f.co_plain!.id}`, companyProps.token, {
      label: 'FL co label',
      rowVersion: f.co_plain!.rowVersion,
    });
    expect(ok(ownCompany), `positive control: ${show(ownCompany)}`).toBe(true);

    const mkCross = await send('post', '/v2/fields', contactProps.token, {
      moduleKey: 'companies',
      sectionId: randomUUID(),
      key: 'co_by_contact_props',
      label: 'x',
      fieldType: 'text',
    });
    expect(mkCross.status, show(mkCross)).toBe(403);
  });

  it('AUTHZ-043 a member without any property permission reads custom values of a masked field (recorded as a policy decision: isMasked is stored but applied nowhere on read)', async () => {
    const reader = await api.member(A, 'cfreader', [['record.contacts.read', 'all']]);
    const res = await send('get', `/v2/contacts/${contactId}`, reader.token);
    expect(res.status, show(res)).toBe(200);
    const masked = res.json.customFields?.cf_masked;
    if (masked === 'seed-secret-123') {
      notes.policy.push(
        'custom fields: a field flagged isMasked is returned in clear by GET /v2/contacts/:id to a reader without any properties permission',
      );
    }
    const hidden = (await send('get', `/v2/fields?moduleKey=contacts`, reader.token)).status;
    expect(hidden, 'the field metadata list needs its own permission').toBe(403);
  });
});

// ---- 5. ambiguity ----------------------------------------------------------------------------------------------------------------

describe('input ambiguity', () => {
  let writer: { token: string; userId: number; uuid: string };
  let ownScope: { token: string; userId: number; uuid: string };
  let mine = '';
  let theirs = '';
  let bContact = '';
  let bMarker = '';

  beforeAll(async () => {
    const w = await api.member(A, 'amb-writer', [
      ['record.contacts.read', 'all'],
      ['record.contacts.update', 'all'],
      ['record.contacts.create', 'all'],
    ]);
    writer = { ...w, uuid: await uuidOfUser(w.userId) };
    const o = await api.member(A, 'amb-own', [['record.contacts.read', 'own']]);
    ownScope = { ...o, uuid: await uuidOfUser(o.userId) };
    const mk = async (t: Tenant, name: string, owner: string) => {
      const r = await send('post', '/v2/contacts', t.admin, {
        name,
        phone: phone(),
        ownerId: owner,
      });
      expect(ok(r), show(r)).toBe(true);
      return r.json.id as string;
    };
    mine = await mk(A, marker('amb-mine'), ownScope.uuid);
    theirs = await mk(A, marker('amb-theirs'), colleague.uuid);
    bMarker = marker('amb-b');
    bContact = await mk(B, bMarker, bAdminUuid);
  }, 120_000);

  const fresh = async (owner = colleague.uuid) => {
    const r = await send('post', '/v2/contacts', A.admin, {
      name: marker('amb'),
      phone: phone(),
      ownerId: owner,
    });
    expect(ok(r), show(r)).toBe(true);
    return { id: r.json.id as string, rv: Number(r.json.rowVersion) };
  };
  const ownerOf = async (id: string) =>
    (await send('get', `/v2/contacts/${id}`, A.admin)).json?.ownerId ?? null;

  it('AUTHZ-091 contacts update: duplicate ownerId keys behave exactly like the last one alone (foreign last is refused, colleague last works)', async () => {
    const mkRaw = (rv: number, ...owners: string[]) =>
      `{"name":"dup-${next()}",${owners.map((o) => `"ownerId":"${o}"`).join(',')},"rowVersion":${rv}}`;
    for (const [first, last] of [
      [colleague.uuid, bAdminUuid],
      [bAdminUuid, colleague.uuid],
      [writer.uuid, bAdminUuid],
      [bAdminUuid, writer.uuid],
    ] as const) {
      const a = await fresh();
      const dup = await send('patch', `/v2/contacts/${a.id}`, writer.token, undefined, {
        raw: mkRaw(a.rv, first, last),
      });
      const ownerAfterDup = await ownerOf(a.id);
      const b = await fresh();
      const single = await send('patch', `/v2/contacts/${b.id}`, writer.token, {
        name: 'single',
        ownerId: last,
        rowVersion: b.rv,
      });
      const ownerAfterSingle = await ownerOf(b.id);
      expect(dup.status, `${first} then ${last}: ${show(dup)}`).toBeLessThan(500);
      expect(dup.status, 'duplicate keys must give the answer of the key that wins').toBe(
        single.status,
      );
      expect(ownerAfterDup === bAdminUuid, 'foreign owner stored').toBe(false);
      expect(
        ownerAfterDup === colleague.uuid
          ? 'colleague'
          : ownerAfterDup === writer.uuid
            ? 'writer'
            : ownerAfterDup,
      ).toBe(
        ownerAfterSingle === colleague.uuid
          ? 'colleague'
          : ownerAfterSingle === writer.uuid
            ? 'writer'
            : ownerAfterSingle,
      );
    }
  });

  it('AUTHZ-091 contacts create and tasks create: duplicate ownerId / assigneeId keys never store the foreign user', async () => {
    const dupC = await send('post', '/v2/contacts', writer.token, undefined, {
      raw: `{"name":"dupc-${next()}","phone":"${phone()}","ownerId":"${colleague.uuid}","ownerId":"${bAdminUuid}"}`,
    });
    expect(dupC.status, show(dupC)).toBeLessThan(500);
    expect(ok(dupC), show(dupC)).toBe(false);
    const posC = await send('post', '/v2/contacts', writer.token, undefined, {
      raw: `{"name":"dupc-${next()}","phone":"${phone()}","ownerId":"${bAdminUuid}","ownerId":"${colleague.uuid}"}`,
    });
    expect(ok(posC), `positive control: ${show(posC)}`).toBe(true);
    expect(ownerIn(posC.json)).toBe(colleague.uuid);

    const tasker = await api.member(A, 'amb-tasker', [
      ['record.tasks.create', 'all'],
      ['record.tasks.read', 'all'],
    ]);
    const dupT = await send('post', '/v2/tasks', tasker.token, undefined, {
      raw: `{"title":"dupt-${next()}","assigneeId":"${colleague.uuid}","assigneeId":"${bAdminUuid}"}`,
    });
    expect(dupT.status, show(dupT)).toBeLessThan(500);
    expect(ok(dupT), show(dupT)).toBe(false);
    const posT = await send('post', '/v2/tasks', tasker.token, undefined, {
      raw: `{"title":"dupt-${next()}","assigneeId":"${bAdminUuid}","assigneeId":"${colleague.uuid}"}`,
    });
    expect(ok(posT), `positive control: ${show(posT)}`).toBe(true);
    expect(ownerIn(posT.json)).toBe(colleague.uuid);
  });

  it('AUTHZ-091 duplicate orgId / id / rowVersion keys do not move a row to another tenant or skip the optimistic lock', async () => {
    const a = await fresh();
    const before = (await rowOf(a.id))!.row;
    const dup = await send('patch', `/v2/contacts/${a.id}`, writer.token, undefined, {
      raw: `{"orgId":${B.orgId},"name":"dup-org","orgId":${A.orgId},"org_id":${B.orgId},"id":"${randomUUID()}","id":"${bContact}","rowVersion":${a.rv + 40},"rowVersion":${a.rv}}`,
    });
    expect(dup.status, show(dup)).toBeLessThan(500);
    const after = (await rowOf(a.id))!.row;
    expect(Number(after.org_id)).toBe(A.orgId);
    expect(after.uuid).toBe(a.id);
    expect(after.created_at).toEqual(before.created_at);
    const foreignRow = (await rowOf(bContact))!.row;
    expect(Number(foreignRow.org_id)).toBe(B.orgId);
    expect(foreignRow.name).toBe(bMarker);
    const lockOnly = await send('patch', `/v2/contacts/${a.id}`, writer.token, undefined, {
      raw: `{"name":"dup-lock","rowVersion":${a.rv},"rowVersion":${a.rv + 40}}`,
    });
    expect(lockOnly.status, 'the last rowVersion wins, and it is stale').toBe(409);
  });

  it('AUTHZ-091 malformed bodies answer 4xx, never 5xx, and change nothing', async () => {
    const a = await fresh();
    const before = JSON.stringify((await rowOf(a.id))!.row);
    const deep = '['.repeat(4000) + ']'.repeat(4000);
    const bodies = [
      '{"name":"x",}',
      '',
      'null',
      '[]',
      '"str"',
      '12',
      deep,
      `{"name":"x","rowVersion":"${a.rv}"}`,
      `{"name":"x","rowVersion":[${a.rv}]}`,
      `{"name":"x","rowVersion":1e400}`,
      `{"name":"x","rowVersion":${a.rv},"ownerId":{"$ne":null}}`,
      `{"name":"\\u0000","rowVersion":${a.rv}}`,
      `\uFEFF{"name":"bom","rowVersion":${a.rv}}`,
    ];
    for (const raw of bodies) {
      const r = await send('patch', `/v2/contacts/${a.id}`, writer.token, undefined, { raw });
      expect(r.status, `${raw.slice(0, 40)} -> ${show(r)}`).toBeLessThan(500);
    }
    const after = (await rowOf(a.id))!.row;
    expect(Number(after.org_id)).toBe(A.orgId);
    expect(after.uuid).toBe(a.id);
    expect(JSON.stringify(after.owner_id)).toBe(JSON.stringify(JSON.parse(before).owner_id));
    for (const ct of [
      'text/plain',
      'application/x-www-form-urlencoded',
      'application/xml',
      'multipart/form-data',
    ]) {
      const r = await send('patch', `/v2/contacts/${a.id}`, writer.token, undefined, {
        raw: `name=x&rowVersion=${a.rv}`,
        headers: { 'content-type': ct },
      });
      expect(r.status, `${ct} -> ${show(r)}`).toBeLessThan(500);
      expect((await rowOf(a.id))!.row.name).toBe(after.name);
    }
  });

  it('AUTHZ-092 list filters given twice, as arrays or as nested objects never widen what an own-scope member sees', async () => {
    const q = [
      `ownerId=${ownScope.uuid}&ownerId=${colleague.uuid}`,
      `ownerId=${colleague.uuid}&ownerId=${ownScope.uuid}`,
      `ownerId[]=${colleague.uuid}`,
      `ownerId[]=${colleague.uuid}&ownerId[]=${ownScope.uuid}`,
      `ownerId[0]=${colleague.uuid}`,
      `ownerId[$ne]=${ownScope.uuid}`,
      `ownerId[a][b]=${colleague.uuid}`,
      `ownerId=`,
      `ownerId=null`,
      `ownerId=${bAdminUuid}`,
      `scope=all`,
      `scope[]=all&scope[]=own`,
      `view=all&mine=false`,
      `ids=${theirs}`,
      `ids[]=${theirs}&ids[]=${bContact}`,
      `ids=${theirs},${bContact}`,
      `id=${theirs}`,
      `q[]=${bMarker}`,
      `q=${bMarker}`,
      `limit[]=5&limit[]=1000`,
      `limit=1e3`,
      `limit=-1`,
      `cursor=${theirs}`,
      `cursor[]=${bContact}`,
      `orgId=${B.orgId}`,
      `org_id=${B.orgId}`,
      `orgId[]=${B.orgId}`,
      `__proto__[ownerId]=${colleague.uuid}`,
      `constructor[prototype][ownerId]=${colleague.uuid}`,
      `segmentId=${randomUUID()}&segmentId=${randomUUID()}`,
      `tagIds=${randomUUID()}&tagIds[]=${randomUUID()}`,
      `expand=groups&expand[]=tags`,
      `sort[]=name&sort[]=createdAt`,
      `order=desc;drop table contacts`,
    ];
    for (const qs of q) {
      for (const base of ['/v2/contacts', '/v2/contacts/select-data']) {
        const res = await send('get', `${base}?${qs}`, ownScope.token);
        expect(res.status, `${base}?${qs} -> ${show(res)}`).toBeLessThan(500);
        if (res.status !== 200) continue;
        const idsSeen = ((res.json?.data ?? res.json ?? []) as Array<Row>).map((x) => x.id);
        expect(idsSeen, `${base}?${qs}`).not.toContain(theirs);
        expect(idsSeen, `${base}?${qs}`).not.toContain(bContact);
        expect(res.text).not.toContain(bMarker);
        expect(res.text).not.toContain(bContact);
      }
    }
    const plain = await send('get', '/v2/contacts', ownScope.token);
    expect(plain.status).toBe(200);
    expect((plain.json.data as Array<Row>).map((x) => x.id)).toContain(mine);
    const writerList = await send(
      'get',
      `/v2/contacts?ownerId=${colleague.uuid}&ownerId=${bAdminUuid}`,
      writer.token,
    );
    expect(writerList.status, show(writerList)).toBeLessThan(500);
    expect(writerList.text).not.toContain(bContact);
  });

  it('AUTHZ-092 tasks, deals and companies lists survive repeated and nested filters without a 5xx or a foreign row', async () => {
    const t = await api.member(A, 'amb-lists', [
      ['record.tasks.read', 'own'],
      ['record.deals.read', 'own'],
      ['record.companies.read', 'own'],
    ]);
    for (const base of [
      '/v2/tasks',
      '/v2/deals',
      '/v2/companies',
      '/v2/tasks?assigneeId=1&assigneeId=2&',
    ]) {
      for (const qs of [
        `ownerId=${colleague.uuid}&ownerId=${t.userId}`,
        `ownerId[]=${colleague.uuid}`,
        `assigneeId[]=${colleague.uuid}&assigneeId=${bAdminUuid}`,
        `assigneeId=${bAdminUuid}`,
        `pipelineId[]=${randomUUID()}`,
        `stageId=${randomUUID()}&stageId=${randomUUID()}`,
        `ids[]=${bContact}`,
        `q[a]=b`,
        `status[]=open&status[]=done&status=x`,
        `limit=0`,
        `cursor[]=a`,
      ]) {
        const url = `${base}${base.includes('?') ? '' : '?'}${qs}`;
        const res = await send('get', url, t.token);
        expect(res.status, `${url} -> ${show(res)}`).toBeLessThan(500);
        if (res.status === 200) expect(res.text).not.toContain(bAdminUuid);
        if (res.status === 200) expect(res.text).not.toContain(bContact);
      }
    }
  });

  it('AUTHZ-094 contact ids written with encoded slashes, dots, case, unicode or traversal never reach another tenant or another record', async () => {
    const variants = (x: string) => [
      x,
      x.toUpperCase(),
      `${x}.`,
      `${x}..`,
      `${x}%2e`,
      `${x}/`,
      `${x}//`,
      `${x}%2f`,
      `${x}%00`,
      `${x}%20`,
      `%20${x}`,
      `${x};a=1`,
      `${x}%3Fa%3D1`,
      `${x}%23`,
      `${mine}/../${x}`,
      `${mine}%2f..%2f${x}`,
      `${mine}%2F%2e%2e%2F${x}`,
      `..%2f${x}`,
      `%2e%2e/${x}`,
      `%2e%2e%2f${x}`,
      `%252e%252e%252f${x}`,
      `${mine}%252f..%252f${x}`,
      `${mine}%c0%af..%c0%af${x}`,
      `${mine}\\..\\${x}`,
      x
        .replace(/[0-9]/g, (d) => String.fromCharCode(0xff10 + Number(d)))
        .split('')
        .map((c) => encodeURIComponent(c))
        .join(''),
      `${x}%E2%80%8B`,
      x.replace(/-/g, '%2d'),
      x.replace(/-/g, ''),
      `{${x}}`,
      `${x},${mine}`,
    ];
    const seen: string[] = [];
    for (const target of [theirs, bContact]) {
      for (const v of variants(target)) {
        const res = await send('get', `/v2/contacts/${v}`, ownScope.token);
        seen.push(`${res.status}`);
        expect(res.status, `GET /v2/contacts/${v} -> ${show(res)}`).toBeLessThan(500);
        expect(
          res.status,
          `GET /v2/contacts/${v} reached a record outside the caller scope`,
        ).not.toBe(200);
        expect(res.text).not.toContain(bMarker);
        const j = res.json as Row;
        expect(j?.id).not.toBe(target);
      }
    }
    // the same trick against writes
    const wb = (await fresh(colleague.uuid)).id;
    for (const v of variants(bContact).concat(variants(wb))) {
      const res = await send('patch', `/v2/contacts/${v}`, ownScope.token, {
        name: 'path-hijack',
        rowVersion: 1,
      });
      expect(res.status, `PATCH /v2/contacts/${v} -> ${show(res)}`).toBeLessThan(500);
      expect(ok(res), `PATCH /v2/contacts/${v} was accepted`).toBe(false);
    }
    expect((await rowOf(bContact))!.row.name).toBe(bMarker);
    expect((await rowOf(wb))!.row.name).not.toBe('path-hijack');
    // positive control: the caller's own record, canonical and upper-cased
    const own = await send('get', `/v2/contacts/${mine}`, ownScope.token);
    expect(own.status).toBe(200);
    const upper = await send('get', `/v2/contacts/${mine.toUpperCase()}`, ownScope.token);
    expect([200, 400, 404]).toContain(upper.status);
    if (upper.status === 200) expect(upper.json.id).toBe(mine);
  });

  it('AUTHZ-094 a traversal or encoded path never lands on a different, more privileged route', async () => {
    const targets = [
      `/v2/contacts/${mine}/../../users`,
      `/v2/contacts/${mine}%2f..%2f..%2fusers`,
      `/v2/contacts/..%2fusers`,
      `/v2/contacts/%2e%2e/users`,
      `/v2/contacts/%2e%2e%2f%2e%2e%2fv2%2fusers`,
      `/v2/contacts/%252e%252e%252fusers`,
      `/v2/contacts/${mine}/..;/users`,
      `/v2/contacts/${mine};/../users`,
      `/v2/contacts/.%2e/users`,
      `/v2/contacts/${mine}/%2e%2e/%2e%2e/roles`,
      `/v2/contacts/${mine}/..%5cusers`,
    ];
    for (const url of targets) {
      const res = await send('get', url, ownScope.token);
      expect(res.status, `${url} -> ${show(res)}`).toBeLessThan(500);
      expect(res.status, `${url} reached a privileged route`).not.toBe(200);
      expect(res.text).not.toContain('Admin Person');
      expect(res.text).not.toContain(bAdminUuid);
    }
  });

  it('AUTHZ-094 case, trailing-slash, double-slash and encoded-letter variants of a permission-gated path do not skip authentication or the permission', async () => {
    const nogrant = await api.member(A, 'amb-nogrant', []);
    const paths = [
      '/v2/users',
      '/V2/users',
      '/v2/Users',
      '/v2/USERS',
      '/v2/users/',
      '/v2/users//',
      '//v2/users',
      '/v2//users',
      '/v2/./users',
      '/v2/users/.',
      '/v2/users%2f',
      '/v2/%75sers',
      '/%76%32/users',
      '/v2/users;x=1',
      '/v2/users%00',
      '/v2/users%20',
      '/v2/contacts/../users',
      '/v2/roles',
      '/v2/ROLES',
      '/v2/%72oles',
      '/v2/developer/keys',
      '/v2/Developer/Keys',
      '/v2/developer//keys',
    ];
    for (const p of paths) {
      const anon = await send('get', p, null);
      expect(anon.status, `anonymous ${p} -> ${show(anon)}`).toBeLessThan(500);
      expect(anon.status, `anonymous ${p}`).not.toBe(200);
      const ng = await send('get', p, nogrant.token);
      expect(ng.status, `no-grant member ${p} -> ${show(ng)}`).toBeLessThan(500);
      expect(ng.status, `no-grant member ${p}`).not.toBe(200);
      expect(ng.text).not.toContain('Admin Person');
    }
    const admin = await send('get', '/v2/users', A.admin);
    expect(admin.status, 'positive control').toBe(200);
  });
});
