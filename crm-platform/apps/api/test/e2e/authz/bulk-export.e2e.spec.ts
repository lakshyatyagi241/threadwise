import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import {
  ChatMediaStore,
  MediaTokenService,
} from '../../../src/infra/providers/chat-conversations/media';
import { ContactImportEngine } from '../../../src/modules/crm';
import {
  Api,
  bearer,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * Bulk operations, import / export, downloads, reports and pagination: authorization evidence
 * (AUTHZ-014, 020, 048, 050, 064, 065, 071, 074, 090).
 *
 * Behaviour found in the code and asserted here (not assumed):
 *  - Bulk by ids is PER ROW, not all-or-nothing, on purpose (contacts, tasks, companies: "one bad id must not sink the others"). An id
 *    that is unknown, belongs to another workspace or lies outside the caller's record scope is listed in `failed` with the same code
 *    and message as a nonexistent id; the legitimate ids are applied. The tests therefore assert: foreign rows untouched, foreign
 *    ids reported (never silently "succeeded"), and the legitimate ids applied (documented partial application).
 *  - A reference that is wrong for the whole call (a foreign group, assignee or owner) is a 4xx and applies nothing.
 *  - A selection by filter is resolved by the same SQL as the list, inside the tenant (RLS + org_id) and the caller's record scope.
 *  - Exports stream a fixed column list; every cell that can start a formula is prefixed with an apostrophe (phone numbers are not).
 *
 * One app, one database; each block works in workspaces of its own so a destructive test cannot disturb another.
 */

let h: Harness;
let api: Api;
let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'crm-authz-media-'));
  process.env.MEDIA_LOCAL_DIR = root;
  h = await startHarness();
  api = new Api(h);
}, 600_000);

afterAll(async () => {
  await h?.stop();
  await rm(root, { recursive: true, force: true });
  delete process.env.MEDIA_LOCAL_DIR;
});

// ---- helpers ---------------------------------------------------------------------------------------------------------------------

type Member = { token: string; userId: number };
let seq = 0;
const phone = () => `+9199${String(10_000_000 + seq++)}`;
const as = (token: string) => api.as(token);
const anon = () => api.http();

const countOf = async (table: string, orgId: number, where = 'true') =>
  Number(
    (
      await h.owner.query(
        `SELECT count(*)::int AS n FROM "${table}" WHERE org_id = $1 AND ${where}`,
        [orgId],
      )
    ).rows[0].n,
  );
const rowHash = async (table: string, uuid: string) =>
  (
    await h.owner.query(`SELECT md5(to_jsonb(t)::text) AS h FROM "${table}" t WHERE uuid = $1`, [
      uuid,
    ])
  ).rows[0]?.h as string | undefined;
const hashes = async (table: string, uuids: string[]) =>
  Promise.all(uuids.map((u) => rowHash(table, u)));
const userUuid = async (userId: number) =>
  (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0].uuid as string;
const ownerOf = async (uuid: string) => {
  const r = await h.owner.query(`SELECT owner_id FROM contacts WHERE uuid = $1`, [uuid]);
  return r.rows[0] ? (r.rows[0].owner_id as number | null) : 'gone';
};
const exists = async (table: string, uuid: string) =>
  Number(
    (await h.owner.query(`SELECT count(*)::int AS n FROM "${table}" WHERE uuid = $1`, [uuid]))
      .rows[0].n,
  ) === 1;

async function seed(
  t: Tenant,
  prefix: string,
  n: number,
  extra: { ownerId?: number | null; source?: string; data?: Record<string, unknown> } = {},
) {
  return api.seedContacts(
    t,
    Array.from({ length: n }, (_, i) => ({
      name: `${prefix}${i}`,
      phone: phone(),
      email: `${prefix.toLowerCase().replace(/[^a-z0-9]/g, '')}${i}-${seq}@example.test`,
      ...extra,
    })),
  );
}

