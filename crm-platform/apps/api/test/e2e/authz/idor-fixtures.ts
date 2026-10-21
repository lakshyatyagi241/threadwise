import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect } from 'vitest';
import {
  Api,
  bearer,
  type Grant,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import { Inbox } from '../team-inbox-conversations/support';

/**
 * Fixtures for the object-level authorization suite (idor-families.e2e.spec.ts): the engine that attacks every id route of a resource
 * family with a foreign tenant's token, and one `Spec` per family that knows how to create a real object through the API.
 */

export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface Route {
  id: string;
  file: string;
  method: string;
  url: string;
  gate: string;
  permissions: string[];
  pathParams: string[];
  objectIdParams: string[];
  v1Api: boolean;
  idempotent?: boolean;
}

export interface Res {
  status: number;
  text: string;
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- responses are read by name in assertions
}

export interface Ctx {
  h: Harness;
  api: Api;
  A: Tenant;
  B: Tenant;
  routes: Route[];
  inbox: Inbox;
  uuidOfUser(id: number): Promise<string>;
}

/** One object of a family in one tenant. */
export interface Fx {
  /** Route parameter name -> uuid of THIS tenant's object (`:id`, `:contactId`, ...). */
  ids: Record<string, string>;
  /** Route parameters that are not object ids (a date, a slug): the same value in the foreign and the nonexistent call. */
  statics: Record<string, string>;
  /** Text only this tenant's object carries: it must never show up in another tenant's response. */
  marker: string;
  /** Other strings that must never be echoed (tokens, secrets). */
  secrets: string[];
  /** The rowVersion of the main object, for update bodies. */
  rv: number;
  /** Anything else a body builder needs. */
  extra: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface Attack {
  name: string;
  method: Method;
  url: string;
  body?: unknown;
  /** Who sends it. Default: the foreign tenant's admin. */
  as?: 'B' | 'A-nogrant';
  /** A 2xx is acceptable only when this returns null (e.g. a bulk that reports the foreign id as failed). */
  ok2xx?: (res: Res) => string | null;
  /** Extra database checks after the call: returns violations. */
  verify?: () => Promise<string[]>;
}

export interface Spec {
  key: string;
  controls: string[];
  claims: (r: Route) => boolean;
  /** Per-tenant prerequisites (a plan feature switched on). */
  prep?: (c: Ctx, t: Tenant) => Promise<void>;
  create: (c: Ctx, t: Tenant, label: string, o: { ownerUuid: string }) => Promise<Fx>;
  /** Valid bodies for mutation routes, matched on "METHOD /pattern". Default `{}`. */
  bodies?: Array<[RegExp, (fx: Fx) => unknown]>;
  /** GET template of the object, e.g. `/v2/contacts/:id`. */
  detail: string;
  /** List / count / aggregate endpoints compared for the foreign tenant before and after the owner creates objects. */
  lists?: string[];
  /** The family has `all|team|own` record scope. */
  scoped?: boolean;
  /** Extra keys the own-scope member needs to create its own record (the create route has no id, so the scan does not list it). */
  scopeGrants?: string[];
  /** Who the scope compares with: the owner field (default) or the creator (the member must create the record itself). */
  scopeMode?: 'owner' | 'creator';
  /** DELETE template used for the deleted-object test. */
  deleteUrl?: string;
  /** Moves the owner's object out of the way before it can be deleted (a booking must be cancelled first). */
  beforeDelete?: (c: Ctx, fx: Fx, token: string) => Promise<void>;
  /** Archives / closes / cancels the object instead of deleting it (AUTHZ-095: archived objects stay protected). */
  retire?: (fx: Fx) => { method: Method; url: string; body?: unknown };
  /** List-style routes that filter rows by the caller's record scope: a 200 is fine as long as no row of the colleague is in it. */
  filteredRoutes?: RegExp;
  /** Route params that name tenant-wide configuration (a pipeline stage), readable by anyone who holds the permission. */
  sharedIds?: string[];
  /** A real update by the owner, to prove the write path works. */
  update?: (fx: Fx) => { method: 'patch' | 'put'; url: string; body: unknown };
  attacks?: (c: Ctx, a: Fx, b: Fx) => Attack[];
  queries?: (a: Fx, b: Fx) => string[];
}

// ---- http ------------------------------------------------------------------------------------------------------------------------

let xff = 0;
const nextIp = () => `10.98.${Math.floor(xff / 250) % 250}.${xff++ % 250}`;

export async function fire(
  h: Harness,
  method: Method,
  url: string,
  token: string | null,
  body?: unknown,
): Promise<Res> {
  const http = request(h.app.getHttpServer());
  let req = http[method](url).set('x-forwarded-for', nextIp());
  if (token) req = req.set(bearer(token));
  if (method !== 'get') req = req.set('Idempotency-Key', randomUUID());
  if (body !== undefined && (method === 'post' || method === 'put' || method === 'patch')) {
    req = req.send(body as object);
  }
  const res = await req;
  return { status: res.status, text: typeof res.text === 'string' ? res.text : '', json: res.body };
}

/** What the fixtures read off a created object. A call site that reads more names those fields in the mk type argument. */
interface Created {
  id: string;
  rowVersion: number;
}

/** A pipeline stage, as the pipeline routes return it. */
interface Stage {
  id: string;
  name: string;
  kind: string;
  rowVersion: number;
}

/** A pipeline, as GET /v2/pipelines returns it. */
interface Pipeline {
  id: string;
  isDefault: boolean;
  stages: Stage[];
}

/** Create through the API as the tenant's admin; throws (so the family is reported as not covered) on anything but 2xx. */
async function mk<T = Created>(c: Ctx, t: Tenant, path: string, body: unknown): Promise<T> {
  const res = await fire(c.h, 'post', path, t.admin, body);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`setup POST ${path} -> ${res.status} ${res.text.slice(0, 300)}`);
  }
  return res.json as T;
}

export const fill = (url: string, values: Record<string, string>): string | null => {
  let missing = false;
  const out = url.replace(/:(\w+)/g, (_m, name: string) => {
    if (values[name] === undefined) missing = true;
    return values[name] ?? '';
  });
  return missing ? null : out;
};

// ---- synthetic data --------------------------------------------------------------------------------------------------------------

let seq = 1;
const next = () => seq++;
export const markerOf = (key: string, label: string) => `IDOR-${key}-${label}-${next()}`;
const phone = () => `+9199${String(70000000 + next()).padStart(8, '0')}`;
const emailOf = (m: string) => `${m.toLowerCase()}@example.test`;
const LINE = { description: 'Consulting', qty: '2', unitPrice: '50.00' };

const base = (marker: string, over: Partial<Fx> = {}): Fx => ({
  ids: {},
  statics: {},
  marker,
  secrets: [],
  rv: 1,
  extra: {},
  ...over,
});

const one = (re: RegExp) => (r: Route) => re.test(r.url);

// ---- families --------------------------------------------------------------------------------------------------------------------

async function newContact(c: Ctx, t: Tenant, m: string, ownerUuid?: string) {
  return mk(c, t, '/v2/contacts', {
    name: m,
    phone: phone(),
    email: emailOf(m),
    ...(ownerUuid ? { ownerId: ownerUuid } : {}),
  });
}

const contacts: Spec = {
  key: 'contacts',
  controls: ['AUTHZ-031', 'AUTHZ-032', 'AUTHZ-073'],
  claims: (r) =>
    /^\/v2\/contacts\/:(id|contactId)(\/|$)/.test(r.url) &&
    !/\/(notes|meetings|files)(\/|$)/.test(r.url),
  scoped: true,
  detail: '/v2/contacts/:id',
  deleteUrl: '/v2/contacts/:id',
  lists: [
    '/v2/contacts?limit=200',
    '/v2/contacts/stats',
    '/v2/contacts/select-data',
    '/v2/contacts/assignees',
    '/v2/contacts/duplicates',
    '/v2/contacts/exports',
    '/v2/attributes/picker',
  ],
  async create(c, t, label, o) {
    const m = markerOf('contact', label);
    const tag = await mk(c, t, '/v2/tags', { name: `${m}-tag` });
    const ct = await newContact(c, t, m, o.ownerUuid);
    await mk(c, t, `/v2/contacts/${ct.id}/tags`, { tagId: tag.id });
    return base(m, { ids: { id: ct.id, contactId: ct.id, tagId: tag.id }, rv: ct.rowVersion });
  },
  bodies: [
    [/^PATCH \/v2\/contacts\/:id$/, (fx) => ({ name: `${fx.marker}-x`, rowVersion: fx.rv })],
    [/^POST \/v2\/contacts\/:id\/tags$/, (fx) => ({ tagId: fx.ids.tagId })],
    [/^PUT \/v2\/contacts\/:id\/groups$/, () => ({ groupIds: [] })],
    [
      /^POST \/v2\/contacts\/:contactId\/activities$/,
      (fx) => ({ activityType: 'call', title: `${fx.marker}-act` }),
    ],
  ],
  update: (fx) => ({
    method: 'patch',
    url: `/v2/contacts/${fx.ids.id}`,
    body: { name: `${fx.marker}-upd`, rowVersion: fx.rv },
  }),
  queries: (a) => [
    `/v2/contacts?q=${a.marker}`,
    `/v2/contacts?ownerId=${a.extra.ownerUuid}`,
    `/v2/contacts?ids=${a.ids.id}`,
    `/v2/contacts?search=${a.marker}`,
    `/v2/contacts/select-data?q=${a.marker}`,
    `/v2/contacts?cursor=${a.ids.id}`,
    `/v2/contacts?tagId=${a.ids.tagId}`,
    `/v2/tags?q=${a.marker}`,
  ],
  attacks: (c, a, b) => {
    const foreignFailed =
      (id: string) =>
      (res: Res): string | null =>
        JSON.stringify(res.json?.succeeded ?? []).includes(id)
          ? `foreign id ${id} reported as succeeded`
          : null;
    const stillThere = (id: string, org: number) => async () => {
      const r = await c.h.owner.query(`SELECT 1 FROM contacts WHERE uuid = $1 AND org_id = $2`, [
        id,
        org,
      ]);
      return r.rowCount === 1 ? [] : [`contact ${id} was deleted or hidden`];
    };
    return [
      {
        name: 'bulk delete mixing a foreign id',
        method: 'post',
        url: '/v2/contacts/bulk/delete',
        body: { ids: [b.ids.id, a.ids.id] },
        ok2xx: foreignFailed(a.ids.id),
        verify: stillThere(a.ids.id, c.A.orgId),
      },
      {
        name: 'bulk delete by filter that targets the foreign marker',
        method: 'post',
        url: '/v2/contacts/bulk/delete',
        body: { filter: { q: a.marker } },
        ok2xx: foreignFailed(a.ids.id),
        verify: stillThere(a.ids.id, c.A.orgId),
      },
      {
        name: 'bulk update mixing a foreign id',
        method: 'post',
        url: '/v2/contacts/bulk/update',
        body: { ids: [b.ids.id, a.ids.id], values: { status: 'IDOR-hijack' } },
        ok2xx: foreignFailed(a.ids.id),
        verify: async () => {
          const r = await c.h.owner.query(
            `SELECT 1 FROM contacts WHERE uuid = $1 AND status = 'IDOR-hijack'`,
            [a.ids.id],
          );
          return r.rowCount ? ['foreign contact status was rewritten'] : [];
        },
      },
      {
        name: 'bulk assign a foreign contact to the attacker',
        method: 'post',
        url: '/v2/contacts/assignee',
        body: { ids: [a.ids.id], ownerId: b.extra.ownerUuid },
        ok2xx: foreignFailed(a.ids.id),
        verify: async () => {
          const r = await c.h.owner.query(
            `SELECT 1 FROM contacts c JOIN users u ON u.id = c.owner_id WHERE c.uuid = $1 AND u.org_id = $2`,
            [a.ids.id, c.B.orgId],
          );
          return r.rowCount ? ['foreign contact now owned by a tenant-B user'] : [];
        },
      },
      {
        name: 'bulk assign the attackers contact to a foreign user',
        method: 'post',
        url: '/v2/contacts/assignee',
        body: { ids: [b.ids.id], ownerId: a.extra.ownerUuid },
        verify: async () => {
          const r = await c.h.owner.query(
            `SELECT 1 FROM contacts c JOIN users u ON u.id = c.owner_id WHERE c.uuid = $1 AND u.org_id = $2`,
            [b.ids.id, c.A.orgId],
          );
          return r.rowCount ? ['tenant-B contact now owned by a tenant-A user'] : [];
        },
      },
      {
        name: 'bulk tag add with a foreign contact and a foreign tag',
        method: 'post',
        url: '/v2/contacts/bulk/tag',
        body: { ids: [b.ids.id, a.ids.id], action: 'add', tagId: a.ids.tagId },
        ok2xx: foreignFailed(a.ids.id),
        verify: async () => {
          const r = await c.h.owner.query(
            `SELECT 1 FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
              WHERE t.uuid = $1 AND ct.org_id <> t.org_id`,
            [a.ids.tagId],
          );
          return r.rowCount ? ['a tag row crosses organizations'] : [];
        },
      },
      {
        name: 'bulk group add with a foreign contact',
        method: 'post',
        url: '/v2/contacts/bulk/group',
        body: { ids: [a.ids.id], groupId: randomUUID(), action: 'add' },
      },
      {
        name: 'export a foreign contact by id',
        method: 'post',
        url: '/v2/contacts/export',
        body: { ids: [a.ids.id] },
        ok2xx: (res) =>
          res.text.includes(a.marker) ? 'export contains the foreign contact' : null,
      },
      {
        name: 'tag attach with foreign contact and foreign tag ids',
        method: 'post',
        url: '/v2/tags/attach',
        body: { contactIds: [a.ids.id], tagIds: [a.ids.tagId] },
        ok2xx: foreignFailed(a.ids.id),
        verify: async () => {
          const r = await c.h.owner.query(
            `SELECT 1 FROM contact_tags ct JOIN contacts k ON k.id = ct.contact_id WHERE k.uuid = $1 AND ct.org_id = $2`,
            [a.ids.id, c.B.orgId],
          );
          return r.rowCount ? ['foreign contact tagged inside tenant B'] : [];
        },
      },
      {
        name: 'dedupe run (must only ever look at the caller organization)',
        method: 'post',
        url: '/v2/contacts/dedupe',
        body: {},
        ok2xx: () => null,
      },
      {
        name: 'create a contact owned by a foreign user',
        method: 'post',
        url: '/v2/contacts',
        body: { name: 'IDOR-owner-hijack', phone: phone(), ownerId: a.extra.ownerUuid },
        verify: async () => {
          const r = await c.h.owner.query(
            `SELECT 1 FROM contacts c JOIN users u ON u.id = c.owner_id WHERE c.name = 'IDOR-owner-hijack' AND u.org_id = $1`,
            [c.A.orgId],
          );
          return r.rowCount ? ['contact in tenant B owned by tenant-A user'] : [];
        },
      },
      {
        name: 'create a contact in a foreign company',
        method: 'post',
        url: '/v2/contacts',
        body: {
          name: 'IDOR-company-hijack',
          phone: phone(),
          companyId: a.extra.companyId ?? randomUUID(),
        },
      },
    ];
  },
};