/** RFC 4180 reader: enough for the exports (quoted cells, doubled quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
function records(text: string): { header: string[]; rows: Array<Record<string, string>> } {
  const [header = [], ...rest] = parseCsv(text);
  return {
    header,
    rows: rest
      .filter((r) => !(r.length === 1 && r[0] === ''))
      .map((r) => Object.fromEntries(header.map((k, i) => [k, r[i] ?? '']))),
  };
}

const rawBytes = (
  res: { on: (e: string, cb: (c?: Buffer) => void) => void },
  cb: (e: null, b: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on('data', (c) => chunks.push(c as Buffer));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

const OWN_CONTACTS: Grant[] = [
  ['record.contacts.read', 'own'],
  ['record.contacts.create'],
  ['record.contacts.update', 'own'],
  ['record.contacts.delete', 'own'],
];
const failedIds = (body: { failed: Array<{ id: string }> }) => body.failed.map((f) => f.id).sort();

// ==== 1. bulk operations (AUTHZ-014, 020) ========================================================================================

describe('AUTHZ-014 / AUTHZ-020 bulk by ids: foreign and nonexistent ids are reported, never applied', () => {
  let A: Tenant;
  let B: Tenant;
  let own: Member;
  let col: Member;

  beforeAll(async () => {
    A = await api.signup('bk-a');
    B = await api.signup('bk-b');
    own = await api.member(A, 'bk-own', OWN_CONTACTS);
    col = await api.member(A, 'bk-col', OWN_CONTACTS);
  });

  it('AUTHZ-014 contacts bulk/delete with own + foreign + nonexistent ids: own deleted, foreign untouched and reported exactly like nonexistent ones', async () => {
    const mine = await seed(A, 'BD-A-', 3);
    const theirs = await seed(B, 'BD-B-', 2);
    const ghosts = [randomUUID(), randomUUID()];
    const before = await hashes('contacts', theirs);
    const bCount = await countOf('contacts', B.orgId);

    const res = await as(A.admin)
      .post('/v2/contacts/bulk/delete')
      .send({ ids: [mine[0], theirs[0], ghosts[0], mine[1], theirs[1], ghosts[1], mine[2]] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // documented per-row policy: the legitimate ids ARE applied; the others are reported, not applied
    expect(res.body).toMatchObject({ matched: 3, changed: 3, failedCount: 4 });
    expect(failedIds(res.body)).toEqual([...theirs, ...ghosts].sort());
    const foreign = res.body.failed.find((f: { id: string }) => f.id === theirs[0]);
    const ghost = res.body.failed.find((f: { id: string }) => f.id === ghosts[0]);
    expect({ code: foreign.code, message: foreign.message }).toEqual({
      code: ghost.code,
      message: ghost.message,
    });
    expect(res.body.succeeded.sort()).toEqual([...mine].sort());
    for (const u of mine) expect(await exists('contacts', u), `own ${u} deleted`).toBe(false);
    expect(await hashes('contacts', theirs)).toEqual(before);
    expect(await countOf('contacts', B.orgId)).toBe(bCount);
  });

  it('AUTHZ-014 contacts bulk/delete naming only foreign ids deletes nothing and is a plain "not found" report', async () => {
    const theirs = await seed(B, 'BD2-B-', 3);
    const before = await hashes('contacts', theirs);
    const res = await as(A.admin).post('/v2/contacts/bulk/delete').send({ ids: theirs });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ matched: 0, changed: 0, failedCount: 3, succeeded: [] });
    expect(await hashes('contacts', theirs)).toEqual(before);
    // and B can still read them: nothing leaked in the report either
    expect(JSON.stringify(res.body)).not.toMatch(/BD2-B-/);
  });

  it('AUTHZ-014 an own-scope member bulk-deleting [own, colleague, other workspace] deletes only its own; the others are reported and unchanged', async () => {
    const mine = await seed(A, 'BS-own-', 2, { ownerId: own.userId });
    const colleague = await seed(A, 'BS-col-', 2, { ownerId: col.userId });
    const theirs = await seed(B, 'BS-B-', 2);
    const before = await hashes('contacts', [...colleague, ...theirs]);
    const res = await as(own.token)
      .post('/v2/contacts/bulk/delete')
      .send({ ids: [mine[0], colleague[0], theirs[0], mine[1], colleague[1], theirs[1]] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ matched: 2, changed: 2, failedCount: 4 });
    expect(failedIds(res.body)).toEqual([...colleague, ...theirs].sort());
    for (const u of mine) expect(await exists('contacts', u)).toBe(false);
    expect(await hashes('contacts', [...colleague, ...theirs])).toEqual(before);
    // positive control: the owner of the colleague's contacts may delete them
    const ok = await as(col.token).post('/v2/contacts/bulk/delete').send({ ids: colleague });
    expect(ok.body).toMatchObject({ matched: 2, changed: 2, failedCount: 0 });
  });

  it('AUTHZ-020 "select all matching" by filter never escapes the workspace: a prefix shared with another workspace deletes only this one', async () => {
    const mine = await seed(A, 'SEL-ALL-', 4);
    const theirs = await seed(B, 'SEL-ALL-', 4);
    const before = await hashes('contacts', theirs);
    const res = await as(A.admin)
      .post('/v2/contacts/bulk/delete')
      .send({ filter: { q: 'SEL-ALL-' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ matched: 4, changed: 4, failedCount: 0 });
    for (const u of mine) expect(await exists('contacts', u)).toBe(false);
    expect(await hashes('contacts', theirs)).toEqual(before);
  });

  it('AUTHZ-020 "select all matching" by an own-scope member covers only its own rows; ownerId / includeArchived / excludeIds cannot widen the scope', async () => {
    const mine = await seed(A, 'SELO-', 3, { ownerId: own.userId });
    const colleague = await seed(A, 'SELO-', 3, { ownerId: col.userId });
    const theirs = await seed(B, 'SELO-', 3);
    const colUuid = await userUuid(col.userId);
    const before = await hashes('contacts', [...colleague, ...theirs]);

    const probeTag = (await as(A.admin).post('/v2/tags').send({ name: 'probe-tag' })).body.id;
    for (const filter of [
      { q: 'SELO-', ownerId: colUuid },
      { q: 'SELO-', ownerId: colUuid, includeArchived: true },
      { ownerId: colUuid },
    ]) {
      const probe = await as(own.token).post('/v2/contacts/bulk/tag').send({
        filter,
        tagId: probeTag,
        action: 'add',
      });
      expect(probe.status, JSON.stringify(probe.body)).toBe(200);
      expect(probe.body.matched, JSON.stringify(filter)).toBe(0);
    }
    expect(await hashes('contacts', [...colleague, ...theirs])).toEqual(before);

    const res = await as(own.token)
      .post('/v2/contacts/bulk/delete')
      .send({ filter: { q: 'SELO-' }, excludeIds: [...colleague, ...theirs, randomUUID()] });
    expect(res.body).toMatchObject({ matched: 3, changed: 3 });
    for (const u of mine) expect(await exists('contacts', u)).toBe(false);
    expect(await hashes('contacts', [...colleague, ...theirs])).toEqual(before);
  });

  it("AUTHZ-020 a filter that names another workspace's group, tag, owner or segment matches nothing (never everything)", async () => {
    const mine = await seed(A, 'FOR-A-', 3);
    const theirs = await seed(B, 'FOR-B-', 3);
    const bGroup = (await as(B.admin).post('/v2/contact-groups').send({ name: 'FOR-B-G' })).body.id;
    const bTag = (await as(B.admin).post('/v2/tags').send({ name: 'FOR-B-T' })).body.id;
    await as(B.admin)
      .post('/v2/contacts/bulk/group')
      .send({ ids: theirs, groupId: bGroup, action: 'add' });
    const bUser = await userUuid(B.adminUserId);
    const before = await hashes('contacts', [...mine, ...theirs]);
    for (const filter of [
      { groupId: bGroup },
      { tagIds: [bTag] },
      { ownerId: bUser },
      { segmentId: randomUUID() },
    ]) {
      const res = await as(A.admin).post('/v2/contacts/bulk/delete').send({ filter });
      expect(res.status, JSON.stringify(filter)).toBe(200);
      expect(res.body, JSON.stringify(filter)).toMatchObject({ matched: 0, changed: 0 });
    }
    expect(await hashes('contacts', [...mine, ...theirs])).toEqual(before);
    expect(await countOf('contact_group_members', B.orgId)).toBe(3);
  });

  it('AUTHZ-014 bulk/group and bulk/tag: foreign contact ids are not added, a foreign group is a 404 for the whole call, a foreign tag id is refused', async () => {
    const mine = await seed(A, 'BG-A-', 2);
    const theirs = await seed(B, 'BG-B-', 2);
    const aGroup = (await as(A.admin).post('/v2/contact-groups').send({ name: 'BG-A-G' })).body.id;
    const bGroup = (await as(B.admin).post('/v2/contact-groups').send({ name: 'BG-B-G' })).body.id;
    const aTag = (await as(A.admin).post('/v2/tags').send({ name: 'BG-A-T' })).body.id;
    const bMembersBefore = await countOf('contact_group_members', B.orgId);
    const bTagsBefore = await countOf('contact_tags', B.orgId);
    const bTag = (await as(B.admin).post('/v2/tags').send({ name: 'BG-B-T' })).body.id;

    const add = await as(A.admin)
      .post('/v2/contacts/bulk/group')
      .send({ ids: [...mine, ...theirs], groupId: aGroup, action: 'add' });
    expect(add.status, JSON.stringify(add.body)).toBe(200);
    expect(add.body).toMatchObject({ matched: 2, changed: 2, failedCount: 2 });
    expect(await countOf('contact_group_members', B.orgId)).toBe(bMembersBefore);

    const foreignGroup = await as(A.admin)
      .post('/v2/contacts/bulk/group')
      .send({ ids: mine, groupId: bGroup, action: 'add' });
    expect(foreignGroup.status).toBe(404);
    const toBGroup = await as(B.admin).get(`/v2/contact-groups/${bGroup}`);
    expect(toBGroup.body.memberCount).toBe(0);

    const tag = await as(A.admin)
      .post('/v2/contacts/bulk/tag')
      .send({ ids: [...mine, ...theirs], tagId: aTag, action: 'add' });
    expect(tag.body).toMatchObject({ matched: 2, changed: 2, failedCount: 2 });
    expect(await countOf('contact_tags', B.orgId)).toBe(bTagsBefore);

    const foreignTag = await as(A.admin)
      .post('/v2/contacts/bulk/tag')
      .send({ ids: mine, tagId: bTag, action: 'add' });
    expect(foreignTag.status, JSON.stringify(foreignTag.body)).toBe(422);
    expect(
      await countOf(
        'contact_tags',
        A.orgId,
        `tag_id = (SELECT id FROM tags WHERE uuid = '${bTag}')`,
      ),
    ).toBe(0);
    expect(await countOf('contact_tags', B.orgId)).toBe(bTagsBefore);
  });

  it('AUTHZ-014 bulk/update and /assignee: foreign ids are reported and untouched, an owner from another workspace is refused with nothing applied', async () => {
    const mine = await seed(A, 'BU-A-', 3);
    const theirs = await seed(B, 'BU-B-', 2);
    const colUuid = await userUuid(col.userId);
    const bUser = await userUuid(B.adminUserId);
    const before = await hashes('contacts', theirs);

    const ok = await as(A.admin)
      .post('/v2/contacts/bulk/update')
      .send({ ids: [mine[0], theirs[0], mine[1], randomUUID()], values: { ownerId: colUuid } });
    expect(ok.status, JSON.stringify(ok.body)).toBeLessThan(300);
    expect(ok.body.succeeded.sort()).toEqual([mine[0], mine[1]].sort());
    expect(failedIds(ok.body)).toHaveLength(2);
    expect(await ownerOf(mine[0]!)).toBe(col.userId);
    expect(await ownerOf(mine[2]!)).toBeNull();
    expect(await hashes('contacts', theirs)).toEqual(before);

    for (const [path, body] of [
      ['/v2/contacts/bulk/update', { ids: mine, values: { ownerId: bUser } }],
      ['/v2/contacts/assignee', { ids: mine, ownerId: bUser }],
    ] as const) {
      const bad = await as(A.admin).post(path).send(body);
      expect(bad.status, `${path} ${JSON.stringify(bad.body)}`).toBeGreaterThanOrEqual(400);
      expect(bad.status, path).toBeLessThan(500);
    }
    expect(await ownerOf(mine[2]!)).toBeNull();
    expect(await ownerOf(mine[0]!)).toBe(col.userId);

    const assign = await as(A.admin)
      .post('/v2/contacts/assignee')
      .send({ ids: [mine[2], theirs[1]], ownerId: colUuid });
    expect(assign.status, JSON.stringify(assign.body)).toBeLessThan(300);
    expect(assign.body.succeeded).toEqual([mine[2]]);
    expect(failedIds(assign.body)).toEqual([theirs[1]]);
    expect(await hashes('contacts', theirs)).toEqual(before);
  });

  it('AUTHZ-014 an own-scope member bulk-updating / reassigning [own, colleague, foreign] changes only its own; a colleague row is reported', async () => {
    const mine = await seed(A, 'BUS-own-', 2, { ownerId: own.userId });
    const colleague = await seed(A, 'BUS-col-', 2, { ownerId: col.userId });
    const theirs = await seed(B, 'BUS-B-', 1);
    const colUuid = await userUuid(col.userId);
    const ownUuid = await userUuid(own.userId);
    const before = await hashes('contacts', [...colleague, ...theirs]);

    const res = await as(own.token)
      .post('/v2/contacts/bulk/update')
      .send({ ids: [...mine, ...colleague, ...theirs], values: { ownerId: colUuid } });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    // AZ-007: an own-scope member may not hand even their OWN contacts to a colleague (the record would vanish from their
    // view), so nothing succeeds; the colleague and foreign rows are reported as before.
    expect(res.body.succeeded).toEqual([]);
    expect(failedIds(res.body)).toEqual([...mine, ...colleague, ...theirs].sort());
    expect(await hashes('contacts', [...colleague, ...theirs])).toEqual(before);
    for (const u of mine) expect(await ownerOf(u)).toBe(own.userId);
    // keeping themselves as the owner is allowed
    const keep = await as(own.token)
      .post('/v2/contacts/bulk/update')
      .send({ ids: [...mine], values: { ownerId: ownUuid } });
    expect(keep.status, JSON.stringify(keep.body)).toBeLessThan(300);
    expect(keep.body.succeeded.sort()).toEqual([...mine].sort());

    // pulling a colleague's contact into your own ownership by "assignee" is the same refusal
    const grab = await as(own.token)
      .post('/v2/contacts/assignee')
      .send({ ids: colleague, ownerId: ownUuid });
    expect(grab.status, JSON.stringify(grab.body)).toBeLessThan(300);
    expect(grab.body.succeeded).toEqual([]);
    expect(failedIds(grab.body)).toEqual([...colleague].sort());
    for (const u of colleague) expect(await ownerOf(u)).toBe(col.userId);
  });

  it("AUTHZ-048 bulk/update custom fields: another workspace's property key is refused (422) and nothing is written; own keys still work", async () => {
    const aSection = (
      await as(A.admin).post('/v2/field-sections').send({ moduleKey: 'contacts', name: 'AZ extra' })
    ).body.id;
    const bSection = (
      await as(B.admin).post('/v2/field-sections').send({ moduleKey: 'contacts', name: 'AZ extra' })
    ).body.id;
    for (const [t, section, key] of [
      [A, aSection, 'az_city'],
      [B, bSection, 'az_bsecret'],
    ] as const) {
      const f = await as(t.admin)
        .post('/v2/fields')
        .send({ moduleKey: 'contacts', sectionId: section, key, label: key, fieldType: 'text' });
      expect(f.status, JSON.stringify(f.body)).toBe(201);
    }
    const mine = await seed(A, 'CF-A-', 2);
    const theirs = await seed(B, 'CF-B-', 1);
    const before = await hashes('contacts', [...mine, ...theirs]);

    const foreignKey = await as(A.admin)
      .post('/v2/contacts/bulk/update')
      .send({ ids: mine, values: { customFields: { az_bsecret: 'leak' } } });
    expect(foreignKey.status, JSON.stringify(foreignKey.body)).toBe(422);
    expect(foreignKey.body.code).toBe('CON_PROPERTY_NOT_EDITABLE');
    expect(await hashes('contacts', [...mine, ...theirs])).toEqual(before);

    const ok = await as(A.admin)
      .post('/v2/contacts/bulk/update')
      .send({ ids: [mine[0], theirs[0]], values: { customFields: { az_city: 'Pune' } } });
    expect(ok.status, JSON.stringify(ok.body)).toBeLessThan(300);
    expect(ok.body.succeeded).toEqual([mine[0]]);
    expect(failedIds(ok.body)).toEqual([theirs[0]]);
    const row = await h.owner.query(`SELECT data FROM contacts WHERE uuid = $1`, [theirs[0]]);
    expect(JSON.stringify(row.rows[0].data)).not.toContain('Pune');
    expect(await hashes('contacts', theirs)).toEqual([before[2]]);
  });

  it('AUTHZ-014 a member with no bulk grants is 403 on every contact bulk route and nothing changes; an anonymous caller is 401', async () => {
    const none = await api.member(A, 'bk-none', []);
    const mine = await seed(A, 'NG-', 2);
    const before = await hashes('contacts', mine);
    for (const [path, body] of [
      ['/v2/contacts/bulk/delete', { ids: mine }],
      ['/v2/contacts/bulk/update', { ids: mine, values: { status: 'x' } }],
      ['/v2/contacts/bulk/tag', { ids: mine, name: 'x', action: 'add' }],
      ['/v2/contacts/bulk/group', { ids: mine, groupId: randomUUID(), action: 'add' }],
      ['/v2/contacts/assignee', { ids: mine, ownerId: null }],
    ] as const) {
      expect((await as(none.token).post(path).send(body)).status, path).toBe(403);
      expect((await anon().post(path).send(body)).status, path).toBe(401);
    }
    expect(await hashes('contacts', mine)).toEqual(before);
  });

  it('AUTHZ-014 an empty / oversized / malformed id list is a 4xx validation error, never an "everything" selection', async () => {
    const mine = await seed(A, 'VAL-', 2);
    for (const body of [
      { ids: [] },
      { ids: ['not-a-uuid'] },
      { ids: mine, filter: {} },
      {},
      { filter: { groupId: 'x' } },
    ]) {
      const res = await as(A.admin).post('/v2/contacts/bulk/delete').send(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    expect(await exists('contacts', mine[0]!)).toBe(true);
  });

  it('AUTHZ-014 tasks bulk complete / reopen / delete with own + colleague + foreign + nonexistent ids: only the caller scope is applied; foreign tasks untouched', async () => {
    const worker: Grant[] = [
      ['record.tasks.read', 'own'],
      ['record.tasks.create'],
      ['record.tasks.update', 'own'],
      ['record.tasks.delete', 'own'],
    ];
    const t1 = await api.member(A, 'tk-own', worker);
    const t2 = await api.member(A, 'tk-col', worker);
    const mkTask = async (token: string, title: string) => {
      const r = await as(token).post('/v2/tasks').send({ title });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.id as string;
    };
    const mine = [await mkTask(t1.token, 'TK-own-1'), await mkTask(t1.token, 'TK-own-2')];
    const colleague = [await mkTask(t2.token, 'TK-col-1'), await mkTask(t2.token, 'TK-col-2')];
    const theirs = [await mkTask(B.admin, 'TK-B-1'), await mkTask(B.admin, 'TK-B-2')];
    const ghost = randomUUID();
    const snapshot = async (token: string, ids: string[]) =>
      Promise.all(
        ids.map(async (id) => {
          const r = await as(token).get(`/v2/tasks/${id}`);
          return `${r.status}:${r.body.status}:${r.body.rowVersion}`;
        }),
      );
    const theirsBefore = await snapshot(B.admin, theirs);
    const colBefore = await snapshot(t2.token, colleague);

    // own-scope worker: its own tasks complete, the colleague's and the foreign ones are reported
    const done = await as(t1.token)
      .post('/v2/tasks/bulk/complete')
      .send({ ids: [mine[0], colleague[0], theirs[0], ghost, mine[1]] });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.succeeded.sort()).toEqual([...mine].sort());
    expect(failedIds(done.body)).toEqual([colleague[0], theirs[0], ghost].sort());
    expect(await snapshot(B.admin, theirs)).toEqual(theirsBefore);
    expect((await snapshot(t2.token, colleague))[0]).toBe(colBefore[0]);

    // workspace admin ("all"): foreign + nonexistent are reported identically, own workspace applied
    const all = await as(A.admin)
      .post('/v2/tasks/bulk/reopen')
      .send({ ids: [...mine, ...theirs, ghost] });
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body.succeeded.sort()).toEqual([...mine].sort());
    expect(failedIds(all.body)).toEqual([...theirs, ghost].sort());
    const f = all.body.failed.find((x: { id: string }) => x.id === theirs[0]);
    const g = all.body.failed.find((x: { id: string }) => x.id === ghost);
    const plain = (x: { code: string; message: string }, id: string) => ({
      code: x.code,
      message: x.message.replace(id, '<id>'),
    });
    expect(plain(f, theirs[0]!)).toEqual(plain(g, ghost));
    expect(await snapshot(B.admin, theirs)).toEqual(theirsBefore);

    // bulk delete: foreign tasks survive
    const del = await as(A.admin)
      .post('/v2/tasks/bulk/delete')
      .send({ ids: [mine[0], theirs[0], theirs[1], colleague[1]] });
    expect(del.body.succeeded.sort()).toEqual([mine[0], colleague[1]].sort());
    expect(failedIds(del.body)).toEqual([...theirs].sort());
    expect(await snapshot(B.admin, theirs)).toEqual(theirsBefore);
    expect((await as(A.admin).get(`/v2/tasks/${mine[0]}`)).status).toBe(404);

    // a tenant B bulk call naming A's ids changes nothing in A
    const aBefore = await snapshot(A.admin, [mine[1]!, colleague[0]!]);
    const cross = await as(B.admin)
      .post('/v2/tasks/bulk/delete')
      .send({ ids: [mine[1], colleague[0]] });
    expect(cross.body.succeeded).toEqual([]);
    expect(await snapshot(A.admin, [mine[1]!, colleague[0]!])).toEqual(aBefore);

    // assigning to a person of another workspace fails the whole call and applies nothing
    const bUser = await userUuid(B.adminUserId);
    const before = await snapshot(A.admin, [mine[1]!, colleague[0]!]);
    const bad = await as(A.admin)
      .post('/v2/tasks/bulk/assign')
      .send({ ids: [mine[1], colleague[0]], assigneeId: bUser });
    expect(bad.status, JSON.stringify(bad.body)).toBe(422);
    expect(bad.body.code).toBe('TASK_ASSIGNEE_INVALID');
    expect(await snapshot(A.admin, [mine[1]!, colleague[0]!])).toEqual(before);
    // positive: assigning to a colleague works for the rows in scope
    const colUuid = await userUuid(t2.userId);
    const okAssign = await as(A.admin)
      .post('/v2/tasks/bulk/assign')
      .send({ ids: [mine[1], theirs[0]], assigneeId: colUuid });
    expect(okAssign.body.succeeded).toEqual([mine[1]]);
    expect(failedIds(okAssign.body)).toEqual([theirs[0]]);
    expect(await snapshot(B.admin, theirs)).toEqual(theirsBefore);
  }, 120_000);

  it('AUTHZ-014 companies bulk/delete and contact linking: foreign / colleague ids are reported and untouched; a foreign contact is never linked', async () => {
    const co: Grant[] = [
      ['record.companies.read', 'own'],
      ['record.companies.create'],
      ['record.companies.update', 'own'],
      ['record.companies.delete', 'own'],
      ['record.contacts.read', 'own'],
      ['record.contacts.update', 'own'],
    ];
    const c1 = await api.member(A, 'co-own', co);
    const c2 = await api.member(A, 'co-col', co);
    const mk = async (token: string, name: string) => {
      const r = await as(token).post('/v2/companies').send({ name });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.id as string;
    };
    const mine = [await mk(c1.token, 'CO-own-1'), await mk(c1.token, 'CO-own-2')];
    const colleague = [await mk(c2.token, 'CO-col-1')];
    const theirs = [await mk(B.admin, 'CO-B-1'), await mk(B.admin, 'CO-B-2')];
    const seeCompany = async (token: string, id: string) => {
      const r = await as(token).get(`/v2/companies/${id}`);
      return `${r.status}:${r.body.rowVersion}`;
    };
    const theirsBefore = await Promise.all(theirs.map((id) => seeCompany(B.admin, id)));

    const res = await as(c1.token)
      .post('/v2/companies/bulk/delete')
      .send({ ids: [mine[0], colleague[0], theirs[0], randomUUID()] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.succeeded).toEqual([mine[0]]);
    expect(failedIds(res.body)).toHaveLength(3);
    expect((await as(c2.token).get(`/v2/companies/${colleague[0]}`)).status).toBe(200);
    expect(await Promise.all(theirs.map((id) => seeCompany(B.admin, id)))).toEqual(theirsBefore);

    const aAll = await as(A.admin)
      .post('/v2/companies/bulk/delete')
      .send({ ids: [theirs[1], colleague[0]] });
    expect(aAll.body.succeeded).toEqual([colleague[0]]);
    expect(failedIds(aAll.body)).toEqual([theirs[1]]);
    expect(await Promise.all(theirs.map((id) => seeCompany(B.admin, id)))).toEqual(theirsBefore);

    // linking contacts: a contact of another workspace is a failure, not a link
    const bContact = (await seed(B, 'CO-LINK-B-', 1))[0]!;
    const aContact = (await seed(A, 'CO-LINK-A-', 1, { ownerId: c1.userId }))[0]!;
    const link = await as(c1.token)
      .post(`/v2/companies/${mine[1]}/contacts`)
      .send({ contactIds: [aContact, bContact] });
    expect(link.status, JSON.stringify(link.body)).toBeLessThan(300);
    expect(link.body.succeeded).toEqual([aContact]);
    expect(failedIds(link.body)).toEqual([bContact]);
    const linked = await h.owner.query(`SELECT company_id FROM contacts WHERE uuid = $1`, [
      bContact,
    ]);
    expect(linked.rows[0].company_id).toBeNull();
    // a company of another workspace cannot be the link target
    const intoForeign = await as(c1.token)
      .post(`/v2/companies/${theirs[0]}/contacts`)
      .send({ contactIds: [aContact] });
    expect(intoForeign.status).toBe(404);
  }, 120_000);

  it('AUTHZ-014 campaigns bulk-delete: foreign and nonexistent campaigns are skipped and survive; no delete grant is 403', async () => {
    const mkCampaign = async (t: Tenant, name: string) =>
      (
        await h.owner.query(
          `INSERT INTO wpcampaigns (org_id, campaign_name, campaign_type, status, schedule_type, timezone, total_recipients)
           VALUES ($1,$2,'text','draft','now','UTC',0) RETURNING uuid`,
          [t.orgId, name],
        )
      ).rows[0].uuid as string;
    const mine = [await mkCampaign(A, 'AZ-camp-a1'), await mkCampaign(A, 'AZ-camp-a2')];
    const theirs = await mkCampaign(B, 'AZ-camp-b1');
    const before = await rowHash('wpcampaigns', theirs);
    const del = (token: string, ids: string[]) =>
      as(token)
        .post('/v2/campaigns/bulk-delete')
        .set('idempotency-key', randomUUID())
        .send({ ids });
    const nogrant = await api.member(A, 'camp-none', []);
    expect((await del(nogrant.token, mine)).status).toBe(403);
    expect(await exists('wpcampaigns', mine[0]!)).toBe(true);

    const res = await del(A.admin, [mine[0]!, theirs, randomUUID(), mine[1]!]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect([...res.body.ids].sort()).toEqual([...mine].sort());
    expect(await rowHash('wpcampaigns', theirs)).toBe(before);
    for (const u of mine) expect(await exists('wpcampaigns', u)).toBe(false);
  });

  it("AUTHZ-014 contacts/dedupe (mass merge) is workspace-bound: the same number in two workspaces is not a duplicate, and another workspace's duplicates are untouched", async () => {
    const shared = '+919955500001';
    await api.seedContacts(A, [
      { name: 'DD-A-keep', phone: shared, createdAt: '2026-01-01T00:00:00Z' },
      { name: 'DD-A-dup', phone: '+919955500002', createdAt: '2026-01-01T00:00:00Z' },
      { name: 'DD-A-dup2', phone: '+919955500002', createdAt: '2026-02-01T00:00:00Z' },
    ]);
    await api.seedContacts(B, [
      { name: 'DD-B-one', phone: shared, createdAt: '2026-01-01T00:00:00Z' },
      { name: 'DD-B-dup', phone: '+919955500003', createdAt: '2026-01-01T00:00:00Z' },
      { name: 'DD-B-dup2', phone: '+919955500003', createdAt: '2026-02-01T00:00:00Z' },
    ]);
    const none = await api.member(A, 'dd-none', [['record.contacts.read']]);
    expect((await as(none.token).post('/v2/contacts/dedupe').send({})).status).toBe(403);
    expect((await as(none.token).get('/v2/contacts/duplicates')).status).toBe(403);

    const preview = await as(A.admin).get('/v2/contacts/duplicates');
    expect(preview.status).toBe(200);
    expect(JSON.stringify(preview.body)).not.toContain('DD-B-');
    const res = await as(A.admin).post('/v2/contacts/dedupe').send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ mergedSets: 1, removed: 1 });
    expect(await countOf('contacts', B.orgId, `name LIKE 'DD-B-%'`)).toBe(3);
    expect(await countOf('contacts', A.orgId, `name LIKE 'DD-A-%'`)).toBe(2);
  });
});

// ==== 2. export (AUTHZ-050, 071) =================================================================================================

const EXPORT_HEADER = [
  'name',
  'first_name',
  'last_name',
  'phone',
  'country_code',
  'email',
  'groups',
  'tags',
  'language',
  'title',
  'address',
  'memo',
  'status',
  'source',
  'unsubscribed',
  'created_at',
];

describe('AUTHZ-050 / AUTHZ-071 exports need the export grant, respect record scope and never carry another workspace', () => {
  let A: Tenant;
  let B: Tenant;
  let ownExp: Member;
  let col: Member;
  let readOnly: Member;
  let none: Member;
  let aOwnNames: string[];
  let aColNames: string[];
  let aOwn: string[];
  let aCol: string[];
  let bNames: string[];
  let bUuids: string[];
  let formulaUuids: string[];

  beforeAll(async () => {
    A = await api.signup('ex-a');
    B = await api.signup('ex-b');
    ownExp = await api.member(A, 'ex-own', [
      ['record.contacts.export', 'own'],
      ['record.segments.read'],
      ['record.contacts.read', 'own'],
    ]);
    col = await api.member(A, 'ex-col', [['record.contacts.export', 'own']]);
    readOnly = await api.member(A, 'ex-ro', [['record.contacts.read']]);
    none = await api.member(A, 'ex-none', []);

    const aSection = (
      await as(A.admin).post('/v2/field-sections').send({ moduleKey: 'contacts', name: 'EX attrs' })
    ).body.id;
    const bSection = (
      await as(B.admin).post('/v2/field-sections').send({ moduleKey: 'contacts', name: 'EX attrs' })
    ).body.id;
    for (const [t, section, key] of [
      [A, aSection, 'ex_city'],
      [B, bSection, 'ex_bsecret'],
    ] as const) {
      const r = await as(t.admin)
        .post('/v2/fields')
        .send({ moduleKey: 'contacts', sectionId: section, key, label: key, fieldType: 'text' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }

    aOwn = await seed(A, 'EX-own-', 4, {
      ownerId: ownExp.userId,
      source: 'ex-seg',
      data: { ex_city: 'Pune' },
    });
    aCol = await seed(A, 'EX-col-', 3, { ownerId: col.userId, source: 'ex-seg' });
    bUuids = await seed(B, 'EX-B-', 3, {
      source: 'ex-seg',
      data: { ex_bsecret: 'B-SECRET-VALUE' },
    });
    aOwnNames = [0, 1, 2, 3].map((i) => `EX-own-${i}`);
    aColNames = [0, 1, 2].map((i) => `EX-col-${i}`);
    bNames = [0, 1, 2].map((i) => `EX-B-${i}`);
    formulaUuids = await api.seedContacts(A, [
      { name: '=1+1 EX-F', phone: phone(), source: 'ex-f' },
      { name: '+cmd EX-F', phone: phone(), source: 'ex-f' },
      { name: '-2+3 EX-F', phone: phone(), source: 'ex-f' },
      { name: '@SUM(A1) EX-F', phone: phone(), source: 'ex-f' },
    ]);
  });

  const exportCsv = (token: string, body: object) =>
    as(token).post('/v2/contacts/export').send(body);

  it('AUTHZ-050 contacts export: anonymous 401; no grant and read-only members 403 (and no export audit row is written)', async () => {
    const before = await countOf('audit_log', A.orgId, `module = 'contacts' AND action = 'export'`);
    expect((await anon().post('/v2/contacts/export').send({ filter: {} })).status).toBe(401);
    for (const m of [none, readOnly]) {
      const res = await exportCsv(m.token, { filter: {} });
      expect(res.status).toBe(403);
      expect(res.text).not.toContain('EX-own-');
    }
    expect(await countOf('audit_log', A.orgId, `module = 'contacts' AND action = 'export'`)).toBe(
      before,
    );
    for (const path of ['/v2/contacts/exports']) {
      expect((await as(none.token).get(path)).status).toBe(403);
      expect((await as(readOnly.token).get(path)).status).toBe(403);
    }
  });

  it('AUTHZ-050 an "all"-scope export holds every row of its own workspace and none of another; the header is the fixed column list with only its own attributes', async () => {
    const res = await exportCsv(A.admin, { filter: {} });
    expect(res.status, res.text.slice(0, 200)).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    const { header, rows } = records(res.text);
    expect(header).toEqual([...EXPORT_HEADER, 'attr:ex_city']);
    const names = rows.map((r) => r.name);
    for (const n of [...aOwnNames, ...aColNames]) expect(names).toContain(n);
    for (const n of bNames) expect(names).not.toContain(n);
    for (const needle of ['EX-B-', 'B-SECRET-VALUE', 'ex_bsecret', ...bUuids, B.slug])
      expect(res.text, needle).not.toContain(needle);
    // no secret / hash / tenant / owner columns, and no internal numeric ids as a column
    expect(header.join(',')).not.toMatch(
      /org|password|hash|secret|token|owner|created_by|deleted|uuid|\bid\b/i,
    );
    // A's attribute value is exported for A
    expect(rows.find((r) => r.name === 'EX-own-0')!['attr:ex_city']).toBe('Pune');
  });

  it("AUTHZ-050 the other workspace's export contains only its rows, its own attribute and none of A's", async () => {
    const res = await exportCsv(B.admin, { filter: {} });
    expect(res.status).toBe(200);
    const { header, rows } = records(res.text);
    expect(header).toEqual([...EXPORT_HEADER, 'attr:ex_bsecret']);
    expect(rows.map((r) => r.name).sort()).toEqual([...bNames].sort());
    for (const needle of ['EX-own-', 'EX-col-', 'ex_city', 'Pune', A.slug])
      expect(res.text, needle).not.toContain(needle);
  });

  it("AUTHZ-050 an own-scope export (filter or ids) contains only the caller's own records; colleague and foreign ids in the list are dropped", async () => {
    const byFilter = await exportCsv(ownExp.token, { filter: {} });
    expect(byFilter.status).toBe(200);
    const names = records(byFilter.text)
      .rows.map((r) => r.name)
      .sort();
    expect(names).toEqual([...aOwnNames].sort());
    const byIds = await exportCsv(ownExp.token, {
      ids: [aOwn[0], aCol[0], bUuids[0], randomUUID()],
    });
    expect(byIds.status).toBe(200);
    expect(records(byIds.text).rows.map((r) => r.name)).toEqual(['EX-own-0']);
    for (const needle of ['EX-col-', 'EX-B-']) {
      expect(byFilter.text).not.toContain(needle);
      expect(byIds.text).not.toContain(needle);
    }
    // a filter on the colleague's ownership does not widen the scope
    const colUuid = await userUuid(col.userId);
    const widened = await exportCsv(ownExp.token, { filter: { ownerId: colUuid } });
    expect(records(widened.text).rows).toEqual([]);
    // positive control: the colleague exports its own rows
    const mine = await exportCsv(col.token, { filter: {} });
    expect(
      records(mine.text)
        .rows.map((r) => r.name)
        .sort(),
    ).toEqual([...aColNames].sort());
  });

  it('AUTHZ-050 ids that only exist in another workspace export a header and no rows', async () => {
    const res = await exportCsv(A.admin, { ids: bUuids });
    expect(res.status).toBe(200);
    expect(records(res.text).rows).toEqual([]);
    expect(res.text).not.toContain('EX-B-');
    const filtered = await exportCsv(A.admin, { filter: { q: 'EX-B-' } });
    expect(records(filtered.text).rows).toEqual([]);
  });

  it('AUTHZ-071 CSV formula injection: cells starting with = + - @ are neutralised with a leading apostrophe', async () => {
    const res = await exportCsv(A.admin, { filter: { source: 'ex-f' } });
    expect(res.status).toBe(200);
    const names = records(res.text).rows.map((r) => r.name);
    expect(names.sort()).toEqual(
      ["'+cmd EX-F", "'-2+3 EX-F", "'=1+1 EX-F", "'@SUM(A1) EX-F"].sort(),
    );
    for (const n of names) expect(n).not.toMatch(/^[=+\-@]/);
    // the same neutralisation on a text cell other than the name
    await h.owner.query(
      `UPDATE contacts SET title = '=HYPERLINK("http://evil")', address = '@x' WHERE uuid = $1`,
      [formulaUuids[0]],
    );
    const again = await exportCsv(A.admin, { filter: { source: 'ex-f' } });
    const row = records(again.text).rows.find((r) => r.name.includes('1+1'))!;
    expect(row.title).toBe(`'=HYPERLINK("http://evil")`);
    expect(row.address).toBe("'@x");
  });

  it("AUTHZ-050 export history lists the caller's workspace only, and an export writes its audit row in its own workspace", async () => {
    const aBefore = await countOf(
      'audit_log',
      A.orgId,
      `module = 'contacts' AND action = 'export'`,
    );
    const bBefore = await countOf(
      'audit_log',
      B.orgId,
      `module = 'contacts' AND action = 'export'`,
    );
    await exportCsv(A.admin, { filter: { q: 'EX-own-' } });
    expect(await countOf('audit_log', A.orgId, `module = 'contacts' AND action = 'export'`)).toBe(
      aBefore + 1,
    );
    expect(await countOf('audit_log', B.orgId, `module = 'contacts' AND action = 'export'`)).toBe(
      bBefore,
    );
    const aHist = await as(A.admin).get('/v2/contacts/exports');
    expect(aHist.status).toBe(200);
    expect(aHist.body.data.length).toBeGreaterThan(0);
    const bHist = await as(B.admin).get('/v2/contacts/exports');
    expect(bHist.status).toBe(200);
    expect(bHist.body.data.length).toBe(bBefore);
    expect(JSON.stringify(bHist.body)).not.toContain('Admin Person ex');
  });

  it('AUTHZ-050 segment export: needs the export grant, an own-scope member gets its own members only, and another workspace cannot export it', async () => {
    const seg = await as(A.admin)
      .post('/v2/segments')
      .send({
        name: 'EX seg',
        visibility: 'shared',
        rules: {
          type: 'group',
          combinator: 'and',
          children: [{ type: 'condition', field: 'source', operator: 'equals', value: 'ex-seg' }],
        },
      });
    expect(seg.status, JSON.stringify(seg.body)).toBe(201);
    const id = seg.body.id as string;
    const exp = (token: string, segmentId = id) =>
      as(token).post(`/v2/segments/${segmentId}/export`).send({});

    const all = await exp(A.admin);
    expect(all.status, all.text.slice(0, 200)).toBe(200);
    expect(
      records(all.text)
        .rows.map((r) => r.name)
        .sort(),
    ).toEqual([...aOwnNames, ...aColNames].sort());
    expect(all.text).not.toContain('EX-B-');

    const own = await exp(ownExp.token);
    expect(own.status, own.text.slice(0, 200)).toBe(200);
    expect(
      records(own.text)
        .rows.map((r) => r.name)
        .sort(),
    ).toEqual([...aOwnNames].sort());

    expect((await exp(none.token)).status).toBe(403);
    expect((await exp(readOnly.token)).status).toBe(403);
    expect((await anon().post(`/v2/segments/${id}/export`).send({})).status).toBe(401);
    const foreign = await exp(B.admin);
    expect(foreign.status).toBe(404);
    expect(foreign.text).not.toContain('EX-own-');
    expect((await exp(B.admin, randomUUID())).status).toBe(404);
    // the same segment rules evaluated in B (a segment of its own) see only B's rows
    const bSeg = await as(B.admin)
      .post('/v2/segments')
      .send({
        name: 'EX seg',
        rules: {
          type: 'group',
          combinator: 'and',
          children: [{ type: 'condition', field: 'source', operator: 'equals', value: 'ex-seg' }],
        },
      });
    expect(bSeg.status, JSON.stringify(bSeg.body)).toBe(201);
    const bOut = await exp(B.admin, bSeg.body.id);
    expect(
      records(bOut.text)
        .rows.map((r) => r.name)
        .sort(),
    ).toEqual([...bNames].sort());
  });

  it('AUTHZ-050 workspace data export (Settings): only the workspace owner can download; each export holds its own workspace rows only; an unknown type is 422', async () => {
    for (const type of ['contacts', 'conversations', 'messages']) {
      expect((await as(none.token).get(`/v2/shell/workspace/export/${type}`)).status, type).toBe(
        403,
      );
      expect(
        (await as(readOnly.token).get(`/v2/shell/workspace/export/${type}`)).status,
        type,
      ).toBe(403);
      expect((await anon().get(`/v2/shell/workspace/export/${type}`)).status, type).toBe(401);
    }
    const a = await as(A.admin).get('/v2/shell/workspace/export/contacts');
    expect(a.status, a.text.slice(0, 200)).toBe(200);
    expect(a.headers['content-disposition']).toContain('contacts.csv');
    expect(a.text).toContain('EX-own-0');
    expect(a.text).not.toContain('EX-B-');
    const b = await as(B.admin).get('/v2/shell/workspace/export/contacts');
    expect(b.status).toBe(200);
    expect(b.text).toContain('EX-B-0');
    expect(b.text).not.toContain('EX-own-');
    expect(a.text.split('\n')[0]).not.toMatch(/org|password|hash|secret|token/i);
    expect((await as(A.admin).get('/v2/shell/workspace/export/users')).status).toBe(422);
    expect(
      (await as(A.admin).get('/v2/shell/workspace/export/..%2f..%2fcontacts')).status,
    ).toBeGreaterThanOrEqual(400);
    // the counts on the cards are the caller's workspace only
    const counts = await as(B.admin).get('/v2/shell/workspace/export');
    expect(counts.body.contacts).toBe(3);
    expect(
      Number((await as(A.admin).get('/v2/shell/workspace/export')).body.contacts),
    ).toBeGreaterThan(7);
    // the export is audited in the exporting workspace only
    expect(
      await countOf('auth_audit_log', A.orgId, `event = 'workspace.data_exported'`).catch(() => -1),
    ).not.toBe(0);
  });

  it('AUTHZ-050 campaign and broadcast exports: the grant is required, and another workspace gets 404 for the id', async () => {
    const campaign = async (t: Tenant, label: string) => {
      const camp = (
        await h.owner.query(
          `INSERT INTO wpcampaigns (org_id, campaign_name, campaign_type, status, schedule_type, timezone, total_recipients)
           VALUES ($1,$2,'text','completed','now','UTC',1) RETURNING id, uuid`,
          [t.orgId, label],
        )
      ).rows[0];
      const [contact] = await api.seedContacts(t, [{ name: `${label}-person`, phone: phone() }]);
      const cid = (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [contact]))
        .rows[0].id;
      await h.owner.query(
        `INSERT INTO wp_campaign_contacts (org_id, campaign_id, contact_id, status) VALUES ($1,$2,$3,'queued')`,
        [t.orgId, camp.id, cid],
      );
      return camp.uuid as string;
    };
    const broadcast = async (t: Tenant, label: string) => {
      const b = (
        await h.owner.query(
          `INSERT INTO broadcasts (org_id, name, status, total_recipients) VALUES ($1,$2,'completed',1) RETURNING id, uuid`,
          [t.orgId, label],
        )
      ).rows[0];
      const [contact] = await api.seedContacts(t, [{ name: `${label}-person`, phone: phone() }]);
      const cid = (await h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [contact]))
        .rows[0].id;
      await h.owner.query(
        `INSERT INTO broadcast_contacts (org_id, broadcast_id, contact_id, status) VALUES ($1,$2,$3,'sent')`,
        [t.orgId, b.id, cid],
      );
      return b.uuid as string;
    };
    const aCamp = await campaign(A, 'AZEXC-A');
    const bCamp = await campaign(B, 'AZEXC-B');
    const aBc = await broadcast(A, 'AZEXB-A');
    const bBc = await broadcast(B, 'AZEXB-B');

    for (const [path, mine, theirs, key, label] of [
      ['campaigns', aCamp, bCamp, 'camp.campaigns.export', 'AZEXC'],
      ['broadcasts', aBc, bBc, 'bcast.broadcasts.export', 'AZEXB'],
    ] as const) {
      const exporter = await api.member(A, `ex-${path}`, [[key]]);
      const noGrant = await api.member(A, `exn-${path}`, []);
      expect((await as(noGrant.token).get(`/v2/${path}/${mine}/export`)).status, path).toBe(403);
      expect((await anon().get(`/v2/${path}/${mine}/export`)).status, path).toBe(401);
      const ok = await as(exporter.token).get(`/v2/${path}/${mine}/export`);
      expect(ok.status, `${path} ${ok.text.slice(0, 120)}`).toBe(200);
      expect(ok.text).toContain(`${label}-A-person`);
      expect(ok.text).not.toContain(`${label}-B-person`);
      // B's id through A's grant, and A's id through B's admin: the same 404 as an unknown id
      const cross = await as(exporter.token).get(`/v2/${path}/${theirs}/export`);
      const unknown = await as(exporter.token).get(`/v2/${path}/${randomUUID()}/export`);
      expect(cross.status, `${path} A->B`).toBe(404);
      expect(cross.status).toBe(unknown.status);
      expect(cross.text).not.toContain(`${label}-B-person`);
      const back = await as(B.admin).get(`/v2/${path}/${mine}/export`);
      expect(back.status, `${path} B->A`).toBe(404);
      expect(back.text).not.toContain(`${label}-A-person`);
    }
  });

  it("AUTHZ-050 another workspace's admin cannot read A's export audit or contacts through the export routes with A's ids", async () => {
    const res = await as(B.admin)
      .post('/v2/contacts/export')
      .send({ ids: [...aOwn, ...aCol] });
    expect(res.status).toBe(200);
    expect(records(res.text).rows).toEqual([]);
    expect(res.text).not.toContain('EX-');
  });
});

// ==== 3. import (AUTHZ-048, 050) ================================================================================================

describe('AUTHZ-048 / AUTHZ-050 import needs the import grant, writes only into the caller workspace and keeps its tenant in the background job', () => {
  let I: Tenant;
  let J: Tenant;
  let importer: Member;
  let jUuids: string[];
  let jGroup: string;
  let jTag: string;

  const upload = (
    token: string | null,
    csv: string,
    options?: Record<string, unknown>,
    path = '/v2/contacts/import',
  ) => {
    let req = (token ? as(token) : anon()).post(path);
    req = req.attach('file', Buffer.from(csv), 'people.csv');
    if (options) req = req.field('options', JSON.stringify(options));
    return req;
  };
  const runJob = (t: Tenant, userId: number, jobInternalId: number) =>
    RequestContextStore.run(
      { requestId: 'authz-worker', orgId: t.orgId, actorType: 'user', actorId: userId, userId },
      () => h.app.get(ContactImportEngine, { strict: false }).run(t.orgId, userId, jobInternalId),
    );

  beforeAll(async () => {
    I = await api.signup('im-i');
    J = await api.signup('im-j');
    importer = await api.member(I, 'im-user', [
      ['record.contacts.import'],
      ['record.contacts.create'],
    ]);
    jUuids = await api.seedContacts(J, [
      { name: 'J-Original', phone: '+919933000001', email: 'j-original@example.test' },
      { name: 'J-Other', phone: '+919933000002', email: 'j-other@example.test' },
    ]);
    jGroup = (await as(J.admin).post('/v2/contact-groups').send({ name: 'J-GROUP' })).body.id;
    jTag = (await as(J.admin).post('/v2/tags').send({ name: 'J-TAG' })).body.id;
  });

  it('AUTHZ-050 import, preview, sample, job list / detail / rejects: anonymous 401, members without the import grant 403, and nothing is created', async () => {
    const readOnly = await api.member(I, 'im-ro', [
      ['record.contacts.read'],
      ['record.contacts.create'],
    ]);
    const before = await countOf('contacts', I.orgId);
    const csv = 'name,mobile\nNo Grant,+919900100001\n';
    for (const m of [readOnly]) {
      expect((await upload(m.token, csv)).status).toBe(403);
      expect((await upload(m.token, csv, undefined, '/v2/contacts/import/preview')).status).toBe(
        403,
      );
      expect((await as(m.token).get('/v2/contacts/import/sample')).status).toBe(403);
      expect((await as(m.token).get('/v2/contacts/import/jobs')).status).toBe(403);
      expect((await as(m.token).get(`/v2/contacts/import/jobs/${randomUUID()}`)).status).toBe(403);
      expect(
        (await as(m.token).get(`/v2/contacts/import/jobs/${randomUUID()}/rejects`)).status,
      ).toBe(403);
    }
    expect((await upload(null, csv)).status).toBe(401);
    expect((await anon().get('/v2/contacts/import/jobs')).status).toBe(401);
    expect(await countOf('contacts', I.orgId)).toBe(before);
    // the import grant alone is not enough (the importer also needs the create grant)
    const importOnly = await api.member(I, 'im-only', [['record.contacts.import']]);
    expect((await upload(importOnly.token, csv)).status).toBe(403);
    expect(await countOf('contacts', I.orgId)).toBe(before);
    // positive control: import + create
    const ok = await upload(importer.token, csv);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ status: 'completed', created: 1 });
  });

  it('AUTHZ-048 columns named org_id / owner / created_by / uuid / id in the file are not mapped: rows land in the importer workspace, owned by the importer, with server-made ids', async () => {
    const jAdminUuid = await userUuid(J.adminUserId);
    const header =
      'name,mobile,org_id,organization_id,owner_id,owner,created_by,user_id,uuid,id,import_job_id,company_id,deleted_at';
    const csv =
      `${header}\n` +
      [0, 1]
        .map(
          (i) =>
            `Col-Inj-${i},+91990020000${i},${J.orgId},${J.orgId},${J.adminUserId},${jAdminUuid},${J.adminUserId},${J.adminUserId},${jUuids[0]},${J.orgId},1,1,2020-01-01`,
        )
        .join('\n') +
      '\n';
    const jBefore = await countOf('contacts', J.orgId);
    const jHashes = await hashes('contacts', jUuids);

    const preview = await upload(importer.token, csv, undefined, '/v2/contacts/import/preview');
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(Object.keys(preview.body.detected ?? {})).toEqual(expect.arrayContaining(['name']));
    for (const k of [
      'org_id',
      'organization_id',
      'owner_id',
      'owner',
      'created_by',
      'user_id',
      'uuid',
      'id',
      'company_id',
      'deleted_at',
    ])
      expect(Object.keys(preview.body.mapping ?? {}), `mapped ${k}`).not.toContain(k);

    const res = await upload(importer.token, csv);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'completed', created: 2 });
    const rows = (
      await h.owner.query(`SELECT * FROM contacts WHERE name LIKE 'Col-Inj-%' ORDER BY name`)
    ).rows;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(Number(r.org_id)).toBe(I.orgId);
      expect(Number(r.owner_id)).toBe(importer.userId);
      expect(r.uuid).not.toBe(jUuids[0]);
      expect(r.deleted_at ?? null).toBeNull();
      expect(r.company_id ?? null).toBeNull();
      if ('created_by' in r)
        expect(r.created_by === null || Number(r.created_by) === importer.userId).toBe(true);
    }
    expect(await countOf('contacts', J.orgId)).toBe(jBefore);
    expect(await hashes('contacts', jUuids)).toEqual(jHashes);
  });

  it("AUTHZ-050 matching on phone or email never updates another workspace's contact: the import creates its own row and the other row is byte-identical", async () => {
    const before = await hashes('contacts', jUuids);
    const jCount = await countOf('contacts', J.orgId);
    const csv =
      'name,mobile,email\n' +
      'I-Import-Same-Phone,+919933000001,i-same@example.test\n' +
      'I-Import-Same-Email,+919933000077,j-other@example.test\n';
    const res = await upload(I.admin, csv);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'completed', created: 2, updated: 0 });
    expect(await hashes('contacts', jUuids)).toEqual(before);
    expect(await countOf('contacts', J.orgId)).toBe(jCount);
    expect(
      await countOf(
        'contacts',
        I.orgId,
        `name = 'I-Import-Same-Phone' AND phone = '+919933000001'`,
      ),
    ).toBe(1);
    // and re-importing the same file in the importer's own workspace does update ITS row (positive control for matching)
    const again = await upload(I.admin, 'name,mobile\nI-Import-Renamed,+919933000001\n');
    expect(again.body).toMatchObject({ status: 'completed', updated: 1, created: 0 });
    expect(await hashes('contacts', jUuids)).toEqual(before);
  });

  it("AUTHZ-050 import knobs that name another workspace's group or tag are refused and link nothing", async () => {
    const jMembers = await countOf('contact_group_members', J.orgId);
    const jTags = await countOf('contact_tags', J.orgId);
    const iBefore = await countOf('contacts', I.orgId);
    const csv = 'name,mobile\nKnob-1,+919900300001\nKnob-2,+919900300002\n';
    const badGroup = await upload(I.admin, csv, { groupId: jGroup });
    expect(badGroup.status, JSON.stringify(badGroup.body)).toBeGreaterThanOrEqual(400);
    expect(badGroup.status).toBeLessThan(500);
    const badTag = await upload(I.admin, csv, { tagIds: [jTag] });
    expect(badTag.status, JSON.stringify(badTag.body)).toBeGreaterThanOrEqual(400);
    expect(badTag.status).toBeLessThan(500);
    expect(await countOf('contact_group_members', J.orgId)).toBe(jMembers);
    expect(await countOf('contact_tags', J.orgId)).toBe(jTags);
    expect(await countOf('contacts', I.orgId, `name LIKE 'Knob-%'`)).toBe(0);
    expect(await countOf('contacts', I.orgId)).toBe(iBefore);
    // group names in the file create the importer's own groups, never join J's group of the same name
    const named = await upload(I.admin, 'name,mobile,group\nKnob-3,+919900300003,J-GROUP\n');
    expect(named.status, JSON.stringify(named.body)).toBe(200);
    expect(await countOf('contact_group_members', J.orgId)).toBe(jMembers);
    expect(await countOf('contact_groups', I.orgId, `name = 'J-GROUP'`)).toBe(1);
  });

  it('AUTHZ-048 custom-property columns in the file do not write properties (only mapped core fields are imported); no key of another workspace is created', async () => {
    const csv =
      'name,mobile,ex_city,attr:ex_bsecret,data,customFields\nProp-1,+919900400001,Pune,leak,{"a":1},x\n';
    const res = await upload(I.admin, csv);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = (await h.owner.query(`SELECT data FROM contacts WHERE name = 'Prop-1'`)).rows[0];
    expect(JSON.stringify(row.data ?? {})).not.toMatch(/Pune|leak|"a"/);
  });

  it('AUTHZ-050 a large import runs as a background job that keeps its workspace: other workspaces cannot see it, run it or receive its rows', async () => {
    const csv =
      'name,mobile\n' +
      Array.from({ length: 1005 }, (_, i) => `Job-I-${i},+9198${String(10_000_000 + i)}`).join(
        '\n',
      ) +
      '\n' +
      ',+919800000001\n';
    const res = await upload(importer.token, csv);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const jobUuid = res.body.id as string;
    const internal = Number(
      (await h.owner.query(`SELECT id FROM contact_import_jobs WHERE uuid = $1`, [jobUuid])).rows[0]
        .id,
    );
    const jobRow = (
      await h.owner.query(`SELECT org_id, status FROM contact_import_jobs WHERE id = $1`, [
        internal,
      ])
    ).rows[0];
    expect(Number(jobRow.org_id)).toBe(I.orgId);

    // other workspace: not visible, not downloadable, not listed
    const jCount = await countOf('contacts', J.orgId);
    expect((await as(J.admin).get(`/v2/contacts/import/jobs/${jobUuid}`)).status).toBe(404);
    expect((await as(J.admin).get(`/v2/contacts/import/jobs/${jobUuid}/rejects`)).status).toBe(404);
    const jList = await as(J.admin).get('/v2/contacts/import/jobs');
    expect(jList.status).toBe(200);
    expect(JSON.stringify(jList.body)).not.toContain(jobUuid);
    // a worker started with the OTHER workspace's context and this job's internal id does nothing
    await runJob(J, J.adminUserId, internal);
    expect(await countOf('contacts', J.orgId)).toBe(jCount);
    expect(
      (await h.owner.query(`SELECT status FROM contact_import_jobs WHERE id = $1`, [internal]))
        .rows[0].status,
    ).toBe('queued');
    expect(await countOf('contacts', I.orgId, `name LIKE 'Job-I-%'`)).toBe(0);

    // the right worker completes it, every row in the importing workspace, owned by the importer
    await runJob(I, importer.userId, internal);
    const done = await as(importer.token).get(`/v2/contacts/import/jobs/${jobUuid}`);
    expect(done.body).toMatchObject({ status: 'completed', created: 1005, invalid: 1 });
    expect(
      await countOf('contacts', I.orgId, `name LIKE 'Job-I-%' AND owner_id = ${importer.userId}`),
    ).toBe(1005);
    expect(await countOf('contacts', J.orgId)).toBe(jCount);
    const leaked = await h.owner.query(
      `SELECT count(*)::int AS n FROM contacts WHERE name LIKE 'Job-I-%' AND org_id <> $1`,
      [I.orgId],
    );
    expect(leaked.rows[0].n).toBe(0);
    // the rejects file (a download) is the importer workspace's only
    expect(
      (await as(importer.token).get(`/v2/contacts/import/jobs/${jobUuid}/rejects`)).text,
    ).toContain('missing_name');
    expect((await as(J.admin).get(`/v2/contacts/import/jobs/${jobUuid}/rejects`)).status).toBe(404);
  }, 180_000);
});

// ==== 4. downloads and signed links (AUTHZ-064, 074) ============================================================================

const PNG_A = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('AZ-A-SECRET-BYTES-0123456789'),
]);
const PNG_A2 = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('AZ-A-SECOND-FILE-BYTES-9876'),
]);
const PNG_B = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('AZ-B-SECRET-BYTES-abcdefgh'),
]);

describe('AUTHZ-064 / AUTHZ-074 media links are bound to the person and workspace they were minted for', () => {
  let A: Tenant;
  let B: Tenant;
  let colleague: Member;
  let keyA: string;
  let keyA2: string;
  let keyB: string;
  let store: ChatMediaStore;
  let tokens: MediaTokenService;

  const get = (path: string, token?: string) =>
    (token ? as(token).get(path) : anon().get(path)).buffer(true).parse(rawBytes);
  const sign = (o: { key: string; orgId: number; userId: number }, ttl?: number, now?: number) =>
    tokens.sign({ ...o, name: 'file.png', mime: 'image/png' }, ttl, now);

  beforeAll(async () => {
    A = await api.signup('md-a');
    B = await api.signup('md-b');
    colleague = await api.member(A, 'md-col', []);
    store = h.app.get(ChatMediaStore);
    tokens = h.app.get(MediaTokenService);
    keyA = (await store.store({ orgId: A.orgId, filename: 'a.png', buffer: PNG_A })).key;
    keyA2 = (await store.store({ orgId: A.orgId, filename: 'a2.png', buffer: PNG_A2 })).key;
    keyB = (await store.store({ orgId: B.orgId, filename: 'b.png', buffer: PNG_B })).key;
  });

  it('AUTHZ-064 positive: the person the link was minted for, in that workspace, gets exactly that object', async () => {
    const t1 = sign({ key: keyA, orgId: A.orgId, userId: A.adminUserId });
    const t2 = sign({ key: keyA2, orgId: A.orgId, userId: A.adminUserId });
    const r1 = await get(`/v2/media/${t1}`, A.admin);
    expect(r1.status).toBe(200);
    expect(Buffer.compare(r1.body as Buffer, PNG_A)).toBe(0);
    expect(r1.headers['x-content-type-options']).toBe('nosniff');
    const r2 = await get(`/v2/media/${t2}`, A.admin);
    expect(Buffer.compare(r2.body as Buffer, PNG_A2)).toBe(0);
  });

  it("AUTHZ-064 a link minted for tenant A / user X is useless to tenant B, to A's other user and to an anonymous caller", async () => {
    const tok = sign({ key: keyA, orgId: A.orgId, userId: A.adminUserId });
    const asB = await get(`/v2/media/${tok}`, B.admin);
    expect(asB.status).toBe(404);
    expect(Buffer.from(asB.body as Buffer).toString('latin1')).not.toContain('AZ-A-SECRET');
    const asColleague = await get(`/v2/media/${tok}`, colleague.token);
    expect(asColleague.status).toBe(404);
    expect(Buffer.from(asColleague.body as Buffer).toString('latin1')).not.toContain('AZ-A-SECRET');
    expect((await get(`/v2/media/${tok}`)).status).toBe(401);
  });

  it('AUTHZ-074 expired, tampered, truncated, extended and garbage tokens are rejected with the same 404', async () => {
    const good = sign({ key: keyA, orgId: A.orgId, userId: A.adminUserId });
    const flip = (s: string, at: number) =>
      s.slice(0, at) + (s[at] === 'A' ? 'B' : 'A') + s.slice(at + 1);
    const expired = sign(
      { key: keyA, orgId: A.orgId, userId: A.adminUserId },
      30,
      Date.now() - 120_000,
    );
    const cases: Record<string, string> = {
      expired,
      'last byte flipped': flip(good, good.length - 2),
      'middle byte flipped': flip(good, Math.floor(good.length / 2)),
      'first byte flipped': flip(good, 3),
      truncated: good.slice(0, good.length - 8),
      extended: `${good}AAAA`,
      garbage: 'x'.repeat(80),
      'plain object key': Buffer.from(
        JSON.stringify({ k: keyA, o: A.orgId, u: A.adminUserId, x: 9_999_999_999 }),
      ).toString('base64url'),
      'the object key itself': keyA.replace(/\//g, '_'),
    };
    for (const [label, tok] of Object.entries(cases)) {
      const res = await get(`/v2/media/${tok}`, A.admin);
      expect(res.status, label).toBe(404);
      expect(Buffer.from(res.body as Buffer).toString('latin1'), label).not.toContain(
        'AZ-A-SECRET',
      );
    }
    expect((await get(`/v2/media/${good}`, A.admin)).status).toBe(200);
  });

  it('AUTHZ-064 a validly signed link cannot point into another workspace or out of the storage root (cross-tenant key, org swap, path traversal)', async () => {
    const bName = keyB.split('/').pop()!;
    const attempts: Record<
      string,
      { key: string; orgId: number; userId: number; as: string; leak: string }
    > = {
      'A key in a link for B': {
        key: keyA,
        orgId: B.orgId,
        userId: B.adminUserId,
        as: B.admin,
        leak: 'AZ-A-SECRET',
      },
      'B key in a link for A': {
        key: keyB,
        orgId: A.orgId,
        userId: A.adminUserId,
        as: A.admin,
        leak: 'AZ-B-SECRET',
      },
      'traversal into B from A': {
        key: `chat/${A.orgId}/../${B.orgId}/${keyB.split('/').slice(2).join('/')}`,
        orgId: A.orgId,
        userId: A.adminUserId,
        as: A.admin,
        leak: 'AZ-B-SECRET',
      },
      'traversal with dot-dot-slash': {
        key: `chat/${A.orgId}/../../${bName}`,
        orgId: A.orgId,
        userId: A.adminUserId,
        as: A.admin,
        leak: 'AZ-',
      },
      'backslash traversal': {
        key: `chat/${A.orgId}\\..\\..\\x`,
        orgId: A.orgId,
        userId: A.adminUserId,
        as: A.admin,
        leak: 'AZ-',
      },
      'absolute path': {
        key: '/etc/passwd',
        orgId: A.orgId,
        userId: A.adminUserId,
        as: A.admin,
        leak: 'root:',
      },
      'encoded traversal': {
        key: `chat/${A.orgId}/%2e%2e/${B.orgId}/x`,
        orgId: A.orgId,
        userId: A.adminUserId,
        as: A.admin,
        leak: 'AZ-',
      },
      'NUL byte': {
        key: `${keyA}\u0000.png`,
        orgId: A.orgId,
        userId: A.adminUserId,
        as: A.admin,
        leak: 'AZ-A-SECRET',
      },
    };
    for (const [label, a] of Object.entries(attempts)) {
      const res = await get(`/v2/media/${sign(a)}`, a.as);
      expect(res.status, label).toBe(404);
      expect(Buffer.from(res.body as Buffer).toString('latin1'), label).not.toContain(a.leak);
    }
  });

  it('AUTHZ-064 deleting is not reachable through the media door: no verb but GET opens it, and the stored objects are intact afterwards', async () => {
    const tok = sign({ key: keyA, orgId: A.orgId, userId: A.adminUserId });
    for (const m of ['delete', 'put', 'patch', 'post'] as const) {
      const res = await as(B.admin)[m](`/v2/media/${tok}`);
      expect([404, 405], m).toContain(res.status);
    }
    expect(await store.open(A.orgId, keyA)).not.toBeNull();
    expect(await store.open(A.orgId, keyA2)).not.toBeNull();
    expect(await store.open(B.orgId, keyB)).not.toBeNull();
    // a workspace cannot even open another workspace's key through the store
    expect(await store.open(B.orgId, keyA)).toBeNull();
    expect(await store.open(A.orgId, keyB)).toBeNull();
  });
});

describe('AUTHZ-064 attachments: contact files, team-chat files, invoice PDFs and flow media', () => {
  let A: Tenant;
  let B: Tenant;
  let aOwn: Member;
  let col: Member;
  let aContact: string;
  let colContact: string;
  let fileA: string;

  const add = (token: string, contact: string, body: object = {}) =>
    as(token)
      .post(`/v2/contacts/${contact}/files`)
      .set('idempotency-key', randomUUID())
      .send({ fileName: 'quote.pdf', storageKey: `files/${randomUUID()}.pdf`, ...body });

  beforeAll(async () => {
    A = await api.signup('fl-a');
    B = await api.signup('fl-b');
    aOwn = await api.member(A, 'fl-own', [
      ['record.contacts.read', 'own'],
      ['record.contacts.update', 'own'],
    ]);
    col = await api.member(A, 'fl-col', [
      ['record.contacts.read', 'own'],
      ['record.contacts.update', 'own'],
    ]);
    [aContact] = await seed(A, 'FL-A-', 1, { ownerId: aOwn.userId });
    [colContact] = await seed(A, 'FL-COL-', 1, { ownerId: col.userId });
    const created = await add(A.admin, aContact!, { fileName: 'a-secret.pdf' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    fileA = created.body.id;
  });

  it("AUTHZ-064 contact files: another workspace can neither list, add to nor delete a contact's files; the file row survives", async () => {
    const filesIn = async () => countOf('contact_files', A.orgId);
    const before = await filesIn();
    expect((await as(B.admin).get(`/v2/contacts/${aContact}/files`)).status).toBe(404);
    expect((await add(B.admin, aContact!)).status).toBe(404);
    expect((await as(B.admin).delete(`/v2/contacts/${aContact}/files/${fileA}`)).status).toBe(404);
    const bContact = (await seed(B, 'FL-B-', 1))[0]!;
    // the file id under B's own contact path is still A's file
    expect((await as(B.admin).delete(`/v2/contacts/${bContact}/files/${fileA}`)).status).toBe(404);
    expect(await filesIn()).toBe(before);
    const still = await as(A.admin).get(`/v2/contacts/${aContact}/files`);
    expect(still.status).toBe(200);
    expect(JSON.stringify(still.body)).toContain('a-secret.pdf');
    // B's list of its own contact holds nothing of A
    const bList = await as(B.admin).get(`/v2/contacts/${bContact}/files`);
    expect(JSON.stringify(bList.body)).not.toContain('a-secret');
  });

  it("AUTHZ-064 contact files: an own-scope member cannot add to or delete a colleague's contact files; it can on its own", async () => {
    const colFile = await add(col.token, colContact!, { fileName: 'col-private.pdf' });
    expect(colFile.status, JSON.stringify(colFile.body)).toBe(201);
    const before = await countOf('contact_files', A.orgId);
    for (const res of [
      await as(aOwn.token).get(`/v2/contacts/${colContact}/files`),
      await add(aOwn.token, colContact!),
      await as(aOwn.token).delete(`/v2/contacts/${colContact}/files/${colFile.body.id}`),
    ]) {
      expect([403, 404]).toContain(res.status);
      expect(res.text).not.toContain('col-private');
    }
    expect(await countOf('contact_files', A.orgId)).toBe(before);
    const mine = await add(aOwn.token, aContact!, { fileName: 'own.pdf' });
    expect(mine.status).toBe(201);
    expect(
      (await as(aOwn.token).delete(`/v2/contacts/${aContact}/files/${mine.body.id}`)).status,
    ).toBe(204);
  });

  it("AUTHZ-064 contact files: file names and storage keys cannot carry path traversal or another workspace's storage key", async () => {
    const before = await countOf('contact_files', A.orgId);
    const bad: Array<[string, object]> = [
      ['traversal in storageKey', { storageKey: '../../../../etc/passwd' }],
      ['traversal in fileName', { fileName: '../../../evil.sh' }],
      ['backslash traversal in fileName', { fileName: '..\\..\\evil.exe' }],
      ['absolute storage key', { storageKey: '/etc/passwd' }],
      ['another workspace storage key', { storageKey: `chat/${B.orgId}/2026/10/1_abcdef.png` }],
    ];
    const accepted: string[] = [];
    for (const [label, body] of bad) {
      const res = await add(A.admin, aContact!, body);
      if (res.status < 400) accepted.push(`${label} -> ${res.status}`);
    }
    expect(accepted, 'unsafe file references accepted by the files endpoint').toEqual([]);
    expect(await countOf('contact_files', A.orgId)).toBe(before);
  });

  it('AUTHZ-064 team-chat attachments: another workspace gets 404, a file name with path parts is stored as a plain name, deleting the message by another workspace fails', async () => {
    const general = (await as(A.admin).get('/v2/team-chat/channels')).body.data.find(
      (c: { slug: string }) => c.slug === 'general',
    );
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(32, 7),
    ]);
    const msg = await as(A.admin)
      .post(`/v2/team-chat/channels/${general.id}/messages`)
      .attach('attachment', png, '../../evil.png');
    expect(msg.status, JSON.stringify(msg.body)).toBe(201);
    expect(msg.body.attachment.name).not.toMatch(/[\\/]|\.\./);
    const dl = await as(A.admin).get(`/v2/team-chat/messages/${msg.body.id}/attachment`);
    expect(dl.status).toBe(200);
    expect(await countOf('team_chat_messages', A.orgId, `attachment_path IS NOT NULL`)).toBe(1);

    expect((await as(B.admin).get(`/v2/team-chat/messages/${msg.body.id}/attachment`)).status).toBe(
      404,
    );
    expect((await anon().get(`/v2/team-chat/messages/${msg.body.id}/attachment`)).status).toBe(401);
    const del = await as(B.admin).delete(`/v2/team-chat/messages/${msg.body.id}`);
    expect([403, 404]).toContain(del.status);
    expect(await countOf('team_chat_messages', A.orgId, `attachment_path IS NOT NULL`)).toBe(1);
    expect((await as(A.admin).get(`/v2/team-chat/messages/${msg.body.id}/attachment`)).status).toBe(
      200,
    );
  });

  it('AUTHZ-064 invoice PDFs: the staff download needs the grant and the invoice id of another workspace is 404; the public link opens exactly its own invoice and dies on revoke, expiry or tampering', async () => {
    const make = async (t: Tenant, buyer: string) => {
      const m = await as(t.admin)
        .post('/v2/invoices')
        .send({
          buyerName: buyer,
          lines: [{ description: 'Consulting', qty: '2', unitPrice: '50.00' }],
        });
      expect(m.status, JSON.stringify(m.body)).toBe(201);
      const i = await as(t.admin).post(`/v2/invoices/${m.body.id}/issue`).send({});
      expect(i.status, JSON.stringify(i.body)).toBe(200);
      return i.body as { id: string; publicLink: { token: string } };
    };
    const a = await make(A, 'AZ Buyer Alpha');
    const a2 = await make(A, 'AZ Buyer Alpha Two');
    const b = await make(B, 'AZ Buyer Bravo');

    const pdf = (path: string, token?: string) =>
      (token ? as(token).get(path) : anon().get(path)).buffer(true).parse(rawBytes);
    const text = (res: { body: unknown }) => Buffer.from(res.body as Buffer).toString('latin1');

    const staff = await pdf(`/v2/invoices/${a.id}/pdf`, A.admin);
    expect(staff.status).toBe(200);
    expect(text(staff)).toContain('AZ Buyer Alpha');
    const nogrant = await api.member(A, 'inv-none', []);
    expect((await pdf(`/v2/invoices/${a.id}/pdf`, nogrant.token)).status).toBe(403);
    expect((await pdf(`/v2/invoices/${a.id}/pdf`)).status).toBe(401);
    const cross = await pdf(`/v2/invoices/${a.id}/pdf`, B.admin);
    expect(cross.status).toBe(404);
    expect(text(cross)).not.toContain('AZ Buyer Alpha');

    // public link: capability for ONE invoice
    const open = await pdf(`/v2/public/invoices/${a.publicLink.token}/pdf`);
    expect(open.status).toBe(200);
    expect(text(open)).toContain('AZ Buyer Alpha');
    expect(text(open)).not.toContain('AZ Buyer Alpha Two');
    const other = await pdf(`/v2/public/invoices/${a2.publicLink.token}/pdf`);
    expect(text(other)).toContain('AZ Buyer Alpha Two');
    const tok = a.publicLink.token;
    const flipped = tok.slice(0, -1) + (tok.endsWith('A') ? 'B' : 'A');
    for (const bad of [
      flipped,
      tok.slice(0, -3),
      `${tok}x`,
      `${tok}/../${b.publicLink.token}`,
      'x'.repeat(40),
    ]) {
      const res = await pdf(`/v2/public/invoices/${encodeURIComponent(bad)}/pdf`);
      expect([400, 404, 410], bad).toContain(res.status);
      expect(text(res)).not.toContain('AZ Buyer');
    }
    // an authenticated caller of another workspace holds no extra right: B's token opens only B's invoice
    const bOpen = await pdf(`/v2/public/invoices/${b.publicLink.token}/pdf`, A.admin);
    expect(text(bOpen)).toContain('AZ Buyer Bravo');
    // revoked and expired links die
    const revoke = await as(A.admin).post(`/v2/invoices/${a.id}/public-link/revoke`).send({});
    expect(revoke.status).toBe(200);
    expect([404, 410]).toContain((await pdf(`/v2/public/invoices/${tok}/pdf`)).status);
    expect(
      (await as(B.admin).post(`/v2/invoices/${a2.id}/public-link/revoke`).send({})).status,
    ).toBe(404);
    expect((await pdf(`/v2/public/invoices/${a2.publicLink.token}/pdf`)).status).toBe(200);
    await h.owner.query(
      `UPDATE invoices SET token_expires_at = now() - interval '1 minute' WHERE uuid = $1`,
      [a2.id],
    );
    expect([404, 410]).toContain(
      (await pdf(`/v2/public/invoices/${a2.publicLink.token}/pdf`)).status,
    );
    expect((await pdf(`/v2/public/invoices/${b.publicLink.token}/pdf`)).status).toBe(200);
  }, 120_000);

  it('AUTHZ-064 public flow media: traversal, other-workspace and malformed paths are never served (404/400, never 200, never 500)', async () => {
    const paths = [
      `/v2/flow-media/${randomUUID()}/${randomUUID()}.png`,
      `/v2/flow-media/..%2f..%2fetc/passwd`,
      `/v2/flow-media/${randomUUID()}/..%2f..%2f..%2fetc%2fpasswd`,
      `/v2/flow-media/${randomUUID()}/%2e%2e%2f%2e%2e%2fpackage.json`,
      `/v2/flow-media/%2e%2e/%2e%2e`,
      `/v2/flow-media/${randomUUID()}/x%00.png`,
    ];
    for (const p of paths) {
      const res = await anon().get(p);
      expect([400, 404], p).toContain(res.status);
    }
  });
});

// ==== 5. reports, analytics, dashboards (AUTHZ-065) ==============================================================================

describe('AUTHZ-065 aggregates for one workspace do not move when another inserts data, and breakdowns never list its labels', () => {
  let C: Tenant;
  let D: Tenant;
  let dRep: Member;
  let dOwn: Member;

  const URLS = [
    '/v2/contacts/stats',
    '/v2/companies/stats',
    '/v2/dashboard/summary',
    '/v2/dashboard/widgets',
    '/v2/dashboard/throughput',
    '/v2/analytics/overview',
    '/v2/analytics/panels',
    '/v2/analytics/export',
    '/v2/deals/reports',
    '/v2/deals/board',
    '/v2/tasks/counts',
    '/v2/tasks/my',
    '/v2/segments',
    '/v2/tags',
    '/v2/contact-groups',
    '/v2/contacts?includeTotal=true&limit=5',
    '/v2/deals?limit=5',
    '/v2/inbox/counts',
    '/v2/workspace/members/summary',
    '/v2/shell/overview-stats',
  ];

  const snap = async (token: string) => {
    const out: Record<string, { status: number; text: string }> = {};
    for (const u of URLS) {
      const r = await as(token).get(u);
      out[u] = { status: r.status, text: r.text };
    }
    return out;
  };
  /** Leaf paths at which two JSON documents differ. */
  function leafDiff(a: unknown, b: unknown, path = ''): string[] {
    if (JSON.stringify(a) === JSON.stringify(b)) return [];
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
      return [...keys].flatMap((k) =>
        leafDiff(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
          `${path}.${k}`,
        ),
      );
    }
    return [path];
  }
  const parse = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  };

  async function conversation(t: Tenant): Promise<number> {
    const channel = await h.owner.query(
      `INSERT INTO channels (org_id, kind, name) VALUES ($1, 'simulator', 'sim') RETURNING id`,
      [t.orgId],
    );
    const r = await h.owner.query(
      `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1, $2, $3, 'chat') RETURNING id`,
      [t.orgId, channel.rows[0].id, `peer-${randomUUID()}`],
    );
    return Number(r.rows[0].id);
  }
  async function messages(t: Tenant, n: number) {
    const conv = await conversation(t);
    await h.owner.query(
      `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, status, kind, created_at)
       SELECT $1, $2, g, CASE WHEN g % 3 = 0 THEN 'in' ELSE 'out' END, CASE WHEN g % 3 = 0 THEN 'customer' ELSE 'agent' END,
              CASE WHEN g % 3 = 0 THEN 'received' ELSE 'delivered' END, 'text', now() - (g || ' minutes')::interval FROM generate_series(1, $3) g`,
      [t.orgId, conv, n],
    );
  }
  async function populate(
    t: Tenant,
    label: string,
    creator: Member,
    n: { contacts: number; deals: number; tasks: number; msgs: number },
  ) {
    await h.owner.query(
      `INSERT INTO contacts (org_id, name, phone, source)
       SELECT $1, $2 || g, '+9188' || (10000000 + g + $4), $2 FROM generate_series(1, $3) g`,
      [t.orgId, `${label}-bulk-`, n.contacts, label === 'ZZA' ? 5_000_000 : 0],
    );
    await as(t.admin)
      .post('/v2/tags')
      .send({ name: `${label}-TAG` });
    await as(t.admin)
      .post('/v2/contact-groups')
      .send({ name: `${label}-GROUP` });
    await as(t.admin)
      .post('/v2/companies')
      .send({ name: `${label}-COMPANY` });
    for (let i = 0; i < n.deals; i += 1) {
      const d = await as(creator.token)
        .post('/v2/deals')
        .send({ title: `${label}-deal-${i}`, value: String(100 + i) });
      expect(d.status, JSON.stringify(d.body)).toBe(201);
      if (i % 3 === 0)
        expect((await as(creator.token).post(`/v2/deals/${d.body.id}/won`).send({})).status).toBe(
          200,
        );
      if (i % 3 === 1)
        expect(
          (
            await as(creator.token)
              .post(`/v2/deals/${d.body.id}/lost`)
              .send({ reason: `${label} lost reason` })
          ).status,
        ).toBe(200);
    }
    for (let i = 0; i < n.tasks; i += 1)
      expect(
        (
          await as(creator.token)
            .post('/v2/tasks')
            .send({ title: `${label}-task-${i}` })
        ).status,
      ).toBe(201);
    await messages(t, n.msgs);
  }

  beforeAll(async () => {
    C = await api.signup('rp-c');
    D = await api.signup('rp-d');
    const full: Grant[] = [
      ['record.deals.read'],
      ['record.deals.create'],
      ['record.deals.update'],
      ['record.tasks.create'],
      ['record.tasks.read'],
      ['dash.analytics.read'],
      ['dash.dashboard.read'],
      ['record.deals.report'],
    ];
    dRep = await api.member(D, 'ZZDPerson', full);
    dOwn = await api.member(D, 'ZZDOwnPerson', [
      ['record.deals.read', 'own'],
      ['record.deals.create'],
      ['record.deals.update', 'own'],
      ['record.deals.report', 'own'],
      ['record.contacts.read', 'own'],
    ]);
    const cRep = await api.member(C, 'ZZCPerson', full);
    await populate(D, 'ZZD', dRep, { contacts: 20, deals: 9, tasks: 4, msgs: 30 });
    await populate(C, 'ZZC', cRep, { contacts: 15, deals: 6, tasks: 3, msgs: 25 });
    // D-owned deals for the own-scope report
    for (let i = 0; i < 2; i += 1) {
      const d = await as(dOwn.token)
        .post('/v2/deals')
        .send({ title: `ZZD-own-${i}`, value: '700' });
      expect(d.status, JSON.stringify(d.body)).toBe(201);
      if (i === 0)
        expect((await as(dOwn.token).post(`/v2/deals/${d.body.id}/won`).send({})).status).toBe(200);
    }
  }, 240_000);

  it('AUTHZ-065 every report, count, series and tile of workspace D is identical before and after workspace C inserts hundreds of rows', async () => {
    const first = await snap(D.admin);
    const second = await snap(D.admin);
    const volatile = new Set<string>();
    for (const u of URLS) {
      if (first[u]!.text !== second[u]!.text)
        for (const p of leafDiff(parse(first[u]!.text), parse(second[u]!.text)))
          volatile.add(`${u}${p}`);
    }
    // anything the endpoint answered with an error would prove nothing: the plan must expose all of them
    const unavailable = URLS.filter((u) => first[u]!.status >= 400).map(
      (u) => `${u} -> ${first[u]!.status}`,
    );

    // workspace C now adds a lot of everything
    const more = await api.member(C, 'ZZCMore', [
      ['record.deals.create'],
      ['record.deals.update'],
      ['record.tasks.create'],
    ]);
    await populate(C, 'ZZC2', more, { contacts: 400, deals: 12, tasks: 10, msgs: 250 });
    await as(C.admin)
      .post('/v2/segments')
      .send({
        name: 'ZZC2 segment',
        rules: {
          type: 'group',
          combinator: 'and',
          children: [{ type: 'condition', field: 'source', operator: 'equals', value: 'ZZC2' }],
        },
      });

    const after = await snap(D.admin);
    const moved: string[] = [];
    for (const u of URLS) {
      if (first[u]!.status !== after[u]!.status)
        moved.push(`${u} status ${first[u]!.status} -> ${after[u]!.status}`);
      for (const p of leafDiff(parse(first[u]!.text), parse(after[u]!.text)))
        if (!volatile.has(`${u}${p}`)) moved.push(`${u}${p}`);
      expect(after[u]!.text, u).not.toMatch(/ZZC/);
    }
    expect(moved, 'values of workspace D that changed when workspace C inserted data').toEqual([]);
    expect(
      unavailable,
      'reports that were not available to the admin of D (nothing was proven for them)',
    ).toEqual([]);
    // positive control: C's own numbers do move
    const c = await as(C.admin).get('/v2/contacts/stats');
    expect(c.body.total).toBeGreaterThanOrEqual(415);
    const d = await as(D.admin).get('/v2/contacts/stats');
    expect(d.body.total).toBe(20);
  }, 240_000);

  it("AUTHZ-065 breakdown dimensions (owners, lost reasons, team performance, tags, groups, stages) never list another workspace's labels or people", async () => {
    const urls = [
      '/v2/deals/reports',
      '/v2/analytics/panels',
      '/v2/analytics/overview',
      '/v2/dashboard/widgets',
      '/v2/tags',
      '/v2/contact-groups',
      '/v2/deals/board',
    ];
    for (const u of urls) {
      const asC = await as(C.admin).get(u);
      const asD = await as(D.admin).get(u);
      expect(asC.text, `C ${u}`).not.toMatch(/ZZD/);
      expect(asD.text, `D ${u}`).not.toMatch(/ZZC/);
    }
    // positive: each sees its own labels where the report lists them
    const dReport = await as(D.admin).get('/v2/deals/reports');
    expect(dReport.status).toBe(200);
    expect(dReport.text).toContain('ZZDPerson');
    expect(dReport.text).toContain('ZZD lost reason');
    const cReport = await as(C.admin).get('/v2/deals/reports');
    expect(cReport.text).toContain('ZZCPerson');
    expect(cReport.text).toContain('ZZC lost reason');
  });

  it("AUTHZ-065 reports need their grant, and an own-scope report counts only the caller's deals", async () => {
    const none = await api.member(D, 'rp-none', []);
    const readOnly = await api.member(D, 'rp-ro', [['record.deals.read']]);
    for (const u of [
      '/v2/deals/reports',
      '/v2/analytics/overview',
      '/v2/analytics/panels',
      '/v2/analytics/export',
      '/v2/dashboard/summary',
      '/v2/dashboard/widgets',
    ]) {
      expect((await as(none.token).get(u)).status, `none ${u}`).toBe(403);
      expect((await anon().get(u)).status, `anon ${u}`).toBe(401);
    }
    expect((await as(readOnly.token).get('/v2/deals/reports')).status).toBe(403);
    expect((await as(readOnly.token).get('/v2/analytics/overview')).status).toBe(403);

    const all = await as(D.admin).get('/v2/deals/reports');
    const own = await as(dOwn.token).get('/v2/deals/reports');
    expect(own.status, own.text.slice(0, 200)).toBe(200);
    expect(own.text).not.toContain('ZZDPerson');
    expect(own.text).not.toContain('ZZD lost reason');
    expect(own.text).toContain('ZZDOwnPerson');
    expect(own.text).not.toBe(all.text);
  });

  it("AUTHZ-065 the analytics CSV export holds the caller workspace's window only, and the date window parameters cannot reach another workspace", async () => {
    const c = await as(C.admin).get('/v2/analytics/export?range=30d');
    const d = await as(D.admin).get('/v2/analytics/export?range=30d');
    expect(c.status).toBe(200);
    expect(d.status).toBe(200);
    expect(c.headers['content-disposition']).toMatch(/^attachment;/);
    expect(c.text).not.toBe(d.text);
    for (const q of [
      '?orgId=1',
      `?org_id=${D.orgId}`,
      `?workspace=${D.slug}`,
      '?range=all&orgId=0',
    ]) {
      const r = await as(C.admin).get(`/v2/analytics/overview${q}`);
      const base = await as(C.admin).get('/v2/analytics/overview');
      expect(r.status, q).toBeLessThan(500);
      if (r.status === 200 && !q.includes('range=all'))
        expect(
          leafDiff(parse(r.text), parse(base.text)).filter(
            (p) => !/window|generated|\bat\b/i.test(p),
          ),
          q,
        ).toEqual([]);
    }
  });
});