const contactSub = (
  key: string,
  segment: string,
  controls: string[],
  mkBody: (m: string) => unknown,
  patchBody?: (fx: Fx) => unknown,
): Spec => ({
  key,
  controls,
  claims: (r) => new RegExp(`^/v2/contacts/:contactId/${segment}(/|$)`).test(r.url),
  scoped: true,
  detail: `/v2/contacts/:contactId/${segment}`,
  async create(c, t, label, o) {
    const m = markerOf(key, label);
    const ct = await newContact(c, t, m, o.ownerUuid);
    const item = await mk(c, t, `/v2/contacts/${ct.id}/${segment}`, mkBody(m));
    return base(m, { ids: { contactId: ct.id, id: item.id }, rv: item.rowVersion ?? 1 });
  },
  bodies: [
    [new RegExp(`^POST /v2/contacts/:contactId/${segment}$`), (fx) => mkBody(`${fx.marker}-new`)],
    ...(patchBody
      ? ([[new RegExp(`^PATCH /v2/contacts/:contactId/${segment}/:id$`), patchBody]] as Array<
          [RegExp, (fx: Fx) => unknown]
        >)
      : []),
  ],
});

const contactNotes = contactSub(
  'contact-notes',
  'notes',
  ['AUTHZ-031', 'AUTHZ-033', 'AUTHZ-094'],
  (m) => ({ body: m }),
  (fx) => ({ body: `${fx.marker}-edit`, rowVersion: fx.rv }),
);
const contactMeetings = contactSub(
  'contact-meetings',
  'meetings',
  ['AUTHZ-031', 'AUTHZ-033'],
  (m) => ({ title: m }),
  (fx) => ({ title: `${fx.marker}-edit`, rowVersion: fx.rv }),
);
const contactFiles = contactSub('contact-files', 'files', ['AUTHZ-031', 'AUTHZ-094'], (m) => ({
  fileName: `${m}.txt`,
  storageKey: `idor/${m}.txt`,
  fileSizeBytes: 5,
  mimeType: 'text/plain',
}));

const companies: Spec = {
  key: 'companies',
  controls: ['AUTHZ-031', 'AUTHZ-032'],
  claims: one(/^\/v2\/companies\/:id(\/|$)/),
  scoped: true,
  detail: '/v2/companies/:id',
  deleteUrl: '/v2/companies/:id',
  lists: [
    '/v2/companies?limit=200',
    '/v2/companies/stats',
    '/v2/companies/select-data',
    '/v2/companies/industries',
  ],
  async create(c, t, label, o) {
    const m = markerOf('company', label);
    const co = await mk(c, t, '/v2/companies', {
      name: m,
      email: emailOf(m),
      ownerId: o.ownerUuid,
    });
    const ct = await newContact(c, t, `${m}-ct`, o.ownerUuid);
    await mk(c, t, `/v2/companies/${co.id}/contacts`, { contactIds: [ct.id] });
    return base(m, {
      ids: { id: co.id, contactId: ct.id },
      rv: co.rowVersion,
      extra: { companyId: co.id },
    });
  },
  bodies: [
    [/^PATCH \/v2\/companies\/:id$/, (fx) => ({ name: `${fx.marker}-x`, rowVersion: fx.rv })],
    [/^POST \/v2\/companies\/:id\/contacts$/, (fx) => ({ contactIds: [fx.ids.contactId] })],
  ],
  update: (fx) => ({
    method: 'patch',
    url: `/v2/companies/${fx.ids.id}`,
    body: { name: `${fx.marker}-upd`, rowVersion: fx.rv },
  }),
  queries: (a) => [
    `/v2/companies?q=${a.marker}`,
    `/v2/companies?ids=${a.ids.id}`,
    `/v2/companies?ownerId=${a.extra.ownerUuid}`,
  ],
  attacks: (c, a, b) => [
    {
      name: 'bulk delete mixing a foreign company',
      method: 'post',
      url: '/v2/companies/bulk/delete',
      body: { ids: [b.ids.id, a.ids.id] },
      ok2xx: (res) =>
        JSON.stringify(res.json?.succeeded ?? []).includes(a.ids.id)
          ? 'foreign id reported as succeeded'
          : null,
      verify: async () => {
        const r = await c.h.owner.query(`SELECT 1 FROM companies WHERE uuid = $1`, [a.ids.id]);
        return r.rowCount === 1 ? [] : ['foreign company deleted'];
      },
    },
    {
      name: 'link a foreign contact to the attacker company',
      method: 'post',
      url: `/v2/companies/${b.ids.id}/contacts`,
      body: { contactIds: [a.ids.contactId] },
      verify: async () => {
        const r = await c.h.owner.query(
          `SELECT 1 FROM contacts x JOIN companies co ON co.id = x.company_id WHERE x.uuid = $1 AND co.org_id = $2`,
          [a.ids.contactId, c.B.orgId],
        );
        return r.rowCount ? ['foreign contact linked into tenant-B company'] : [];
      },
    },
    {
      name: 'create a company owned by a foreign user',
      method: 'post',
      url: '/v2/companies',
      body: { name: 'IDOR-co-owner', ownerId: a.extra.ownerUuid },
    },
  ],
};

const tasks: Spec = {
  key: 'tasks',
  controls: ['AUTHZ-031', 'AUTHZ-032'],
  claims: one(/^\/v2\/tasks\/:id(\/|$)/),
  scoped: true,
  detail: '/v2/tasks/:id',
  deleteUrl: '/v2/tasks/:id',
  retire: (fx) => ({ method: 'post', url: `/v2/tasks/${fx.ids.id}/complete`, body: {} }),
  lists: ['/v2/tasks?limit=200', '/v2/tasks/my', '/v2/tasks/counts'],
  async create(c, t, label, o) {
    const m = markerOf('task', label);
    const ct = await newContact(c, t, `${m}-ct`, o.ownerUuid);
    const tk = await mk(c, t, '/v2/tasks', { title: m, assigneeId: o.ownerUuid, contactId: ct.id });
    return base(m, { ids: { id: tk.id }, rv: tk.rowVersion, extra: { contactId: ct.id } });
  },
  bodies: [
    [/^PATCH \/v2\/tasks\/:id$/, (fx) => ({ title: `${fx.marker}-x`, rowVersion: fx.rv })],
    [/^PUT \/v2\/tasks\/:id\/links$/, (fx) => ({ contactId: fx.extra.contactId })],
  ],
  update: (fx) => ({
    method: 'patch',
    url: `/v2/tasks/${fx.ids.id}`,
    body: { title: `${fx.marker}-upd`, rowVersion: fx.rv },
  }),
  queries: (a) => [
    `/v2/tasks?assigneeId=${a.extra.ownerUuid}`,
    `/v2/tasks?q=${a.marker}`,
    `/v2/tasks?contactId=${a.extra.contactId}`,
  ],
  attacks: (c, a, b) => {
    const unchanged = async () => {
      const r = await c.h.owner.query(`SELECT status::text AS s FROM tasks WHERE uuid = $1`, [
        a.ids.id,
      ]);
      return r.rows[0]?.s === 'open' || r.rows[0]?.s === 'pending'
        ? []
        : [`foreign task state is ${r.rows[0]?.s}`];
    };
    return [
      {
        name: 'bulk complete mixing a foreign task',
        method: 'post',
        url: '/v2/tasks/bulk/complete',
        body: { ids: [b.ids.id, a.ids.id] },
        ok2xx: (res) =>
          JSON.stringify(res.json?.succeeded ?? res.json?.updated ?? []).includes(a.ids.id)
            ? 'foreign id succeeded'
            : null,
        verify: unchanged,
      },
      {
        name: 'bulk delete mixing a foreign task',
        method: 'post',
        url: '/v2/tasks/bulk/delete',
        body: { ids: [b.ids.id, a.ids.id] },
        ok2xx: (res) =>
          JSON.stringify(res.json?.succeeded ?? res.json?.deleted ?? []).includes(a.ids.id)
            ? 'foreign id succeeded'
            : null,
        verify: async () =>
          (await c.h.owner.query(`SELECT 1 FROM tasks WHERE uuid = $1`, [a.ids.id])).rowCount === 1
            ? []
            : ['foreign task deleted'],
      },
      {
        name: 'bulk assign a foreign task to the attacker',
        method: 'post',
        url: '/v2/tasks/bulk/assign',
        body: { ids: [a.ids.id], assigneeId: b.extra.ownerUuid },
        ok2xx: (res) =>
          JSON.stringify(res.json ?? {}).includes(a.ids.id) &&
          res.status < 300 &&
          /succe|updated/i.test(JSON.stringify(res.json)) &&
          !/failed/i.test(JSON.stringify(res.json))
            ? 'foreign task assigned'
            : null,
      },
      {
        name: 'create a task assigned to a foreign user',
        method: 'post',
        url: '/v2/tasks',
        body: { title: 'IDOR-task-assign', assigneeId: a.extra.ownerUuid },
        verify: async () =>
          (
            await c.h.owner.query(
              `SELECT 1 FROM tasks t JOIN users u ON u.id = t.assignee_id WHERE t.title = 'IDOR-task-assign' AND u.org_id = $1`,
              [c.A.orgId],
            )
          ).rowCount
            ? ['task in B assigned to A user']
            : [],
      },
      {
        name: 'create a task linked to a foreign contact',
        method: 'post',
        url: '/v2/tasks',
        body: { title: 'IDOR-task-link', contactId: a.extra.contactId },
      },
      {
        name: 'link my task to a foreign contact',
        method: 'put',
        url: `/v2/tasks/${b.ids.id}/links`,
        body: { contactId: a.extra.contactId },
      },
    ];
  },
};

const tags: Spec = {
  key: 'tags',
  controls: ['AUTHZ-031', 'AUTHZ-033'],
  claims: one(/^\/v2\/tags\/:id(\/|$)/),
  detail: '/v2/tags',
  deleteUrl: '/v2/tags/:id',
  lists: ['/v2/tags?limit=200&includeCounts=true'],
  async create(c, t, label) {
    const m = markerOf('tag', label);
    const tg = await mk(c, t, '/v2/tags', { name: m });
    return base(m, { ids: { id: tg.id }, rv: tg.rowVersion });
  },
  bodies: [[/^PATCH \/v2\/tags\/:id$/, (fx) => ({ name: `${fx.marker}-x`, rowVersion: fx.rv })]],
  update: (fx) => ({
    method: 'patch',
    url: `/v2/tags/${fx.ids.id}`,
    body: { name: `${fx.marker}-upd`, rowVersion: fx.rv },
  }),
  queries: (a) => [`/v2/tags?q=${a.marker}`],
};

const groups: Spec = {
  key: 'contact-groups',
  controls: ['AUTHZ-031', 'AUTHZ-033'],
  claims: one(/^\/v2\/contact-groups\/:id(\/|$)/),
  detail: '/v2/contact-groups/:id',
  deleteUrl: '/v2/contact-groups/:id',
  lists: ['/v2/contact-groups?limit=200'],
  async create(c, t, label) {
    const m = markerOf('group', label);
    const g = await mk(c, t, '/v2/contact-groups', { name: m });
    return base(m, { ids: { id: g.id }, rv: g.rowVersion });
  },
  bodies: [
    [/^PATCH \/v2\/contact-groups\/:id$/, (fx) => ({ name: `${fx.marker}-x`, rowVersion: fx.rv })],
  ],
  update: (fx) => ({
    method: 'patch',
    url: `/v2/contact-groups/${fx.ids.id}`,
    body: { name: `${fx.marker}-upd`, rowVersion: fx.rv },
  }),
  attacks: (c, a, b) => [
    {
      name: 'put a foreign group onto the attacker contact',
      method: 'put',
      url: `/v2/contacts/${b.extra.contactId}/groups`,
      body: { groupIds: [a.ids.id] },
      verify: async () =>
        (
          await c.h.owner.query(
            `SELECT 1 FROM contact_group_members m JOIN contact_groups g ON g.id = m.group_id WHERE g.uuid = $1 AND m.org_id <> g.org_id`,
            [a.ids.id],
          )
        ).rowCount
          ? ['group membership crosses organizations']
          : [],
    },
  ],
};

const attributes: Spec = {
  key: 'attributes',
  controls: ['AUTHZ-031', 'AUTHZ-033'],
  claims: one(/^\/v2\/attributes\/:id(\/|$)/),
  detail: '/v2/attributes/:id',
  deleteUrl: '/v2/attributes/:id',
  lists: ['/v2/attributes?limit=200', '/v2/attributes/catalog'],
  async create(c, t, label) {
    const m = markerOf('attr', label);
    const key = `idor_${m.toLowerCase().replace(/[^a-z0-9]/g, '_')}`.slice(0, 60);
    const at = await mk(c, t, '/v2/attributes', { name: m, key, type: 'text' });
    return base(m, { ids: { id: at.id }, rv: at.rowVersion });
  },
  bodies: [
    [/^PATCH \/v2\/attributes\/:id$/, (fx) => ({ name: `${fx.marker}-x`, rowVersion: fx.rv })],
  ],
  update: (fx) => ({
    method: 'patch',
    url: `/v2/attributes/${fx.ids.id}`,
    body: { name: `${fx.marker}-upd`, rowVersion: fx.rv },
  }),
  queries: (a) => [`/v2/attributes?q=${a.marker}`],
};

const segments: Spec = {
  key: 'segments',
  controls: ['AUTHZ-031', 'AUTHZ-032', 'AUTHZ-053'],
  claims: one(/^\/v2\/segments\/:id(\/|$)/),
  detail: '/v2/segments/:id',
  deleteUrl: '/v2/segments/:id',
  lists: ['/v2/segments?limit=200'],
  async create(c, t, label) {
    const m = markerOf('segment', label);
    const ct = await newContact(c, t, `${m}-ct`);
    const sg = await mk(c, t, '/v2/segments', {
      name: m,
      visibility: 'shared',
      rules: {
        type: 'group',
        combinator: 'and',
        children: [{ type: 'condition', field: 'name', operator: 'contains', value: m }],
      },
    });
    const g = await mk(c, t, '/v2/contact-groups', { name: `${m}-grp` });
    return base(m, {
      ids: { id: sg.id },
      rv: sg.rowVersion,
      extra: { contactId: ct.id, groupId: g.id },
    });
  },
  bodies: [
    [/^PATCH \/v2\/segments\/:id$/, (fx) => ({ name: `${fx.marker}-x`, rowVersion: fx.rv })],
    [/^POST \/v2\/segments\/:id\/tag$/, (fx) => ({ name: `${fx.marker}-t` })],
    [/^POST \/v2\/segments\/:id\/add-to-group$/, (fx) => ({ groupId: fx.extra.groupId })],
  ],
  update: (fx) => ({
    method: 'patch',
    url: `/v2/segments/${fx.ids.id}`,
    body: { name: `${fx.marker}-upd`, rowVersion: fx.rv },
  }),
  queries: (a) => [`/v2/segments?q=${a.marker}`, `/v2/contacts?segmentId=${a.ids.id}`],
  attacks: (c, a) => [
    {
      name: 'preview rules that match the foreign marker',
      method: 'post',
      url: '/v2/segments/preview',
      body: {
        rules: {
          type: 'group',
          combinator: 'and',
          children: [{ type: 'condition', field: 'name', operator: 'contains', value: a.marker }],
        },
      },
      ok2xx: (res) =>
        res.json?.count > 0 || res.text.includes(a.extra.contactId)
          ? 'preview matched a foreign contact'
          : null,
    },
  ],
};

async function pipelineOf(
  c: Ctx,
  t: Tenant,
): Promise<{ pipeline: Pipeline; stage: Record<string, Stage> }> {
  const res = await fire(c.h, 'get', '/v2/pipelines', t.admin);
  const p = (res.json as Pipeline[]).find((x) => x.isDefault) as Pipeline;
  return {
    pipeline: p,
    stage: Object.fromEntries(p.stages.map((s): [string, Stage] => [s.name, s])),
  };
}

const deals: Spec = {
  key: 'deals',
  controls: ['AUTHZ-031', 'AUTHZ-032', 'AUTHZ-051'],
  claims: (r) =>
    /^\/v2\/deals\/:(id|dealId)(\/|$)/.test(r.url) ||
    /^\/v2\/deals\/board\/stages\/:stageId/.test(r.url),
  scoped: true,
  sharedIds: ['stageId'],
  retire: (fx) => ({
    method: 'post',
    url: `/v2/deals/${fx.ids.id}/lost`,
    body: { reason: 'IDOR retire' },
  }),
  detail: '/v2/deals/:id',
  deleteUrl: '/v2/deals/:id',
  lists: [
    '/v2/deals?limit=200',
    '/v2/deals/board',
    '/v2/deals/reports',
    '/v2/deals/tasks',
    '/v2/pipelines',
  ],
  async create(c, t, label, o) {
    const m = markerOf('deal', label);
    const { pipeline, stage } = await pipelineOf(c, t);
    const ct = await newContact(c, t, `${m}-ct`, o.ownerUuid);
    const stageId = (Object.values(stage).find((s) => s.kind === 'open') as Stage).id;
    const d = await mk(c, t, '/v2/deals', {
      title: m,
      pipelineId: pipeline.id,
      stageId,
      value: '100.00',
      ownerId: o.ownerUuid,
      contactId: ct.id,
    });
    const act = await mk(c, t, `/v2/deals/${d.id}/activities`, { type: 'note', body: `${m}-note` });
    return base(m, {
      ids: { id: d.id, dealId: d.id, stageId, activityId: act.id },
      rv: d.rowVersion,
      extra: { pipelineId: pipeline.id, contactId: ct.id, stageId },
    });
  },
  bodies: [
    [/^PATCH \/v2\/deals\/:id$/, (fx) => ({ title: `${fx.marker}-x`, rowVersion: fx.rv })],
    [/^PATCH \/v2\/deals\/:id\/stage$/, (fx) => ({ stageId: fx.ids.stageId })],
    [/^POST \/v2\/deals\/:id\/lost$/, () => ({ reason: 'IDOR' })],
    [/^POST \/v2\/deals\/:id\/activities$/, (fx) => ({ type: 'note', body: `${fx.marker}-n2` })],
  ],
  update: (fx) => ({
    method: 'patch',
    url: `/v2/deals/${fx.ids.id}`,
    body: { title: `${fx.marker}-upd`, rowVersion: fx.rv },
  }),
  queries: (a) => [
    `/v2/deals?q=${a.marker}`,
    `/v2/deals?contactId=${a.extra.contactId}`,
    `/v2/deals?ownerId=${a.extra.ownerUuid}`,
    `/v2/deals?pipelineId=${a.extra.pipelineId}`,
    `/v2/deals?stageId=${a.ids.stageId}`,
    `/v2/deals/board?pipelineId=${a.extra.pipelineId}`,
  ],
  attacks: (c, a, b) => [
    {
      name: 'create a deal in a foreign pipeline and stage',
      method: 'post',
      url: '/v2/deals',
      body: { title: 'IDOR-deal-x1', pipelineId: a.extra.pipelineId, stageId: a.ids.stageId },
      verify: async () =>
        (
          await c.h.owner.query(
            `SELECT 1 FROM deals WHERE title = 'IDOR-deal-x1' AND org_id = $1`,
            [c.B.orgId],
          )
        ).rowCount
          ? ['deal in B placed in foreign pipeline']
          : [],
    },
    {
      name: 'create a deal on a foreign contact and company',
      method: 'post',
      url: '/v2/deals',
      body: { title: 'IDOR-deal-x2', contactId: a.extra.contactId },
      verify: async () =>
        (
          await c.h.owner.query(
            `SELECT 1 FROM deals d JOIN contacts k ON k.id = d.contact_id WHERE d.title = 'IDOR-deal-x2' AND k.uuid = $1`,
            [a.extra.contactId],
          )
        ).rowCount
          ? ['deal in B linked to foreign contact']
          : [],
    },
    {
      name: 'create a deal owned by a foreign user',
      method: 'post',
      url: '/v2/deals',
      body: { title: 'IDOR-deal-x3', ownerId: a.extra.ownerUuid },
      verify: async () =>
        (
          await c.h.owner.query(
            `SELECT 1 FROM deals d JOIN users u ON u.id = d.owner_user_id WHERE d.title = 'IDOR-deal-x3' AND u.org_id = $1`,
            [c.A.orgId],
          )
        ).rowCount
          ? ['deal in B owned by A user']
          : [],
    },
    {
      name: 'move my deal into a foreign stage',
      method: 'patch',
      url: `/v2/deals/${b.ids.id}/stage`,
      body: { stageId: a.ids.stageId },
      verify: async () =>
        (
          await c.h.owner.query(
            `SELECT 1 FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id WHERE d.uuid = $1 AND s.org_id <> d.org_id`,
            [b.ids.id],
          )
        ).rowCount
          ? ['deal references a foreign stage']
          : [],
    },
    {
      name: 'complete a foreign deal task activity via my deal',
      method: 'post',
      url: `/v2/deals/${b.ids.id}/activities/${a.ids.activityId}/complete`,
      body: {},
    },
  ],
};