// ==== 6. pagination, counts, search, expand (AUTHZ-090) ===========================================================================

describe('AUTHZ-090 cursors, limits, totals, search and expand never reveal another workspace', () => {
  let P: Tenant;
  let Q: Tenant;
  let own: Member;
  let pIds: Set<string>;
  let qIds: Set<string>;
  let pMaxInternalId = 0;

  const ids = (res: { body: { data?: Array<{ id: string }> } }) =>
    (res.body.data ?? []).map((r) => r.id);

  beforeAll(async () => {
    P = await api.signup('pg-p');
    Q = await api.signup('pg-q');
    own = await api.member(P, 'pg-own', [
      ['record.contacts.read', 'own'],
      ['record.tasks.read', 'own'],
      ['record.tasks.create'],
    ]);
    const pRows = await api.seedContacts(
      P,
      Array.from({ length: 130 }, (_, i) => ({
        name: `ZZP-${i}`,
        phone: `+9177${String(20_000_000 + i)}`,
        email: `zzp${i}@example.test`,
        ownerId: i % 5 === 0 ? own.userId : null,
      })),
    );
    const qRows = await api.seedContacts(Q, [
      { name: 'ZZQ-0', phone: '+917788000001', email: 'zzq0@example.test' },
      { name: 'ZZQ-1', phone: '+917788000002' },
      { name: 'ZZQ-2', phone: '+917788000003' },
    ]);
    pIds = new Set(pRows);
    qIds = new Set(qRows);
    pMaxInternalId = Number(
      (await h.owner.query(`SELECT max(id) AS m FROM contacts WHERE org_id = $1`, [P.orgId]))
        .rows[0].m,
    );
    // chips, owners and filters that only P has
    const g = (await as(P.admin).post('/v2/contact-groups').send({ name: 'ZZP-GROUP' })).body.id;
    const t = (await as(P.admin).post('/v2/tags').send({ name: 'ZZP-TAG' })).body.id;
    await as(P.admin)
      .post('/v2/contacts/bulk/group')
      .send({ ids: pRows.slice(-20), groupId: g, action: 'add' });
    await as(P.admin)
      .post('/v2/contacts/bulk/tag')
      .send({ ids: pRows.slice(-20), tagId: t, action: 'add' });
    const qg = (await as(Q.admin).post('/v2/contact-groups').send({ name: 'ZZQ-GROUP' })).body.id;
    await as(Q.admin)
      .post('/v2/contacts/bulk/group')
      .send({ ids: qRows, groupId: qg, action: 'add' });
    for (let i = 0; i < 5; i += 1) {
      await as(P.admin)
        .post('/v2/tasks')
        .send({ title: `ZZP-task-${i}` });
      await as(P.admin)
        .post('/v2/companies')
        .send({ name: `ZZP-company-${i}` });
      await as(P.admin)
        .post('/v2/deals')
        .send({ title: `ZZP-deal-${i}` });
    }
    await as(Q.admin).post('/v2/tasks').send({ title: 'ZZQ-task' });
  }, 240_000);

  it('AUTHZ-090 positive control: P pages through its 130 contacts with limit and cursor and sees only its own rows, no row twice', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const res = await as(P.admin).get(
        `/v2/contacts?limit=50${cursor ? `&cursor=${cursor}` : ''}`,
      );
      expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
      seen.push(...ids(res));
      cursor = res.body.page.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(130);
    expect(new Set(seen).size).toBe(130);
    for (const id of seen) expect(pIds.has(id)).toBe(true);
  });

  it("AUTHZ-090 a cursor taken from P's list, used by Q, returns only Q's rows and no error; forged cursors never reach P's rows", async () => {
    const page1 = await as(P.admin).get('/v2/contacts?limit=50');
    const cursor = page1.body.page.nextCursor as string;
    expect(cursor).toBeTruthy();
    const viaQ = await as(Q.admin).get(`/v2/contacts?limit=50&cursor=${cursor}`);
    expect(viaQ.status, viaQ.text.slice(0, 200)).toBe(200);
    for (const id of ids(viaQ)) {
      expect(pIds.has(id)).toBe(false);
      expect(qIds.has(id)).toBe(true);
    }
    expect(viaQ.text).not.toMatch(/ZZP/);

    const future = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const forged = [
      `${future}|${pMaxInternalId}`,
      `${future}|999999999`,
      `${new Date(0).toISOString()}|${pMaxInternalId}`,
      `${future}|0`,
      `${future}|-1`,
      `${future}|9007199254740991`,
      `${future}|${pMaxInternalId}|extra`,
    ].map((s) => Buffer.from(s).toString('base64url'));
    for (const c of forged) {
      const res = await as(Q.admin).get(`/v2/contacts?limit=200&cursor=${c}`);
      expect([200, 400, 422], Buffer.from(c, 'base64url').toString()).toContain(res.status);
      expect(res.text).not.toMatch(/ZZP/);
      for (const id of ids(res)) expect(pIds.has(id)).toBe(false);
    }
    for (const c of ['%%%', 'not-base64!', '', '#', 'AAAA']) {
      const res = await as(Q.admin).get(`/v2/contacts?cursor=${encodeURIComponent(c)}`);
      expect(res.status, c).toBeLessThan(500);
      expect(res.text).not.toMatch(/ZZP/);
    }
  });

  it('AUTHZ-090 limit is bounded: zero, negative, huge, non-numeric and repeated values are validation errors or capped, never an unbounded dump', async () => {
    for (const limit of [
      '0',
      '-1',
      '1001',
      '1000000',
      '1e9',
      'abc',
      '99999999999999999999',
      '1.5',
    ]) {
      const res = await as(P.admin).get(`/v2/contacts?limit=${limit}`);
      expect([400, 422], `limit=${limit} -> ${res.status}`).toContain(res.status);
    }
    const repeated = await as(P.admin).get('/v2/contacts?limit=5&limit=1000');
    if (repeated.status === 200) expect(repeated.body.data.length).toBeLessThanOrEqual(1000);
    else expect(repeated.status).toBeLessThan(500);
    const max = await as(P.admin).get('/v2/contacts?limit=1000');
    expect(max.status).toBe(200);
    expect(max.body.data).toHaveLength(130);
    for (const path of ['/v2/tasks', '/v2/companies', '/v2/deals', '/v2/tags']) {
      const res = await as(P.admin).get(`${path}?limit=100000`);
      expect([400, 422], path).toContain(res.status);
    }
  });

  it("AUTHZ-090 total counts are per workspace (and per record scope): includeTotal, stats and filters never count another workspace's rows", async () => {
    const pAll = await as(P.admin).get('/v2/contacts?includeTotal=true&limit=1');
    const qAll = await as(Q.admin).get('/v2/contacts?includeTotal=true&limit=1');
    expect(pAll.body.meta.total).toBe(130);
    expect(qAll.body.meta.total).toBe(3);
    const ownTotal = await as(own.token).get('/v2/contacts?includeTotal=true&limit=1');
    expect(ownTotal.body.meta.total).toBe(26);
    expect((await as(own.token).get('/v2/contacts/stats')).body.total).toBe(26);
    expect((await as(Q.admin).get('/v2/contacts/stats')).body.total).toBe(3);
    // a cursor of the admin's list does not enlarge the own-scope member's view
    const adminPage = await as(P.admin).get('/v2/contacts?limit=10');
    const viaOwn = await as(own.token).get(
      `/v2/contacts?limit=200&cursor=${adminPage.body.page.nextCursor}&includeTotal=true`,
    );
    expect(viaOwn.status).toBe(200);
    for (const r of viaOwn.body.data as Array<{ ownerId: string | null }>)
      expect(r.ownerId).toBeTruthy();
    expect(viaOwn.body.meta.total).toBe(26);
    // filters that name P-only things match nothing in Q, with a zero total
    const pGroup = (await as(P.admin).get('/v2/contact-groups')).body.data.find(
      (x: { name: string }) => x.name === 'ZZP-GROUP',
    ).id;
    const pTag = (await as(P.admin).get('/v2/tags')).body.data.find(
      (x: { name: string }) => x.name === 'ZZP-TAG',
    ).id;
    const pUser = await userUuid(P.adminUserId);
    for (const q of [
      `groupId=${pGroup}`,
      `tagIds=${pTag}`,
      `tagId=${pTag}`,
      `ownerId=${pUser}`,
      `segmentId=${randomUUID()}`,
      'q=ZZP',
      'q=zzp0%40example.test',
      'q=7720000',
    ]) {
      const res = await as(Q.admin).get(`/v2/contacts?includeTotal=true&${q}`);
      expect(res.status, q).toBeLessThan(500);
      if (res.status === 200) {
        expect(res.body.data, q).toEqual([]);
        expect(res.body.meta.total, q).toBe(0);
      }
    }
    // positive control for the same filters inside P
    expect(
      (await as(P.admin).get(`/v2/contacts?includeTotal=true&groupId=${pGroup}`)).body.meta.total,
    ).toBe(20);
    expect(
      (await as(P.admin).get('/v2/contacts?includeTotal=true&q=zzp0%40example.test')).body.meta
        .total,
    ).toBe(1);
  });

  it('AUTHZ-090 typeaheads and suggestions (select-data, assignees, tags, groups, companies) list the caller workspace only', async () => {
    const pSel = await as(P.admin).get('/v2/contacts/select-data?q=ZZP&limit=100');
    expect(pSel.status).toBe(200);
    expect(pSel.body.length ?? pSel.body.data?.length).toBeGreaterThan(0);
    const qSel = await as(Q.admin).get('/v2/contacts/select-data?q=ZZP&limit=100');
    expect(qSel.status).toBe(200);
    expect(qSel.text).not.toMatch(/ZZP/);
    expect((await as(Q.admin).get('/v2/contacts/select-data?q=ZZQ')).text).toContain('ZZQ-0');
    expect((await as(Q.admin).get('/v2/contacts/select-data?limit=101')).status).toBe(422);
    const ownSel = await as(own.token).get('/v2/contacts/select-data?limit=100');
    const colleagueLeak = (ownSel.body.length ?? ownSel.body.data?.length) as number;
    expect(colleagueLeak).toBeLessThanOrEqual(26);

    const assignees = await as(Q.admin).get('/v2/contacts/assignees');
    expect(assignees.status).toBe(200);
    expect(JSON.stringify(assignees.body)).not.toMatch(/pg-own|pg-p/);
    for (const path of [
      '/v2/tags',
      '/v2/contact-groups',
      '/v2/companies/select-data',
      '/v2/companies',
      '/v2/tasks',
      '/v2/deals',
      '/v2/segments',
    ]) {
      const res = await as(Q.admin).get(`${path}?q=ZZP`);
      expect(res.status, path).toBeLessThan(500);
      expect(res.text, path).not.toMatch(/ZZP/);
      const plain = await as(Q.admin).get(path);
      expect(plain.text, path).not.toMatch(/ZZP/);
    }
  });

  it("AUTHZ-090 expand / include parameters add the caller's chips only; unknown values and tenant override parameters change nothing", async () => {
    const q = await as(Q.admin).get('/v2/contacts?expand=groups,tags&limit=50');
    expect(q.status).toBe(200);
    expect(q.text).toContain('ZZQ-GROUP');
    expect(q.text).not.toMatch(/ZZP/);
    const p = await as(P.admin).get('/v2/contacts?expand=groups,tags&limit=50');
    expect(p.text).toContain('ZZP-GROUP');
    expect(p.text).not.toContain('ZZQ');
    const base = await as(Q.admin).get('/v2/contacts?limit=50');
    for (const extra of [
      'include=org,owner,all',
      'include=users',
      'expand=organization',
      'expand=groups,orgs',
      'populate=*',
      `orgId=${P.orgId}`,
      `org_id=${P.orgId}`,
      `workspace=${P.slug}`,
      `tenant=${P.slug}`,
      'fields=*',
      'select=password_hash',
    ]) {
      const res = await as(Q.admin).get(`/v2/contacts?limit=50&${extra}`);
      expect(res.status, extra).toBeLessThan(500);
      expect(res.text, extra).not.toMatch(/ZZP/);
      if (res.status === 200) expect(ids(res), extra).toEqual(ids(base));
    }
    const hdr = await as(Q.admin)
      .get('/v2/contacts?limit=50')
      .set('x-org-id', String(P.orgId))
      .set('x-tenant-id', String(P.orgId));
    expect(hdr.text).not.toMatch(/ZZP/);
    expect(ids(hdr)).toEqual(ids(base));
  });

  it("AUTHZ-090 cursor pagination of tasks, companies and deals: a cursor from P used by Q returns only Q's rows", async () => {
    for (const [path, qMarker] of [
      ['/v2/tasks', 'ZZQ-task'],
      ['/v2/companies', null],
      ['/v2/deals', null],
    ] as const) {
      const page = await as(P.admin).get(`${path}?limit=2`);
      expect(page.status, path).toBe(200);
      const cursor = page.body.page?.nextCursor as string | undefined;
      expect(cursor, `${path} has a next page`).toBeTruthy();
      const viaQ = await as(Q.admin).get(`${path}?limit=50&cursor=${cursor}`);
      expect(viaQ.status, `${path} ${viaQ.text.slice(0, 160)}`).toBe(200);
      expect(viaQ.text, path).not.toMatch(/ZZP/);
      if (qMarker) {
        const qOwn = await as(Q.admin).get(`${path}?limit=50`);
        expect(qOwn.text).toContain(qMarker);
      }
      const forged = Buffer.from(
        `${new Date(Date.now() + 86_400_000).toISOString()}|${pMaxInternalId}`,
      ).toString('base64url');
      const f = await as(Q.admin).get(`${path}?limit=50&cursor=${forged}`);
      expect([200, 400, 422], path).toContain(f.status);
      expect(f.text, path).not.toMatch(/ZZP/);
    }
  });
});