const pipelines: Spec = {
  key: 'pipelines',
  controls: ['AUTHZ-031', 'AUTHZ-033', 'AUTHZ-051'],
  claims: one(/^\/v2\/pipelines\/:id(\/|$)/),
  detail: '/v2/pipelines/:id',
  deleteUrl: '/v2/pipelines/:id',
  lists: ['/v2/pipelines', '/v2/deal-lost-reasons'],
  async create(c, t, label) {
    const m = markerOf('pipeline', label);
    const p = await mk<Created & { stages: Stage[] }>(c, t, '/v2/pipelines', { name: m });
    return base(m, {
      ids: { id: p.id },
      rv: p.rowVersion,
      extra: { stageIds: p.stages.map((s) => s.id) },
    });
  },
  bodies: [
    [/^PATCH \/v2\/pipelines\/:id$/, (fx) => ({ name: `${fx.marker}-x`, rowVersion: fx.rv })],
    [/^POST \/v2\/pipelines\/:id\/stages$/, (fx) => ({ name: `${fx.marker}-st`, kind: 'open' })],
    [/^PUT \/v2\/pipelines\/:id\/stages\/order$/, (fx) => ({ stageIds: fx.extra.stageIds })],
  ],
  update: (fx) => ({
    method: 'patch',
    url: `/v2/pipelines/${fx.ids.id}`,
    body: { name: `${fx.marker}-upd`, rowVersion: fx.rv },
  }),
  attacks: (c, a, b) => [
    {
      name: 'reorder pipelines including a foreign id',
      method: 'put',
      url: '/v2/pipelines/order',
      body: { pipelineIds: [b.ids.id, a.ids.id] },
    },
    {
      name: 'reorder my stages with foreign stage ids',
      method: 'put',
      url: `/v2/pipelines/${b.ids.id}/stages/order`,
      body: { stageIds: a.extra.stageIds },
    },
  ],
};

const stages: Spec = {
  key: 'pipeline-stages',
  controls: ['AUTHZ-031', 'AUTHZ-033'],
  claims: one(/^\/v2\/pipeline-stages\/:id(\/|$)/),
  detail: '/v2/pipelines',
  async create(c, t, label) {
    const m = markerOf('stage', label);
    const p = await mk<{ stages: Stage[] }>(c, t, '/v2/pipelines', { name: m });
    const st = p.stages.find((s) => s.kind === 'open') as Stage;
    return base(m, { ids: { id: st.id }, rv: st.rowVersion });
  },
  bodies: [
    [/^PATCH \/v2\/pipeline-stages\/:id$/, (fx) => ({ name: `${fx.marker}-x`, rowVersion: fx.rv })],
  ],
};

const invoices: Spec = {
  key: 'invoices',
  controls: ['AUTHZ-031', 'AUTHZ-032', 'AUTHZ-053', 'AUTHZ-054'],
  claims: one(/^\/v2\/invoices\/:id(\/|$)/),
  scoped: true,
  scopeMode: 'creator',
  detail: '/v2/invoices/:id',
  deleteUrl: '/v2/invoices/:id',
  lists: [
    '/v2/invoices?limit=200',
    '/v2/invoices/counts',
    '/v2/payments?limit=200',
    '/v2/payments/summary',
    '/v2/payments/aging',
    '/v2/payments/outstanding',
  ],
  async create(c, t, label) {
    const m = markerOf('invoice', label);
    const inv = await mk(c, t, '/v2/invoices', { buyerName: m, lines: [LINE] });
    return base(m, { ids: { id: inv.id }, rv: inv.rowVersion ?? 1 });
  },
  bodies: [
    [/^PATCH \/v2\/invoices\/:id$/, (fx) => ({ buyerName: `${fx.marker}-x`, rowVersion: fx.rv })],
    [/^POST \/v2\/invoices\/:id\/payments$/, () => ({ amount: '10.00', method: 'cash' })],
    [/^POST \/v2\/invoices\/:id\/void$/, () => ({ reason: 'IDOR' })],
  ],
  update: (fx) => ({
    method: 'patch',
    url: `/v2/invoices/${fx.ids.id}`,
    body: { buyerName: `${fx.marker}-upd`, rowVersion: fx.rv },
  }),
  queries: (a) => [`/v2/invoices?q=${a.marker}`, `/v2/payments?invoiceId=${a.ids.id}`],
  attacks: (c, a) => [
    {
      name: 'record a payment against a foreign invoice',
      method: 'post',
      url: '/v2/payments',
      body: { invoiceId: a.ids.id, amount: '10.00', method: 'cash' },
      verify: async () =>
        (
          await c.h.owner.query(
            `SELECT 1 FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.uuid = $1 AND p.org_id <> i.org_id`,
            [a.ids.id],
          )
        ).rowCount
          ? ['payment row crosses organizations']
          : [],
    },
    {
      name: 'create a credit note on a foreign invoice',
      method: 'post',
      url: '/v2/credit-notes',
      body: { invoiceId: a.ids.id, lines: [LINE] },
    },
  ],
};

const salesDocs: Spec = {
  key: 'sales-docs',
  controls: ['AUTHZ-031', 'AUTHZ-032', 'AUTHZ-054'],
  claims: one(/^\/v2\/sales-docs\/:id(\/|$)/),
  scoped: true,
  scopeMode: 'creator',
  detail: '/v2/sales-docs/:id',
  deleteUrl: '/v2/sales-docs/:id',
  lists: ['/v2/sales-docs?limit=200', '/v2/sales-docs/counts'],
  async create(c, t, label) {
    const m = markerOf('salesdoc', label);
    const d = await mk(c, t, '/v2/sales-docs', { kind: 'proposal', buyerName: m, lines: [LINE] });
    return base(m, {
      ids: { id: d.id, eventId: randomUUID() },
      statics: { revision: '1' },
      rv: d.rowVersion ?? 1,
    });
  },
  bodies: [
    [/^PATCH \/v2\/sales-docs\/:id$/, (fx) => ({ buyerName: `${fx.marker}-x`, rowVersion: fx.rv })],
    [/^POST \/v2\/sales-docs\/:id\/send$/, () => ({ channel: 'email', to: 'idor@example.test' })],
    [/^POST \/v2\/sales-docs\/:id\/extend$/, () => ({ validUntil: '2031-03-10' })],
  ],
  update: (fx) => ({
    method: 'patch',
    url: `/v2/sales-docs/${fx.ids.id}`,
    body: { buyerName: `${fx.marker}-upd`, rowVersion: fx.rv },
  }),
};

const webhooks: Spec = {
  key: 'webhooks',
  controls: ['AUTHZ-031', 'AUTHZ-033', 'AUTHZ-062'],
  claims: one(/^\/v2\/webhooks\/:id(\/|$)/),
  detail: '/v2/webhooks',
  lists: ['/v2/webhooks'],
  async create(c, t, label) {
    const m = markerOf('webhook', label);
    const secret = `whsec_${m}`;
    const w = await mk(c, t, '/v2/webhooks', {
      name: m,
      url: 'https://93.184.216.34/in',
      events: ['contact_created'],
      secret,
    });
    return base(m, { ids: { id: w.id }, secrets: [secret], rv: w.rowVersion ?? 1 });
  },
  bodies: [[/^PATCH \/v2\/webhooks\/:id$/, (fx) => ({ name: `${fx.marker}-x` })]],
  update: (fx) => ({
    method: 'patch',
    url: `/v2/webhooks/${fx.ids.id}`,
    body: { name: `${fx.marker}-upd` },
  }),
};

const devKeys: Spec = {
  key: 'api-keys',
  controls: ['AUTHZ-031', 'AUTHZ-033', 'AUTHZ-062', 'AUTHZ-063'],
  claims: one(/^\/v2\/developer\/keys\/:id(\/|$)/),
  detail: '/v2/developer/keys',
  lists: ['/v2/developer/keys'],
  async create(c, t, label) {
    const m = markerOf('apikey', label);
    const k = await mk<{ key: { id: string; prefix: string }; secret: string }>(
      c,
      t,
      '/v2/developer/keys',
      { name: m },
    );
    return base(m, { ids: { id: k.key.id }, secrets: [k.secret, k.key.prefix].filter(Boolean) });
  },
};

const widgets: Spec = {
  key: 'widgets',
  controls: ['AUTHZ-031', 'AUTHZ-033'],
  claims: one(/^\/v2\/widgets\/:id(\/|$)/),
  detail: '/v2/widgets/:id',
  deleteUrl: '/v2/widgets/:id',
  lists: ['/v2/widgets'],
  async create(c, t, label) {
    const m = markerOf('widget', label);
    const body = {
      name: m,
      mode: 'whatsapp',
      position: 'bottom_right',
      buttonColor: '#075E54',
      headerTitle: 'Chat with us',
      headerBg: '#075E54',
      headerTextColor: '#FFFFFF',
      messageBubbleColor: '#FFFFFF',
      messageTextColor: '#222222',
      bodyBgKind: 'color',
      bodyBgColor: '#ECE5DD',
      buttonLabel: 'Send message',
      actionButtonBg: '#075E54',
      actionButtonTextColor: '#FFFFFF',
      welcomeMessage: 'Hi',
      targetWhatsappCc: '+91',
      targetWhatsappNumber: '9876543210',
      prefilledMessage: 'Hi there',
    };
    const w = await mk<Created & { embedToken: string }>(c, t, '/v2/widgets', body);
    return base(m, {
      ids: { id: w.id },
      secrets: [w.embedToken].filter(Boolean),
      rv: w.rowVersion,
      extra: { body },
    });
  },
  bodies: [
    [
      /^PATCH \/v2\/widgets\/:id$/,
      (fx) => ({ ...fx.extra.body, name: 'IDOR-attacker-widget', rowVersion: fx.rv }),
    ],
  ],
  update: (fx) => ({
    method: 'patch',
    url: `/v2/widgets/${fx.ids.id}`,
    body: { ...fx.extra.body, name: `${fx.marker}-upd`, rowVersion: fx.rv },
  }),
};

const leadSources: Spec = {
  key: 'lead-sources',
  controls: ['AUTHZ-031', 'AUTHZ-033', 'AUTHZ-062'],
  claims: one(/^\/v2\/lead-sources\/:id(\/|$)/),
  detail: '/v2/lead-sources/:id',
  deleteUrl: '/v2/lead-sources/:id',
  lists: ['/v2/lead-sources'],
  async create(c, t, label) {
    const m = markerOf('leadsrc', label);
    const s = await mk<Created & { token: string; hookPath: string; hookUrl: string }>(
      c,
      t,
      '/v2/lead-sources',
      { name: m },
    );
    return base(m, {
      ids: { id: s.id, eventId: randomUUID() },
      secrets: [s.token, s.hookPath, s.hookUrl].filter(
        (x) => typeof x === 'string' && x.length > 6,
      ),
      rv: s.rowVersion ?? 1,
    });
  },
  bodies: [
    [/^PATCH \/v2\/lead-sources\/:id$/, (fx) => ({ name: `${fx.marker}-x`, rowVersion: fx.rv })],
  ],
  update: (fx) => ({
    method: 'patch',
    url: `/v2/lead-sources/${fx.ids.id}`,
    body: { name: `${fx.marker}-upd`, rowVersion: fx.rv },
  }),
};

const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, from: '00:00', to: '23:59' }));

const bookingTypes: Spec = {
  key: 'booking-types',
  controls: ['AUTHZ-031', 'AUTHZ-033'],
  claims: one(/^\/v2\/booking-types\/:id(\/|$)/),
  detail: '/v2/booking-types/:id',
  deleteUrl: '/v2/booking-types/:id',
  lists: ['/v2/booking-types'],
  async create(c, t, label) {
    const m = markerOf('btype', label);
    const bt = await mk(c, t, '/v2/booking-types', {
      name: m,
      durationMinutes: 30,
      minNoticeMinutes: 0,
      maxAdvanceDays: 30,
      timezone: 'UTC',
      availability: ALL_DAY,
    });
    return base(m, { ids: { id: bt.id }, statics: { date: '2030-01-01' }, rv: bt.rowVersion });
  },
  bodies: [
    [/^PATCH \/v2\/booking-types\/:id$/, (fx) => ({ name: `${fx.marker}-x`, rowVersion: fx.rv })],
    [
      /^PUT \/v2\/booking-types\/:id\/overrides\/:date$/,
      () => ({ isClosed: true, reason: 'IDOR' }),
    ],
  ],
  update: (fx) => ({
    method: 'patch',
    url: `/v2/booking-types/${fx.ids.id}`,
    body: { name: `${fx.marker}-upd`, rowVersion: fx.rv },
  }),
};

const appointments: Spec = {
  key: 'appointments',
  controls: ['AUTHZ-031', 'AUTHZ-032', 'AUTHZ-090'],
  claims: (r) =>
    /^\/v2\/appointments\/:id(\/|$)/.test(r.url) ||
    /^\/v2\/contacts\/:contactId\/appointments$/.test(r.url),
  scoped: true,
  detail: '/v2/appointments/:id',
  deleteUrl: '/v2/appointments/:id',
  beforeDelete: async (c, fx, token) => {
    await fire(c.h, 'post', `/v2/appointments/${fx.ids.id}/cancel`, token, {});
  },
  retire: (fx) => ({ method: 'post', url: `/v2/appointments/${fx.ids.id}/cancel`, body: {} }),
  lists: ['/v2/appointments?limit=200', '/v2/appointments/counts', '/v2/appointments/calendar'],
  async create(c, t, label, o) {
    const m = markerOf('appt', label);
    const bt = await mk(c, t, '/v2/booking-types', {
      name: m,
      durationMinutes: 30,
      minNoticeMinutes: 0,
      maxAdvanceDays: 30,
      timezone: 'UTC',
      availability: ALL_DAY,
    });
    const slots = await fire(c.h, 'get', `/v2/booking-types/${bt.id}/slots`, t.admin);
    const start = (slots.json as { days: Array<{ slots: Array<{ start: string }> }> }).days.flatMap(
      (d) => d.slots,
    )[next() % 5].start;
    const ct = await newContact(c, t, `${m}-ct`, o.ownerUuid);
    const ap = await mk(c, t, '/v2/appointments', {
      bookingTypeId: bt.id,
      startsAt: start,
      contactId: ct.id,
      hostId: o.ownerUuid,
      notes: m,
    });
    return base(m, {
      ids: { id: ap.id, contactId: ct.id },
      rv: ap.rowVersion,
      extra: { typeId: bt.id, startsAt: start },
    });
  },
  bodies: [
    [/^PATCH \/v2\/appointments\/:id$/, (fx) => ({ notes: `${fx.marker}-x`, rowVersion: fx.rv })],
    [
      /^POST \/v2\/appointments\/:id\/reschedule$/,
      (fx) => ({ startsAt: fx.extra.startsAt, ignoreAvailability: true }),
    ],
    [/^POST \/v2\/appointments\/:id\/payments$/, () => ({ amount: '1.00', method: 'cash' })],
  ],
  update: (fx) => ({
    method: 'patch',
    url: `/v2/appointments/${fx.ids.id}`,
    body: { notes: `${fx.marker}-upd`, rowVersion: fx.rv },
  }),
  attacks: (c, a, b) => [
    {
      name: 'book a foreign booking type',
      method: 'post',
      url: '/v2/appointments',
      body: {
        bookingTypeId: a.extra.typeId,
        startsAt: a.extra.startsAt,
        invitee: { name: 'IDOR', phone: phone() },
      },
    },
    {
      name: 'book my type for a foreign contact',
      method: 'post',
      url: '/v2/appointments',
      body: {
        bookingTypeId: b.extra.typeId,
        startsAt: b.extra.startsAt,
        contactId: a.ids.contactId,
      },
    },
  ],
};

const forms: Spec = {
  key: 'forms',
  controls: ['AUTHZ-031', 'AUTHZ-032', 'AUTHZ-033'],
  claims: one(/^\/v2\/forms\/:id(\/|$)/),
  scoped: true,
  scopeMode: 'creator',
  filteredRoutes:
    /^(GET \/v2\/forms\/:id\/submissions|POST \/v2\/forms\/:id\/submissions\/export)$/,
  beforeDelete: async (c, fx, token) => {
    await fire(c.h, 'post', `/v2/forms/${fx.ids.id}/archive`, token, { rowVersion: fx.rv });
  },
  prep: async (c, t) => {
    await c.h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"form_builder":true}}'::jsonb WHERE org_id = $1`,
      [t.orgId],
    );
  },
  detail: '/v2/forms/:id',
  deleteUrl: '/v2/forms/:id',
  lists: ['/v2/forms?limit=200'],
  async create(c, t, label) {
    const m = markerOf('form', label);
    const field = (id: string, kind: string, over: Record<string, unknown> = {}) => ({
      id,
      type: 'field',
      kind,
      label: id,
      ...over,
    });
    const f = await mk(c, t, '/v2/forms', {
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
    });
    const pub = await mk<Created & { publicKey: string }>(c, t, `/v2/forms/${f.id}/publish`, {
      rowVersion: f.rowVersion,
    });
    const sub = await fire(c.h, 'post', `/v2/public/forms/${pub.publicKey}/submit`, null, {
      idempotencyKey: `idem-${m}`,
      answers: { name: m, email: emailOf(m) },
    });
    if (sub.status >= 300)
      throw new Error(`public submit -> ${sub.status} ${sub.text.slice(0, 200)}`);
    const sid = (
      await c.h.owner.query(
        `SELECT s.uuid FROM web_form_submissions s JOIN web_forms w ON w.org_id = s.org_id AND w.id = s.form_id WHERE w.uuid = $1 LIMIT 1`,
        [f.id],
      )
    ).rows[0]?.uuid as string | undefined;
    if (!sid) throw new Error('the public submission left no row');
    return base(m, {
      ids: { id: f.id, sid },
      statics: { version: '1' },
      secrets: [pub.publicKey].filter(Boolean),
      rv: pub.rowVersion,
    });
  },
  bodies: [
    [/^PATCH \/v2\/forms\/:id$/, (fx) => ({ name: `${fx.marker}-x`, rowVersion: fx.rv })],
    [
      /^POST \/v2\/forms\/:id\/(publish|pause|resume|archive|duplicate|rotate-key)$/,
      (fx) => ({ rowVersion: fx.rv }),
    ],
    [/^POST \/v2\/forms\/:id\/versions\/:version\/restore$/, (fx) => ({ rowVersion: fx.rv })],
  ],
  retire: (fx) => ({
    method: 'post',
    url: `/v2/forms/${fx.ids.id}/archive`,
    body: { rowVersion: fx.rv },
  }),
  update: (fx) => ({
    method: 'patch',
    url: `/v2/forms/${fx.ids.id}`,
    body: { name: `${fx.marker}-upd`, rowVersion: fx.rv },
  }),
};

const flows: Spec = {
  key: 'flows',
  controls: ['AUTHZ-031', 'AUTHZ-033', 'AUTHZ-052'],
  claims: one(/^\/v2\/flows\/:id(\/|$)/),
  detail: '/v2/flows/:id',
  deleteUrl: '/v2/flows/:id',
  lists: ['/v2/flows', '/v2/flows/overview'],
  async create(c, t, label) {
    const m = markerOf('flow', label);
    const graph = {
      flowNodes: [
        { id: 'n_trig', type: 'trigger', x: 0, y: 0, data: { kind: 'keyword', keywords: 'hi' } },
        { id: 'n_msg', type: 'message', x: 300, y: 0, data: { text: 'hello' } },
      ],
      flowEdges: [{ id: 'e_1', source: 'n_trig', sourceHandle: 'out', target: 'n_msg' }],
      vars: [],
    };
    const f = await mk(c, t, '/v2/flows', { name: m, graph });
    return base(m, { ids: { id: f.id }, rv: f.rowVersion, extra: { graph } });
  },
  bodies: [
    [
      /^PUT \/v2\/flows\/:id$/,
      (fx) => ({ name: `${fx.marker}-x`, graph: fx.extra.graph, rowVersion: fx.rv }),
    ],
    [/^PATCH \/v2\/flows\/:id\/rename$/, (fx) => ({ name: `${fx.marker}-x`, rowVersion: fx.rv })],
    [/^PUT \/v2\/flows\/:id\/publish-sync\/chatbot$/, () => ({ chatbotRecord: null })],
  ],
  update: (fx) => ({
    method: 'patch',
    url: `/v2/flows/${fx.ids.id}/rename`,
    body: { name: `${fx.marker}-upd`, rowVersion: fx.rv },
  }),
};

const products: Spec = {
  key: 'catalog-products',
  controls: ['AUTHZ-031', 'AUTHZ-033'],
  claims: one(/^\/v2\/catalog\/products\/:id(\/|$)/),
  detail: '/v2/catalog/products/:id',
  deleteUrl: '/v2/catalog/products/:id',
  lists: [
    '/v2/catalog/products',
    '/v2/catalog/products/picker',
    '/v2/catalog/collections',
    '/v2/catalog/overview',
  ],
  async create(c, t, label) {
    const m = markerOf('product', label);
    const p = await mk(c, t, '/v2/catalog/products', {
      name: m,
      priceMajor: '1299.50',
      currencyCode: 'INR',
    });
    return base(m, { ids: { id: p.id }, rv: p.rowVersion });
  },
  bodies: [
    [
      /^PUT \/v2\/catalog\/products\/:id$/,
      (fx) => ({
        name: `${fx.marker}-x`,
        priceMajor: '10.00',
        currencyCode: 'INR',
        rowVersion: fx.rv,
      }),
    ],
    [/^POST \/v2\/catalog\/products\/:id\/send$/, () => ({ phone: '+919800000001' })],
  ],
  update: (fx) => ({
    method: 'put',
    url: `/v2/catalog/products/${fx.ids.id}`,
    body: { name: `${fx.marker}-upd`, priceMajor: '10.00', currencyCode: 'INR', rowVersion: fx.rv },
  }),
};

const roles: Spec = {
  key: 'roles',
  controls: ['AUTHZ-031', 'AUTHZ-033', 'AUTHZ-061', 'AUTHZ-064'],
  claims: one(/^\/v2\/roles\/:id(\/|$)/),
  detail: '/v2/roles/:id',
  deleteUrl: '/v2/roles/:id',
  lists: ['/v2/roles'],
  async create(c, t, label) {
    const m = markerOf('role', label);
    const r = await mk(c, t, '/v2/roles', {
      name: m,
      grants: [{ permissionKey: 'record.contacts.read', effect: 'allow', recordScope: 'own' }],
    });
    return base(m, { ids: { id: r.id }, rv: r.rowVersion ?? 1 });
  },
  bodies: [[/^PATCH \/v2\/roles\/:id$/, (fx) => ({ name: `${fx.marker}-x`, rowVersion: fx.rv })]],
  update: (fx) => ({
    method: 'patch',
    url: `/v2/roles/${fx.ids.id}`,
    body: { name: `${fx.marker}-upd`, rowVersion: fx.rv },
  }),
  attacks: (c, a) => [
    {
      name: 'create a user with a foreign role id',
      method: 'post',
      url: '/v2/users',
      body: {
        email: `idor-role${next()}@example.test`,
        fullName: 'IDOR',
        password: 'Str0ngPassw0rd#1',
        roleIds: [a.ids.id],
      },
      ok2xx: () => null,
      verify: async () =>
        (
          await c.h.owner.query(
            `SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.uuid = $1 AND ur.org_id <> r.org_id`,
            [a.ids.id],
          )
        ).rowCount
          ? ['user_roles row crosses organizations']
          : [],
    },
  ],
};

const users: Spec = {
  key: 'users',
  controls: ['AUTHZ-031', 'AUTHZ-033', 'AUTHZ-061'],
  claims: one(/^\/v2\/users\/:id(\/|$)/),
  detail: '/v2/users/:id',
  lists: ['/v2/users?limit=200', '/v2/workspace/members'],
  async create(c, t, label) {
    const m = markerOf('user', label);
    const role = (
      await c.h.owner.query(`SELECT uuid FROM roles WHERE org_id = $1 AND name = 'Viewer'`, [
        t.orgId,
      ])
    ).rows[0].uuid as string;
    const u = await mk(c, t, '/v2/users', {
      email: emailOf(m),
      fullName: m,
      password: 'Str0ngPassw0rd#1',
      roleIds: [role],
    });
    return base(m, { ids: { id: u.id }, rv: u.rowVersion ?? 1, extra: { roleId: role } });
  },
  bodies: [
    [/^PATCH \/v2\/users\/:id$/, (fx) => ({ fullName: `${fx.marker}-x`, rowVersion: fx.rv })],
  ],
  update: (fx) => ({
    method: 'patch',
    url: `/v2/users/${fx.ids.id}`,
    body: { fullName: `${fx.marker}-upd`, rowVersion: fx.rv },
  }),
  queries: (a) => [`/v2/users?q=${a.marker}`],
};

const members: Spec = {
  key: 'workspace-members',
  controls: ['AUTHZ-031', 'AUTHZ-033', 'AUTHZ-061', 'AUTHZ-065'],
  claims: one(/^\/v2\/workspace\/members\/:id(\/|$)/),
  detail: '/v2/workspace/members',
  lists: ['/v2/workspace/members'],
  async create(c, t, label) {
    const m = markerOf('member', label);
    const role = (
      await c.h.owner.query(`SELECT uuid FROM roles WHERE org_id = $1 AND name = 'Agent'`, [
        t.orgId,
      ])
    ).rows[0].uuid as string;
    const inv = await mk<{ member: Created; inviteLink: string }>(
      c,
      t,
      '/v2/workspace/members/invite',
      {
        fullName: m,
        email: emailOf(m),
        roleId: role,
      },
    );
    return base(m, {
      ids: { id: inv.member.id },
      secrets: [inv.inviteLink].filter((x) => typeof x === 'string' && x.length > 6),
      rv: inv.member.rowVersion ?? 1,
      extra: { roleId: role },
    });
  },
  bodies: [
    [
      /^PATCH \/v2\/workspace\/members\/:id\/role$/,
      (fx) => ({ roleId: fx.extra.roleId, rowVersion: fx.rv }),
    ],
  ],
  attacks: (c, a, b) => [
    {
      name: 'invite with a foreign role',
      method: 'post',
      url: '/v2/workspace/members/invite',
      body: { fullName: 'IDOR', email: `idor-inv${next()}@example.test`, roleId: a.extra.roleId },
    },
    {
      name: 'assign a foreign role to my member',
      method: 'patch',
      url: `/v2/workspace/members/${b.ids.id}/role`,
      body: { roleId: a.extra.roleId, rowVersion: 1 },
    },
  ],
};

const teams: Spec = {
  key: 'teams',
  controls: ['AUTHZ-031', 'AUTHZ-033'],
  claims: one(/^\/v2\/workspace\/teams\/:id(\/|$)/),
  detail: '/v2/workspace/teams',
  lists: ['/v2/workspace/teams'],
  async create(c, t, label) {
    const m = markerOf('team', label);
    const tm = await mk(c, t, '/v2/workspace/teams', { name: m });
    return base(m, { ids: { id: tm.id }, rv: tm.rowVersion ?? 1 });
  },
  bodies: [
    [
      /^PATCH \/v2\/workspace\/teams\/:id$/,
      (fx) => ({ name: `${fx.marker}-x`, rowVersion: fx.rv }),
    ],
  ],
  update: (fx) => ({
    method: 'patch',
    url: `/v2/workspace/teams/${fx.ids.id}`,
    body: { name: `${fx.marker}-upd`, rowVersion: fx.rv },
  }),
};

const inbox: Spec = {
  key: 'inbox-conversations',
  controls: ['AUTHZ-031', 'AUTHZ-032', 'AUTHZ-052', 'AUTHZ-056'],
  claims: (r) =>
    /^\/v2\/inbox\/conversations\/:id(\/|$)/.test(r.url) ||
    /^\/v2\/inbox\/messages\/:id(\/|$)/.test(r.url),
  scoped: true,
  detail: '/v2/inbox/conversations/:id',
  lists: ['/v2/inbox/conversations?limit=100', '/v2/inbox/counts', '/v2/inbox/assignees'],
  async create(c, t, label, o) {
    const m = markerOf('conv', label);
    const ch = await c.inbox.channel(t.admin);
    const owner = await c.h.owner.query(`SELECT id FROM users WHERE uuid = $1`, [o.ownerUuid]);
    const conv = await c.inbox.conversation(t, ch.id, {
      title: m,
      peerName: m,
      assigneeUserId: Number(owner.rows[0].id),
      messages: 2,
      preview: m,
    });
    const msg = (
      await c.h.owner.query(
        `SELECT uuid FROM messages WHERE conversation_id = $1 ORDER BY id LIMIT 1`,
        [conv.id],
      )
    ).rows[0].uuid as string;
    const note = await mk(c, t, `/v2/inbox/conversations/${conv.uuid}/notes`, {
      body: `${m}-note`,
    });
    return base(m, {
      ids: { id: conv.uuid, noteId: note.id },
      extra: { msgId: msg, channelId: ch.id },
    });
  },
  bodies: [
    [
      /^POST \/v2\/inbox\/conversations\/:id\/messages$/,
      (fx) => ({ kind: 'text', body: `${fx.marker}-reply`, clientMessageId: randomUUID() }),
    ],
    [/^POST \/v2\/inbox\/conversations\/:id\/read$/, () => ({ upToSeq: 1 })],
    [
      /^POST \/v2\/inbox\/conversations\/:id\/status$/,
      () => ({ rowVersion: 1, status: 'resolved' }),
    ],
    [/^POST \/v2\/inbox\/conversations\/:id\/notes$/, (fx) => ({ body: `${fx.marker}-n2` })],
    [
      /^POST \/v2\/inbox\/conversations\/:id\/assign$/,
      (fx) => ({ rowVersion: 1, userId: fx.extra.ownerUuid }),
    ],
  ],
  attacks: (c, a, b) => [
    {
      name: 'assign my conversation to a foreign user',
      method: 'post',
      url: `/v2/inbox/conversations/${b.ids.id}/assign`,
      body: { rowVersion: 1, userId: a.extra.ownerUuid },
      verify: async () =>
        (
          await c.h.owner.query(
            `SELECT 1 FROM conversations x JOIN users u ON u.id = x.assignee_user_id WHERE x.uuid = $1 AND u.org_id <> x.org_id`,
            [b.ids.id],
          )
        ).rowCount
          ? ['conversation assigned to a user of another organization']
          : [],
    },
    {
      name: 'add a note to a foreign conversation through my note route',
      method: 'delete',
      url: `/v2/inbox/conversations/${b.ids.id}/notes/${a.ids.noteId}`,
    },
  ],
  queries: (a) => [
    `/v2/inbox/conversations?q=${a.marker}`,
    `/v2/inbox/conversations?assigneeId=${a.extra.ownerUuid}`,
    `/v2/inbox/conversations?channelId=${a.extra.channelId}`,
  ],
};

const tickets: Spec = {
  key: 'support-tickets',
  controls: ['AUTHZ-031', 'AUTHZ-040'],
  claims: one(/^\/v2\/support\/tickets\/:id(\/|$)/),
  detail: '/v2/support/tickets/:id',
  lists: ['/v2/support/tickets'],
  async create(c, t, label) {
    const m = markerOf('ticket', label);
    const tk = await mk<Created & { ticketNumber: string }>(c, t, '/v2/support/tickets', {
      reason: 'billing',
      name: m,
      email: emailOf(m),
      subject: m,
      message: `${m} body`,
    });
    return base(m, { ids: { id: tk.id }, secrets: [tk.ticketNumber].filter(Boolean) });
  },
  bodies: [[/^POST \/v2\/support\/tickets\/:id\/reply$/, (fx) => ({ body: `${fx.marker}-reply` })]],
};

async function seedTemplate(c: Ctx, t: Tenant, m: string): Promise<string> {
  const r = await c.h.owner.query(
    `INSERT INTO wa_templates (org_id, template_name, template_body, template_type, status) VALUES ($1, $2, $3, 'standard', 'approved') RETURNING uuid`,
    [t.orgId, m, `Hello ${m}`],
  );
  return r.rows[0].uuid as string;
}
async function seedDevice(c: Ctx, t: Tenant): Promise<string> {
  const r = await c.h.owner.query(
    `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active) VALUES ($1, $2, '+91', $3, 'connected', true) RETURNING uuid`,
    [t.orgId, `Phone ${next()}`, `98111${String(10000 + next())}`],
  );
  return r.rows[0].uuid as string;
}

const templates: Spec = {
  key: 'message-templates',
  controls: ['AUTHZ-031', 'AUTHZ-033', 'AUTHZ-053'],
  claims: one(/^\/v2\/templates\/:id(\/|$)/),
  detail: '/v2/templates/:id',
  lists: ['/v2/templates', '/v2/templates/counts'],
  async create(c, t, label) {
    const m = markerOf('template', label);
    return base(m, { ids: { id: await seedTemplate(c, t, m) } });
  },
};

const broadcasts: Spec = {
  key: 'broadcasts',
  controls: ['AUTHZ-031', 'AUTHZ-033', 'AUTHZ-053', 'AUTHZ-059'],
  claims: one(/^\/v2\/broadcasts\/:id(\/|$)/),
  detail: '/v2/broadcasts/:id',
  deleteUrl: '/v2/broadcasts/:id',
  lists: ['/v2/broadcasts?limit=100', '/v2/broadcasts/summary', '/v2/broadcast-wizard/history'],
  async create(c, t, label) {
    const m = markerOf('broadcast', label);
    const tpl = await seedTemplate(c, t, `${m}-tpl`);
    const dev = await seedDevice(c, t);
    const ct = await newContact(c, t, `${m}-ct`);
    const b = await mk<{ broadcasts: Created[] }>(c, t, '/v2/broadcasts', {
      name: m,
      templateId: tpl,
      contactIds: [ct.id],
      senderKeys: [`baileys:${dev}`],
      scheduleType: 'later',
      sendDate: '2031-03-10',
      sendTime: '09:00',
      timezone: 'Asia/Kolkata',
    });
    return base(m, {
      ids: { id: b.broadcasts[0].id },
      extra: { templateId: tpl, deviceUuid: dev, contactId: ct.id },
    });
  },
  queries: (a) => [`/v2/broadcasts?q=${a.marker}`],
  attacks: (c, a, b) => [
    {
      name: 'create a broadcast from a foreign template, contact and sender',
      method: 'post',
      url: '/v2/broadcasts',
      body: {
        name: 'IDOR-bc-x1',
        templateId: a.extra.templateId,
        contactIds: [a.extra.contactId],
        senderKeys: [`baileys:${a.extra.deviceUuid}`],
        scheduleType: 'later',
        sendDate: '2031-03-10',
        sendTime: '09:00',
        timezone: 'UTC',
      },
      verify: async () =>
        (
          await c.h.owner.query(
            `SELECT 1 FROM broadcasts WHERE name LIKE 'IDOR-bc-x1%' AND org_id = $1`,
            [c.B.orgId],
          )
        ).rowCount
          ? ['broadcast created in B from foreign template/contact/sender']
          : [],
    },
    {
      name: 'create a broadcast with my template to a foreign contact',
      method: 'post',
      url: '/v2/broadcasts',
      body: {
        name: 'IDOR-bc-x2',
        templateId: b.extra.templateId,
        contactIds: [a.extra.contactId],
        senderKeys: [`baileys:${b.extra.deviceUuid}`],
        scheduleType: 'later',
        sendDate: '2031-03-10',
        sendTime: '09:00',
        timezone: 'UTC',
      },
      verify: async () =>
        (
          await c.h.owner.query(
            `SELECT 1 FROM broadcast_contacts bc JOIN contacts k ON k.id = bc.contact_id WHERE k.uuid = $1 AND bc.org_id <> k.org_id`,
            [a.extra.contactId],
          )
        ).rowCount
          ? ['broadcast recipient row crosses organizations']
          : [],
    },
  ],
};

const campaigns: Spec = {
  key: 'campaigns',
  controls: ['AUTHZ-031', 'AUTHZ-033', 'AUTHZ-053'],
  claims: one(/^\/v2\/campaigns\/:id(\/|$)/),
  detail: '/v2/campaigns/:id',
  deleteUrl: '/v2/campaigns/:id',
  lists: ['/v2/campaigns?limit=100'],
  async create(c, t, label) {
    const m = markerOf('campaign', label);
    const ct = await newContact(c, t, `${m}-ct`);
    const r = await mk<{ campaign: Created }>(c, t, '/v2/campaigns', {
      name: m,
      type: 'text',
      customMessage: m,
      scheduleType: 'scheduled',
      sendDate: '2031-03-10',
      sendTime: '09:00',
      timezone: 'UTC',
      contactIds: [ct.id],
    });
    return base(m, { ids: { id: r.campaign.id }, extra: { contactId: ct.id } });
  },
  bodies: [
    [
      /^PUT \/v2\/campaigns\/:id$/,
      (fx) => ({ name: `${fx.marker}-x`, type: 'text', customMessage: 'x', scheduleType: 'now' }),
    ],
  ],
  queries: (a) => [`/v2/campaigns?q=${a.marker}`],
  attacks: (c, a) => [
    {
      name: 'bulk delete a foreign campaign',
      method: 'post',
      url: '/v2/campaigns/bulk-delete',
      body: { ids: [a.ids.id] },
      ok2xx: () => null,
      verify: async () =>
        (await c.h.owner.query(`SELECT 1 FROM wpcampaigns WHERE uuid = $1`, [a.ids.id]))
          .rowCount === 1
          ? []
          : ['foreign campaign deleted'],
    },
    {
      name: 'create a campaign for a foreign contact',
      method: 'post',
      url: '/v2/campaigns',
      body: {
        name: 'IDOR-camp-x',
        type: 'text',
        customMessage: 'x',
        scheduleType: 'scheduled',
        sendDate: '2031-03-10',
        sendTime: '09:00',
        timezone: 'UTC',
        contactIds: [a.extra.contactId],
      },
      ok2xx: () => null,
      verify: async () =>
        (
          await c.h.owner.query(
            `SELECT 1 FROM wp_campaign_contacts r JOIN contacts k ON k.id = r.contact_id WHERE k.uuid = $1 AND r.org_id <> k.org_id`,
            [a.extra.contactId],
          )
        ).rowCount
          ? ['campaign recipient crosses organizations']
          : [],
    },
  ],
};

const scheduled: Spec = {
  key: 'scheduled-messages',
  controls: ['AUTHZ-031', 'AUTHZ-033'],
  claims: one(/^\/v2\/scheduled\/:id(\/|$)/),
  detail: '/v2/scheduled/:id',
  deleteUrl: '/v2/scheduled/:id',
  lists: ['/v2/scheduled'],
  async create(c, t, label) {
    const m = markerOf('sched', label);
    const dev = await seedDevice(c, t);
    const r = await mk<{ ids: string[] }>(c, t, '/v2/scheduled', {
      name: m,
      scheduleType: 'once',
      sendDate: '2031-03-10',
      sendTime: '10:30',
      timezone: 'UTC',
      senders: [`baileys:${dev}`],
      messageType: 'plain',
      message: `Hello ${m}`,
      recipientType: 'number',
      numbers: [`+9198222${String(10000 + next())}`],
    });
    return base(m, { ids: { id: r.ids[0] }, extra: { deviceUuid: dev } });
  },
  bodies: [
    [/^PATCH \/v2\/scheduled\/:id$/, (fx) => ({ name: `${fx.marker}-x`, rowVersion: 1 })],
    [/^POST \/v2\/scheduled\/:id\/retry$/, () => ({ sendDate: '2031-03-12', sendTime: '10:00' })],
  ],
  attacks: (c, a) => [
    {
      name: 'schedule from a foreign device',
      method: 'post',
      url: '/v2/scheduled',
      body: {
        name: 'IDOR-sched-x',
        scheduleType: 'once',
        sendDate: '2031-03-10',
        sendTime: '10:30',
        timezone: 'UTC',
        senders: [`baileys:${a.extra.deviceUuid}`],
        messageType: 'plain',
        message: 'x',
        recipientType: 'number',
        numbers: ['+919822299999'],
      },
      verify: async () =>
        (
          await c.h.owner.query(
            `SELECT 1 FROM scheduled_messages WHERE schedule_name = 'IDOR-sched-x' AND org_id = $1`,
            [c.B.orgId],
          )
        ).rowCount
          ? ['schedule created in B on a foreign device']
          : [],
    },
  ],
};

const salesOrders: Spec = {
  key: 'sales-orders',
  controls: ['AUTHZ-031', 'AUTHZ-032', 'AUTHZ-054'],
  claims: one(/^\/v2\/sales-orders\/:id(\/|$)/),
  scoped: true,
  scopeMode: 'creator',
  detail: '/v2/sales-orders/:id',
  deleteUrl: '/v2/sales-orders/:id',
  lists: ['/v2/sales-orders?limit=100', '/v2/sales-orders/counts'],
  async create(c, t, label) {
    const m = markerOf('salesorder', label);
    const o = await mk(c, t, '/v2/sales-orders', { buyerName: m, lines: [LINE] });
    return base(m, { ids: { id: o.id }, rv: o.rowVersion ?? 1 });
  },
  scopeGrants: ['record.sales-orders.create'],
  bodies: [
    [
      /^PATCH \/v2\/sales-orders\/:id$/,
      (fx) => ({ buyerName: `${fx.marker}-x`, rowVersion: fx.rv }),
    ],
    [/^POST \/v2\/sales-orders\/:id\/fulfil$/, () => ({ all: true })],
    [/^POST \/v2\/sales-orders\/:id\/cancel$/, () => ({ reason: 'IDOR' })],
    [/^POST \/v2\/sales-orders\/:id\/invoice$/, () => ({ all: true })],
  ],
  update: (fx) => ({
    method: 'patch',
    url: `/v2/sales-orders/${fx.ids.id}`,
    body: { buyerName: `${fx.marker}-upd`, rowVersion: fx.rv },
  }),
};

const contactViews: Spec = {
  key: 'contact-views',
  controls: ['AUTHZ-031', 'AUTHZ-033'],
  claims: one(/^\/v2\/contact-views\/:id(\/|$)/),
  detail: '/v2/contact-views',
  lists: ['/v2/contact-views'],
  async create(c, t, label) {
    const m = markerOf('view', label);
    const v = await mk(c, t, '/v2/contact-views', { name: m, filter: {}, isShared: true });
    return base(m, { ids: { id: v.id }, rv: v.rowVersion ?? 1 });
  },
  bodies: [
    [/^PATCH \/v2\/contact-views\/:id$/, (fx) => ({ name: `${fx.marker}-x`, rowVersion: fx.rv })],
  ],
};

const storeOrders: Spec = {
  key: 'store-orders',
  controls: ['AUTHZ-031', 'AUTHZ-033', 'AUTHZ-053'],
  claims: one(/^\/v2\/store\/orders\/:id(\/|$)/),
  detail: '/v2/store/orders/:id',
  deleteUrl: '/v2/store/orders/:id',
  lists: ['/v2/store/orders?limit=100', '/v2/store/overview'],
  async create(c, t, label) {
    const m = markerOf('order', label);
    const dev = await seedDevice(c, t);
    const shop = await mk<Created & { slug: string }>(c, t, '/v2/store/shops', {
      shopName: `Shop ${m}`,
      deviceId: dev,
    });
    const prod = await c.h.owner.query(
      `INSERT INTO wa_products (org_id, name, slug, price_minor, stock_qty, in_stock, status, currency_code) VALUES ($1,'Tea','tea-' || $2,10000,NULL,true,'active','INR') RETURNING uuid`,
      [t.orgId, String(next())],
    );
    const res = await fire(c.h, 'post', `/v2/store-public/${shop.slug}/checkout`, null, {
      name: m,
      phone: `+9198${String(70000000 + next())}`,
      email: emailOf(m),
      address: '12 Main St',
      items: [{ id: prod.rows[0].uuid, qty: 1 }],
    });
    if (res.status !== 201) throw new Error(`checkout -> ${res.status} ${res.text.slice(0, 200)}`);
    const row = await c.h.owner.query(`SELECT uuid FROM wa_orders WHERE id = $1`, [
      res.json.orderNo,
    ]);
    return base(m, {
      ids: { id: row.rows[0].uuid as string },
      extra: { orderNo: res.json.orderNo },
    });
  },
  bodies: [
    [/^PATCH \/v2\/store\/orders\/:id\/status$/, () => ({ status: 'cancelled' })],
    [
      /^POST \/v2\/store\/orders\/:id\/payment-link$/,
      () => ({ paymentLink: 'https://pay.example.test/x' }),
    ],
  ],
};

const devices: Spec = {
  key: 'devices',
  controls: ['AUTHZ-031', 'AUTHZ-033'],
  claims: one(/^\/v2\/devices\/:id(\/|$)/),
  detail: '/v2/devices/:id',
  deleteUrl: '/v2/devices/:id',
  lists: ['/v2/devices'],
  async create(c, t, label) {
    const m = markerOf('device', label);
    const r = await c.h.owner.query(
      `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active) VALUES ($1, $2, '+91', $3, 'connected', true) RETURNING uuid`,
      [t.orgId, m, `98111${String(10000 + next())}`],
    );
    return base(m, { ids: { id: r.rows[0].uuid as string } });
  },
  bodies: [[/^PATCH \/v2\/devices\/:id$/, (fx) => ({ name: `${fx.marker}-x`, rowVersion: 1 })]],
};

const channels: Spec = {
  key: 'channels',
  controls: ['AUTHZ-031', 'AUTHZ-033'],
  claims: one(/^\/v2\/channels\/:id(\/|$)/),
  detail: '/v2/channels',
  lists: ['/v2/channels'],
  async create(c, t, label) {
    const m = markerOf('channel', label);
    const ch = await c.inbox.channel(t.admin, { name: m, displayName: m, label: m });
    return base(m, { ids: { id: ch.id }, rv: ch.rowVersion });
  },
  bodies: [
    [/^PATCH \/v2\/channels\/:id$/, (fx) => ({ rowVersion: fx.rv, name: `${fx.marker}-x` })],
  ],
};

const tchatChannels: Spec = {
  key: 'team-chat-channels',
  controls: ['AUTHZ-031', 'AUTHZ-033', 'AUTHZ-056'],
  claims: one(/^\/v2\/team-chat\/channels\/:id(\/|$)/),
  detail: '/v2/team-chat/channels',
  lists: ['/v2/team-chat/channels', '/v2/team-chat/members'],
  async create(c, t, label, o) {
    const name = `idor-chan-${label.toLowerCase()}-${next()}`;
    const ch = await mk(c, t, '/v2/team-chat/channels', { name, type: 'private' });
    const msg = await mk(c, t, `/v2/team-chat/channels/${ch.id}/messages`, {
      body: `${name} hello`,
    });
    return base(name, { ids: { id: ch.id, userId: o.ownerUuid }, extra: { messageId: msg.id } });
  },
  bodies: [
    [
      /^POST \/v2\/team-chat\/channels\/:id\/messages$/,
      (fx) => ({ body: `${fx.marker} intruder` }),
    ],
    [/^POST \/v2\/team-chat\/channels\/:id\/members$/, (fx) => ({ userId: fx.ids.userId })],
  ],
  attacks: (c, a, b) => {
    const chan = `/v2/team-chat/channels/${a.ids.id}`;
    return [
      ...['messages', 'members', 'pinned', 'activity', 'search?q=hello'].map((p): Attack => ({
        name: `a workspace member who is not in the private channel reads ${p}`,
        as: 'A-nogrant',
        method: 'get',
        url: `${chan}/${p}`,
      })),
      {
        name: 'a non-member posts into the private channel',
        as: 'A-nogrant',
        method: 'post',
        url: `${chan}/messages`,
        body: { body: 'IDOR non-member post' },
        verify: async () =>
          (
            await c.h.owner.query(
              `SELECT 1 FROM team_chat_messages WHERE body = 'IDOR non-member post'`,
            )
          ).rowCount
            ? ['a non-member message was stored in the private channel']
            : [],
      },
      {
        name: 'add a foreign user to my channel',
        method: 'post',
        url: `/v2/team-chat/channels/${b.ids.id}/members`,
        body: { userId: a.ids.userId },
        verify: async () =>
          (
            await c.h.owner.query(
              `SELECT 1 FROM team_chat_channel_members m JOIN users u ON u.id = m.user_id WHERE u.uuid = $1 AND m.org_id <> u.org_id`,
              [a.ids.userId],
            )
          ).rowCount
            ? ['a tenant-A user is a member of a tenant-B channel']
            : [],
      },
      {
        name: 'open a direct message with a foreign user',
        method: 'post',
        url: '/v2/team-chat/dm',
        body: { userId: a.ids.userId },
      },
      {
        name: 'invite someone into a foreign private channel',
        method: 'post',
        url: '/v2/team-chat/invitations',
        body: { inviteeEmail: `idor-inv-${next()}@example.test`, channelId: a.ids.id },
      },
    ];
  },
};

const tchatMessages: Spec = {
  key: 'team-chat-messages',
  controls: ['AUTHZ-031', 'AUTHZ-033', 'AUTHZ-094'],
  claims: one(/^\/v2\/team-chat\/messages\/:id(\/|$)/),
  detail: '/v2/team-chat/channels/:channelId/messages',
  async create(c, t, label) {
    const name = `idor-chan-${label.toLowerCase()}-${next()}`;
    const ch = await mk(c, t, '/v2/team-chat/channels', { name, type: 'private' });
    const marker = markerOf('chatmsg', label);
    const msg = await mk(c, t, `/v2/team-chat/channels/${ch.id}/messages`, { body: marker });
    return base(marker, { ids: { id: msg.id, channelId: ch.id }, rv: msg.rowVersion ?? 1 });
  },
  bodies: [
    [
      /^PATCH \/v2\/team-chat\/messages\/:id$/,
      (fx) => ({ body: `${fx.marker}-x`, rowVersion: fx.rv }),
    ],
    [/^POST \/v2\/team-chat\/messages\/:id\/reactions$/, () => ({ emoji: '+1' })],
  ],
};

const fieldSections: Spec = {
  key: 'field-sections',
  controls: ['AUTHZ-031', 'AUTHZ-033'],
  claims: one(/^\/v2\/field-sections\/:id(\/|$)/),
  detail: '/v2/field-sections?moduleKey=contacts',
  lists: ['/v2/field-sections?moduleKey=contacts'],
  async create(c, t, label) {
    const m = markerOf('fsection', label);
    const sec = await mk(c, t, '/v2/field-sections', { moduleKey: 'contacts', name: m });
    return base(m, { ids: { id: sec.id }, rv: sec.rowVersion ?? 1 });
  },
  bodies: [
    [/^PATCH \/v2\/field-sections\/:id$/, (fx) => ({ name: `${fx.marker}-x`, rowVersion: fx.rv })],
  ],
};

const customFields: Spec = {
  key: 'custom-fields',
  controls: ['AUTHZ-031', 'AUTHZ-033', 'AUTHZ-073'],
  claims: (r) =>
    /^\/v2\/fields\/(:id|options\/:optionId|dependencies\/:dependencyId)(\/|$)/.test(r.url),
  detail: '/v2/fields/:id',
  lists: [
    '/v2/fields?moduleKey=contacts&limit=200',
    '/v2/fields/usage?moduleKey=contacts',
    '/v2/fields/dependencies?moduleKey=contacts',
  ],
  async create(c, t, label) {
    const m = markerOf('field', label);
    const sec = await mk(c, t, '/v2/field-sections', { moduleKey: 'contacts', name: `${m}-sec` });
    const key = `idor_${next()}_${label.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const options = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ];
    const mkField = (suffix: string) =>
      mk(c, t, '/v2/fields', {
        moduleKey: 'contacts',
        sectionId: sec.id,
        key: `${key}_${suffix}`,
        label: suffix === 'a' ? m : `${m}-b`,
        fieldType: 'select',
        options,
      });
    const f1 = await mkField('a');
    const f2 = await mkField('b');
    const listed = await fire(c.h, 'get', `/v2/fields/${f1.id}/options`, t.admin);
    const opts: any[] = Array.isArray(listed.json) ? listed.json : (listed.json?.data ?? []); // eslint-disable-line @typescript-eslint/no-explicit-any
    const dep = await mk(c, t, '/v2/fields/dependencies', {
      fieldId: f2.id,
      dependsOnFieldId: f1.id,
      dependsOnValue: 'a',
    });
    if (!opts[0]?.id) throw new Error(`no option id in ${listed.text.slice(0, 160)}`);
    return base(m, {
      ids: { id: f1.id, optionId: opts[0].id, dependencyId: dep.id },
      rv: f1.rowVersion ?? 1,
      extra: { sectionId: sec.id, otherFieldId: f2.id },
    });
  },
  bodies: [
    [/^PATCH \/v2\/fields\/:id$/, (fx) => ({ label: `${fx.marker}-x`, rowVersion: fx.rv })],
    [
      /^PATCH \/v2\/fields\/options\/:optionId$/,
      (fx) => ({ label: `${fx.marker}-x`, rowVersion: 1 }),
    ],
    [/^POST \/v2\/fields\/:id\/options$/, () => ({ value: 'c', label: 'C' })],
  ],
  update: (fx) => ({
    method: 'patch',
    url: `/v2/fields/${fx.ids.id}`,
    body: { label: `${fx.marker}-upd`, rowVersion: fx.rv },
  }),
  attacks: (c, a, b) => [
    {
      name: 'create a field in a foreign section',
      method: 'post',
      url: '/v2/fields',
      body: {
        moduleKey: 'contacts',
        sectionId: a.extra.sectionId,
        key: `idor_x_${next()}`,
        label: 'IDOR foreign section',
        fieldType: 'text',
      },
      verify: async () =>
        (
          await c.h.owner.query(
            `SELECT 1 FROM fields WHERE label = 'IDOR foreign section' AND org_id = $1`,
            [c.B.orgId],
          )
        ).rowCount
          ? ['a field was created in tenant B inside a tenant-A section']
          : [],
    },
    {
      name: 'make my field depend on a foreign field',
      method: 'post',
      url: '/v2/fields/dependencies',
      body: { fieldId: b.ids.id, dependsOnFieldId: a.ids.id, dependsOnValue: 'a' },
      verify: async () =>
        (
          await c.h.owner.query(
            `SELECT 1 FROM field_dependencies d JOIN fields f ON f.id = d.depends_on_field_id WHERE f.uuid = $1 AND d.org_id <> f.org_id`,
            [a.ids.id],
          )
        ).rowCount
          ? ['a field dependency crosses organizations']
          : [],
    },
  ],
};

const statusOptions: Spec = {
  key: 'status-options',
  controls: ['AUTHZ-031', 'AUTHZ-033'],
  claims: one(/^\/v2\/status-options\/:id(\/|$)/),
  detail: '/v2/status-options?moduleKey=contacts&optionGroup=status',
  lists: [
    '/v2/status-options?moduleKey=contacts&optionGroup=status',
    '/v2/status-options/usage?moduleKey=contacts&optionGroup=status',
  ],
  async create(c, t, label) {
    const m = markerOf('status', label);
    const value = `idor_${next()}_${label.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const o = await mk(c, t, '/v2/status-options', {
      moduleKey: 'contacts',
      optionGroup: 'status',
      value,
      label: m,
    });
    return base(m, { ids: { id: o.id }, rv: o.rowVersion ?? 1 });
  },
  bodies: [
    [/^PATCH \/v2\/status-options\/:id$/, (fx) => ({ label: `${fx.marker}-x`, rowVersion: fx.rv })],
  ],
};

export const SPECS: Spec[] = [
  fieldSections,
  customFields,
  statusOptions,
  tchatChannels,
  tchatMessages,
  devices,
  channels,
  tickets,
  templates,
  broadcasts,
  campaigns,
  scheduled,
  salesOrders,
  contactViews,
  storeOrders,
  contacts,
  contactNotes,
  contactMeetings,
  contactFiles,
  companies,
  tasks,
  tags,
  groups,
  attributes,
  segments,
  deals,
  pipelines,
  stages,
  invoices,
  salesDocs,
  webhooks,
  devKeys,
  widgets,
  leadSources,
  bookingTypes,
  appointments,
  forms,
  flows,
  products,
  roles,
  users,
  members,
  teams,
  inbox,
];

/** Unique permission keys of a family's routes, as grants of the given scope (the member that holds "everything of this family"). */
export const grantsOf = (routes: Route[], scope: 'all' | 'own'): Grant[] =>
  [...new Set(routes.flatMap((r) => r.permissions.slice(0, 1)))].map((k) => [k, scope] as Grant);

export { expect };
